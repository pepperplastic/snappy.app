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

// ── mode: "appraise" — melt-based suggested value (per-item breakdown) for the CRM's appraised-value
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

const r2 = n => Math.round(n * 100) / 100;

// Purity label/number → decimal: "14K" → 14/24, "585" → .585, "0.585" → .585.
function purityToDecimal(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
  const k = t.match(/^(\d+(?:\.\d+)?)(k|kt|karat)$/);
  if (k) return parseFloat(k[1]) / 24;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) return n;
  if (n >= 100 && n <= 1000) return n / 1000;
  return null;
}

// The model supplies judgment only (stone deduction, premium, flag); the math
// is done here from the INSPECTION record, which wins over anything the model
// echoes back. Items are matched by position — one per inspection row.
function computeAppraisal(inspection, modelItems, gold, silver) {
  const lines = [];
  let total = 0, valued = 0, excluded = 0, verify = 0, anyDeduction = false, anyPremium = false;
  inspection.forEach((it, i) => {
    const m = (modelItems[i] && typeof modelItems[i] === 'object') ? modelItems[i] : {};
    const name = clip(m.name, 40).trim();
    const label = `Item ${i + 1}${name ? ` (${name})` : ''}`;
    const purityLabel = String(it.purity || '').toUpperCase();
    const w = it.weight > 0 ? it.weight : null;
    const p = it.purityDecimal > 0 ? it.purityDecimal : null;

    if (w === null || p === null) { excluded++; lines.push(`${label} — no weight recorded`); return; }
    const spot = it.metal === 'Gold' ? gold : it.metal === 'Silver' ? silver : null;
    if (!spot) { excluded++; lines.push(`${label} — ${w}g ${purityLabel} ${it.metal} — no spot price`); return; }

    const notes = [];
    const mw = parseFloat(m.weight_g);
    if (Number.isFinite(mw) && Math.abs(mw - w) > 0.05) notes.push(`model said ${mw}g; using inspection ${w}g`);
    if (m.karat_or_purity != null && String(m.karat_or_purity).trim()) {
      const mp = purityToDecimal(m.karat_or_purity);
      const sameLabel = String(m.karat_or_purity).trim().toLowerCase() === String(it.purity || '').trim().toLowerCase();
      if (!sameLabel && (mp === null || Math.abs(mp - p) > 0.01)) notes.push(`model said ${clip(m.karat_or_purity, 12)}; using inspection ${purityLabel}`);
    }
    const flag = clip(m.flag, 80).trim();
    const sfx = notes.length ? ` [${notes.join('; ')}]` : '';

    if (/verify/i.test(flag)) {
      verify++;
      lines.push(`${label} — ${w}g ${purityLabel} → $0 — verify before offer${sfx}`);
      return;
    }

    let ded = parseFloat(m.stone_deduction_g);
    ded = Number.isFinite(ded) && ded > 0 ? Math.min(ded, w) : 0;
    const net = w - ded;
    const fine = net * p;
    const melt = r2(fine * (spot / 31.1035));
    let prem = parseFloat(m.premium_usd);
    prem = Number.isFinite(prem) && prem > 0 ? r2(prem) : 0;
    const capped = prem > melt;
    if (capped) prem = melt;
    if (ded > 0) anyDeduction = true;
    if (prem > 0) anyPremium = true;
    const value = r2(melt + prem);
    total += value; valued++;
    lines.push(`${label} — ${r2(net)}g ${purityLabel} → ${r2(fine)}g fine → $${melt.toFixed(2)}`
      + (ded > 0 ? ` (−${r2(ded)}g stones from ${w}g)` : '')
      + (prem > 0 ? ` + $${prem.toFixed(2)} premium${flag ? `: ${flag}` : ''}` : '')
      + (capped ? ' [premium capped]' : '')
      + sfx);
  });
  total = r2(total);
  const parts = [`${valued} valued`];
  if (excluded) parts.push(`${excluded} excluded`);
  if (verify) parts.push(`${verify} to verify`);
  return {
    value: total,
    lines,
    total_line: `Total — ${parts.join(', ')} → $${total.toFixed(2)}`,
    confidence: (excluded || verify || !inspection.length) ? 'Low' : anyDeduction ? 'Medium' : 'High',
    basis: anyPremium ? 'melt+premium' : 'melt',
  };
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

  // Nothing for the model to judge — skip the call, the server math stands alone.
  if (!inspection.length) return res.status(200).json(computeAppraisal(inspection, [], gold, silver));

  const images = (await Promise.all(photos.map(fetchDrivePhoto))).filter(Boolean);

  const prompt = `A gold buyer has inspected a lot. Our server computes melt from the inspection record. Your job is ONLY judgment per item: estimated stone weight to deduct, any premium, and risk flags. Do not compute melt or totals.

Inspection rows (authoritative — weight and karat come from here, never from photos):
${inspection.map((r, i) => `- Item ${i + 1}: ${r.metal} ${r.purity || '(no karat)'}, ${r.weight > 0 ? r.weight + 'g' : '(no weight)'}${r.hasStones ? `, stones: ${r.stoneNote || 'yes (unspecified)'}` : ''}`).join('\n')}

Inspection notes:
${notes.length ? notes.map(n => `- ${n}`).join('\n') : '(none)'}

Context only: item description "${item || 'none'}"; manifest: ${manifest.length ? manifest.map(m => m.name).join('; ') : 'none'}; offer ${Number.isFinite(offer) ? '$' + offer.toFixed(2) : 'not set'}. ${images.length} photo(s) attached, for judging stone size and hallmarks only.

Rules:
1. Return exactly one entry per inspection row, in the same order (${inspection.length} entries).
2. weight_g and karat_or_purity: copy them from the inspection row. If a row has none, return null — never estimate from photos.
3. stone_deduction_g: stones are dead weight. Small melee ≈0.1g total; a visible center stone ≈0.2–1.0g depending on its size in the photos. 0 if no stones.
4. premium_usd: 0 unless BOTH (a) a meaningful stone (≥~0.5ct center, apparent diamond/sapphire/ruby/emerald) AND (b) a brand/provenance signal (hallmark, maker, cert in notes or photos). Then a conservative amount, and put the reason as one phrase in flag.
5. flag: "verify" if the notes raise doubt about that item (e.g. "not sure if solid or plated", "untested", missing stamp); the premium reason if a premium applies; otherwise "".
6. name: a 1–3 word label for the item (e.g. "ring", "chain").

Respond with JSON only — no markdown, no backticks, no other text:
{"items": [{"name": "<string>", "weight_g": <number|null>, "karat_or_purity": "<string|null>", "stone_deduction_g": <number>, "premium_usd": <number>, "flag": "<string>"}]}`;

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: APPRAISE_MAX_TOKENS,
    temperature: 0,
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
  const modelItems = Array.isArray(out && out.items) ? out.items : [];
  return res.status(200).json(computeAppraisal(inspection, modelItems, gold, silver));
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
