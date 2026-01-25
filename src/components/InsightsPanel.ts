import { Panel } from './Panel';
import { mlWorker } from '@/services/ml-worker';
import { generateSummary, type SummarizationProvider } from '@/services/summarization';
import { parallelAnalysis, type AnalyzedHeadline } from '@/services/parallel-analysis';
import { signalAggregator, logSignalSummary, type RegionalConvergence } from '@/services/signal-aggregator';
import { focalPointDetector } from '@/services/focal-point-detector';
import { ingestNewsForCII } from '@/services/country-instability';
import { isMobileDevice } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import type { ClusteredEvent, FocalPoint } from '@/types';

export class InsightsPanel extends Panel {
  private isHidden = false;
  private lastBriefUpdate = 0;
  private cachedBrief: string | null = null;
  private briefProvider: SummarizationProvider | null = null;
  private lastMissedStories: AnalyzedHeadline[] = [];
  private lastConvergenceZones: RegionalConvergence[] = [];
  private lastFocalPoints: FocalPoint[] = [];
  private static readonly BRIEF_COOLDOWN_MS = 120000; // 2 min cooldown (API has limits)

  constructor() {
    super({
      id: 'insights',
      title: 'AI INSIGHTS',
      showCount: false,
      infoTooltip: `
        <strong>AI-Powered Analysis</strong><br>
        • <strong>World Brief</strong>: AI summary (Groq/OpenRouter)<br>
        • <strong>Sentiment</strong>: News tone analysis<br>
        • <strong>Velocity</strong>: Fast-moving stories<br>
        • <strong>Focal Points</strong>: Correlates news entities with map signals (military, protests, outages)<br>
        <em>Desktop only • Powered by Llama 3.3 + Focal Point Detection</em>
      `,
    });

    if (isMobileDevice()) {
      this.hide();
      this.isHidden = true;
    }
  }

  // High-priority military/conflict keywords (huge boost)
  private static readonly MILITARY_KEYWORDS = [
    'war', 'armada', 'invasion', 'airstrike', 'strike', 'missile', 'troops',
    'deployed', 'offensive', 'artillery', 'bomb', 'combat', 'fleet', 'warship',
    'carrier', 'navy', 'airforce', 'deployment', 'mobilization', 'attack',
  ];

  // Violence/casualty keywords (huge boost - human cost stories)
  private static readonly VIOLENCE_KEYWORDS = [
    'killed', 'dead', 'death', 'shot', 'blood', 'massacre', 'slaughter',
    'fatalities', 'casualties', 'wounded', 'injured', 'murdered', 'execution',
    'crackdown', 'violent', 'clashes', 'gunfire', 'shooting',
  ];

  // Civil unrest keywords (high boost)
  private static readonly UNREST_KEYWORDS = [
    'protest', 'protests', 'uprising', 'revolt', 'revolution', 'riot', 'riots',
    'demonstration', 'unrest', 'dissent', 'rebellion', 'insurgent', 'overthrow',
    'coup', 'martial law', 'curfew', 'shutdown', 'blackout',
  ];

  // Geopolitical flashpoints (major boost)
  private static readonly FLASHPOINT_KEYWORDS = [
    'iran', 'tehran', 'russia', 'moscow', 'china', 'beijing', 'taiwan', 'ukraine', 'kyiv',
    'north korea', 'pyongyang', 'israel', 'gaza', 'west bank', 'syria', 'damascus',
    'yemen', 'hezbollah', 'hamas', 'kremlin', 'pentagon', 'nato', 'wagner',
  ];

  // Crisis keywords (moderate boost)
  private static readonly CRISIS_KEYWORDS = [
    'crisis', 'emergency', 'catastrophe', 'disaster', 'collapse', 'humanitarian',
    'sanctions', 'ultimatum', 'threat', 'retaliation', 'escalation', 'tensions',
    'breaking', 'urgent', 'developing', 'exclusive',
  ];

  // Business/tech context that should REDUCE score (demote business news with military words)
  private static readonly DEMOTE_KEYWORDS = [
    'ceo', 'earnings', 'stock', 'startup', 'data center', 'datacenter', 'revenue',
    'quarterly', 'profit', 'investor', 'ipo', 'funding', 'valuation',
  ];

