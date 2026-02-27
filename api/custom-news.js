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

// ===== SMART DEDUP: similar topics එක group කරනවා =====
function getTopicKey(title) {
  const t = title.toLowerCase();
  
  // Stop words ඉවත් කරනවා
  const stopWords = ['the','a','an','is','are','was','were','has','have','had',
    'will','would','could','should','may','might','can','do','does','did',
    'to','of','in','for','on','at','by','with','from','up','about','into',
    'through','during','before','after','above','below','between','out',
    'off','over','under','again','further','then','once','here','there',
    'when','where','why','how','all','both','each','few','more','most',
    'other','some','such','no','nor','not','only','own','same','so',
    'than','too','very','just','new','says','said','report','reports',
    'according','sources','via','also','now','latest','first','big',
    'launches','launched','launch','unveils','unveiled','unveil',
    'announces','announced','announce','releases','released','release',
    'introduces','introduced','introduce','reveals','revealed','reveal',
    'gets','got','get','makes','made','make','shows','show','shown'];
  
  // Important words extract කරනවා
  const words = t
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w))
    .sort();
  
  // Top 4 keywords ගන්නවා - මේවා match වුනොත් same topic
  return words.slice(0, 4).join('|');
}

// ===== Similar title check =====
function areSimilar(title1, title2) {
  const words1 = new Set(title1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(title2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return false;
  
  let common = 0;
  for (const w of words1) {
    if (words2.has(w)) common++;
  }
  
  const similarity = common / Math.min(words1.size, words2.size);
  return similarity > 0.6; // 60% similar words = same news
}

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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml'
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
        
        if (titleMatch && linkMatch) {
          allArticles.push({
            title: titleMatch[1].replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"'),
            link: linkMatch[1],
            date: pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now()
          });
        }
      });
    });

    // Sort by date (newest first)
    allArticles.sort((a, b) => b.date - a.date);

    // ===== AGGRESSIVE DEDUP =====
    // Step 1: Exact link dedup
    let step1 = [];
    const seenLinks = new Set();
    for (const a of allArticles) {
      if (!seenLinks.has(a.link)) {
        seenLinks.add(a.link);
        step1.push(a);
      }
    }

    // Step 2: Topic key dedup (same keywords = same news)
    let step2 = [];
    const seenTopics = new Set();
    for (const a of step1) {
      const key = getTopicKey(a.title);
      if (!seenTopics.has(key)) {
        seenTopics.add(key);
        step2.push(a);
      }
    }

    // Step 3: Similarity dedup (60%+ word overlap = same news)
    let final = [];
    for (const a of step2) {
      let isDuplicate = false;
      for (const existing of final) {
        if (areSimilar(a.title, existing.title)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        final.push(a);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      total_raw: allArticles.length,
      total_after_dedup: final.length,
      articles: final.slice(0, 50)
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
