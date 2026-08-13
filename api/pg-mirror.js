// ═══════════════════════════════════════════════════════════════
//  /api/pg-mirror — Apps Script's route into Postgres
//
//  WHY THIS EXISTS
//  Apps Script can't talk to Supabase directly any more: the new sb_secret_
//  keys reject any caller whose User-Agent looks like a browser, and
//  UrlFetchApp sends a Mozilla UA it won't let you override. This project has
//  no legacy JWT keys to fall back on.
//
//  Routing through Vercel is better anyway — Supabase credentials now live in
//  exactly one place instead of two, and Apps Script only needs the shared
//  CRM key it already has.
//
//  WHAT IT DOES
//  Takes a raw Sheets row, shapes it to the real Postgres columns, resolves the
//  customer FK, and upserts on legacy_id. All Postgres knowledge stays here.
//
//  AUTH: the same CRM_SECRET_KEY the proxy already injects. Not a public route.
// ═══════════════════════════════════════════════════════════════

const SUPA_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

// Whichever name the existing setup uses — logged on failure so it's obvious.
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  '';

const ALLOWED_TABLES = new Set(['customers', 'shipments']);

// Sheet's id column → Postgres legacy_id
const ID_COL = { customers: 'customer_id', shipments: 'shipment_id' };

let columnCache = {};   // table → string[]; persists across warm invocations

function headers(extra) {
  return {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

// PostgREST publishes an OpenAPI doc at the schema root. Reading it means we
// never guess column names, and a column added in Supabase is picked up without
// a code change.
async function getColumns(table) {
  if (columnCache[table]) return columnCache[table];
  const res = await fetch(`${SUPA_URL}/rest/v1/`, { headers: headers() });
  if (!res.ok) throw new Error(`schema fetch ${res.status}`);
  const spec = await res.json();
  const def = spec?.definitions?.[table];
  if (!def?.properties) throw new Error(`table ${table} not in schema`);
  columnCache[table] = Object.keys(def.properties);
  return columnCache[table];
}

// Sheets sends '' for blank, which Postgres rejects for timestamp/numeric
// columns. false and 0 must survive — they're real values.
function clean(v) {
  if (v === '' || v === undefined || v === null) return null;
  return v;
}

// ── Normalisation ──────────────────────────────────────────────────────
// The Aug 10 import scripts applied transformations that this endpoint has to
// repeat, or the same rows fail the same way. Each rule below exists because a
// real row was rejected by a real constraint.
function normalise(table, row, sheetRow) {
  if (table === 'shipments') {
    // The Sheets `shipping_type` can be 'label', which isn't in the
    // shipping_carrier enum. The import resolved it from shipping_service and
    // defaulted to fedex; same rule here so mirrored rows match imported ones.
    if (row.shipping_type != null) {
      const t = String(row.shipping_type).toLowerCase().trim();
      if (t === 'label') {
        const svc = String(sheetRow.shipping_service || '').toLowerCase();
        row.shipping_type = svc.includes('usps') ? 'usps' : 'fedex';
      } else if (t === '') {
        row.shipping_type = null;
      } else {
        row.shipping_type = t;
      }
    }
    // bin_is_short: the CHECK rejects long bin values.
    if (row.bin != null) {
      const b = String(row.bin).trim();
      row.bin = b.length ? b.slice(0, 10) : null;
    }
  }

  if (table === 'customers') {
    // zip_format: CHECK wants 5 digits or 5+4. Anything else is better as null
    // than as a rejected row — the Sheet keeps the original either way.
    if (row.zip != null) {
      const digits = String(row.zip).replace(/[^0-9]/g, '');
      if (digits.length === 5) row.zip = digits;
      else if (digits.length === 9) row.zip = digits.slice(0, 5) + '-' + digits.slice(5);
      else row.zip = null;
    }
  }

  return row;
}

async function customerPkFromLegacy(legacyId) {
  const url = `${SUPA_URL}/rest/v1/customers?legacy_id=eq.${encodeURIComponent(legacyId)}&select=id&limit=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.id ?? null;
}

async function upsert(table, row) {
  const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=legacy_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upsert ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({
      error: 'Supabase not configured',
      hint: 'expected SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY / SUPABASE_SECRET_KEY',
    });
  }

  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
    : (req.body || {});

  if ((body.key || '') !== process.env.CRM_SECRET_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const table = String(body.table || '');
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: `unsupported table: ${table}` });
  }

  // ── Fingerprint mode ────────────────────────────────────────────────
  // Returns legacy_id plus a caller-chosen set of columns for every row, so
  // Apps Script can diff Sheets against Postgres and mirror only what differs.
  // Apps Script can't read Supabase directly (sb_secret_ keys reject
  // browser-like User-Agents), so the read has to come through here too.
  if (body.action === 'fingerprint') {
    try {
      const cols = await getColumns(table);
      const want = Array.isArray(body.fields) ? body.fields.filter(f => cols.includes(f)) : [];
      const select = ['legacy_id', ...want].join(',');
      const out = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}` +
                    `&order=legacy_id&limit=${pageSize}&offset=${offset}`;
        const r = await fetch(url, { headers: headers() });
        if (!r.ok) throw new Error(`fingerprint ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const page = await r.json();
        out.push(...page);
        if (page.length < pageSize) break;
        if (offset > 50000) break;               // guard against a runaway loop
      }
      return res.status(200).json({ ok: true, rows: out, fields: want });
    } catch (err) {
      console.error('pg-mirror fingerprint', err);
      return res.status(500).json({ error: String(err.message || err) });
    }
  }

  const sheetRow = body.row;
  if (!sheetRow || typeof sheetRow !== 'object') {
    return res.status(400).json({ error: 'row required' });
  }

  try {
    const cols = await getColumns(table);
    const idCol = ID_COL[table];
    const shaped = {};
    const skipped = [];

    for (const [k, v] of Object.entries(sheetRow)) {
      const target = k === idCol ? 'legacy_id' : k;
      if (!cols.includes(target)) { skipped.push(k); continue; }
      shaped[target] = clean(v);
    }

    if (!shaped.legacy_id) {
      return res.status(400).json({ error: `row is missing ${idCol}` });
    }

    normalise(table, shaped, sheetRow);

    // customers.email is NOT NULL. One legacy row (CUST-1825) has none and was
    // skipped by the original import too — report it as skipped, not as an error,
    // so it stops looking like a failure every time a backfill runs.
    if (table === 'customers' && !shaped.email) {
      return res.status(200).json({ ok: true, skipped_row: true,
        reason: 'no email — cannot satisfy NOT NULL', legacy_id: shaped.legacy_id });
    }

    // shipments.customer_id is a bigint FK; the sheet carries 'CUST-123'.
    if (table === 'shipments') {
      const legacyCust = sheetRow.customer_id;
      if (legacyCust) {
        const pk = await customerPkFromLegacy(legacyCust);
        if (pk) shaped.customer_id = pk;
        else delete shaped.customer_id;   // don't fail the whole write on a dangling FK
      } else {
        delete shaped.customer_id;
      }
    }

    await upsert(table, shaped);
    return res.status(200).json({ ok: true, legacy_id: shaped.legacy_id, skipped });
  } catch (err) {
    console.error('pg-mirror', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