  private getImportanceScore(cluster: ClusteredEvent): number {
    let score = 0;
    const titleLower = cluster.primaryTitle.toLowerCase();

    // Source confirmation (base signal)
    score += cluster.sourceCount * 10;

    // Violence/casualty keywords: highest priority (+100 base, +25 per match)
    // "Pools of blood" type stories should always surface
    const violenceMatches = InsightsPanel.VIOLENCE_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (violenceMatches.length > 0) {
      score += 100 + (violenceMatches.length * 25);
    }

    // Military keywords: highest priority (+80 base, +20 per match)
    const militaryMatches = InsightsPanel.MILITARY_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (militaryMatches.length > 0) {
      score += 80 + (militaryMatches.length * 20);
    }

    // Civil unrest: high priority (+70 base, +18 per match)
    const unrestMatches = InsightsPanel.UNREST_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (unrestMatches.length > 0) {
      score += 70 + (unrestMatches.length * 18);
    }

    // Flashpoint keywords: high priority (+60 base, +15 per match)
    const flashpointMatches = InsightsPanel.FLASHPOINT_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (flashpointMatches.length > 0) {
      score += 60 + (flashpointMatches.length * 15);
    }

    // COMBO BONUS: Violence/unrest + flashpoint location = critical story
    // e.g., "Iran protests" + "blood" = huge boost
    if ((violenceMatches.length > 0 || unrestMatches.length > 0) && flashpointMatches.length > 0) {
      score *= 1.5; // 50% bonus for flashpoint unrest
    }

    // Crisis keywords: moderate priority (+30 base, +10 per match)
    const crisisMatches = InsightsPanel.CRISIS_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (crisisMatches.length > 0) {
      score += 30 + (crisisMatches.length * 10);
    }

    // Demote business/tech news that happens to contain military words
    const demoteMatches = InsightsPanel.DEMOTE_KEYWORDS.filter(kw => titleLower.includes(kw));
    if (demoteMatches.length > 0) {
      score *= 0.3; // Heavy penalty for business context
    }

    // Velocity multiplier
    const velMultiplier: Record<string, number> = {
      'viral': 3,
      'spike': 2.5,
      'elevated': 1.5,
      'normal': 1
    };
    score *= velMultiplier[cluster.velocity?.level ?? 'normal'] ?? 1;

    // Alert bonus
    if (cluster.isAlert) score += 50;

    // Recency bonus (decay over 12 hours)
    const ageMs = Date.now() - cluster.firstSeen.getTime();
    const ageHours = ageMs / 3600000;
    const recencyMultiplier = Math.max(0.5, 1 - (ageHours / 12));
    score *= recencyMultiplier;

    return score;
  }

  private selectTopStories(clusters: ClusteredEvent[], maxCount: number): ClusteredEvent[] {
    // Score ALL clusters first - high-scoring stories override source requirements
    const allScored = clusters
      .map(c => ({ cluster: c, score: this.getImportanceScore(c) }));

    // Filter: require at least 2 sources OR alert OR elevated velocity OR high score
    // High score (>100) means critical keywords were matched - don't require multi-source
    const candidates = allScored.filter(({ cluster: c, score }) =>
      c.sourceCount >= 2 ||
      c.isAlert ||
      (c.velocity && c.velocity.level !== 'normal') ||
      score > 100  // Critical stories bypass source requirement
    );

    // Sort by score
    const scored = candidates.sort((a, b) => b.score - a.score);

    // Select with source diversity (max 3 from same primary source)
    const selected: ClusteredEvent[] = [];
    const sourceCount = new Map<string, number>();
    const MAX_PER_SOURCE = 3;

    for (const { cluster } of scored) {
      const source = cluster.primarySource;
      const count = sourceCount.get(source) || 0;

      if (count < MAX_PER_SOURCE) {
        selected.push(cluster);
        sourceCount.set(source, count + 1);
      }

      if (selected.length >= maxCount) break;
    }

    return selected;
  }

  private setProgress(step: number, total: number, message: string): void {
    const percent = Math.round((step / total) * 100);
    this.setContent(`
      <div class="insights-progress">
        <div class="insights-progress-bar">
          <div class="insights-progress-fill" style="width: ${percent}%"></div>
        </div>
        <div class="insights-progress-info">
          <span class="insights-progress-step">Step ${step}/${total}</span>
          <span class="insights-progress-message">${message}</span>
        </div>
      </div>
    `);
  }

