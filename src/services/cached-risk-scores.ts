/**
 * Cached Risk Scores Service
 * Fetches pre-computed CII and Strategic Risk scores from backend
 * Eliminates 15-minute learning mode for users
 */

import type { CountryScore, ComponentScores } from './country-instability';
import { setHasCachedScores } from './country-instability';

export interface CachedCIIScore {
  code: string;
  name: string;
  score: number;
  level: 'low' | 'normal' | 'elevated' | 'high' | 'critical';
  trend: 'rising' | 'stable' | 'falling';
  change24h: number;
  components: ComponentScores;
  lastUpdated: string;
}

export interface CachedStrategicRisk {
  score: number;
  level: string;
  trend: string;
  lastUpdated: string;
  contributors: Array<{
    country: string;
    code: string;
    score: number;
    level: string;
  }>;
}

export interface CachedRiskScores {
  cii: CachedCIIScore[];
  strategicRisk: CachedStrategicRisk;
  protestCount: number;
  computedAt: string;
  cached: boolean;
}

let cachedScores: CachedRiskScores | null = null;
let fetchPromise: Promise<CachedRiskScores | null> | null = null;
let lastFetchTime = 0;
const REFETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchCachedRiskScores(): Promise<CachedRiskScores | null> {
  const now = Date.now();

  // Return cached if fresh
  if (cachedScores && now - lastFetchTime < REFETCH_INTERVAL_MS) {
    return cachedScores;
  }

  // Deduplicate concurrent fetches
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const response = await fetch('/api/risk-scores');
      if (!response.ok) {
        console.warn('[CachedRiskScores] API error:', response.status);
        return cachedScores; // Return stale cache on error
      }

      const data = await response.json();
      cachedScores = data;
      lastFetchTime = now;
      setHasCachedScores(true); // Bypass 15-min learning mode
      console.log('[CachedRiskScores] Loaded', data.cached ? '(from Redis)' : '(computed)');
      return cachedScores;
    } catch (error) {
      console.error('[CachedRiskScores] Fetch error:', error);
      return cachedScores; // Return stale cache on error
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export function getCachedScores(): CachedRiskScores | null {
  return cachedScores;
}

export function hasCachedScores(): boolean {
  return cachedScores !== null;
}

/**
 * Convert cached CII score to CountryScore format
 */
export function toCountryScore(cached: CachedCIIScore): CountryScore {
  return {
    code: cached.code,
    name: cached.name,
    score: cached.score,
    level: cached.level,
    trend: cached.trend,
    change24h: cached.change24h,
    components: cached.components,
    lastUpdated: new Date(cached.lastUpdated),
  };
}
