// ═══════════════════════════════════════════════════════════════
//  /api/crm-proxy — the ONLY path the CRM uses to reach its backend.
//
//  WHY THIS EXISTS
//   1. SECURITY. SCRIPT_URL was a constant in crm.jsx, so it shipped in the
//      Vite bundle on snappy.gold. doGet's read actions had no key check and
//      doPost had none at all — anyone who viewed source could pull every
//      customer record (incl. DL numbers + DOB from the FL 538 file) or write
//      to any shipment. Now the URL and key stay server-side and every call
//      requires a valid session cookie.
//   2. MIGRATION SEAM. One choke point for all CRM data access, so a table can
//      be repointed from Sheets to Postgres here without crm.jsx knowing.
//
//  ═══ HOW THE MIGRATION SWITCHES WORK ═══
//
//  Two env vars, independent, no code change needed to flip either:
//
//    PG_MIRROR=customers,shipments,contact_logs
//        Writes go to Apps Script FIRST (Sheets stays authoritative), then a
//        copy is applied to Postgres. Mirror failures are logged and swallowed
//        — they must never fail the operator's action.
//
//    PG_TABLES=customers,shipments,contact_logs
//        Reads come from Postgres instead of Sheets. Falls back to Apps Script
//        automatically if a Postgres query errors — a slow CRM beats a broken
//        one.
//
//  ORDER MATTERS. Turn on PG_MIRROR, let it run, re-run the backfill to catch
//  anything written in between, verify counts, THEN add PG_TABLES.
//
//  PG_TABLES *without* PG_MIRROR means edits land in Sheets while reads come
//  from Postgres — the CRM appears to lose changes on reload. Fine for a brief
//  timing test, not for real use.
//
//  ═══ ID TRANSLATION ═══
//
//  crm.jsx speaks SHP-984 / CUST-123. Postgres uses bigint primary keys with
//  the old string in a `legacy_id` column. Every read handler translates back
//  so the UI needs no changes at all; every mirror translates forward.
//
//  GET  /api/crm-proxy?action=getCustomers
//  POST /api/crm-proxy   { action:'updateShipment', ... }
// ═══════════════════════════════════════════════════════════════

import { requireSession } from './_lib/session.js';
import { supabase, readsFromPg, mirrorsToPg } from './_lib/supabase.js';

const READ_ACTIONS = new Set([
  'getCustomers',
  'getShipments',
  'getShipmentsLite',
  'getShipmentAttribution',
  'getContactLog',
  'getPhotos',
  'getSales',
  'crm_leads',
]);

// doPost falls through to handleLeadIngestion for unknown actions, so an
// explicit allowlist matters here: a typo would silently create a lead.
const WRITE_ACTIONS = new Set([
  'upsertCustomer', 'createShipment', 'updateShipment', 'getShipment',
  'resendLabelEmail', 'addContactLog', 'updateContactLog', 'deleteContactLog',
  'addSale', 'updateSale', 'deleteSale', 'getSales',
  'createListing', 'updateListing', 'getListings', 'composeFromShipment',
  'getCsThreads', 'getCsThreadMessages', 'updateCsThread', 'getCsNeedsReplyCount',
  'addPhoto', 'addInventoryPhoto', 'setPhotoStatus',
  'generateUSPSLabel', 'generateReturnLabel',
  'capturePaymentId', 'generateSelfServeToken',
  'pushToLeadsOnline', 'uploadLeadsOnlinePhotos',
  'manualCustomerShipment', 'getAffiliates', 'addAffiliate', 'updateAffiliate',
  'deleteAffiliate', 'getAffiliateStats',
]);

const UPSTREAM_TIMEOUT_MS = 55_000;
const PAGE = 1000;      // PostgREST caps a single response at 1000 rows
const MAX_ROWS = 50_000;

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

const blank = (v) => (v === undefined || v === null ? '' : String(v).trim());

// crm.jsx renders fields straight into JSX and does String(x||'') in places,
// so a null would print as "null". Sheets handed it '' for empty cells.
const s = (v) => (v === null || v === undefined ? '' : v);