  public async updateInsights(clusters: ClusteredEvent[]): Promise<void> {
    if (this.isHidden) return;

    if (clusters.length === 0) {
      this.setContent('<div class="insights-empty">Waiting for news data...</div>');
      return;
    }

    const totalSteps = 4;

    try {
      // Step 1: Filter and rank stories by composite importance score
      this.setProgress(1, totalSteps, 'Ranking important stories...');

      const importantClusters = this.selectTopStories(clusters, 8);

      // Run parallel multi-perspective analysis in background (logs to console)
      // This analyzes ALL clusters, not just the keyword-filtered ones
      const parallelPromise = parallelAnalysis.analyzeHeadlines(clusters).then(report => {
        this.lastMissedStories = report.missedByKeywords;
        const suggestions = parallelAnalysis.getSuggestedImprovements();
        if (suggestions.length > 0) {
          console.log('%c💡 Improvement Suggestions:', 'color: #f59e0b; font-weight: bold');
          suggestions.forEach(s => console.log(`  • ${s}`));
        }
      }).catch(err => {
        console.warn('[ParallelAnalysis] Error:', err);
      });

      // Get geographic signal correlations
      const signalSummary = signalAggregator.getSummary();
      this.lastConvergenceZones = signalSummary.convergenceZones;
      if (signalSummary.totalSignals > 0) {
        logSignalSummary();
      }

      // Run focal point detection (correlates news entities with map signals)
      const focalSummary = focalPointDetector.analyze(clusters, signalSummary);
      this.lastFocalPoints = focalSummary.focalPoints;
      if (focalSummary.focalPoints.length > 0) {
        focalPointDetector.logSummary();
        // Ingest news for CII BEFORE signaling (so CII has data when it calculates)
        ingestNewsForCII(clusters);
        // Signal CII to refresh now that focal points AND news data are available
        window.dispatchEvent(new CustomEvent('focal-points-ready'));
      }

      if (importantClusters.length === 0) {
        this.setContent('<div class="insights-empty">No breaking or multi-source stories yet</div>');
        return;
      }

      const titles = importantClusters.map(c => c.primaryTitle);

      // Step 2: Analyze sentiment (browser-based, fast)
      this.setProgress(2, totalSteps, 'Analyzing sentiment...');
      let sentiments: Array<{ label: string; score: number }> | null = null;

      if (mlWorker.isAvailable) {
        sentiments = await mlWorker.classifySentiment(titles).catch(() => null);
      }

      // Step 3: Generate World Brief (with cooldown)
      let worldBrief = this.cachedBrief;
      const now = Date.now();

      if (!worldBrief || now - this.lastBriefUpdate > InsightsPanel.BRIEF_COOLDOWN_MS) {
        this.setProgress(3, totalSteps, 'Generating world brief...');

        // Pass focal point context to AI for correlation-aware summarization
        const geoContext = focalSummary.aiContext || signalSummary.aiContext;
        const result = await generateSummary(titles, (_step, _total, msg) => {
          // Show sub-progress for summarization
          this.setProgress(3, totalSteps, `Generating brief: ${msg}`);
        }, geoContext);

        if (result) {
          worldBrief = result.summary;
          this.cachedBrief = worldBrief;
          this.briefProvider = result.provider;
          this.lastBriefUpdate = now;
          console.log(`[InsightsPanel] Brief from ${result.provider}${result.cached ? ' (cached)' : ''}${geoContext ? ' (with geo context)' : ''}`);
        }
      } else {
        this.setProgress(3, totalSteps, 'Using cached brief...');
      }

      // Step 4: Wait for parallel analysis to complete
      this.setProgress(4, totalSteps, 'Multi-perspective analysis...');
      await parallelPromise;

      this.renderInsights(importantClusters, sentiments, worldBrief);
    } catch (error) {
      console.error('[InsightsPanel] Error:', error);
      this.setContent('<div class="insights-error">Analysis failed - retrying...</div>');
    }
  }

