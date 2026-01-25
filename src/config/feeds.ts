import type { Feed } from '@/types';

const SITE_VARIANT = import.meta.env.VITE_VARIANT || 'full';

// Helper to create RSS proxy URL (Vercel)
const rss = (url: string) => `/api/rss-proxy?url=${encodeURIComponent(url)}`;

// Railway proxy for feeds blocked by Vercel IPs (UN News, CISA, etc.)
// Reuses VITE_WS_RELAY_URL which is already configured for AIS/OpenSky
const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const railwayBaseUrl = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '')
  : '';
const railwayRss = (url: string) =>
  railwayBaseUrl ? `${railwayBaseUrl}/rss?url=${encodeURIComponent(url)}` : rss(url);

// Source tier system for prioritization (lower = more authoritative)
// Tier 1: Wire services - fastest, most reliable breaking news
// Tier 2: Major outlets - high-quality journalism
// Tier 3: Specialty sources - domain expertise
// Tier 4: Aggregators & blogs - useful but less authoritative
export const SOURCE_TIERS: Record<string, number> = {
  // Tier 1 - Wire Services
  'Reuters': 1,
  'AP News': 1,
  'AFP': 1,
  'Bloomberg': 1,

  // Tier 2 - Major Outlets
  'BBC World': 2,
  'BBC Middle East': 2,
  'Guardian World': 2,
  'Guardian ME': 2,
  'NPR News': 2,
  'CNN World': 2,
  'CNBC': 2,
  'MarketWatch': 2,
  'Al Jazeera': 2,
  'Financial Times': 2,
  'Politico': 2,
  'Reuters World': 1,
  'Reuters Business': 1,
  'OpenAI News': 3,

  // Tier 1 - Official Government & International Orgs
  'White House': 1,
  'State Dept': 1,
  'Pentagon': 1,
  'UN News': 1,
  'CISA': 1,
  'Treasury': 2,
  'DOJ': 2,
  'DHS': 2,
  'CDC': 2,
  'FEMA': 2,

  // Tier 3 - Specialty
  'Defense One': 3,
  'Breaking Defense': 3,
  'The War Zone': 3,
  'Defense News': 3,
  'Janes': 3,
  'Foreign Policy': 3,
  'The Diplomat': 3,
  'Bellingcat': 3,
  'Krebs Security': 3,
  'Federal Reserve': 3,
  'SEC': 3,
  'MIT Tech Review': 3,
  'Ars Technica': 3,
  'Atlantic Council': 3,
  'Foreign Affairs': 3,
  'CrisisWatch': 3,
  'CSIS': 3,
  'RAND': 3,
  'Brookings': 3,
  'Carnegie': 3,
  'IAEA': 1,
  'WHO': 1,
  'UNHCR': 1,
  'Xinhua': 3,
  'TASS': 3,
  'Layoffs.fyi': 3,

  // Tier 2 - Premium Startup/VC Sources
  'Y Combinator Blog': 2,
  'a16z Blog': 2,
  'First Round Review': 2,
  'Sequoia Blog': 2,
  'Crunchbase News': 2,
  'CB Insights': 2,
  'PitchBook News': 2,
  'The Information': 2,

  // Tier 3 - Regional/Specialty Startup Sources
  'EU Startups': 3,
  'Tech.eu': 3,
  'Sifted (Europe)': 3,
  'Tech in Asia': 3,
  'TechCabal (Africa)': 3,
  'Inc42 (India)': 3,
  'YourStory': 3,
  'NFX Essays': 3,
  'Paul Graham Essays': 2,
  'Stratechery': 2,

  // Tier 4 - Aggregators
  'Hacker News': 4,
  'The Verge': 4,
  'The Verge AI': 4,
  'VentureBeat AI': 4,
  'Yahoo Finance': 4,
  'TechCrunch Layoffs': 4,
  'ArXiv AI': 4,
  'AI News': 4,
  'Layoffs News': 4,
};

export function getSourceTier(sourceName: string): number {
  return SOURCE_TIERS[sourceName] ?? 4; // Default to tier 4 if unknown
}

