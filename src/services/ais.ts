import type { AisDisruptionEvent, AisDensityZone } from '@/types';
import { dataFreshness } from './data-freshness';

// WebSocket relay for live vessel tracking
// Dev: local relay (node scripts/ais-relay.cjs)
// Prod: configured via VITE_WS_RELAY_URL env var
const AISSTREAM_URL = import.meta.env.VITE_WS_RELAY_URL || 'ws://localhost:3004';

// AIS is configured if VITE_WS_RELAY_URL is set OR we're on localhost (dev mode)
const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const aisConfigured = Boolean(import.meta.env.VITE_WS_RELAY_URL) || isLocalhost;

export function isAisConfigured(): boolean {
  return aisConfigured;
}

// Grid cell size for density aggregation (degrees)
const GRID_SIZE = 2;
// Time window for density calculation (ms)
const DENSITY_WINDOW = 30 * 60 * 1000; // 30 minutes
// Gap threshold for disruption detection (ms)
const GAP_THRESHOLD = 60 * 60 * 1000; // 1 hour without signal = potential dark ship

interface VesselPosition {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  timestamp: number;
  shipType?: number;
}

interface GridCell {
  lat: number;
  lon: number;
  vessels: Set<string>;
  lastUpdate: number;
  previousCount: number;
}

// In-memory vessel tracking
const vessels = new Map<string, VesselPosition>();
const densityGrid = new Map<string, GridCell>();
const vesselHistory = new Map<string, number[]>(); // MMSI -> last seen timestamps

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let isConnected = false;
let isConnecting = false;
let messageCount = 0;

// Callback system for external listeners (e.g., military vessel tracking)
export interface AisPositionData {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  shipType?: number;
  heading?: number;
  speed?: number;
  course?: number;
}
type AisCallback = (data: AisPositionData) => void;
const positionCallbacks = new Set<AisCallback>();

export function registerAisCallback(callback: AisCallback): void {
  positionCallbacks.add(callback);
}

export function unregisterAisCallback(callback: AisCallback): void {
  positionCallbacks.delete(callback);
}

// Regions of interest for monitoring
const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.5, radius: 2 },
  { name: 'Suez Canal', lat: 30.0, lon: 32.5, radius: 1 },
  { name: 'Strait of Malacca', lat: 2.5, lon: 101.5, radius: 2 },
  { name: 'Bab el-Mandeb', lat: 12.5, lon: 43.5, radius: 1.5 },
  { name: 'Panama Canal', lat: 9.0, lon: -79.5, radius: 1 },
  { name: 'Taiwan Strait', lat: 24.5, lon: 119.5, radius: 2 },
  { name: 'South China Sea', lat: 15.0, lon: 115.0, radius: 5 },
  { name: 'Black Sea', lat: 43.5, lon: 34.0, radius: 3 },
];

function getGridKey(lat: number, lon: number): string {
  const gridLat = Math.floor(lat / GRID_SIZE) * GRID_SIZE;
  const gridLon = Math.floor(lon / GRID_SIZE) * GRID_SIZE;
  return `${gridLat},${gridLon}`;
}

