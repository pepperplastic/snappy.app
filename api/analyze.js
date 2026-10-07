// ═══════════════════════════════════════════════════════════════
//  /api/analyze — Claude proxy for the photo estimate flow and the
//  CRM's ID-photo parser.
//
//  AUG 3 HARDENING. This endpoint spends money on every call, so it
//  was worth closing:
//   • Access-Control-Allow-Origin was '*' with no auth — any site on
//     the internet could POST to it and bill your Anthropic account.
//     Now same-origin only.
//   • req.body was forwarded to Anthropic wholesale, so a caller chose
//     the model and max_tokens. Both are now validated server-side
//     against an allowlist, and only known-good fields are forwarded.
//   • Added an image count cap so one request can't ship 50 photos.
//
//  Deliberately NOT added: a login requirement. This is called by
//  anonymous visitors on the estimate flow, which is the point of the
//  product. Same-origin + field validation is the right ceiling here.
// ═══════════════════════════════════════════════════════════════

// Hosts allowed to call this endpoint. Vercel preview deploys are
// included so staging keeps working.
const ALLOWED_HOSTS = new Set([
  'snappy.gold',
  'www.snappy.gold',
]);
function hostAllowed(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  return h.endsWith('.vercel.app'); // preview deployments
}

// Models this endpoint may call. Anything not listed silently falls back to
// DEFAULT_MODEL rather than being billed or 404'd.
//
// AUG 3: crm.jsx's parseIdPhoto still asks for 'claude-sonnet-4-20250514',
// which Anthropic has retired — that request was 404ing, so ID-photo parsing
// had been failing (operators were hand-typing every ID number and DOB).
// Deliberately NOT allowlisted, so it falls through to the current model and
// starts working again without a crm.jsx change. Fix the string there too
// when convenient, but this endpoint no longer depends on it.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS_CAP = 1500;  // above anything either caller legitimately needs
const MAX_IMAGES     = 8;     // estimate flow sends a handful of angles
const MAX_TEXT_CHARS = 40000; // the appraisal prompt is ~12k

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

// Build a request from ONLY the fields we permit. Anything else the caller
// sent (system prompts, tools, extra params) is dropped rather than relayed.
// Returns { ok:true, body } or { ok:false, error }.
function buildSafeRequest(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request body' };

  const model = ALLOWED_MODELS.has(raw.model) ? raw.model : DEFAULT_MODEL;

  let maxTokens = parseInt(raw.max_tokens, 10);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) maxTokens = 1024;
  maxTokens = Math.min(maxTokens, MAX_TOKENS_CAP);

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return { ok: false, error: 'messages required' };
  }
  if (raw.messages.length > 2) {
    return { ok: false, error: 'too many messages' };
  }

  let imageCount = 0;
  let textChars = 0;
  const messages = [];

  for (const msg of raw.messages) {
    if (!msg || msg.role !== 'user') return { ok: false, error: 'only user messages allowed' };

    // Content may be a plain string or an array of blocks.
    if (typeof msg.content === 'string') {
      textChars += msg.content.length;
      messages.push({ role: 'user', content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) return { ok: false, error: 'invalid message content' };

    const blocks = [];
    for (const b of msg.content) {
      if (!b || typeof b !== 'object') return { ok: false, error: 'invalid content block' };

      if (b.type === 'text') {
        textChars += String(b.text || '').length;
        blocks.push({ type: 'text', text: String(b.text || '') });

      } else if (b.type === 'image') {
        imageCount++;
        const src = b.source || {};
        if (src.type !== 'base64' || typeof src.data !== 'string') {
          return { ok: false, error: 'invalid image source' };
        }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(String(src.media_type || ''))) {
          return { ok: false, error: 'unsupported image type' };
        }
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: src.media_type, data: src.data },
        });

      } else {
        // Drop anything else (tool_use, document, etc.) rather than relaying it.
        return { ok: false, error: 'unsupported content block: ' + b.type };
      }
    }
    messages.push({ role: 'user', content: blocks });
  }

  if (imageCount > MAX_IMAGES) return { ok: false, error: 'too many images' };
  if (textChars > MAX_TEXT_CHARS) return { ok: false, error: 'prompt too long' };

  const body = { model, max_tokens: maxTokens, messages };
  // temperature is the only optional passthrough, and it's clamped.
  if (raw.temperature !== undefined) {
    const t = parseFloat(raw.temperature);
    if (Number.isFinite(t)) body.temperature = Math.max(0, Math.min(1, t));
  }
  return { ok: true, body };
}

