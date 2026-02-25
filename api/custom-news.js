// api/custom-news.js
export const config = { runtime: 'edge' };

// 100% මුළු AI ලෝකෙම කවර් වෙන ලින්ක් ටික (Image, Video, Voice, OpenSource & LLMs)
const TARGET_FEEDS = [
  // 1. ප්‍රධාන LLM සහ සමාගම් (OpenAI, ChatGPT, Gemini, Claude ආදිය)
  'https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Gemini+OR+ChatGPT+OR+Claude)+when:1d&hl=en-US&gl=US',
  
  // 2. Open Source සහ Hugging Face (Llama, Mistral වගේ ඩිවලොපර්ස්ලගේ අලුත්ම දේවල්)
  'https://news.google.com/rss/search?q=("Hugging+Face"+OR+"open-source+AI"+OR+Llama+OR+Mistral+OR+"open+weights")+when:1d&hl=en-US&gl=US',
  
  // 3. Image, Video සහ Voice Models (Midjourney, Sora, AI Video වගේ ක්‍රියේටිව් දේවල්)
  'https://news.google.com/rss/search?q=(Midjourney+OR+"OpenAI+Sora"+OR+RunwayML+OR+ElevenLabs+OR+"AI+video"+OR+"AI+image+generator"+OR+"AI+voice")+when:1d&hl=en-US&gl=US',
  
  // 4. ලෝකේ ප්‍රධාන Tech අඩවි වල AI කොටස් පමණක් (විශ්වාසදායකම පුවත්)
  'https://techcrunch.com/category/artificial-intelligence/feed/',
  'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  'https://venturebeat.com/category/ai/feed/'
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
            title: titleMatch[1].replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"'),
            link: linkMatch[1],
            date: pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now()
          });
        }
      });
    });

    // 🛑 අලුත් කොටස: Duplicates (එකම නිවුස්) අයින් කිරීම 🛑
    let uniqueArticles = [];
    let seenLinks = new Set();
    let seenTitles = new Set();

    allArticles.forEach(article => {
      // ටයිට්ල් එකේ මුල් වචන 4 අරගෙන බලනවා ඒක කලින් ආවද කියලා
      let shortTitle = article.title.toLowerCase().split(' ').slice(0, 4).join(' ');
      
      if (!seenLinks.has(article.link) && !seenTitles.has(shortTitle)) {
        seenLinks.add(article.link);
        seenTitles.add(shortTitle);
        uniqueArticles.push(article);
      }
    });

    // අලුත්ම නිවුස් උඩට එන විදිහට වෙලාව අනුව Sort කිරීම
    uniqueArticles.sort((a, b) => b.date - a.date);

    // අලුත්ම, පිරිසිදුම නිවුස් 50 විතරක් N8N එකට යැවීම
    return new Response(JSON.stringify({ 
      success: true, 
      total: uniqueArticles.length,
      articles: uniqueArticles.slice(0, 50) 
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