export type SourceType = 'wire' | 'gov' | 'intel' | 'mainstream' | 'market' | 'tech' | 'other';

export const SOURCE_TYPES: Record<string, SourceType> = {
  // Wire services - fastest, most authoritative
  'Reuters': 'wire', 'Reuters World': 'wire', 'Reuters Business': 'wire',
  'AP News': 'wire', 'AFP': 'wire', 'Bloomberg': 'wire',

  // Government & International Org sources
  'White House': 'gov', 'State Dept': 'gov', 'Pentagon': 'gov',
  'Treasury': 'gov', 'DOJ': 'gov', 'DHS': 'gov', 'CDC': 'gov',
  'FEMA': 'gov', 'Federal Reserve': 'gov', 'SEC': 'gov',
  'UN News': 'gov', 'CISA': 'gov',

  // Intel/Defense specialty
  'Defense One': 'intel', 'Breaking Defense': 'intel', 'The War Zone': 'intel',
  'Defense News': 'intel', 'Janes': 'intel', 'Bellingcat': 'intel', 'Krebs Security': 'intel',
  'Foreign Policy': 'intel', 'The Diplomat': 'intel',
  'Atlantic Council': 'intel', 'Foreign Affairs': 'intel',
  'CrisisWatch': 'intel',
  'CSIS': 'intel', 'RAND': 'intel', 'Brookings': 'intel', 'Carnegie': 'intel',
  'IAEA': 'gov', 'WHO': 'gov', 'UNHCR': 'gov',
  'Xinhua': 'wire', 'TASS': 'wire',

  // Mainstream outlets
  'BBC World': 'mainstream', 'BBC Middle East': 'mainstream',
  'Guardian World': 'mainstream', 'Guardian ME': 'mainstream',
  'NPR News': 'mainstream', 'Al Jazeera': 'mainstream',
  'CNN World': 'mainstream', 'Politico': 'mainstream',

  // Market/Finance
  'CNBC': 'market', 'MarketWatch': 'market', 'Yahoo Finance': 'market',
  'Financial Times': 'market',

  // Tech
  'Hacker News': 'tech', 'Ars Technica': 'tech', 'The Verge': 'tech',
  'The Verge AI': 'tech', 'MIT Tech Review': 'tech', 'TechCrunch Layoffs': 'tech',
  'AI News': 'tech', 'ArXiv AI': 'tech', 'VentureBeat AI': 'tech',
  'Layoffs.fyi': 'tech', 'Layoffs News': 'tech',
};

export function getSourceType(sourceName: string): SourceType {
  return SOURCE_TYPES[sourceName] ?? 'other';
}

// Propaganda risk assessment for sources (Quick Win #5)
// 'high' = State-controlled media, known to push government narratives
// 'medium' = State-affiliated or known editorial bias toward specific governments
// 'low' = Independent journalism with editorial standards
export type PropagandaRisk = 'low' | 'medium' | 'high';

export interface SourceRiskProfile {
  risk: PropagandaRisk;
  stateAffiliated?: string;
  knownBiases?: string[];
  note?: string;
}