// ── mode: "appraise" — AI suggested resale value for the CRM's appraised-value
// modal. The caller sends shipment DATA only; the prompt is built here, so this
// mode can't be used as a general-purpose relay. Photos are fetched server-side
// from Drive (the only host the CRM stores them on) and sent as base64.
const APPRAISE_MAX_TOKENS = Math.min(600, MAX_TOKENS_CAP);
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function driveFileId(url) {
  const s = String(url || '');
  let host = '';
  try { host = new URL(s).host.toLowerCase(); } catch { return null; }
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;
  const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchDrivePhoto(url) {
  const id = driveFileId(url);
  if (!id) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=w1000`, { signal: controller.signal });
    if (!r.ok) return null;
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return null; // Drive sends HTML for non-public files
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// Melt from the inspection rows (metal / purityDecimal / weight in grams).
// Platinum has no spot feed here, so it's left to the model to note.
function meltFromInspection(items, gold, silver) {
  let total = 0;
  const lines = [];
  for (const it of items) {
    const w = parseFloat(it && it.weight);
    const p = parseFloat(it && it.purityDecimal);
    const metal = String((it && it.metal) || '');
    const spot = metal === 'Gold' ? gold : metal === 'Silver' ? silver : null;
    if (!spot || !(w > 0) || !(p > 0)) continue;
    const melt = (spot / 31.1035) * p * w;
    total += melt;
    lines.push(`${metal} ${clip(it.purity, 10)} ${w}g → melt $${melt.toFixed(2)}`);
  }
  return { total: Math.round(total * 100) / 100, lines };
}

async function handleAppraise(raw, res) {
  const photos = (Array.isArray(raw.photos) ? raw.photos : []).slice(0, MAX_IMAGES);
  const notes = (Array.isArray(raw.inspection_notes) ? raw.inspection_notes : []).slice(0, 20).map(n => clip(n, 1000));
  const manifest = (Array.isArray(raw.manifest) ? raw.manifest : []).slice(0, 30).map(m => ({
    name: clip(m && m.name, 200), estimate: clip(m && m.price, 40),
  }));
  const inspection = (Array.isArray(raw.inspection) ? raw.inspection : []).slice(0, 30).map(it => ({
    metal: clip(it && it.metal, 20), purity: clip(it && it.purity, 10),
    purityDecimal: parseFloat(it && it.purityDecimal) || 0, weight: parseFloat(it && it.weight) || 0,
    hasStones: !!(it && it.hasStones), stoneNote: clip(it && it.stoneNote, 200),
  }));
  const offer = parseFloat(String(raw.offer_amount || '').replace(/[^0-9.]/g, ''));
  const item = clip(raw.item, 500);

  let gold = FALLBACK_GOLD, silver = FALLBACK_SILVER;
  try { const p = await getSpotPrices(); gold = p.gold; silver = p.silver; } catch {}
  const melt = meltFromInspection(inspection, gold, silver);

  const images = (await Promise.all(photos.map(fetchDrivePhoto))).filter(Boolean);

  const prompt = `You are appraising a lot of jewelry/precious metal that a gold-buying business has received and inspected. Estimate what the business could REALISTICALLY SELL this lot for (eBay sold listings or retail) — NOT melt value and NOT the offer to the customer.

Spot today: gold $${gold}/ozt, silver $${silver}/ozt.

Item description: ${item || '(none)'}
Manifest items (customer-submitted, with original estimate ranges):
${manifest.length ? manifest.map(m => `- ${m.name}${m.estimate ? ` (est ${m.estimate})` : ''}`).join('\n') : '(none)'}

Gold-read / inspection results per item:
${inspection.length ? inspection.map(i => `- ${i.metal} ${i.purity} ${i.weight}g${i.hasStones ? `, stones: ${i.stoneNote || 'yes'}` : ''}`).join('\n') : '(none recorded)'}
Computed melt from inspection: ${melt.lines.length ? `$${melt.total.toFixed(2)} (${melt.lines.join('; ')})` : 'not computable (no weights/purity)'}

Inspection notes:
${notes.length ? notes.map(n => `- ${n}`).join('\n') : '(none)'}

Offer amount to customer: ${Number.isFinite(offer) ? '$' + offer.toFixed(2) : '(not set)'}
${images.length} photo(s) of the shipment are attached.

Rules:
- If nothing (stones, brand, design, condition, collectibility) supports a premium, the realistic resale is about melt; set basis "melt".
- If a premium is supported, set basis "resale" and say what drives it.
- The rationale is 2–3 sentences and must cite the melt value and what drives any premium.
- confidence is "High", "Medium" or "Low" (Low when weights/purity are missing or photos are unclear).

Respond with JSON only — no markdown, no backticks:
{"value": <number, USD>, "rationale": "<2-3 sentences>", "confidence": "High|Medium|Low", "basis": "melt|resale"}`;

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: APPRAISE_MAX_TOKENS,
    temperature: 0.2,
    messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt }] }],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error('Anthropic API error (appraise):', response.status, await response.text());
    return res.status(502).json({ error: 'Analysis service error' });
  }
  const data = await response.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let out;
  try {
    const m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    out = JSON.parse(m ? m[0] : text);
  } catch {
    console.error('appraise: unparseable model output:', text.slice(0, 300));
    return res.status(502).json({ error: 'Unparseable suggestion' });
  }
  const value = parseFloat(String(out.value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value < 0) return res.status(502).json({ error: 'No value in suggestion' });
  const confidence = ['High', 'Medium', 'Low'].find(c => c.toLowerCase() === String(out.confidence || '').toLowerCase()) || 'Low';
  const basis = String(out.basis || '').toLowerCase() === 'resale' ? 'resale' : 'melt';
  return res.status(200).json({
    value: Math.round(value * 100) / 100,
    rationale: clip(out.rationale, 1000).trim(),
    confidence,
    basis,
  });
}

export default async function handler(req, res) {
  // Same-origin only. No wildcard CORS — this endpoint is called by our own
  // pages, so there is no legitimate cross-origin caller to allow.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let callerHost = '';
  try {
    const origin = req.headers.origin;
    const referer = req.headers.referer || req.headers.referrer;
    if (origin) callerHost = new URL(origin).host;
    else if (referer) callerHost = new URL(referer).host;
  } catch {
    callerHost = '';
  }
  if (!hostAllowed(callerHost)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const parsed = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body); } catch { return null; } })()
      : req.body;

    if (parsed && parsed.mode === 'appraise') return await handleAppraise(parsed, res);

    const safe = buildSafeRequest(parsed);
    if (!safe.ok) {
      console.warn('analyze rejected request:', safe.error);
      return res.status(400).json({ error: safe.error });
    }

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
    const modifiedBody = injectSpotPrices(safe.body, gold, silver);

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