// PostgREST returns at most 1000 rows per request regardless of .limit(),
// so page until a short page comes back.
async function fetchAll(build) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// SHP-984 -> 8471. Null when not found.
async function resolveLegacy(table, legacyId) {
  const id = blank(legacyId);
  if (!id) return null;
  const { data, error } = await supabase()
    .from(table).select('id').eq('legacy_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.id : null;
}

// ── Shape adapters: Postgres row -> the object crm.jsx already expects ──

// Sheets kept one `address` string; Postgres splits it into street/city/
// state/zip. Recombine so address rendering and the label path see what they
// always have.
function joinAddress(r) {
  const street = [r.street1, r.street2].filter(Boolean).join(' ');
  const tail = [r.city, r.state, r.zip].filter(Boolean).join(', ');
  return [street, tail].filter(Boolean).join(', ');
}

function toCustomer(r) {
  return {
    customer_id: s(r.legacy_id),
    email: s(r.email),
    name: s(r.name),
    phone: s(r.phone),
    address: joinAddress(r),
    source: s(r.source),
    created_at: s(r.created_at),
    notes: s(r.notes),
    id_type: s(r.id_type),
    id_number: s(r.id_number),
    id_state: s(r.id_state),
    date_birth: s(r.date_birth),
    id_photo_url: s(r.id_photo_url),
    sworn_statement_at: s(r.sworn_statement_at),
    sworn_statement_ip: s(r.sworn_statement_ip),
    quo_contact_id: s(r.quo_contact_id),
  };
}

const SHIPMENT_PASSTHROUGH = [
  'stage', 'shipping_type', 'item', 'estimate', 'ai_estimate_raw', 'ai_rationale',
  'customer_message', 'agent_notes', 'notes', 'bin_number', 'purchase_price',
  'appraised_value', 'offer_price', 'offer_description', 'shipping_cost',
  'outbound_tracking', 'return_tracking', 'kit_tracking', 'shipping_service',
  'easypost_shipment_id', 'shippo_transaction_id', 'label_qr_url',
  'label_refunded_at', 'payment_method', 'payment_info', 'created_at',
  'sent_at', 'received_at', 'purchased_at', 'returned_at', 'paid_at',
  'deferred_at', 'leadsonline_submitted_at', 'self_serve_submitted_at',
  'last_activity_at', 'traffic_source', 'variant', 'gclid', 'fbclid',
  'ship_followups_sent', 'capi_shipped_sent', 'capi_purchase_sent',
  'id_type', 'id_number', 'id_state', 'date_birth', 'id_photo_url',
  'sworn_statement_at', 'sworn_statement_ip', 'customer_edits',
  'customer_edits_text', 'user_edits',
];

function toShipment(r) {
  const out = {
    shipment_id: s(r.legacy_id),
    // customers comes from the FK join in SHIPMENT_SELECT below.
    customer_id: s(r.customers ? r.customers.legacy_id : ''),
  };
  for (const k of SHIPMENT_PASSTHROUGH) out[k] = s(r[k]);
  // crm.jsx compares is_urgent against the STRING "true"/"false" (see the
  // Mark Urgent button), so don't hand it a real boolean.
  out.is_urgent = r.is_urgent === true ? 'true' : (r.is_urgent === false ? 'false' : '');
  return out;
}

const SHIPMENT_SELECT = '*, customers!inner(legacy_id)';

function toContactLog(r) {
  return {
    log_id: s(r.legacy_id),
    customer_id: s(r.customers ? r.customers.legacy_id : ''),
    shipment_id: s(r.shipments ? r.shipments.legacy_id : ''),
    timestamp: s(r.occurred_at),    // Postgres named it occurred_at
    type: s(r.type),
    notes: s(r.notes),
  };
}

function toPhoto(r) {
  return {
    photo_id: s(r.legacy_id),
    shipment_id: s(r.shipments ? r.shipments.legacy_id : ''),
    drive_url: s(r.url),            // Postgres named it url
    uploaded_at: s(r.uploaded_at),
    source: s(r.source),
    purchase_status: s(r.purchase_status),
  };
}

// ── Read handlers ─────────────────────────────────────────────────

async function pgGetCustomers() {
  const rows = await fetchAll(() =>
    supabase().from('customers').select('*').order('id', { ascending: true }));
  return rows.map(toCustomer);
}

async function pgGetShipmentsLite(params) {
  const custLegacy = blank(params.customer_id);
  let custId = null;
  if (custLegacy) {
    custId = await resolveLegacy('customers', custLegacy);
    if (!custId) return [];
  }
  const rows = await fetchAll(() => {
    let q = supabase().from('shipments').select(SHIPMENT_SELECT)
      .order('id', { ascending: true });
    if (custId) q = q.eq('customer_id', custId);
    return q;
  });
  // attribution=null lets the frontend tell "not loaded yet" from "none".
  return rows.map((r) => ({ ...toShipment(r), attribution: null }));
}

// The attribution join is why getShipments took ~5s on Sheets: it walked the
// whole Lead Intake tab per call. Here it's one indexed lookup.
async function pgGetShipmentAttribution(params) {
  const shipLegacy = blank(params.shipment_id);
  if (!shipLegacy) return null;

  const { data: ship, error: e1 } = await supabase()
    .from('shipments').select('customer_id').eq('legacy_id', shipLegacy).maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!ship) return null;

  const { data, error } = await supabase()
    .from('lead_submissions')
    .select('utm_source, utm_medium, utm_campaign, utm_content, fbclid, gclid, variant, submission_type, session_id, submitted_at')
    .eq('customer_id', ship.customer_id)
    .order('submitted_at', { ascending: true })   // earliest = first touch
    .limit(50);
  if (error) throw new Error(error.message);
  if (!data || !data.length) return null;

  // Earliest row that actually carries attribution — same test as
  // getAttributionForCustomer's hasAttr check.
  const hit = data.find((r) => r.utm_source || r.utm_medium || r.utm_campaign
    || r.utm_content || r.fbclid || r.gclid || r.variant || r.submission_type);
  if (!hit) return null;

  return {
    utm_source: s(hit.utm_source),
    utm_medium: s(hit.utm_medium),
    utm_campaign: s(hit.utm_campaign),
    utm_content: s(hit.utm_content),
    fbclid: s(hit.fbclid),
    gclid: s(hit.gclid),
    variant: String(hit.variant || '').toUpperCase(),
    lead_source: s(hit.submission_type),
    session_id: s(hit.session_id),
    first_visit: s(hit.submitted_at),
  };
}

