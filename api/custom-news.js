// api/custom-news.js
export const config = { runtime: 'edge' };

// හොඳම AI news sites 3 විතරයි - direct RSS feeds
const TARGET_FEEDS = [
  {
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    name: 'TechCrunch'
  },
  {
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    name: 'The Verge'
  },
  {
    url: 'https://venturebeat.com/category/ai/feed/',
    name: 'VentureBeat'
  }
];

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, s-maxage=300'
  };

  try {
    // සියලුම feeds එකවර fetch කරනවා
    const fetchPromises = TARGET_FEEDS.map(async (feed) => {
      try {
        const response = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
            'Accept': 'application/rss+xml, application/xml, text/xml'
          },
          signal: AbortSignal.timeout(15000)
        });
        const xml = await response.text();
        return { name: feed.name, xml };
      } catch (e) {
        return { name: feed.name, xml: null };
      }
    });

    const results = await Promise.all(fetchPromises);
    let allArticles = [];

    results.forEach(({ name, xml }) => {
      if (!xml) return;

      const items = xml.split('<item>').slice(1);

      items.forEach(item => {
        // Title extract
        const titleMatch = 
          item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || 
          item.match(/<title>(.*?)<\/title>/);

        // Link extract
        const linkMatch = item.match(/<link>(.*?)<\/link>/);

        // Date extract
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

        if (titleMatch && linkMatch) {
          const title = titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#8217;/g, "'")
            .replace(/&#8216;/g, "'")
            .replace(/&#8220;/g, '"')
            .replace(/&#8221;/g, '"')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();

          const link = linkMatch[1].trim();
          const date = pubDateMatch 
            ? new Date(pubDateMatch[1]).getTime() 
            : Date.now();

          // AI/Tech related articles only
          if (title.length > 10) {
            allArticles.push({
              title,
              link,
              date,
              source: name
            });
          }
        }
      });
    });

    // අලුත්ම ඒවා උඩට
    allArticles.sort((a, b) => b.date - a.date);

    // Simple dedup - exact title match only
    const seen = new Set();
    const unique = [];
    
    for (const a of allArticles) {
      const key = a.title.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(a);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: unique.length,
      articles: unique.slice(0, 30)
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { status: 500, headers });
  }
}
