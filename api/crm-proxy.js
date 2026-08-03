// ═══════════════════════════════════════════════════════════════
//  /api/crm-proxy — the ONLY path the CRM uses to reach Apps Script.
//
//  Why this exists:
//   1. SECURITY. SCRIPT_URL was a constant in crm.jsx, so it shipped in
//      the Vite bundle on snappy.gold. doGet's read actions had no key
//      check and doPost had none at all — anyone who viewed source could
//      pull every customer record (incl. DL numbers + DOB from the FL 538
//      file) or write to any shipment. Now the URL and key stay server-side
//      and every call requires a valid session cookie.
//   2. MIGRATION SEAM. One choke point for all CRM data access, so a table
//      can be repointed from Sheets to Postgres here without the CRM UI
//      knowing. Contact Log first (see ROUTE_OVERRIDES below).
//
//  GET  /api/crm-proxy?action=getCustomers
//  POST /api/crm-proxy   { action:'updateShipment', ... }
// ═══════════════════════════════════════════════════════════════

import { requireSession } from './_lib/session.js';

// Read actions (doGet). Anything not listed is rejected.
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

// Write actions (doPost). Explicit allowlist matters here: doPost falls
// through to handleLeadIngestion for unknown actions, so a typo or an
// injected action would silently create leads.
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
  'manualCustomerShipment',
]);

// Migration seam. As a table moves to Postgres, add its action here and
// implement the handler; everything else keeps flowing to Apps Script.
// Empty today — this is the hook, not the migration.
const ROUTE_OVERRIDES = {
  // getContactLog: (params) => queryPostgresContactLog(params),
};

const UPSTREAM_TIMEOUT_MS = 55_000; // Apps Script can be slow on big reads

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

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

    if (req.method === 'GET') {
      const params = { ...req.query };
      const action = String(params.action || '');
      if (!READ_ACTIONS.has(action)) {
        return res.status(400).json({ error: 'unsupported action: ' + action });
      }
      if (ROUTE_OVERRIDES[action]) {
        return res.status(200).json(await ROUTE_OVERRIDES[action](params));
      }
      params.key = crmKey; // injected server-side; never leaves this function
      const qs = new URLSearchParams(params).toString();
      upstream = await fetch(scriptUrl + '?' + qs, {
        method: 'GET',
        redirect: 'follow', // Apps Script 302s to script.googleusercontent.com
        signal: controller.signal,
      });

    } else if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body.action || '');
      if (!WRITE_ACTIONS.has(action)) {
        return res.status(400).json({ error: 'unsupported action: ' + action });
      }
      if (ROUTE_OVERRIDES[action]) {
        return res.status(200).json(await ROUTE_OVERRIDES[action](body));
      }
      upstream = await fetch(scriptUrl, {
        method: 'POST',
        // text/plain matches what crm.jsx already sends — Apps Script parses
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
    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      // Apps Script returns an HTML error page when the deployment is broken
      // or the account is logged out. Surface it instead of a blank failure.
      return res.status(502).json({
        error: 'upstream returned non-JSON',
        status: upstream.status,
        preview: text.slice(0, 300),
      });
    }
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return res.status(aborted ? 504 : 500).json({
      error: aborted ? 'upstream timed out' : String((err && err.message) || err),
    });
  } finally {
    clearTimeout(timer);
  }
}
