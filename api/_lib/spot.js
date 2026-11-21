// Spot prices, shared by /api/metals and /api/analyze. getSpot() at the bottom
// is the entry point: gold-api.com first, metalpriceapi as backup.
//
// With base=USD, rates.USDXAU is already USD per troy ounce (e.g. 3979.55) and
// rates.XAU is its inverse (ounces per USD). Prefer USDxxx; fall back to 1/xxx.
// Returns { gold, silver, platinum } (platinum may be null) or null on failure.

const RANGES = { gold: [500, 20000], silver: [5, 500], platinum: [200, 10000] };

function usdPerOz(rates, sym, range) {
  let v = Number(rates['USD' + sym]);
  if (!(v > 0) && Number(rates[sym]) > 0) v = 1 / Number(rates[sym]);
  if (!(v >= range[0] && v <= range[1])) return null;
  return Math.round(v * 100) / 100;
}

export async function fetchSpotFromMetalpriceapi(apiKey, timeoutMs = 5000) {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://api.metalpriceapi.com/v1/latest?api_key=${apiKey}&base=USD&currencies=XAU,XAG,XPT`,
      { signal: controller.signal }
    );
    if (!r.ok) { console.warn('metalpriceapi HTTP', r.status); return null; }
    const data = await r.json();
    if (!data || !data.success || !data.rates) { console.warn('metalpriceapi bad response'); return null; }
    const gold = usdPerOz(data.rates, 'XAU', RANGES.gold);
    const silver = usdPerOz(data.rates, 'XAG', RANGES.silver);
    const platinum = usdPerOz(data.rates, 'XPT', RANGES.platinum);
    if (!gold || !silver) { console.warn('metalpriceapi rates out of range', JSON.stringify(data.rates)); return null; }
    return { gold, silver, platinum };
  } catch (e) {
    console.warn('metalpriceapi fetch failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// gold-api.com: free, no key. One request per metal; returns
// { gold, silver, platinum } (platinum may be null) or null if gold/silver fail.
export async function fetchSpotFromGoldApi(timeoutMs = 5000) {
  const one = async (sym, range) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`https://api.gold-api.com/price/${sym}`, { signal: controller.signal });
      if (!r.ok) { console.warn('gold-api.com HTTP', r.status, sym); return null; }
      const v = Number((await r.json()).price);
      if (!(v >= range[0] && v <= range[1])) { console.warn('gold-api.com out of range', sym, v); return null; }
      return Math.round(v * 100) / 100;
    } catch (e) {
      console.warn('gold-api.com fetch failed', sym, e.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const [gold, silver, platinum] = await Promise.all([
    one('XAU', RANGES.gold), one('XAG', RANGES.silver), one('XPT', RANGES.platinum),
  ]);
  return gold && silver ? { gold, silver, platinum } : null;
}

// Primary gold-api.com; metalpriceapi only when METALS_API_KEY is set.
// Returns { gold, silver, platinum, source } or null. If the primary has no
// platinum, it's filled from metalpriceapi when that's available.
export async function getSpot(apiKey = process.env.METALS_API_KEY) {
  const primary = await fetchSpotFromGoldApi();
  if (primary && primary.platinum) return { ...primary, source: 'gold-api.com' };
  const backup = apiKey ? await fetchSpotFromMetalpriceapi(apiKey) : null;
  if (primary) return { ...primary, platinum: (backup && backup.platinum) || null, source: 'gold-api.com' };
  if (backup) return { ...backup, source: 'metalpriceapi' };
  return null;
}