async function pgGetShipments(params) {
  const lite = await pgGetShipmentsLite(params);
  // Only the detail view needs attribution and it lazy-loads. Anything still
  // calling getShipments gets the same shape with attribution filled in.
  for (const row of lite) {
    row.attribution = await pgGetShipmentAttribution({ shipment_id: row.shipment_id });
  }
  return lite;
}

async function pgGetContactLog(params) {
  const custLegacy = blank(params.customer_id);
  let custId = null;
  if (custLegacy) {
    custId = await resolveLegacy('customers', custLegacy);
    if (!custId) return [];
  }
  const rows = await fetchAll(() => {
    let q = supabase().from('contact_logs')
      .select('*, customers(legacy_id), shipments(legacy_id)')
      .order('occurred_at', { ascending: false });
    if (custId) q = q.eq('customer_id', custId);
    return q;
  });
  return rows.map(toContactLog);
}

async function pgGetPhotos(params) {
  const shipLegacy = blank(params.shipment_id);
  let shipId = null;
  if (shipLegacy) {
    shipId = await resolveLegacy('shipments', shipLegacy);
    if (!shipId) return [];
  }
  const rows = await fetchAll(() => {
    let q = supabase().from('photos')
      .select('*, shipments(legacy_id)')
      .order('uploaded_at', { ascending: true });
    if (shipId) q = q.eq('shipment_id', shipId);
    return q;
  });
  return rows.map(toPhoto);
}

const PG_READ_ROUTES = {
  getCustomers:           { table: 'customers',    handler: pgGetCustomers },
  getShipmentsLite:       { table: 'shipments',    handler: pgGetShipmentsLite },
  getShipments:           { table: 'shipments',    handler: pgGetShipments },
  getShipmentAttribution: { table: 'shipments',    handler: pgGetShipmentAttribution },
  getContactLog:          { table: 'contact_logs', handler: pgGetContactLog },
  getPhotos:              { table: 'photos',       handler: pgGetPhotos },
};

// ── Write mirrors ─────────────────────────────────────────────────
// These run AFTER Apps Script succeeds. Sheets stays the source of truth
// while PG_MIRROR is on; Postgres is a replica kept warm so that turning on
// PG_TABLES doesn't serve stale data.

