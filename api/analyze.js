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
const APPRAISE_MAX_TOKENS = Math.min(1200, MAX_TOKENS_CAP); // one entry + source snippet per item
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

// Purity as written → decimal: "14K" → 14/24, "585"/"pt950" → .585/.95,
// "0.585" → .585, "sterling" → .925.
function purityToDecimal(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '').replace(/^(pt|plat)/, '');
  if (t === 'sterling') return 0.925;
  const k = t.match(/^(\d+(?:\.\d+)?)(k|kt|karat)$/);
  if (k) { const d = parseFloat(k[1]) / 24; return d > 0 && d <= 1 ? d : null; }
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0 || !/^\d+(\.\d+)?$/.test(t)) return null;
  if (n < 1) return n;
  if (n >= 100 && n <= 1000) return n / 1000;
  return null;
}

const APPRAISE_EMPTY_HINT = 'Add weights and karats to inspection notes';

// The model extracts items from the free-text inspection notes; everything
// numeric after that happens here. value is always this function's own sum.
function computeAppraisal(modelItems, gold, silver) {
  const lines = [];
  let total = 0, valued = 0, excluded = 0, verify = 0, anyPremium = false;
  modelItems.slice(0, 30).forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    const name = clip(m.name, 40).trim() || `Item ${i + 1}`;
    const source = clip(m.source, 120).replace(/"/g, "'").trim();
    const from = source ? `(from notes: "${source}")` : '(from notes)';
    const flag = clip(m.flag, 80).trim();
    const metal = ['Gold', 'Silver', 'Platinum'].find(x => x.toLowerCase() === String(m.metal || '').trim().toLowerCase()) || '';
    const gross = parseFloat(m.weight_g);
    const purityText = clip(m.karat_or_purity, 12).trim();
    const p = purityToDecimal(purityText);

    if (!(gross > 0) || p === null) { excluded++; lines.push(`${name} — no weight in notes ${from}`); return; }
    const shown = `${name} — ${r2(gross)}g ${purityText.toUpperCase()}${metal && metal !== 'Gold' ? ' ' + metal : ''} ${from}`;
    if (/verify/i.test(flag)) { verify++; lines.push(`${shown} → $0 — verify before offer`); return; }
    const spot = metal === 'Silver' ? silver : metal === 'Platinum' ? null : gold; // Gold is the default metal
    if (!spot) { excluded++; lines.push(`${shown} — no spot price`); return; }

    let ded = parseFloat(m.stone_deduction_g);
    ded = Number.isFinite(ded) && ded > 0 ? Math.min(ded, gross) : 0;
    const net = gross - ded;
    const fine = net * p;
    const melt = r2(fine * (spot / 31.1035));
    let prem = parseFloat(m.premium_usd);
    prem = Number.isFinite(prem) && prem > 0 ? r2(prem) : 0;
    const capped = prem > melt;
    if (capped) prem = melt;
    if (prem > 0) anyPremium = true;
    const reason = clip(m.premium_reason, 80).trim();
    total += r2(melt + prem); valued++;
    lines.push(shown
      + (ded > 0 ? ` → −${r2(ded)}g stones = ${r2(net)}g` : '')
      + ` → ${r2(fine)}g fine → $${melt.toFixed(2)}`
      + (prem > 0 ? ` + $${prem.toFixed(2)} premium${reason ? `: ${reason}` : ''}` : '')
      + (capped ? ' [premium capped]' : ''));
  });
  total = r2(total);
  const parts = [`${valued} valued`];
  if (excluded) parts.push(`${excluded} excluded`);
  if (verify) parts.push(`${verify} to verify`);
  return {
    value: total,
    lines,
    total_line: lines.length ? `Total — ${parts.join(', ')} → $${total.toFixed(2)}` : '',
    // Notes-derived values are never High.
    confidence: (excluded || verify || !valued) ? 'Low' : 'Medium',
    basis: anyPremium ? 'melt+premium' : 'melt',
  };
}

async function handleAppraise(raw, res) {
  const photos = (Array.isArray(raw.photos) ? raw.photos : []).slice(0, MAX_IMAGES);
  const notes = (Array.isArray(raw.inspection_notes) ? raw.inspection_notes : []).slice(0, 20)
    .map(n => clip(n, 1000).trim()).filter(Boolean);
  const manifest = (Array.isArray(raw.manifest) ? raw.manifest : []).slice(0, 30)
    .map(m => clip(m && m.name, 200).trim()).filter(Boolean);

  // Nothing to read weights from — skip the call.
  if (!notes.length) {
    return res.status(200).json({ value: 0, lines: [], total_line: '', confidence: 'Low', basis: 'melt', hint: APPRAISE_EMPTY_HINT });
  }

  let gold = FALLBACK_GOLD, silver = FALLBACK_SILVER;
  try { const p = await getSpotPrices(); gold = p.gold; silver = p.silver; } catch {}

  const images = (await Promise.all(photos.map(fetchDrivePhoto))).filter(Boolean);

  const prompt = `A gold buyer has inspected a lot and written free-text inspection notes. Extract one entry per item mentioned in the notes. Our server does all the math — do not compute melt or totals.

Inspection notes:
${notes.map(n => `- ${n}`).join('\n')}

Manifest item names (customer-submitted, for naming only — never a source of weight or karat): ${manifest.length ? manifest.join('; ') : 'none'}
${images.length} photo(s) attached, for judging stones and hallmarks only — never a source of weight or karat.

Fields per item:
- name: short label ("ring", "rope chain").
- metal: "Gold", "Silver" or "Platinum" — infer from the karat/notes (925/sterling → Silver; pt/950 plat → Platinum; karat → Gold).
- weight_g: the GROSS weight exactly as written in the notes, in grams. null if none.
- karat_or_purity: as written ("14K", "10k", "925", "18kt"). null if none.
- stone_deduction_g: if the line gives a gross weight then "prob Xg" / "net Xg" / "~Xg gold", X is the metal weight after stones: stone_deduction_g = gross − X. If X > gross, use 0 and set flag "verify". Only estimate a deduction yourself when stones are mentioned with no net figure (small melee ≈0.1g total; visible center stone ≈0.2–1.0g by size in photos). Otherwise 0.
- premium_usd: 0 unless BOTH (a) a meaningful stone (≥~0.5ct center, apparent diamond/sapphire/ruby/emerald) AND (b) a brand/provenance signal (hallmark, maker, cert in notes or photos). Then a conservative amount.
- premium_reason: one phrase when premium_usd > 0, else "".
- flag: "no weight in notes" if weight or karat is missing; "verify" if the notes raise doubt ("plated", "not sure if solid", "untested", "sus", "no stamp", "hopefully nothing filling"); otherwise "".
- source: the exact note snippet you read for this item (short).

Respond with JSON only — no markdown, no backticks, no other text:
{"items": [{"name": "", "metal": "Gold", "weight_g": null, "karat_or_purity": null, "stone_deduction_g": 0, "premium_usd": 0, "premium_reason": "", "flag": "", "source": ""}]}`;

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
  return res.status(200).json(computeAppraisal(Array.isArray(out && out.items) ? out.items : [], gold, silver));
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
