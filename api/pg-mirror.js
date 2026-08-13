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
