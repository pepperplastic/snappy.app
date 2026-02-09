// ── Spot price cache (persists across warm invocations) ──
let priceCache = {
  date: null,
  gold: null,
  silver: null,
};

const FALLBACK_GOLD = 5000;
const FALLBACK_SILVER = 81;

async function getSpotPrices() {
  const today = new Date().toISOString().slice(0, 10);

  // Return cached if same day
  if (priceCache.date === today && priceCache.gold) {
    return { gold: priceCache.gold, silver: priceCache.silver };
  }

  // Try fetching fresh prices
  try {
    const apiKey = process.env.METALS_API_KEY;
    if (apiKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          `https://api.metalpriceapi.com/v1/latest?api_key=${apiKey}&base=USD&currencies=XAU,XAG`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.rates) {
            const gold = data.rates.USDXAU ? Math.round(1 / data.rates.USDXAU) : null;
            const silver = data.rates.USDXAG ? Math.round(1 / data.rates.USDXAG) : null;
            if (gold && gold > 1000) {
              priceCache = { date: today, gold, silver: silver || FALLBACK_SILVER };
              console.log(`Spot prices updated: Gold $${gold}/oz, Silver $${silver}/oz`);
              return priceCache;
            }
          }
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        throw fetchErr;
      }
    }
  } catch (err) {
    console.warn('Spot price fetch failed, using fallback:', err.message);
  }

  // Use stale cache if available, otherwise fallback
  if (priceCache.gold) {
    console.log('Using stale cached price:', priceCache.gold);
    return priceCache;
  }

  return { gold: FALLBACK_GOLD, silver: FALLBACK_SILVER };
}

function injectSpotPrices(body, gold, silver) {
  const modified = JSON.parse(JSON.stringify(body));

  // Pre-compute per-gram melt values
  const perGramPure = gold / 31.1;
  const gold10k = (perGramPure * 0.417).toFixed(2);
  const gold14k = (perGramPure * 0.583).toFixed(2);
  const gold18k = (perGramPure * 0.750).toFixed(2);
  const gold24k = (perGramPure * 0.999).toFixed(2);
  const silverSterling = ((silver / 31.1) * 0.925).toFixed(2);
  const silverFine = (silver / 31.1).toFixed(2);

  if (modified.messages && modified.messages[0] && modified.messages[0].content) {
    for (const block of modified.messages[0].content) {
      if (block.type === 'text' && block.text) {
        block.text = block.text
          .replace('GOLD_SPOT_PRICE', '$' + gold.toLocaleString())
          .replace('SILVER_SPOT_PRICE', '$' + silver.toLocaleString())
          .replace(/GOLD_10K_PER_GRAM/g, '$' + gold10k)
          .replace(/GOLD_14K_PER_GRAM/g, '$' + gold14k)
          .replace(/GOLD_18K_PER_GRAM/g, '$' + gold18k)
          .replace(/GOLD_24K_PER_GRAM/g, '$' + gold24k)
          .replace(/SILVER_STERLING_PER_GRAM/g, '$' + silverSterling)
          .replace(/SILVER_FINE_PER_GRAM/g, '$' + silverFine);
        console.log(`Price injection: gold=$${gold}, 14K/g=$${gold14k}, 18K/g=$${gold18k}, silver=$${silver}`);
      }
    }
  }

  return modified;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    // Fetch today's spot prices (cached after first call of the day)
    let gold = FALLBACK_GOLD;
    let silver = FALLBACK_SILVER;
    try {
      const prices = await getSpotPrices();
      gold = prices.gold;
      silver = prices.silver;
    } catch (priceErr) {
      console.warn('Price fetch error (using fallback):', priceErr.message);
    }

    // Inject live prices into the prompt
    const modifiedBody = injectSpotPrices(req.body, gold, silver);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(modifiedBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(response.status).json({ error: 'Analysis service error', status: response.status });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}