function processPositionReport(data: {
  MetaData: { MMSI: number; ShipName: string; latitude: number; longitude: number; time_utc: string; ShipType?: number };
  Message: { PositionReport?: { Latitude: number; Longitude: number; Cog?: number; Sog?: number; TrueHeading?: number } };
}): void {
  const meta = data.MetaData;
  const pos = data.Message.PositionReport;

  if (!meta || !pos) return;

  const mmsi = String(meta.MMSI);
  const lat = pos.Latitude ?? meta.latitude;
  const lon = pos.Longitude ?? meta.longitude;
  const now = Date.now();

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  // Update vessel position
  vessels.set(mmsi, {
    mmsi,
    name: meta.ShipName || `Vessel ${mmsi}`,
    lat,
    lon,
    timestamp: now,
    shipType: meta.ShipType,
  });

  // Notify callbacks (for military vessel tracking, etc.)
  if (positionCallbacks.size > 0) {
    const callbackData: AisPositionData = {
      mmsi,
      name: meta.ShipName || '',
      lat,
      lon,
      shipType: meta.ShipType,
      heading: pos.TrueHeading,
      speed: pos.Sog,
      course: pos.Cog,
    };
    for (const callback of positionCallbacks) {
      try {
        callback(callbackData);
      } catch {
        // Ignore callback errors
      }
    }
  }

  // Track vessel history for gap detection
  const history = vesselHistory.get(mmsi) || [];
  history.push(now);
  if (history.length > 10) history.shift();
  vesselHistory.set(mmsi, history);

  // Update density grid
  const gridKey = getGridKey(lat, lon);
  let cell = densityGrid.get(gridKey);
  if (!cell) {
    cell = {
      lat: Math.floor(lat / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      lon: Math.floor(lon / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
      vessels: new Set(),
      lastUpdate: now,
      previousCount: 0,
    };
    densityGrid.set(gridKey, cell);
  }
  cell.vessels.add(mmsi);
  cell.lastUpdate = now;

  messageCount++;
}

function handleMessage(event: MessageEvent): void {
  try {
    const data = JSON.parse(event.data);

    if (data.MessageType === 'PositionReport') {
      processPositionReport(data);
      if (messageCount % 100 === 0) {
        console.log(`[Shipping] Received ${messageCount} position reports, tracking ${vessels.size} vessels`);
        // Update data freshness every 100 messages
        dataFreshness.recordUpdate('ais', vessels.size);
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
}

function connect(): void {
  if (isConnecting || isConnected) return;
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  isConnecting = true;
  console.log('[Shipping] Opening WebSocket to:', AISSTREAM_URL);
  try {
    socket = new WebSocket(AISSTREAM_URL);

    socket.onopen = () => {
      console.log('[Shipping] Connected to relay');
      isConnected = true;
      isConnecting = false;
      ensureCleanupInterval();
    };

    socket.onmessage = handleMessage;

    socket.onclose = (event) => {
      console.log('[Shipping] Disconnected:', event.code, event.reason || 'No reason');
      isConnected = false;
      isConnecting = false;
      socket = null;
      scheduleReconnect();
    };

    socket.onerror = (error) => {
      console.error('[Shipping] WebSocket error:', error);
      isConnected = false;
      isConnecting = false;
      if (socket) {
        socket.close();
        socket = null;
      }
    };
  } catch (e) {
    console.error('[Shipping] Failed to connect:', e);
    isConnecting = false;
    scheduleReconnect();
  }
}

function ensureCleanupInterval(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupOldData, 60 * 1000);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, 30000); // Reconnect after 30s
}

function cleanupOldData(): void {
  const now = Date.now();
  const cutoff = now - DENSITY_WINDOW;

  // Remove old vessel positions
  for (const [mmsi, vessel] of vessels) {
    if (vessel.timestamp < cutoff) {
      vessels.delete(mmsi);
    }
  }

  // Prune vesselHistory for removed vessels and old timestamps
  for (const [mmsi, history] of vesselHistory) {
    if (!vessels.has(mmsi)) {
      vesselHistory.delete(mmsi);
    } else {
      const filtered = history.filter(ts => ts >= cutoff);
      if (filtered.length === 0) {
        vesselHistory.delete(mmsi);
      } else {
        vesselHistory.set(mmsi, filtered);
      }
    }
  }

  // Update grid cells
  for (const [key, cell] of densityGrid) {
    cell.previousCount = cell.vessels.size;

    // Remove vessels not seen recently from this cell
    for (const mmsi of cell.vessels) {
      const vessel = vessels.get(mmsi);
      if (!vessel || vessel.timestamp < cutoff) {
        cell.vessels.delete(mmsi);
      }
    }

    // Remove empty cells
    if (cell.vessels.size === 0 && now - cell.lastUpdate > DENSITY_WINDOW * 2) {
      densityGrid.delete(key);
    }
  }
}

function detectDisruptions(): AisDisruptionEvent[] {
  const disruptions: AisDisruptionEvent[] = [];
  const now = Date.now();

  // Report on all chokepoints with vessel activity
  for (const chokepoint of CHOKEPOINTS) {
    let vesselCount = 0;

    for (const vessel of vessels.values()) {
      const distance = Math.sqrt(
        Math.pow(vessel.lat - chokepoint.lat, 2) +
        Math.pow(vessel.lon - chokepoint.lon, 2)
      );
      if (distance <= chokepoint.radius) {
        vesselCount++;
      }
    }

    // Show any chokepoint with vessels (lower threshold: 5+ vessels)
    if (vesselCount >= 5) {
      const normalTraffic = chokepoint.radius * 10; // Expected baseline
      const severity = vesselCount > normalTraffic * 1.5 ? 'high' :
                       vesselCount > normalTraffic ? 'elevated' : 'low';

      disruptions.push({
        id: `chokepoint-${chokepoint.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: chokepoint.name,
        type: 'chokepoint_congestion',
        lat: chokepoint.lat,
        lon: chokepoint.lon,
        severity,
        changePct: normalTraffic > 0 ? Math.round((vesselCount / normalTraffic - 1) * 100) : 0,
        windowHours: 1,
        vesselCount,
        region: chokepoint.name,
        description: `${vesselCount} vessels in ${chokepoint.name}`,
      });
    }
  }

  // Check for AIS gap spikes (dark ships)
  let darkShipCount = 0;
  for (const [, history] of vesselHistory) {
    if (history.length >= 2) {
      const lastSeen = history[history.length - 1]!;
      const secondLast = history[history.length - 2]!;

      // If there was a long gap and vessel just reappeared
      if (lastSeen - secondLast > GAP_THRESHOLD && now - lastSeen < 10 * 60 * 1000) {
        darkShipCount++;
      }
    }
  }

  if (darkShipCount >= 1) {
    disruptions.push({
      id: 'global-gap-spike',
      name: 'AIS Gap Spike Detected',
      type: 'gap_spike',
      lat: 0,
      lon: 0,
      severity: darkShipCount > 20 ? 'high' : darkShipCount > 10 ? 'elevated' : 'low',
      changePct: darkShipCount * 10,
      windowHours: 1,
      darkShips: darkShipCount,
      description: `${darkShipCount} vessels returned after extended AIS silence`,
    });
  }

  return disruptions;
}

function calculateDensityZones(): AisDensityZone[] {
  const zones: AisDensityZone[] = [];
  const allCells = Array.from(densityGrid.values()).filter(c => c.vessels.size >= 2);

  if (allCells.length === 0) return zones;

  const vesselCounts = allCells.map(c => c.vessels.size);
  const maxVessels = Math.max(...vesselCounts);
  const minVessels = Math.min(...vesselCounts);

  for (const [key, cell] of densityGrid) {
    if (cell.vessels.size < 2) continue;

    // Use logarithmic scaling to make smaller zones visible
    // This ensures zones with fewer ships still appear on the map
    const logMax = Math.log(maxVessels + 1);
    const logMin = Math.log(minVessels + 1);
    const logCurrent = Math.log(cell.vessels.size + 1);

    // Normalize to 0.2-1.0 range (minimum 20% intensity for visibility)
    const intensity = logMax > logMin
      ? 0.2 + 0.8 * (logCurrent - logMin) / (logMax - logMin)
      : 0.5;

    const deltaPct = cell.previousCount > 0
      ? Math.round(((cell.vessels.size - cell.previousCount) / cell.previousCount) * 100)
      : 0;

    zones.push({
      id: `density-${key}`,
      name: `Zone ${key}`,
      lat: cell.lat,
      lon: cell.lon,
      intensity,
      deltaPct,
      shipsPerDay: cell.vessels.size * 48,
      note: cell.vessels.size >= 10 ? 'High traffic area' : undefined,
    });
  }

  // Return all qualifying zones (increased from 50 to 200 for global coverage)
  const sorted = zones.sort((a, b) => b.intensity - a.intensity).slice(0, 200);


  return sorted;
}

export function initAisStream(): void {
  console.log('[Shipping] Initializing AIS stream...');
  connect();
  ensureCleanupInterval();
}

export function disconnectAisStream(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  isConnected = false;
  isConnecting = false;
}

export function getAisStatus(): { connected: boolean; vessels: number; messages: number } {
  return {
    connected: isConnected,
    vessels: vessels.size,
    messages: messageCount,
  };
}

export async function fetchAisSignals(): Promise<{ disruptions: AisDisruptionEvent[]; density: AisDensityZone[] }> {
  // Initialize stream if not already running
  if (!socket && !isConnecting) {
    connect();
  }
  ensureCleanupInterval();

  // Return aggregated data from in-memory tracking
  cleanupOldData();

  return {
    disruptions: detectDisruptions(),
    density: calculateDensityZones(),
  };
}
