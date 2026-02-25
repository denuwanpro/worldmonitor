// api/custom-news.js
export const config = { runtime: 'edge' };

// ඔයාට ඕනේ කරන හොඳම Tech/AI News ලින්ක් ටික (feeds.ts එකෙන් ගත්ත)
const TARGET_FEEDS = [
  'https://techcrunch.com/feed/',
  'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  'https://venturebeat.com/category/ai/feed/',
  'https://hnrss.org/frontpage', // HackerNews
  'https://news.google.com/rss/search?q=(OpenAI+OR+AI+OR+ChatGPT)+when:1d&hl=en-US&gl=US'
];

export default async function handler(req) {
  // CORS හදාගැනීම (N8N එකෙන් කතා කරනකොට අවුලක් නොඑන්න)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, s-maxage=300' // විනාඩි 5ක් Cache කරනවා
  };

  try {
    // සයිට් ඔක්කොටම එකවර Request යැවීම (වේගවත් වෙන්න)
    const fetchPromises = TARGET_FEEDS.map(async (feedUrl) => {
      try {
        const response = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml'
          },
          signal: AbortSignal.timeout(15000) // තත්පර 15න් අතාරිනවා
        });
        const xml = await response.text();
        return { url: feedUrl, xml };
      } catch (e) {
        return { url: feedUrl, xml: null }; // එකක් fail වුණත් අනිත් ඒවා වැඩ කරන්න
      }
    });

    const results = await Promise.all(fetchPromises);
    let allArticles = [];

    // XML එකෙන් අපිට ඕනේ Data ටික විතරක් JSON වලට කැඩීම
    results.forEach(({ url, xml }) => {
      if (!xml) return;
      
      const items = xml.split('<item>').slice(1);
      
      items.forEach(item => {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        
        if (titleMatch && linkMatch) {
          allArticles.push({
            source_url: url,
            title: titleMatch[1].replace(/&amp;/g, '&').replace(/&#8217;/g, "'"),
            link: linkMatch[1],
            date: pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now()
          });
        }
      });
    });

    // අලුත්ම නිවුස් උඩට එන විදිහට වෙලාව අනුව Sort කිරීම
    allArticles.sort((a, b) => b.date - a.date);

    // අලුත්ම නිවුස් 30 විතරක් N8N එකට යැවීම
    return new Response(JSON.stringify({ 
      success: true, 
      total: allArticles.length,
      articles: allArticles.slice(0, 30) 
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
