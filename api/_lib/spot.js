// metalpriceapi spot fetch, shared by /api/metals and /api/analyze.
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