export const SOURCE_PROPAGANDA_RISK: Record<string, SourceRiskProfile> = {
  // High risk - State-controlled media
  'Xinhua': { risk: 'high', stateAffiliated: 'China', note: 'Official CCP news agency' },
  'TASS': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state news agency' },
  'RT': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state media, banned in EU' },
  'Sputnik': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state media' },
  'CGTN': { risk: 'high', stateAffiliated: 'China', note: 'Chinese state broadcaster' },
  'Press TV': { risk: 'high', stateAffiliated: 'Iran', note: 'Iranian state media' },
  'KCNA': { risk: 'high', stateAffiliated: 'North Korea', note: 'North Korean state media' },

  // Medium risk - State-affiliated or known bias
  'Al Jazeera': { risk: 'medium', stateAffiliated: 'Qatar', note: 'Qatari state-funded, independent editorial' },
  'Al Arabiya': { risk: 'medium', stateAffiliated: 'Saudi Arabia', note: 'Saudi-owned, reflects Gulf perspective' },
  'TRT World': { risk: 'medium', stateAffiliated: 'Turkey', note: 'Turkish state broadcaster' },
  'France 24': { risk: 'medium', stateAffiliated: 'France', note: 'French state-funded, editorially independent' },
  'DW News': { risk: 'medium', stateAffiliated: 'Germany', note: 'German state-funded, editorially independent' },
  'Voice of America': { risk: 'medium', stateAffiliated: 'USA', note: 'US government-funded' },
  'Kyiv Independent': { risk: 'medium', knownBiases: ['Pro-Ukraine'], note: 'Ukrainian perspective on Russia-Ukraine war' },
  'Moscow Times': { risk: 'medium', knownBiases: ['Anti-Kremlin'], note: 'Independent, critical of Russian government' },

  // Low risk - Independent with editorial standards (explicit)
  'Reuters': { risk: 'low', note: 'Wire service, strict editorial standards' },
  'AP News': { risk: 'low', note: 'Wire service, nonprofit cooperative' },
  'AFP': { risk: 'low', note: 'Wire service, editorially independent' },
  'BBC World': { risk: 'low', note: 'Public broadcaster, editorial independence charter' },
  'BBC Middle East': { risk: 'low', note: 'Public broadcaster, editorial independence charter' },
  'Guardian World': { risk: 'low', knownBiases: ['Center-left'], note: 'Scott Trust ownership, no shareholders' },
  'Financial Times': { risk: 'low', note: 'Business focus, Nikkei-owned' },
  'Bellingcat': { risk: 'low', note: 'Open-source investigations, methodology transparent' },
};

export function getSourcePropagandaRisk(sourceName: string): SourceRiskProfile {
  return SOURCE_PROPAGANDA_RISK[sourceName] ?? { risk: 'low' };
}

export function isStateAffiliatedSource(sourceName: string): boolean {
  const profile = SOURCE_PROPAGANDA_RISK[sourceName];
  return !!profile?.stateAffiliated;
}