  private renderInsights(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null,
    worldBrief: string | null
  ): void {
    const briefHtml = worldBrief ? this.renderWorldBrief(worldBrief) : '';
    const focalPointsHtml = this.renderFocalPoints();
    const convergenceHtml = this.renderConvergenceZones();
    const sentimentOverview = this.renderSentimentOverview(sentiments);
    const breakingHtml = this.renderBreakingStories(clusters, sentiments);
    const statsHtml = this.renderStats(clusters);
    const missedHtml = this.renderMissedStories();

    this.setContent(`
      ${briefHtml}
      ${focalPointsHtml}
      ${convergenceHtml}
      ${sentimentOverview}
      ${statsHtml}
      <div class="insights-section">
        <div class="insights-section-title">BREAKING & CONFIRMED</div>
        ${breakingHtml}
      </div>
      ${missedHtml}
    `);
  }

  private renderWorldBrief(brief: string): string {
    const providerBadge = this.briefProvider && this.briefProvider !== 'cache'
      ? `<span class="insights-provider">${this.briefProvider}</span>`
      : '';

    return `
      <div class="insights-brief">
        <div class="insights-section-title">🌍 WORLD BRIEF ${providerBadge}</div>
        <div class="insights-brief-text">${escapeHtml(brief)}</div>
      </div>
    `;
  }

