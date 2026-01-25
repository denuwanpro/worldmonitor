/**
 * Risk Scores API - Cached CII and Strategic Risk computation
 * Eliminates 15-minute "learning mode" for users by pre-computing scores
 * Uses Upstash Redis for cross-user caching (10-minute TTL)
 */

import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const CACHE_TTL_SECONDS = 600; // 10 minutes
const CACHE_KEY = 'risk:scores:v1';

// Tier 1 countries for CII
const TIER1_COUNTRIES = {
  US: 'United States', RU: 'Russia', CN: 'China', UA: 'Ukraine', IR: 'Iran',
  IL: 'Israel', TW: 'Taiwan', KP: 'North Korea', SA: 'Saudi Arabia', TR: 'Turkey',
  PL: 'Poland', DE: 'Germany', FR: 'France', GB: 'United Kingdom', IN: 'India',
  PK: 'Pakistan', SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
};

// Baseline geopolitical risk (0-50)
const BASELINE_RISK = {
  US: 5, RU: 35, CN: 25, UA: 50, IR: 40, IL: 45, TW: 30, KP: 45,
  SA: 20, TR: 25, PL: 10, DE: 5, FR: 10, GB: 5, IN: 20, PK: 35,
  SY: 50, YE: 50, MM: 45, VE: 40,
};

// Event significance multipliers
const EVENT_MULTIPLIER = {
  US: 0.3, RU: 2.0, CN: 2.5, UA: 0.8, IR: 2.0, IL: 0.7, TW: 1.5, KP: 3.0,
  SA: 2.0, TR: 1.2, PL: 0.8, DE: 0.5, FR: 0.6, GB: 0.5, IN: 0.8, PK: 1.5,
  SY: 0.7, YE: 0.7, MM: 1.8, VE: 1.8,
};

// Country keywords for matching
const COUNTRY_KEYWORDS = {
  US: ['united states', 'usa', 'america', 'washington', 'biden', 'trump', 'pentagon'],
  RU: ['russia', 'moscow', 'kremlin', 'putin'],
  CN: ['china', 'beijing', 'xi jinping', 'prc'],
  UA: ['ukraine', 'kyiv', 'zelensky', 'donbas'],
  IR: ['iran', 'tehran', 'khamenei', 'irgc'],
  IL: ['israel', 'tel aviv', 'netanyahu', 'idf', 'gaza'],
  TW: ['taiwan', 'taipei'],
  KP: ['north korea', 'pyongyang', 'kim jong'],
  SA: ['saudi arabia', 'riyadh'],
  TR: ['turkey', 'ankara', 'erdogan'],
  PL: ['poland', 'warsaw'],
  DE: ['germany', 'berlin'],
  FR: ['france', 'paris', 'macron'],
  GB: ['britain', 'uk', 'london'],
  IN: ['india', 'delhi', 'modi'],
  PK: ['pakistan', 'islamabad'],
  SY: ['syria', 'damascus'],
  YE: ['yemen', 'sanaa', 'houthi'],
  MM: ['myanmar', 'burma'],
  VE: ['venezuela', 'caracas', 'maduro'],
};

// Initialize Redis (lazy)
let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
  return redis;
}

function normalizeCountryName(text) {
  const lower = text.toLowerCase();
  for (const [code, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return code;
  }
  return null;
}

function getScoreLevel(score) {
  if (score >= 70) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 25) return 'normal';
  return 'low';
}