const FULL_FEEDS: Record<string, Feed[]> = {
  politics: [
    { name: 'BBC World', url: rss('https://feeds.bbci.co.uk/news/world/rss.xml') },
    { name: 'NPR News', url: rss('https://feeds.npr.org/1001/rss.xml') },
    { name: 'Guardian World', url: rss('https://www.theguardian.com/world/rss') },
    { name: 'AP News', url: rss('https://news.google.com/rss/search?q=site:apnews.com&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Reuters World', url: rss('https://news.google.com/rss/search?q=site:reuters.com+world&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Politico', url: rss('https://www.politico.com/rss/politicopicks.xml') },
    { name: 'The Diplomat', url: rss('https://thediplomat.com/feed/') },
  ],
  middleeast: [
    { name: 'BBC Middle East', url: rss('https://feeds.bbci.co.uk/news/world/middle_east/rss.xml') },
    { name: 'Al Jazeera', url: rss('https://www.aljazeera.com/xml/rss/all.xml') },
    { name: 'Al Arabiya', url: railwayRss('https://english.alarabiya.net/feed/rss2/en.xml') },
    { name: 'Arab News', url: railwayRss('https://www.arabnews.com/cat/2/rss.xml') },
    { name: 'Times of Israel', url: railwayRss('https://www.timesofisrael.com/feed/') },
    { name: 'Guardian ME', url: rss('https://www.theguardian.com/world/middleeast/rss') },
    { name: 'CNN World', url: rss('http://rss.cnn.com/rss/cnn_world.rss') },
  ],
  tech: [
    { name: 'Hacker News', url: rss('https://hnrss.org/frontpage') },
    { name: 'Ars Technica', url: rss('https://feeds.arstechnica.com/arstechnica/technology-lab') },
    { name: 'The Verge', url: rss('https://www.theverge.com/rss/index.xml') },
    { name: 'MIT Tech Review', url: rss('https://www.technologyreview.com/feed/') },
  ],
  ai: [
    { name: 'AI News', url: rss('https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Google+AI+OR+"large+language+model"+OR+ChatGPT)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VentureBeat AI', url: rss('https://venturebeat.com/category/ai/feed/') },
    { name: 'The Verge AI', url: rss('https://www.theverge.com/rss/ai-artificial-intelligence/index.xml') },
    { name: 'MIT Tech Review', url: rss('https://www.technologyreview.com/topic/artificial-intelligence/feed') },
    { name: 'ArXiv AI', url: rss('https://export.arxiv.org/rss/cs.AI') },
  ],
  finance: [
    { name: 'CNBC', url: rss('https://www.cnbc.com/id/100003114/device/rss/rss.html') },
    { name: 'MarketWatch', url: rss('https://feeds.marketwatch.com/marketwatch/topstories') },
    { name: 'Yahoo Finance', url: rss('https://finance.yahoo.com/news/rssindex') },
    { name: 'Financial Times', url: rss('https://www.ft.com/rss/home') },
    { name: 'Reuters Business', url: rss('https://news.google.com/rss/search?q=site:reuters.com+business+markets&hl=en-US&gl=US&ceid=US:en') },
  ],
  gov: [
    { name: 'White House', url: rss('https://news.google.com/rss/search?q=site:whitehouse.gov&hl=en-US&gl=US&ceid=US:en') },
    { name: 'State Dept', url: rss('https://news.google.com/rss/search?q=site:state.gov+OR+"State+Department"&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Pentagon', url: rss('https://news.google.com/rss/search?q=site:defense.gov+OR+Pentagon&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Treasury', url: rss('https://news.google.com/rss/search?q=site:treasury.gov+OR+"Treasury+Department"&hl=en-US&gl=US&ceid=US:en') },
    { name: 'DOJ', url: rss('https://news.google.com/rss/search?q=site:justice.gov+OR+"Justice+Department"+DOJ&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Federal Reserve', url: rss('https://www.federalreserve.gov/feeds/press_all.xml') },
    { name: 'SEC', url: rss('https://www.sec.gov/news/pressreleases.rss') },
    { name: 'CDC', url: rss('https://news.google.com/rss/search?q=site:cdc.gov+OR+CDC+health&hl=en-US&gl=US&ceid=US:en') },
    { name: 'FEMA', url: rss('https://news.google.com/rss/search?q=site:fema.gov+OR+FEMA+emergency&hl=en-US&gl=US&ceid=US:en') },
    { name: 'DHS', url: rss('https://news.google.com/rss/search?q=site:dhs.gov+OR+"Homeland+Security"&hl=en-US&gl=US&ceid=US:en') },
    { name: 'UN News', url: railwayRss('https://news.un.org/feed/subscribe/en/news/all/rss.xml') },
    { name: 'CISA', url: railwayRss('https://www.cisa.gov/cybersecurity-advisories/all.xml') },
  ],
  layoffs: [
    { name: 'Layoffs.fyi', url: rss('https://layoffs.fyi/feed/') },
    { name: 'TechCrunch Layoffs', url: rss('https://techcrunch.com/tag/layoffs/feed/') },
    { name: 'Layoffs News', url: rss('https://news.google.com/rss/search?q=(layoffs+OR+"job+cuts"+OR+"workforce+reduction")+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  thinktanks: [
    { name: 'Foreign Policy', url: rss('https://foreignpolicy.com/feed/') },
    { name: 'Atlantic Council', url: rss('https://www.atlanticcouncil.org/feed/') },
    { name: 'Foreign Affairs', url: rss('https://www.foreignaffairs.com/rss.xml') },
    { name: 'CSIS', url: rss('https://news.google.com/rss/search?q=site:csis.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'RAND', url: rss('https://news.google.com/rss/search?q=site:rand.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Brookings', url: rss('https://news.google.com/rss/search?q=site:brookings.edu+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Carnegie', url: rss('https://news.google.com/rss/search?q=site:carnegieendowment.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  crisis: [
    { name: 'CrisisWatch', url: rss('https://www.crisisgroup.org/rss') },
    { name: 'IAEA', url: rss('https://www.iaea.org/feeds/topnews') },
    { name: 'WHO', url: rss('https://www.who.int/rss-feeds/news-english.xml') },
    { name: 'UNHCR', url: rss('https://news.google.com/rss/search?q=site:unhcr.org+OR+UNHCR+refugees+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  regional: [
    { name: 'Xinhua', url: rss('https://news.google.com/rss/search?q=site:xinhuanet.com+OR+Xinhua+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TASS', url: rss('https://news.google.com/rss/search?q=site:tass.com+OR+TASS+Russia+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Kyiv Independent', url: rss('https://kyivindependent.com/feed/') },
    { name: 'Moscow Times', url: rss('https://www.themoscowtimes.com/rss/news') },
  ],
  africa: [
    { name: 'Africa News', url: rss('https://news.google.com/rss/search?q=(Africa+OR+Nigeria+OR+Kenya+OR+"South+Africa"+OR+Ethiopia)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Sahel Crisis', url: rss('https://news.google.com/rss/search?q=(Sahel+OR+Mali+OR+Niger+OR+"Burkina+Faso"+OR+Wagner)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'News24', url: railwayRss('https://feeds.capi24.com/v1/Search/articles/news24/Africa/rss') },
    { name: 'BBC Africa', url: rss('https://feeds.bbci.co.uk/news/world/africa/rss.xml') },
  ],
  latam: [
    { name: 'Latin America', url: rss('https://news.google.com/rss/search?q=(Brazil+OR+Mexico+OR+Argentina+OR+Venezuela+OR+Colombia)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'BBC Latin America', url: rss('https://feeds.bbci.co.uk/news/world/latin_america/rss.xml') },
    { name: 'Reuters LatAm', url: rss('https://news.google.com/rss/search?q=site:reuters.com+(Brazil+OR+Mexico+OR+Argentina)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Guardian Americas', url: rss('https://www.theguardian.com/world/americas/rss') },
  ],
  asia: [
    { name: 'Asia News', url: rss('https://news.google.com/rss/search?q=(China+OR+Japan+OR+Korea+OR+India+OR+ASEAN)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'BBC Asia', url: rss('https://feeds.bbci.co.uk/news/world/asia/rss.xml') },
    { name: 'South China Morning Post', url: railwayRss('https://www.scmp.com/rss/91/feed/') },
    { name: 'Reuters Asia', url: rss('https://news.google.com/rss/search?q=site:reuters.com+(China+OR+Japan+OR+Taiwan+OR+Korea)+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  energy: [
    { name: 'Oil & Gas', url: rss('https://news.google.com/rss/search?q=(oil+price+OR+OPEC+OR+"natural+gas"+OR+pipeline+OR+LNG)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Nuclear Energy', url: rss('https://news.google.com/rss/search?q=("nuclear+energy"+OR+"nuclear+power"+OR+uranium+OR+IAEA)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Reuters Energy', url: rss('https://news.google.com/rss/search?q=site:reuters.com+(oil+OR+gas+OR+energy+OR+OPEC)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Mining & Resources', url: rss('https://news.google.com/rss/search?q=(lithium+OR+"rare+earth"+OR+cobalt+OR+mining)+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
};

// Tech/AI variant feeds
const TECH_FEEDS: Record<string, Feed[]> = {
  tech: [
    { name: 'TechCrunch', url: rss('https://techcrunch.com/feed/') },
    { name: 'The Verge', url: rss('https://www.theverge.com/rss/index.xml') },
    { name: 'Ars Technica', url: rss('https://feeds.arstechnica.com/arstechnica/technology-lab') },
    { name: 'Hacker News', url: rss('https://hnrss.org/frontpage') },
    { name: 'MIT Tech Review', url: rss('https://www.technologyreview.com/feed/') },
    { name: 'ZDNet', url: rss('https://www.zdnet.com/news/rss.xml') },
    { name: 'TechMeme', url: rss('https://www.techmeme.com/feed.xml') },
    { name: 'Engadget', url: rss('https://www.engadget.com/rss.xml') },
    { name: 'Fast Company', url: rss('https://feeds.feedburner.com/fastcompany/headlines') },
  ],
  ai: [
    { name: 'AI News', url: rss('https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Google+AI+OR+"large+language+model"+OR+ChatGPT+OR+Claude+OR+"AI+model")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VentureBeat AI', url: rss('https://venturebeat.com/category/ai/feed/') },
    { name: 'The Verge AI', url: rss('https://www.theverge.com/rss/ai-artificial-intelligence/index.xml') },
    { name: 'MIT Tech Review AI', url: rss('https://www.technologyreview.com/topic/artificial-intelligence/feed') },
    { name: 'MIT Research', url: rss('https://news.mit.edu/rss/research') },
    { name: 'ArXiv AI', url: rss('https://export.arxiv.org/rss/cs.AI') },
    { name: 'ArXiv ML', url: rss('https://export.arxiv.org/rss/cs.LG') },
    { name: 'AI Weekly', url: rss('https://news.google.com/rss/search?q="artificial+intelligence"+OR+"machine+learning"+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Anthropic News', url: rss('https://news.google.com/rss/search?q=Anthropic+Claude+AI+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'OpenAI News', url: rss('https://news.google.com/rss/search?q=OpenAI+ChatGPT+GPT-4+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  startups: [
    { name: 'TechCrunch Startups', url: rss('https://techcrunch.com/category/startups/feed/') },
    { name: 'VentureBeat', url: rss('https://venturebeat.com/feed/') },
    { name: 'Crunchbase News', url: rss('https://news.crunchbase.com/feed/') },
    { name: 'SaaStr', url: rss('https://www.saastr.com/feed/') },
    { name: 'Product Hunt', url: rss('https://www.producthunt.com/feed') },
    { name: 'AngelList News', url: rss('https://news.google.com/rss/search?q=site:angellist.com+OR+"AngelList"+funding+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TechCrunch Venture', url: rss('https://techcrunch.com/category/venture/feed/') },
    { name: 'The Information', url: rss('https://news.google.com/rss/search?q=site:theinformation.com+startup+OR+funding+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Fortune Term Sheet', url: rss('https://news.google.com/rss/search?q="Term+Sheet"+venture+capital+OR+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'PitchBook News', url: rss('https://pitchbook.com/feed') },
    { name: 'CB Insights', url: rss('https://www.cbinsights.com/research/feed/') },
  ],
  vcblogs: [
    { name: 'Y Combinator Blog', url: rss('https://www.ycombinator.com/blog/rss/') },
    { name: 'a16z Blog', url: rss('https://a16z.com/feed/') },
    { name: 'First Round Review', url: rss('https://review.firstround.com/feed.xml') },
    { name: 'Sequoia Blog', url: rss('https://www.sequoiacap.com/feed/') },
    { name: 'NFX Essays', url: rss('https://www.nfx.com/feed') },
    { name: 'Paul Graham Essays', url: rss('https://www.aaronsw.com/2002/feeds/pgessays.rss') },
    { name: 'Both Sides of Table', url: rss('https://bothsidesofthetable.com/feed') },
    { name: 'Lenny\'s Newsletter', url: rss('https://www.lennysnewsletter.com/feed') },
    { name: 'Stratechery', url: rss('https://stratechery.com/feed/') },
    { name: 'FwdStart Newsletter', url: '/api/fwdstart' },
  ],
  regionalStartups: [
    { name: 'EU Startups', url: rss('https://www.eu-startups.com/feed/') },
    { name: 'Tech.eu', url: rss('https://tech.eu/feed/') },
    { name: 'Sifted (Europe)', url: rss('https://sifted.eu/feed') },
    { name: 'Tech in Asia', url: rss('https://www.techinasia.com/feed') },
    { name: 'KrASIA', url: rss('https://kr-asia.com/feed') },
    { name: 'TechCabal (Africa)', url: rss('https://techcabal.com/feed/') },
    { name: 'Disrupt Africa', url: rss('https://disrupt-africa.com/feed/') },
    { name: 'LAVCA (LATAM)', url: rss('https://lavca.org/feed/') },
    { name: 'Contxto (LATAM)', url: rss('https://contxto.com/feed/') },
    { name: 'Inc42 (India)', url: rss('https://inc42.com/feed/') },
    { name: 'YourStory', url: rss('https://yourstory.com/feed') },
  ],
  github: [
    { name: 'GitHub Blog', url: rss('https://github.blog/feed/') },
    { name: 'GitHub Trending', url: rss('https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml') },
    { name: 'Show HN', url: rss('https://hnrss.org/show') },
    { name: 'YC Launches', url: rss('https://hnrss.org/launches') },
    { name: 'Dev Events', url: rss('https://dev.events/rss.xml') },
    { name: 'Open Source News', url: rss('https://news.google.com/rss/search?q="open+source"+project+release+OR+launch+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  ipo: [
    { name: 'IPO News', url: rss('https://news.google.com/rss/search?q=(IPO+OR+"initial+public+offering"+OR+SPAC)+tech+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Renaissance IPO', url: rss('https://news.google.com/rss/search?q=site:renaissancecapital.com+IPO+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Tech IPO News', url: rss('https://news.google.com/rss/search?q=tech+IPO+OR+"tech+company"+IPO+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  funding: [
    { name: 'Crunchbase News', url: rss('https://news.crunchbase.com/feed/') },
    { name: 'TechCrunch Funding', url: rss('https://techcrunch.com/category/venture/feed/') },
    { name: 'SEC Filings', url: rss('https://news.google.com/rss/search?q=(S-1+OR+"IPO+filing"+OR+"SEC+filing")+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VC News', url: rss('https://news.google.com/rss/search?q=("Series+A"+OR+"Series+B"+OR+"Series+C"+OR+"funding+round"+OR+"venture+capital")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Seed & Pre-Seed', url: rss('https://news.google.com/rss/search?q=("seed+round"+OR+"pre-seed"+OR+"angel+round"+OR+"seed+funding")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startup Funding', url: rss('https://news.google.com/rss/search?q=("startup+funding"+OR+"raised+funding"+OR+"raised+$"+OR+"funding+announced")+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  producthunt: [
    { name: 'Product Hunt', url: rss('https://www.producthunt.com/feed') },
  ],
  outages: [
    { name: 'AWS Status', url: rss('https://news.google.com/rss/search?q=AWS+outage+OR+"Amazon+Web+Services"+down+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Cloud Outages', url: rss('https://news.google.com/rss/search?q=(Azure+OR+GCP+OR+Cloudflare+OR+Slack+OR+GitHub)+outage+OR+down+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],
  security: [
    { name: 'Krebs Security', url: rss('https://krebsonsecurity.com/feed/') },
    { name: 'The Hacker News', url: rss('https://feeds.feedburner.com/TheHackersNews') },
    { name: 'Dark Reading', url: rss('https://www.darkreading.com/rss.xml') },
    { name: 'Schneier', url: rss('https://www.schneier.com/feed/') },
  ],
  policy: [
    { name: 'Politico Tech', url: rss('https://rss.politico.com/technology.xml') },
    { name: 'AI Regulation', url: rss('https://news.google.com/rss/search?q=AI+regulation+OR+"artificial+intelligence"+law+OR+policy+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Tech Antitrust', url: rss('https://news.google.com/rss/search?q=tech+antitrust+OR+FTC+Google+OR+FTC+Apple+OR+FTC+Amazon+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  finance: [
    { name: 'CNBC Tech', url: rss('https://www.cnbc.com/id/19854910/device/rss/rss.html') },
    { name: 'MarketWatch Tech', url: rss('https://feeds.marketwatch.com/marketwatch/topstories/') },
    { name: 'Yahoo Finance', url: rss('https://finance.yahoo.com/rss/topstories') },
    { name: 'Seeking Alpha Tech', url: rss('https://seekingalpha.com/market_currents.xml') },
  ],
  hardware: [
    { name: "Tom's Hardware", url: rss('https://www.tomshardware.com/feeds/all') },
    { name: 'SemiAnalysis', url: rss('https://www.semianalysis.com/feed') },
    { name: 'Semiconductor News', url: rss('https://news.google.com/rss/search?q=semiconductor+OR+chip+OR+TSMC+OR+NVIDIA+OR+Intel+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  cloud: [
    { name: 'InfoQ', url: rss('https://feed.infoq.com/') },
    { name: 'The New Stack', url: rss('https://thenewstack.io/feed/') },
    { name: 'DevOps.com', url: rss('https://devops.com/feed/') },
  ],
  dev: [
    { name: 'Dev.to', url: rss('https://dev.to/feed') },
    { name: 'Lobsters', url: rss('https://lobste.rs/rss') },
    { name: 'Changelog', url: rss('https://changelog.com/feed') },
  ],
  layoffs: [
    { name: 'Layoffs.fyi', url: rss('https://news.google.com/rss/search?q=tech+layoffs+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TechCrunch Layoffs', url: rss('https://techcrunch.com/tag/layoffs/feed/') },
  ],
  unicorns: [
    { name: 'Unicorn News', url: rss('https://news.google.com/rss/search?q=("unicorn+startup"+OR+"unicorn+valuation"+OR+"$1+billion+valuation")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'CB Insights Unicorn', url: rss('https://news.google.com/rss/search?q=site:cbinsights.com+unicorn+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Decacorn News', url: rss('https://news.google.com/rss/search?q=("decacorn"+OR+"$10+billion+valuation"+OR+"$10B+valuation")+startup+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'New Unicorns', url: rss('https://news.google.com/rss/search?q=("becomes+unicorn"+OR+"joins+unicorn"+OR+"reaches+unicorn"+OR+"achieved+unicorn")+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
  accelerators: [
    { name: 'YC News', url: rss('https://news.ycombinator.com/rss') },
    { name: 'YC Blog', url: rss('https://www.ycombinator.com/blog/rss/') },
    { name: 'Techstars Blog', url: rss('https://www.techstars.com/blog/feed/') },
    { name: '500 Global News', url: rss('https://news.google.com/rss/search?q="500+Global"+OR+"500+Startups"+accelerator+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Demo Day News', url: rss('https://news.google.com/rss/search?q=("demo+day"+OR+"YC+batch"+OR+"accelerator+batch")+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startup School', url: rss('https://news.google.com/rss/search?q="Startup+School"+OR+"YC+Startup+School"+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
};

// Variant-aware exports
export const FEEDS = SITE_VARIANT === 'tech' ? TECH_FEEDS : FULL_FEEDS;

export const INTEL_SOURCES: Feed[] = [
  { name: 'Defense One', url: rss('https://www.defenseone.com/rss/all/'), type: 'defense' },
  { name: 'Breaking Defense', url: rss('https://breakingdefense.com/feed/'), type: 'defense' },
  { name: 'The War Zone', url: rss('https://www.thedrive.com/the-war-zone/rss'), type: 'defense' },
  { name: 'Defense News', url: rss('https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml'), type: 'defense' },
  { name: 'Janes', url: rss('https://news.google.com/rss/search?q=site:janes.com+when:3d&hl=en-US&gl=US&ceid=US:en'), type: 'defense' },
  { name: 'Bellingcat', url: rss('https://www.bellingcat.com/feed/'), type: 'osint' },
  { name: 'Krebs Security', url: rss('https://krebsonsecurity.com/feed/'), type: 'cyber' },
];

// Keywords that trigger alert status - must be specific to avoid false positives
export const ALERT_KEYWORDS = [
  'war', 'invasion', 'military', 'nuclear', 'sanctions', 'missile',
  'airstrike', 'drone strike', 'troops deployed', 'armed conflict', 'bombing', 'casualties',
  'ceasefire', 'peace treaty', 'nato', 'coup', 'martial law',
  'assassination', 'terrorist', 'terror attack', 'cyber attack', 'hostage', 'evacuation order',
];

// Patterns that indicate non-alert content (lifestyle, entertainment, etc.)
export const ALERT_EXCLUSIONS = [
  'protein', 'couples', 'relationship', 'dating', 'diet', 'fitness',
  'recipe', 'cooking', 'shopping', 'fashion', 'celebrity', 'movie',
  'tv show', 'sports', 'game', 'concert', 'festival', 'wedding',
  'vacation', 'travel tips', 'life hack', 'self-care', 'wellness',
];