  private renderBreakingStories(
    clusters: ClusteredEvent[],
    sentiments: Array<{ label: string; score: number }> | null
  ): string {
    return clusters.map((cluster, i) => {
      const sentiment = sentiments?.[i];
      const sentimentClass = sentiment?.label === 'negative' ? 'negative' :
        sentiment?.label === 'positive' ? 'positive' : 'neutral';

      const badges: string[] = [];

      if (cluster.sourceCount >= 3) {
        badges.push(`<span class="insight-badge confirmed">✓ ${cluster.sourceCount} sources</span>`);
      } else if (cluster.sourceCount >= 2) {
        badges.push(`<span class="insight-badge multi">${cluster.sourceCount} sources</span>`);
      }

      if (cluster.velocity && cluster.velocity.level !== 'normal') {
        const velIcon = cluster.velocity.trend === 'rising' ? '↑' : '';
        badges.push(`<span class="insight-badge velocity ${cluster.velocity.level}">${velIcon}+${cluster.velocity.sourcesPerHour}/hr</span>`);
      }

      if (cluster.isAlert) {
        badges.push('<span class="insight-badge alert">⚠ ALERT</span>');
      }

      return `
        <div class="insight-story">
          <div class="insight-story-header">
            <span class="insight-sentiment-dot ${sentimentClass}"></span>
            <span class="insight-story-title">${escapeHtml(cluster.primaryTitle.slice(0, 100))}${cluster.primaryTitle.length > 100 ? '...' : ''}</span>
          </div>
          ${badges.length > 0 ? `<div class="insight-badges">${badges.join('')}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  private renderSentimentOverview(sentiments: Array<{ label: string; score: number }> | null): string {
    if (!sentiments || sentiments.length === 0) {
      return '';
    }

    const negative = sentiments.filter(s => s.label === 'negative').length;
    const positive = sentiments.filter(s => s.label === 'positive').length;
    const neutral = sentiments.length - negative - positive;

    const total = sentiments.length;
    const negPct = Math.round((negative / total) * 100);
    const neuPct = Math.round((neutral / total) * 100);
    const posPct = 100 - negPct - neuPct;

    let toneLabel = 'Mixed';
    let toneClass = 'neutral';
    if (negative > positive + neutral) {
      toneLabel = 'Negative';
      toneClass = 'negative';
    } else if (positive > negative + neutral) {
      toneLabel = 'Positive';
      toneClass = 'positive';
    }

    return `
      <div class="insights-sentiment-bar">
        <div class="sentiment-bar-track">
          <div class="sentiment-bar-negative" style="width: ${negPct}%"></div>
          <div class="sentiment-bar-neutral" style="width: ${neuPct}%"></div>
          <div class="sentiment-bar-positive" style="width: ${posPct}%"></div>
        </div>
        <div class="sentiment-bar-labels">
          <span class="sentiment-label negative">${negative}</span>
          <span class="sentiment-label neutral">${neutral}</span>
          <span class="sentiment-label positive">${positive}</span>
        </div>
        <div class="sentiment-tone ${toneClass}">Overall: ${toneLabel}</div>
      </div>
    `;
  }

  private renderStats(clusters: ClusteredEvent[]): string {
    const multiSource = clusters.filter(c => c.sourceCount >= 2).length;
    const fastMoving = clusters.filter(c => c.velocity && c.velocity.level !== 'normal').length;
    const alerts = clusters.filter(c => c.isAlert).length;

    return `
      <div class="insights-stats">
        <div class="insight-stat">
          <span class="insight-stat-value">${multiSource}</span>
          <span class="insight-stat-label">Multi-source</span>
        </div>
        <div class="insight-stat">
          <span class="insight-stat-value">${fastMoving}</span>
          <span class="insight-stat-label">Fast-moving</span>
        </div>
        ${alerts > 0 ? `
        <div class="insight-stat alert">
          <span class="insight-stat-value">${alerts}</span>
          <span class="insight-stat-label">Alerts</span>
        </div>
        ` : ''}
      </div>
    `;
  }

  private renderMissedStories(): string {
    if (this.lastMissedStories.length === 0) {
      return '';
    }

    const storiesHtml = this.lastMissedStories.slice(0, 3).map(story => {
      const topPerspective = story.perspectives
        .filter(p => p.name !== 'keywords')
        .sort((a, b) => b.score - a.score)[0];

      const perspectiveName = topPerspective?.name ?? 'ml';
      const perspectiveScore = topPerspective?.score ?? 0;

      return `
        <div class="insight-story missed">
          <div class="insight-story-header">
            <span class="insight-sentiment-dot ml-flagged"></span>
            <span class="insight-story-title">${escapeHtml(story.title.slice(0, 80))}${story.title.length > 80 ? '...' : ''}</span>
          </div>
          <div class="insight-badges">
            <span class="insight-badge ml-detected">🔬 ${perspectiveName}: ${(perspectiveScore * 100).toFixed(0)}%</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="insights-section insights-missed">
        <div class="insights-section-title">🎯 ML DETECTED (check console for details)</div>
        ${storiesHtml}
      </div>
    `;
  }

  private renderConvergenceZones(): string {
    if (this.lastConvergenceZones.length === 0) {
      return '';
    }

    const zonesHtml = this.lastConvergenceZones.slice(0, 3).map(zone => {
      const signalIcons: Record<string, string> = {
        internet_outage: '🌐',
        military_flight: '✈️',
        military_vessel: '🚢',
        protest: '🪧',
        ais_disruption: '⚓',
      };

      const icons = zone.signalTypes.map(t => signalIcons[t] || '📍').join('');

      return `
        <div class="convergence-zone">
          <div class="convergence-region">${icons} ${escapeHtml(zone.region)}</div>
          <div class="convergence-description">${escapeHtml(zone.description)}</div>
          <div class="convergence-stats">${zone.signalTypes.length} signal types • ${zone.totalSignals} events</div>
        </div>
      `;
    }).join('');

    return `
      <div class="insights-section insights-convergence">
        <div class="insights-section-title">📍 GEOGRAPHIC CONVERGENCE</div>
        ${zonesHtml}
      </div>
    `;
  }

  private renderFocalPoints(): string {
    // Only show focal points that have both news AND signals (true correlations)
    const correlatedFPs = this.lastFocalPoints.filter(
      fp => fp.newsMentions > 0 && fp.signalCount > 0
    ).slice(0, 5);

    if (correlatedFPs.length === 0) {
      return '';
    }

    const signalIcons: Record<string, string> = {
      internet_outage: '🌐',
      military_flight: '✈️',
      military_vessel: '⚓',
      protest: '📢',
      ais_disruption: '🚢',
    };

    const focalPointsHtml = correlatedFPs.map(fp => {
      const urgencyClass = fp.urgency;
      const icons = fp.signalTypes.map(t => signalIcons[t] || '').join(' ');
      const headline = fp.topHeadlines[0]?.slice(0, 60) || '';

      return `
        <div class="focal-point ${urgencyClass}">
          <div class="focal-point-header">
            <span class="focal-point-name">${escapeHtml(fp.displayName)}</span>
            <span class="focal-point-urgency ${urgencyClass}">${fp.urgency.toUpperCase()}</span>
          </div>
          <div class="focal-point-signals">${icons}</div>
          <div class="focal-point-stats">
            ${fp.newsMentions} news • ${fp.signalCount} signals
          </div>
          ${headline ? `<div class="focal-point-headline">"${escapeHtml(headline)}..."</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="insights-section insights-focal">
        <div class="insights-section-title">🎯 FOCAL POINTS</div>
        ${focalPointsHtml}
      </div>
    `;
  }
}
