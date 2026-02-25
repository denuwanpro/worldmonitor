// api/custom-news.js
export const config = { runtime: 'edge' };

const TARGET_FEEDS = [
  'https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Gemini+OR+ChatGPT+OR+Claude)+when:1d&hl=en-US&gl=US',
  'https://news.google.com/rss/search?q=("Hugging+Face"+OR+"open-source+AI"+OR+Llama+OR+Mistral+OR+"open+weights")+when:1d&hl=en-US&gl=US',
  'https://news.google.com/rss/search?q=(Midjourney+OR+"OpenAI+Sora"+OR+RunwayML+OR+ElevenLabs+OR+"AI+video"+OR+"AI+image+generator"+OR+"AI+voice")+when:1d&hl=en-US&gl=US',
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  'https://venturebeat.com/category/ai/feed/'
];

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, s-maxage=300'
  };

  try {
    const fetchPromises = TARGET_FEEDS.map(async (feedUrl) => {
      try {
        const response = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(15000)
        });
        const xml = await response.text();
        return { url: feedUrl, xml };
      } catch (e) {
        return { url: feedUrl, xml: null };
      }
    });

    const results = await Promise.all(fetchPromises);
    let allArticles = [];

    results.forEach(({ url, xml }) => {
      if (!xml) return;
      
      const items = xml.split('<item>').slice(1);
      
      items.forEach(item => {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        
        // 🛑 පින්තූරය ඇදලා ගන්නා කොටස (Original Image)
        let imageUrl = null;
        const mediaMatch = item.match(/<media:content[^>]+url="([^"]+)"/i);
        const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"[^>]+type="image\//i);
        const imgTagMatch = item.match(/<img[^>]+src="([^"]+)"/i);
        
        if (mediaMatch) imageUrl = mediaMatch[1];
        else if (enclosureMatch) imageUrl = enclosureMatch[1];
        else if (imgTagMatch) imageUrl = imgTagMatch[1];

        if (titleMatch && linkMatch) {
          const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"');
          allArticles.push({
            source_url: url,
            title: title,
            link: linkMatch[1],
            image: imageUrl, // මුල් වෙබ් අඩවියේ පින්තූරය
            // 🛑 පින්තූර නැතිනම් භාවිතයට 100% Free AI පින්තූරයක් Generate කරන ලින්ක් එක
            ai_image: `https://image.pollinations.ai/prompt/${encodeURIComponent(title)}?width=1080&height=1080&nologo=true`,
            date: pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now()
          });
        }
      });
    });

    let uniqueArticles = [];
    let seenLinks = new Set();
    let seenTitles = new Set();

    allArticles.forEach(article => {
      let shortTitle = article.title.toLowerCase().split(' ').slice(0, 4).join(' ');
      if (!seenLinks.has(article.link) && !seenTitles.has(shortTitle)) {
        seenLinks.add(article.link);
        seenTitles.add(shortTitle);
        uniqueArticles.push(article);
      }
    });

    uniqueArticles.sort((a, b) => b.date - a.date);

    return new Response(JSON.stringify({ 
      success: true, 
      total: uniqueArticles.length,
      articles: uniqueArticles.slice(0, 50) 
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