const nn = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const num = (v) => {
  const t = nn(v);
  if (t === null) return null;
  const n = parseFloat(t.replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
};

// Deliberately simple. The authoritative parse is _parseUsAddress in Code.gs
// and it already ran on the Sheets write; this only keeps the replica legible.
// Anything that fails the zip_format CHECK is stored as null rather than
// failing the mirror.
function splitAddress(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  const empty = { street1: null, city: null, state: null, zip: null };
  if (!parts.length) return empty;
  const last = parts[parts.length - 1];
  const two = last.split(/\s+/);
  const okZip = (z) => (/^\d{5}(-\d{4})?$/.test(z) ? z : null);

  if (two.length === 2 && /^[A-Za-z]{2}$/.test(two[0]) && /^\d{5}(-\d{4})?$/.test(two[1])) {
    return {
      street1: parts.slice(0, -2).join(', ') || null,
      city: parts[parts.length - 2] || null,
      state: two[0].toUpperCase(),
      zip: two[1],
    };
  }
  const maybeState = parts[parts.length - 2] || '';
  return {
    street1: parts.slice(0, -3).join(', ') || null,
    city: parts[parts.length - 3] || null,
    state: /^[A-Za-z]{2}$/.test(maybeState) ? maybeState.toUpperCase() : null,
    zip: okZip(last),
  };
}

async function mirrorUpsertCustomer(body) {
  const d = body.data || {};
  if (!nn(d.email)) return;
  const addr = splitAddress(d.address);
  // Conflict on email — upsertCustomer in Apps Script dedupes by email and
  // doesn't return the CUST- id, so legacy_id isn't available here.
  const { error } = await supabase().from('customers').upsert({
    email: nn(d.email),
    name: nn(d.name),
    phone: nn(d.phone),
    street1: addr.street1, city: addr.city, state: addr.state, zip: addr.zip,
    source: nn(d.source),
    notes: nn(d.notes),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

async function mirrorCreateShipment(body, upstream) {
  // createShipment returns the new SHP- id as a bare JSON string.
  const legacyId = typeof upstream === 'string' ? upstream : null;
  if (!legacyId) return;
  const d = body.data || {};
  const custId = await resolveLegacy('customers', d.customer_id);
  if (!custId) return;   // customer not mirrored yet; a backfill will catch it
  const now = new Date().toISOString();
  const { error } = await supabase().from('shipments').upsert({
    legacy_id: legacyId,
    customer_id: custId,
    stage: nn(d.stage) || 'ready_to_fulfill',
    shipping_type: nn(d.shipping_type) === 'label' ? 'fedex' : nn(d.shipping_type),
    item: nn(d.item),
    estimate: nn(d.estimate),
    notes: nn(d.notes),
    created_at: now,
    updated_at: now,
  }, { onConflict: 'legacy_id' });
  if (error) throw new Error(error.message);
}

const SHIPMENT_NUMERIC = new Set([
  'purchase_price', 'appraised_value', 'offer_price', 'shipping_cost',
]);
// inspection_json has no Postgres column — the typed inspection_items table
// is its proper home. Dropping it here mirrors what Sheets already does.
const SHIPMENT_SKIP = new Set(['inspection_json']);

async function mirrorUpdateShipment(body) {
  const legacyId = nn(body.shipment_id);
  if (!legacyId) return;
  const updates = body.updates || {};
  const patch = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(updates)) {
    if (SHIPMENT_SKIP.has(k)) continue;
    if (k === 'shipping_type') { patch[k] = nn(v) === 'label' ? 'fedex' : nn(v); continue; }
    if (k === 'is_urgent') { patch[k] = String(v) === 'true'; continue; }
    if (SHIPMENT_NUMERIC.has(k)) { patch[k] = num(v); continue; }
    patch[k] = nn(v);
  }
  const { error } = await supabase()
    .from('shipments').update(patch).eq('legacy_id', legacyId);
  if (error) throw new Error(error.message);
}

async function mirrorAddContactLog(body, upstream) {
  const legacyId = typeof upstream === 'string' ? upstream : null;
  if (!legacyId) return;
  const d = body.data || {};
  const custId = await resolveLegacy('customers', d.customer_id);
  if (!custId) return;
  const shipId = d.shipment_id ? await resolveLegacy('shipments', d.shipment_id) : null;
  const { error } = await supabase().from('contact_logs').upsert({
    legacy_id: legacyId,
    customer_id: custId,
    shipment_id: shipId,
    type: nn(d.type) || 'note',
    notes: nn(d.notes),
    occurred_at: new Date().toISOString(),
  }, { onConflict: 'legacy_id' });
  if (error) throw new Error(error.message);
}

async function mirrorUpdateContactLog(body) {
  const legacyId = nn(body.log_id);
  if (!legacyId) return;
  const u = body.updates || {};
  const patch = {};
  if (u.notes !== undefined) patch.notes = nn(u.notes);
  if (u.type !== undefined) patch.type = nn(u.type);
  if (!Object.keys(patch).length) return;
  const { error } = await supabase()
    .from('contact_logs').update(patch).eq('legacy_id', legacyId);
  if (error) throw new Error(error.message);
}

async function mirrorDeleteContactLog(body) {
  const legacyId = nn(body.log_id);
  if (!legacyId) return;
  const { error } = await supabase()
    .from('contact_logs').delete().eq('legacy_id', legacyId);
  if (error) throw new Error(error.message);
}

const PG_MIRROR_ROUTES = {
  upsertCustomer:   { table: 'customers',    handler: mirrorUpsertCustomer },
  createShipment:   { table: 'shipments',    handler: mirrorCreateShipment },
  updateShipment:   { table: 'shipments',    handler: mirrorUpdateShipment },
  addContactLog:    { table: 'contact_logs', handler: mirrorAddContactLog },
  updateContactLog: { table: 'contact_logs', handler: mirrorUpdateContactLog },
  deleteContactLog: { table: 'contact_logs', handler: mirrorDeleteContactLog },
};

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;

  const scriptUrl = process.env.APPS_SCRIPT_URL;
  const crmKey = process.env.CRM_SECRET_KEY;
  if (!scriptUrl || !crmKey) {
    return res.status(500).json({
      error: 'Server not configured — set APPS_SCRIPT_URL and CRM_SECRET_KEY',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    let upstream;
    let mirror = null;
    let mirrorBody = null;

    if (req.method === 'GET') {
      const params = { ...req.query };
      const action = String(params.action || '');
      if (!READ_ACTIONS.has(action)) {
        return res.status(400).json({ error: 'unsupported action: ' + action });
      }

      const route = PG_READ_ROUTES[action];
      if (route && readsFromPg(route.table)) {
        const t0 = Date.now();
        try {
          const out = await route.handler(params);
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Data-Source', 'postgres');
          res.setHeader('X-Query-Ms', String(Date.now() - t0));
          return res.status(200).json(out);
        } catch (pgErr) {
          // Fall through to Sheets rather than showing the operator an error.
          console.error('[crm-proxy] PG read failed for ' + action + ', falling back:', pgErr);
        }
      }

      params.key = crmKey;   // injected server-side; never leaves this function
      const qs = new URLSearchParams(params).toString();
      upstream = await fetch(scriptUrl + '?' + qs, {
        method: 'GET',
        redirect: 'follow',  // Apps Script 302s to script.googleusercontent.com
        signal: controller.signal,
      });

    } else if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body.action || '');
      if (!WRITE_ACTIONS.has(action)) {
        return res.status(400).json({ error: 'unsupported action: ' + action });
      }

      const mRoute = PG_MIRROR_ROUTES[action];
      if (mRoute && mirrorsToPg(mRoute.table)) { mirror = mRoute; mirrorBody = body; }

      upstream = await fetch(scriptUrl, {
        method: 'POST',
        // text/plain matches what crm.jsx sends — Apps Script parses
        // e.postData.contents itself and this avoids a CORS preflight.
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...body, key: crmKey }),
        redirect: 'follow',
        signal: controller.signal,
      });

    } else {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const text = await upstream.text();
    res.setHeader('Cache-Control', 'no-store');

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Apps Script serves an HTML error page when the deployment is broken
      // or the account is logged out. Surface it instead of failing blank.
      return res.status(502).json({
        error: 'upstream returned non-JSON',
        status: upstream.status,
        preview: text.slice(0, 300),
      });
    }

    if (mirror && parsed && parsed.success !== false) {
      try {
        await mirror.handler(mirrorBody, parsed);
      } catch (mirrorErr) {
        console.error('[crm-proxy] PG mirror failed for ' + mirrorBody.action + ':', mirrorErr);
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return res.status(aborted ? 504 : 500).json({
      error: aborted ? 'upstream timed out' : String((err && err.message) || err),
    });
  } finally {
    clearTimeout(timer);
  }
}
