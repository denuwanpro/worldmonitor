import type { PredictionMarket } from '@/types';
import { fetchWithProxy } from '@/utils';

interface PolymarketMarket {
  question: string;
  outcomes?: string[];
  outcomePrices?: string; // Stringified JSON array like "[\"0.02\", \"0.98\"]"
  volume?: string;
  volumeNum?: number;
  closed?: boolean;
}

export async function fetchPredictions(): Promise<PredictionMarket[]> {
  try {
    // Use /markets endpoint ordered by volume (most active first)
    const response = await fetchWithProxy(
      '/api/polymarket/markets?closed=false&order=volume&ascending=false&limit=25'
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: PolymarketMarket[] = await response.json();

    return data
      .map((market) => {
        // outcomePrices is a STRINGIFIED JSON array like "[\"0.02\", \"0.98\"]"
        let yesPrice = 50; // default

        try {
          const pricesStr = market.outcomePrices;
          if (pricesStr) {
            // Parse the stringified JSON array
            const prices: string[] = JSON.parse(pricesStr);
            if (Array.isArray(prices) && prices.length >= 1 && prices[0]) {
              const parsed = parseFloat(prices[0]);
              if (!isNaN(parsed)) {
                yesPrice = parsed * 100;
              }
            }
          }
        } catch {
          // Keep default 50 if parsing fails
        }

        const volume = market.volumeNum ?? (market.volume ? parseFloat(market.volume) : 0);

        return {
          title: market.question || '',
          yesPrice,
          volume,
        };
      })
      .filter((p) => {
        // Filter out empty titles and ensure valid price
        if (!p.title || isNaN(p.yesPrice)) return false;

        // Filter for "interesting" markets - those with strong signals (far from 50%)
        // Keep markets where Yes is below 40% or above 60%
        const discrepancy = Math.abs(p.yesPrice - 50);
        return discrepancy > 10 || (p.volume && p.volume > 10000);
      })
      .slice(0, 12); // Limit to 12 predictions
  } catch (e) {
    console.error('Failed to fetch predictions:', e);
    return [];
  }
}
