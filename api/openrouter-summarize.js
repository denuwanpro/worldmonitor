/**
 * OpenRouter API Summarization Endpoint with Redis Caching
 * Fallback when Groq is rate-limited
 * Uses Llama 3.3 70B free model
 * Free tier: 50 requests/day (20/min)
 * Server-side Redis cache for cross-user deduplication
 */

import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const CACHE_TTL_SECONDS = 86400; // 24 hours

// Initialize Redis (lazy - only if env vars present)
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

// Generate cache key from headlines and geoContext (same as groq endpoint)
function getCacheKey(headlines, mode, geoContext = '') {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  return `summary:${hash}${geoHash}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Deduplicate similar headlines (same story from different sources)
function deduplicateHeadlines(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    // Normalize: lowercase, remove punctuation, collapse whitespace
    const normalized = headline.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract key words (4+ chars) for similarity check
    const words = new Set(normalized.split(' ').filter(w => w.length >= 4));

    // Check if this headline is too similar to any we've seen
    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter(w => seenWords.has(w));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(words);
      unique.push(headline);
    }
  }

  return unique;
}

export default async function handler(request) {
  // Only allow POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured', fallback: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { headlines, mode = 'brief', geoContext = '' } = await request.json();

    if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
      return new Response(JSON.stringify({ error: 'Headlines array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Redis cache first (shared with Groq endpoint)
    const redisClient = getRedis();
    const cacheKey = getCacheKey(headlines, mode, geoContext);

    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached && typeof cached === 'object' && cached.summary) {
          console.log('[OpenRouter] Cache hit:', cacheKey);
          return new Response(JSON.stringify({
            summary: cached.summary,
            model: cached.model || MODEL,
            provider: 'cache',
            cached: true,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (cacheError) {
        console.warn('[OpenRouter] Cache read error:', cacheError.message);
      }
    }

    // Deduplicate similar headlines (same story from different sources)
    const uniqueHeadlines = deduplicateHeadlines(headlines.slice(0, 8));
    const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

    let systemPrompt, userPrompt;

    // Include intelligence synthesis context in prompt if available
    const intelSection = geoContext ? `\n\n${geoContext}` : '';

    // Current date context for LLM (models may have outdated knowledge)
    const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}. Donald Trump is the current US President (second term, inaugurated Jan 2025).`;

    if (mode === 'brief') {
      systemPrompt = `${dateContext}

Summarize the key development in 2-3 sentences.
Rules:
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject: "Iran's regime...", "The US Treasury...", "Protests in..."
- CRITICAL FOCAL POINTS are the main actors - mention them by name
- If focal points show news + signals convergence, that's the lead
- No bullet points, no meta-commentary`;
      userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
    } else if (mode === 'analysis') {
      systemPrompt = `${dateContext}

Provide analysis in 2-3 sentences. Be direct and specific.
Rules:
- Lead with the insight - what's significant and why
- NEVER start with "Breaking news", "Tonight", "The key/dominant narrative is"
- Start with substance: "Iran faces...", "The escalation in...", "Multiple signals suggest..."
- CRITICAL FOCAL POINTS are your main actors - explain WHY they matter
- If focal points show news-signal correlation, flag as escalation
- Connect dots, be specific about implications`;
      userPrompt = `What's the key pattern or risk?\n${headlineText}${intelSection}`;
    } else {
      systemPrompt = `${dateContext}

Synthesize in 2 sentences max. Lead with substance. NEVER start with "Breaking news" or "Tonight" - just state the insight directly. CRITICAL focal points with news-signal convergence are significant.`;
      userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://worldmonitor.app',
        'X-Title': 'WorldMonitor',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenRouter] API error:', response.status, errorText);

      // Return fallback signal for rate limiting
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'OpenRouter API error', fallback: true }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return new Response(JSON.stringify({ error: 'Empty response', fallback: true }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store in Redis cache (shared with Groq endpoint)
    if (redisClient) {
      try {
        await redisClient.set(cacheKey, {
          summary,
          model: MODEL,
          timestamp: Date.now(),
        }, { ex: CACHE_TTL_SECONDS });
        console.log('[OpenRouter] Cached:', cacheKey);
      } catch (cacheError) {
        console.warn('[OpenRouter] Cache write error:', cacheError.message);
      }
    }

    return new Response(JSON.stringify({
      summary,
      model: MODEL,
      provider: 'openrouter',
      cached: false,
      tokens: data.usage?.total_tokens || 0,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800',
      },
    });

  } catch (error) {
    console.error('[OpenRouter] Error:', error);
    return new Response(JSON.stringify({ error: error.message, fallback: true }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
