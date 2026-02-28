// api/custom-news.js
export const config = { runtime: 'edge' };

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

// ===== KEYWORD EXTRACTION =====
function getKeywords(title) {
  const stop = new Set([
    'the','a','an','is','are','was','were','has','have','had','will',
    'would','could','should','may','might','can','do','does','did',
    'to','of','in','for','on','at','by','with','from','up','about',
    'into','through','during','before','after','between','out','off',
    'over','under','again','then','once','here','there','when','where',
    'why','how','all','both','each','few','more','most','other','some',
    'such','no','nor','not','only','own','same','so','than','too',
    'very','just','new','says','said','report','reports','according',
    'also','now','latest','first','big','its','what','whats','who',
    'whos','that','this','these','those','been','being','your','you',
    'and','but','yet','still','really','actually','inside','gets',
    'got','get','makes','made','make','one','two','last','next',
    'launches','launched','launch','unveils','unveiled','announces',
    'announced','releases','released','introduces','reveals','adds',
    'rolls','hits','raises','says','inks','reaches','moves','stands',
    'support','supports','left','right','many','another','helps'
  ]);

  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w));
}

// ===== SIMILARITY CHECK =====
function areSimilar(title1, title2) {
  const kw1 = getKeywords(title1);
  const kw2 = getKeywords(title2);

  if (kw1.length < 2 || kw2.length < 2) return false;

  const set1 = new Set(kw1);
  const set2 = new Set(kw2);

  let common = 0;
  for (const w of set1) {
    if (set2.has(w)) common++;
  }

  // 50% overlap = same topic
  const ratio = common / Math.min(set1.size, set2.size);
  return ratio >= 0.5;
}

// ===== FILTER: skip non-news =====
function isRealNews(title) {
  const skip = [
    'techcrunch disrupt',
    'tickets at',
    'days left',
    'last 24 hours',
    'lock in the best',
    'exhibit in',
    'founder summit',
    'discount',
    'save on tickets'
  ];
  const t = title.toLowerCase();
  return !skip.some(s => t.includes(s));
}

export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, s-maxage=300'
  };

  try {
    const fetchPromises = TARGET_FEEDS.map(async (feed) => {
      try {
        const response = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
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
        const titleMatch =
          item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

        if (titleMatch && linkMatch) {
          const title = titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#8217;/g, "'")
            .replace(/&#8216;/g, "'")
            .replace(/&#8220;/g, '"')
            .replace(/&#8221;/g, '"')
            .replace(/&quot;/g, '"')
            .trim();

          if (title.length > 10 && isRealNews(title)) {
            allArticles.push({
              title,
              link: linkMatch[1].trim(),
              date: pubDateMatch
                ? new Date(pubDateMatch[1]).getTime()
                : Date.now(),
              source: name
            });
          }
        }
      });
    });

    // Newest first
    allArticles.sort((a, b) => b.date - a.date);

    // ===== DEDUP: 3 Steps =====

    // Step 1: Exact link dedup
    const seenLinks = new Set();
    let step1 = [];
    for (const a of allArticles) {
      if (!seenLinks.has(a.link)) {
        seenLinks.add(a.link);
        step1.push(a);
      }
    }

    // Step 2: Exact title dedup
    const seenTitles = new Set();
    let step2 = [];
    for (const a of step1) {
      const t = a.title.toLowerCase().trim();
      if (!seenTitles.has(t)) {
        seenTitles.add(t);
        step2.push(a);
      }
    }

    // Step 3: Similar topic dedup (50% keyword overlap)
    let final = [];
    for (const a of step2) {
      let isDup = false;
      for (const existing of final) {
        if (areSimilar(a.title, existing.title)) {
          isDup = true;
          break;
        }
      }
      if (!isDup) {
        final.push(a);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_raw: allArticles.length,
      total_after_dedup: final.length,
      articles: final.slice(0, 30)
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers });
  }
}
