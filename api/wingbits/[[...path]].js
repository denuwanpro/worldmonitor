// Wingbits API proxy - keeps API key server-side
// Note: Edge runtime is stateless - caching happens client-side and via HTTP Cache-Control
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/wingbits', '');

  // Get API key from server-side env
  const apiKey = process.env.WINGBITS_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'Wingbits not configured',
      configured: false
    }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // Route: GET /details/:icao24 - Aircraft details
  const detailsMatch = path.match(/^\/details\/([a-fA-F0-9]+)$/);
  if (detailsMatch) {
    const icao24 = detailsMatch[1].toLowerCase();

    try {
      const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return Response.json({
          error: `Wingbits API error: ${response.status}`,
          icao24,
        }, {
          status: response.status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      const data = await response.json();

      return Response.json(data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400', // 24h - aircraft details rarely change
        },
      });
    } catch (error) {
      return Response.json({
        error: `Fetch failed: ${error.message}`,
        icao24,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // Route: POST /details/batch - Batch lookup multiple aircraft (parallel)
  if (path === '/details/batch' && req.method === 'POST') {
    try {
      const body = await req.json();
      const icao24List = body.icao24s || [];

      if (!Array.isArray(icao24List) || icao24List.length === 0) {
        return Response.json({ error: 'icao24s array required' }, {
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Limit batch size to avoid overwhelming the API
      const limitedList = icao24List.slice(0, 20).map(id => id.toLowerCase());
      const results = {};

      // Fetch all in parallel
      const fetchPromises = limitedList.map(async (icao24) => {
        try {
          const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
            headers: {
              'x-api-key': apiKey,
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            return { icao24, data };
          }
        } catch {
          // Skip failed lookups
        }
        return null;
      });

      const fetchResults = await Promise.all(fetchPromises);

      for (const result of fetchResults) {
        if (result) {
          results[result.icao24] = result.data;
        }
      }

      return Response.json({
        results,
        fetched: Object.keys(results).length,
        requested: limitedList.length,
      }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return Response.json({
        error: `Batch lookup failed: ${error.message}`,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // Route: GET /health - Check Wingbits status
  if (path === '/health' || path === '') {
    try {
      const response = await fetch('https://customer-api.wingbits.com/health', {
        headers: { 'x-api-key': apiKey },
      });
      const data = await response.json();
      return Response.json({
        ...data,
        configured: true,
      }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        configured: true,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  return Response.json({ error: 'Not found' }, {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
