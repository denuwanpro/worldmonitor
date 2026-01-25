#!/usr/bin/env node
/**
 * AIS WebSocket Relay Server
 * Proxies aisstream.io data to browsers via WebSocket
 *
 * Deploy on Railway with:
 *   AISSTREAM_API_KEY=your_key
 *
 * Local: node scripts/ais-relay.cjs
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.AISSTREAM_API_KEY || process.env.VITE_AISSTREAM_API_KEY;
const PORT = process.env.PORT || 3004;

if (!API_KEY) {
  console.error('[Relay] Error: AISSTREAM_API_KEY environment variable not set');
  console.error('[Relay] Get a free key at https://aisstream.io');
  process.exit(1);
}

let upstreamSocket = null;
let clients = new Set();
let messageCount = 0;

// OpenSky OAuth2 token cache
let openskyToken = null;
let openskyTokenExpiry = 0;

async function getOpenSkyToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (openskyToken && Date.now() < openskyTokenExpiry - 60000) {
    return openskyToken;
  }

  try {
    console.log('[Relay] Fetching new OpenSky OAuth2 token...');
    const https = require('https');

    return new Promise((resolve, reject) => {
      const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

      const req = https.request({
        hostname: 'auth.opensky-network.org',
        port: 443,
        path: '/auth/realms/opensky-network/protocol/openid-connect/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              openskyToken = json.access_token;
              // Token valid for 30 min, cache with expiry
              openskyTokenExpiry = Date.now() + (json.expires_in || 1800) * 1000;
              console.log('[Relay] OpenSky token acquired, expires in', json.expires_in, 'seconds');
              resolve(openskyToken);
            } else {
              console.error('[Relay] OpenSky token error:', json.error || 'Unknown');
              resolve(null);
            }
          } catch (e) {
            console.error('[Relay] OpenSky token parse error:', e.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Relay] OpenSky token request error:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  } catch (err) {
    console.error('[Relay] OpenSky token error:', err.message);
    return null;
  }
}

async function handleOpenSkyRequest(req, res, PORT) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const params = url.searchParams;

    const token = await getOpenSkyToken();
    if (!token) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OpenSky not configured or auth failed', time: Date.now(), states: [] }));
      return;
    }

    let openskyUrl = 'https://opensky-network.org/api/states/all';
    const queryParams = [];
    for (const key of ['lamin', 'lomin', 'lamax', 'lomax']) {
      if (params.has(key)) queryParams.push(`${key}=${params.get(key)}`);
    }
    if (queryParams.length > 0) {
      openskyUrl += '?' + queryParams.join('&');
    }

    console.log('[Relay] OpenSky request:', openskyUrl);

    const https = require('https');
    const request = https.get(openskyUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WorldMonitor/1.0',
        'Authorization': `Bearer ${token}`,
      },
      timeout: 15000
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        // If 401, invalidate token cache
        if (response.statusCode === 401) {
          console.log('[Relay] OpenSky 401, invalidating token cache');
          openskyToken = null;
          openskyTokenExpiry = 0;
        }
        res.writeHead(response.statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30'
        });
        res.end(data);
      });
    });

    request.on('error', (err) => {
      console.error('[Relay] OpenSky error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
    });

    request.on('timeout', () => {
      request.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timeout', time: Date.now(), states: null }));
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, time: Date.now(), states: null }));
  }
}

// HTTP server for health checks and OpenSky proxy
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      messages: messageCount,
      connected: upstreamSocket?.readyState === WebSocket.OPEN
    }));
  } else if (req.url.startsWith('/rss')) {
    // Proxy RSS feeds that block Vercel IPs
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const feedUrl = url.searchParams.get('url');

      if (!feedUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing url parameter' }));
      }

      // Allow domains that block Vercel IPs (must match feeds.ts railwayRss usage)
      const allowedDomains = [
        // Original
        'rss.cnn.com',
        'www.defensenews.com',
        'layoffs.fyi',
        // International Organizations
        'news.un.org',
        'www.cisa.gov',
        'www.iaea.org',
        'www.who.int',
        'www.crisisgroup.org',
        // Middle East & Regional News
        'english.alarabiya.net',
        'www.arabnews.com',
        'www.timesofisrael.com',
        'www.scmp.com',
        'kyivindependent.com',
        'www.themoscowtimes.com',
        // Africa
        'feeds.24.com',
        'feeds.capi24.com',  // News24 redirect destination
      ];
      const parsed = new URL(feedUrl);
      if (!allowedDomains.includes(parsed.hostname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Domain not allowed on Railway proxy' }));
      }

      console.log('[Relay] RSS request:', feedUrl);

      const https = require('https');
      const http = require('http');

      // Helper to fetch with redirect following (max 3 redirects)
      let responseHandled = false;

      const sendError = (statusCode, message) => {
        if (responseHandled || res.headersSent) return;
        responseHandled = true;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      };

      const fetchWithRedirects = (url, redirectCount = 0) => {
        if (redirectCount > 3) {
          return sendError(502, 'Too many redirects');
        }

        const protocol = url.startsWith('https') ? https : http;
        const request = protocol.get(url, {
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000
        }, (response) => {
          // Handle redirects
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            const redirectUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, url).href;
            console.log(`[Relay] Following redirect to: ${redirectUrl}`);
            return fetchWithRedirects(redirectUrl, redirectCount + 1);
          }

          // Handle gzip/deflate compressed responses from upstream
          const encoding = response.headers['content-encoding'];
          let stream = response;
          if (encoding === 'gzip' || encoding === 'deflate') {
            const zlib = require('zlib');
            stream = encoding === 'gzip' ? response.pipe(zlib.createGunzip()) : response.pipe(zlib.createInflate());
          }

          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            if (responseHandled || res.headersSent) return;
            responseHandled = true;
            const data = Buffer.concat(chunks);
            res.writeHead(response.statusCode, {
              'Content-Type': 'application/xml',
              'Cache-Control': 'public, max-age=300'
            });
            res.end(data);
          });
          stream.on('error', (err) => {
            console.error('[Relay] Decompression error:', err.message);
            sendError(502, 'Decompression failed: ' + err.message);
          });
        });

        request.on('error', (err) => {
          console.error('[Relay] RSS error:', err.message);
          sendError(502, err.message);
        });

        request.on('timeout', () => {
          request.destroy();
          sendError(504, 'Request timeout');
        });
      };

      fetchWithRedirects(feedUrl);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  } else if (req.url.startsWith('/opensky')) {
    // Proxy OpenSky API requests with OAuth2 authentication
    // OpenSky requires OAuth2 client credentials flow for cloud IPs
    handleOpenSkyRequest(req, res, PORT);
  } else {
    res.writeHead(404);
    res.end();
  }
});

function connectUpstream() {
  // Skip if already connected or connecting
  if (upstreamSocket?.readyState === WebSocket.OPEN ||
      upstreamSocket?.readyState === WebSocket.CONNECTING) return;

  console.log('[Relay] Connecting to aisstream.io...');
  const socket = new WebSocket(AISSTREAM_URL);
  upstreamSocket = socket;

  socket.on('open', () => {
    // Verify this socket is still the current one (race condition guard)
    if (upstreamSocket !== socket) {
      console.log('[Relay] Stale socket open event, closing');
      socket.close();
      return;
    }
    console.log('[Relay] Connected to aisstream.io');
    socket.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport'],
    }));
  });

  socket.on('message', (data) => {
    if (upstreamSocket !== socket) return; // Stale socket
    messageCount++;
    if (messageCount % 1000 === 0) {
      console.log(`[Relay] ${messageCount} messages, ${clients.size} clients`);
    }
    const message = data.toString();
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  socket.on('close', () => {
    if (upstreamSocket === socket) {
      upstreamSocket = null;
      console.log('[Relay] Disconnected, reconnecting in 5s...');
      setTimeout(connectUpstream, 5000);
    }
  });

  socket.on('error', (err) => {
    console.error('[Relay] Upstream error:', err.message);
  });
}

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`[Relay] WebSocket relay on port ${PORT}`);
});

wss.on('connection', (ws, req) => {
  console.log('[Relay] Client connected');
  clients.add(ws);
  connectUpstream();

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Relay] Client error:', err.message);
  });
});