async function fetchACLEDProtests() {
  try {
    // Fetch recent protests from ACLED (last 7 days)
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await fetch(
      `https://api.acleddata.com/acled/read?event_type=Protests&event_type=Riots&event_date=${startDate}|${endDate}&event_date_where=BETWEEN&limit=500`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      console.warn('[RiskScores] ACLED fetch failed:', response.status);
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.warn('[RiskScores] ACLED error:', error.message);
    return [];
  }
}

function computeCIIScores(protests) {
  const countryEvents = new Map();

  // Count events per country
  for (const event of protests) {
    const country = event.country;
    const code = normalizeCountryName(country);
    if (code && TIER1_COUNTRIES[code]) {
      const count = countryEvents.get(code) || { protests: 0, riots: 0 };
      if (event.event_type === 'Riots') {
        count.riots++;
      } else {
        count.protests++;
      }
      countryEvents.set(code, count);
    }
  }

  // Compute scores for all Tier 1 countries
  const scores = [];
  const now = new Date();

  for (const [code, name] of Object.entries(TIER1_COUNTRIES)) {
    const events = countryEvents.get(code) || { protests: 0, riots: 0 };
    const baseline = BASELINE_RISK[code] || 20;
    const multiplier = EVENT_MULTIPLIER[code] || 1.0;

    // Unrest component: protests + riots (riots weighted 2x)
    const unrestRaw = (events.protests + events.riots * 2) * multiplier;
    const unrest = Math.min(100, Math.round(unrestRaw * 2));

    // Security component: baseline + riot contribution
    const security = Math.min(100, baseline + events.riots * multiplier * 5);

    // Information component: based on event count (proxy for news coverage)
    const totalEvents = events.protests + events.riots;
    const information = Math.min(100, totalEvents * multiplier * 3);

    // Composite score: weighted average + baseline
    const composite = Math.min(100, Math.round(
      baseline +
      (unrest * 0.4 + security * 0.35 + information * 0.25) * 0.5
    ));

    scores.push({
      code,
      name,
      score: composite,
      level: getScoreLevel(composite),
      trend: 'stable', // Would need historical data for real trend
      change24h: 0,
      components: { unrest, security, information },
      lastUpdated: now.toISOString(),
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function computeStrategicRisk(ciiScores) {
  // Top 5 CII scores weighted average
  const top5 = ciiScores.slice(0, 5);
  const ciiComponent = top5.reduce((sum, s, i) => {
    const weight = 1 - (i * 0.15); // 1.0, 0.85, 0.70, 0.55, 0.40
    return sum + s.score * weight;
  }, 0) / top5.reduce((_, __, i) => 1 - (i * 0.15), 0);

  // Overall strategic risk
  const overallScore = Math.round(ciiComponent * 0.7 + 15); // 30% baseline

  return {
    score: Math.min(100, overallScore),
    level: getScoreLevel(overallScore),
    trend: 'stable',
    lastUpdated: new Date().toISOString(),
    contributors: top5.map(s => ({
      country: s.name,
      code: s.code,
      score: s.score,
      level: s.level,
    })),
  };
}

export default async function handler(request) {
  // Allow GET only
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redisClient = getRedis();

  // Check cache first
  if (redisClient) {
    try {
      const cached = await redisClient.get(CACHE_KEY);
      if (cached && typeof cached === 'object') {
        console.log('[RiskScores] Cache hit');
        return new Response(JSON.stringify({
          ...cached,
          cached: true,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }
    } catch (cacheError) {
      console.warn('[RiskScores] Cache read error:', cacheError.message);
    }
  }

  try {
    // Fetch ACLED protests
    console.log('[RiskScores] Computing scores...');
    const protests = await fetchACLEDProtests();

    // Compute CII scores
    const ciiScores = computeCIIScores(protests);

    // Compute strategic risk
    const strategicRisk = computeStrategicRisk(ciiScores);

    const result = {
      cii: ciiScores,
      strategicRisk,
      protestCount: protests.length,
      computedAt: new Date().toISOString(),
    };

    // Cache in Redis
    if (redisClient) {
      try {
        await redisClient.set(CACHE_KEY, result, { ex: CACHE_TTL_SECONDS });
        console.log('[RiskScores] Cached scores');
      } catch (cacheError) {
        console.warn('[RiskScores] Cache write error:', cacheError.message);
      }
    }

    return new Response(JSON.stringify({
      ...result,
      cached: false,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });

  } catch (error) {
    console.error('[RiskScores] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
