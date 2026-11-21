// ═══════════════════════════════════════════════════════════════
//  /api/metals — live spot prices for the estimate prompt.
//
//  First source fetchMetalPrices() (src/App.jsx) tries. gold-api.com (free, no
//  key) first; metalpriceapi only when METALS_API_KEY is set. Cached 15 minutes
//  in the warm instance and at Vercel's edge. On failure this returns 503 and
//  the browser tries gold-api.com itself, then its hard-coded fallback.
//
//  Response: { gold_oz, silver_oz, platinum_oz, gold_per_gram_24k/18k/14k/10k,
//              silver_per_gram_sterling, silver_per_gram_fine,
//              platinum_per_gram_950, source, fetched_at }
// ═══════════════════════════════════════════════════════════════

import { getSpot } from './_lib/spot.js';

const CACHE_MS = 15 * 60 * 1000;
const TROY_OZ_TO_GRAMS = 31.1035;
let cache = { at: 0, body: null };

function shape(gold, silver, platinum) {
  const r2 = n => Math.round(n * 100) / 100;
  const g = gold / TROY_OZ_TO_GRAMS, s = silver / TROY_OZ_TO_GRAMS, p = platinum / TROY_OZ_TO_GRAMS;
  return {
    gold_oz: r2(gold),
    silver_oz: r2(silver),
    platinum_oz: r2(platinum),
    gold_per_gram_24k: r2(g),
    gold_per_gram_18k: r2(g * 18 / 24),
    gold_per_gram_14k: r2(g * 14 / 24),
    gold_per_gram_10k: r2(g * 10 / 24),
    silver_per_gram_sterling: r2(s * 0.925),
    silver_per_gram_fine: r2(s),
    platinum_per_gram_950: r2(p * 0.95),
    source: '',
    fetched_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (cache.body && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    return res.status(200).json(cache.body);
  }

  const spot = await getSpot();
  if (!spot) {
    // Serve the last good prices rather than failing, if we have any.
    if (cache.body) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ...cache.body, source: cache.body.source + '-stale' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'Spot prices unavailable',
      reason: 'gold-api.com failed' + (process.env.METALS_API_KEY ? ' and metalpriceapi failed' : '; no METALS_API_KEY for the backup'),
    });
  }

  // If no source had platinum, the browser uses its platinum fallback
  // (buildMetalPrices) and gold/silver stay live.
  const body = { ...shape(spot.gold, spot.silver, spot.platinum || NaN), source: spot.source };
  if (!spot.platinum) { delete body.platinum_oz; delete body.platinum_per_gram_950; }
  cache = { at: Date.now(), body };
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
  return res.status(200).json(cache.body);
}
