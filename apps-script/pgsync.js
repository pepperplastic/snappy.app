// ═══════════════════════════════════════════════════════════════════════
//  pgsync.gs — mirror Sheets writes into Postgres          (Aug 13, 2026)
//
//  WHY THIS EXISTS
//  api/crm-proxy.js already mirrors writes into Postgres, but it can only
//  mirror what passes through it. Three write paths deliberately bypass the
//  proxy because they're public callers with no secret:
//      handleLeadIngestion   — new customers + shipments from snappy.gold
//      handleSubmitSelfServe — ID fields + sworn statement (FL 538 data)
//      the OpenPhone webhook — inbound SMS
//  On Aug 13 that gap surfaced as "the CRM isn't showing new registrations":
//  PG_TABLES made the CRM read shipments from Postgres, and everything created
//  by those three paths since Aug 10 existed only in Sheets.
//
//  DESIGN CHOICE THAT MATTERS
//  This hooks the three LOW-LEVEL writers — upsertCustomer, createShipment,
//  updateShipment — not the handlers. Every write to those two tables funnels
//  through them, including bulk scripts, patch functions and quickStage. Hook
//  the handlers instead and the next path someone adds silently re-opens the
//  same hole. Yes, that means proxy writes get mirrored twice; the mirror is an
//  idempotent upsert on legacy_id, so the second write is a no-op with the same
//  values. Wasted milliseconds are a fair price for "no path can bypass this".
//
//  SAFETY
//  • Never throws. A mirror failure must never break the Sheets write, which
//    remains the source of truth.
//  • Kill switch: set Script Property PG_MIRROR_ENABLED to "false" to stop
//    mirroring instantly, no redeploy — same pattern as the Vercel env vars.
//  • Reads the row back from the sheet and pushes THAT, rather than pushing the
//    delta it was handed. Auto-stamped fields (received_at, capi_shipped_sent,
//    purchased_at) are applied inside updateShipment, so pushing the delta would
//    silently drop them.
//
//  HOW IT TALKS TO POSTGRES
//  Not directly. Supabase's new sb_secret_ keys reject any caller with a
//  browser-like User-Agent, and UrlFetchApp sends one it won't let us change;
//  this project has no legacy JWT keys to fall back on. So Apps Script POSTs to
//  https://snappy.gold/api/pg-mirror and Vercel does the Supabase write with the
//  credentials it already holds. Supabase keys live in exactly one place, and
//  Apps Script only needs the CRM_SECRET_KEY it already has.
//
//  SETUP — nothing extra to configure. CRM_SECRET_KEY is a global in Code.gs,
//  read from Script Property CRM_SECRET_KEY (Sep 14), and must match the value
//  in Vercel.
//  Optional kill switch: Script Property PG_MIRROR_ENABLED = false
// ═══════════════════════════════════════════════════════════════════════

var PG_MIRROR_ENDPOINT = 'https://snappy.gold/api/pg-mirror';

// CRM_SECRET_KEY is a global var declared in Code.gs (loaded from Script Property
// CRM_SECRET_KEY) — Apps Script shares globals across files, so we read it from there.
// That also means it can never drift from what doGet/doPost check.
function _pgCfg() {
  var key = (typeof CRM_SECRET_KEY !== 'undefined') ? String(CRM_SECRET_KEY || '') : '';
  var on  = String(PropertiesService.getScriptProperties().getProperty('PG_MIRROR_ENABLED') || 'true')
              .toLowerCase() !== 'false';
  return { key: key, enabled: on && !!key };
}

// Sheets hands back Date objects; JSON.stringify turns those into ISO strings
// anyway, so the endpoint receives clean values. Blank-vs-null is handled there.
function _pgPost(table, row) {
  var cfg = _pgCfg();
  if (!cfg.enabled) return false;
  var res = UrlFetchApp.fetch(PG_MIRROR_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ key: cfg.key, table: table, row: row }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;
  Logger.log('pgsync: ' + table + ' HTTP ' + code + ' — ' + res.getContentText().slice(0, 300));
  return false;
}

function _sheetRowByValue(tabName, keyCol, keyVal) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var data = ss.getSheetByName(tabName).getDataRange().getValues();
  var headers = data[0];
  var idx = headers.indexOf(keyCol);
  if (idx < 0) return null;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idx]) === String(keyVal)) {
      var o = {};
      headers.forEach(function (h, i) { if (h) o[h] = data[r][i]; });
      return o;
    }
  }
  return null;
}

// ── Customers ──────────────────────────────────────────────────────────
function pgMirrorCustomer(customerId) {
  try {
    if (!_pgCfg().enabled || !customerId) return false;
    var row = _sheetRowByValue(TAB.CUSTOMERS, 'customer_id', customerId);
    if (!row) { Logger.log('pgsync: customer ' + customerId + ' not in sheet'); return false; }
    return _pgPost('customers', row);
  } catch (e) {
    Logger.log('pgsync: pgMirrorCustomer failed (non-fatal) — ' + e);
    return false;
  }
}

// ── Shipments ──────────────────────────────────────────────────────────
// The endpoint resolves the customer FK itself. If the customer hasn't reached
// Postgres yet (brand-new lead), mirror it first so the FK can resolve.
function pgMirrorShipment(shipmentId) {
  try {
    if (!_pgCfg().enabled || !shipmentId) return false;
    var row = _sheetRowByValue(TAB.SHIPMENTS, 'shipment_id', shipmentId);
    if (!row) { Logger.log('pgsync: shipment ' + shipmentId + ' not in sheet'); return false; }
    if (row.customer_id) pgMirrorCustomer(row.customer_id);
    return _pgPost('shipments', row);
  } catch (e) {
    Logger.log('pgsync: pgMirrorShipment failed (non-fatal) — ' + e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  CATCH-UP BACKFILL
//  Run once to close the Aug 10 → now gap, then any time the two drift.
//  Safe to re-run: every write is an upsert on legacy_id.
//
//    pgCatchUp()                → everything created on/after 2026-08-10
//    pgCatchUp('2026-08-01')    → from a specific date
//    pgCatchUp(null, true)      → DRY RUN, logs counts and changes nothing
// ═══════════════════════════════════════════════════════════════════════
function pgCatchUp(sinceIso, dryRun) {
  var cfg = _pgCfg();
  if (!cfg.enabled) { Logger.log('pgsync: disabled or unconfigured — nothing to do'); return; }

  var since = new Date(sinceIso || '2026-08-10T00:00:00Z');
  Logger.log('pgsync catch-up since ' + since.toISOString() + (dryRun ? '  [DRY RUN]' : ''));

  var ss = SpreadsheetApp.openById(SHEET_ID);

  ['CUSTOMERS', 'SHIPMENTS'].forEach(function (which) {
    var tab = TAB[which];
    var idCol = which === 'CUSTOMERS' ? 'customer_id' : 'shipment_id';
    var data = ss.getSheetByName(tab).getDataRange().getValues();
    var headers = data[0];
    var iId = headers.indexOf(idCol);
    var iCreated = headers.indexOf('created_at');
    var todo = [];

    for (var r = 1; r < data.length; r++) {
      var created = data[r][iCreated];
      var d = created instanceof Date ? created : new Date(created);
      if (isNaN(d.getTime()) || d < since) continue;
      if (data[r][iId]) todo.push(data[r][iId]);
    }

    Logger.log('  ' + tab + ': ' + todo.length + ' row(s) on/after cutoff');
    if (dryRun) { Logger.log('    ' + todo.slice(0, 20).join(', ') + (todo.length > 20 ? ' …' : '')); return; }

    var ok = 0, failed = [];
    todo.forEach(function (id, i) {
      var good = (which === 'CUSTOMERS') ? pgMirrorCustomer(id) : pgMirrorShipment(id);
      if (good) ok++; else failed.push(id);
      if ((i + 1) % 25 === 0) Logger.log('    …' + (i + 1) + '/' + todo.length);
    });
    Logger.log('  ' + tab + ': ' + ok + '/' + todo.length + ' mirrored');
    if (failed.length) Logger.log('  ' + tab + ' FAILED: ' + failed.join(', '));
  });

  Logger.log('catch-up done. Verify in Supabase: select max(created_at) from shipments;');
}

// Sanity check before wiring anything in. Writes nothing.
function pgTestConnection() {
  var cfg = _pgCfg();
  Logger.log('CRM_SECRET_KEY found in Code.gs: ' + !!cfg.key + '   mirror enabled: ' + cfg.enabled);
  if (!cfg.enabled) { Logger.log('→ CRM_SECRET_KEY missing, or PG_MIRROR_ENABLED is false'); return; }

  var res = UrlFetchApp.fetch(PG_MIRROR_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ key: cfg.key, table: 'shipments' }),   // no row on purpose
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log('endpoint HTTP ' + code + ' — ' + body.slice(0, 300));
  if (code === 400 && body.indexOf('row required') !== -1) {
    Logger.log('✅ auth OK and Supabase reachable — ready to run pgCatchUp()');
  } else if (code === 401) {
    Logger.log('❌ CRM_SECRET_KEY here does not match the one in Vercel');
  } else if (code === 500) {
    Logger.log('❌ endpoint reached but Supabase env vars are wrong — see the hint above');
  } else if (code === 404) {
    Logger.log('❌ /api/pg-mirror not deployed yet');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  NIGHTLY RECONCILIATION                                   (Aug 13, 2026)
//
//  WHY THIS EXISTS
//  The mirror hooks sit in upsertCustomer / createShipment / updateShipment,
//  which covers the CRM and the public ingestion paths. But ~30 other functions
//  in Code.gs write cells directly with setValue() and never touch those —
//  _orphanSweepCore (30-min trigger), _refundSweepCore and _dailyRefundCore
//  (daily, stamp label_refunded_at), _cleanBinCore, backfillCleanDobs,
//  migratePipelineStages and the various patch scripts. Postgres will drift
//  again from those, quietly.
//
//  Hooking each one is the wrong fix: there are too many, and the next one
//  someone writes won't be hooked either. This reconciles by comparing STATE
//  instead, so drift self-heals no matter which writer caused it — including
//  writers that don't exist yet.
//
//  WHY IT COMPARES INSTEAD OF RE-MIRRORING EVERYTHING
//  pgCatchUp filters on created_at, so it would miss the actual problem — a
//  refund sweep stamping a shipment created in June. And blindly re-pushing all
//  ~1,166 shipments nightly would blow the 6-minute execution limit.
//
//  Only these volatile fields are compared — the ones the direct writers touch.
//  Add to the list if a new field starts drifting; comparing everything creates
//  false positives from Sheets/Postgres formatting differences.
// ═══════════════════════════════════════════════════════════════════════

var RECON_FIELDS = {
  SHIPMENTS: [
    'stage','bin','received_at','purchase_price','appraised_value','offer_price',
    'paid_at','purchased_at','returned_at','label_refunded_at','leadsonline_submitted_at',
    'outbound_tracking','return_tracking','payment_method','payment_info',
    'date_birth','id_number','deferred_at','capi_shipped_sent','capi_purchase_sent'
  ],
  CUSTOMERS: [
    'name','email','phone','address','city','state','zip',
    'id_type','id_number','id_state','date_birth'
  ]
};

// ~1.5s per row in practice, so 120 keeps a full run near 3 minutes against the
// 6-minute execution limit. The first run may cap; just re-run until it's clean.
var RECON_MAX_WRITES = 120;

// Postgres stores these as DATE, not timestamp. Sheets returns a Date object
// that becomes midnight-Eastern-in-UTC ("1969-07-29T04:00:00"), so a naive
// compare never matches: we'd push the timestamp, Postgres would truncate it
// back to a date, and the row would "drift" again every single night forever.
// Compare the calendar date only.
var RECON_DATE_ONLY = { date_birth: true };

// Both sides have to be reduced to the same shape before comparing, or every
// row looks different: Sheets hands back Date objects and numbers, Postgres
// returns ISO strings and numeric strings.
function _reconNorm(v, dateOnly) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return dateOnly ? v.toISOString().slice(0, 10) : v.toISOString().slice(0, 19);
  }
  var s = String(v).trim();
  if (dateOnly) {
    var d = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return d ? d[1] : s.toLowerCase();
  }
  // timestamps: compare to the second, ignoring zone suffix and separator style
  var m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return m[1] + 'T' + m[2];
  // numbers: 250 and "250.00" are the same value
  if (s !== '' && !isNaN(Number(s))) {
    var n = Number(s);
    return (Math.round(n * 100) / 100).toString();
  }
  return s.toLowerCase();
}

function _pgFingerprint(table, fields) {
  var cfg = _pgCfg();
  if (!cfg.enabled) return null;
  var res = UrlFetchApp.fetch(PG_MIRROR_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ key: cfg.key, action: 'fingerprint', table: table, fields: fields }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('recon: fingerprint ' + table + ' HTTP ' + res.getResponseCode() +
               ' — ' + res.getContentText().slice(0, 250));
    return null;
  }
  var body = JSON.parse(res.getContentText());
  var byId = {};
  (body.rows || []).forEach(function (r) { byId[r.legacy_id] = r; });
  return byId;
}

// pgReconcile()          → fix drift
// pgReconcile(true)      → DRY RUN, logs what differs and writes nothing
function pgReconcile(dryRun) {
  var cfg = _pgCfg();
  if (!cfg.enabled) { Logger.log('recon: mirror disabled — nothing to do'); return; }

  var started = new Date();
  Logger.log('═══ pgReconcile ' + started.toISOString() + (dryRun ? '  [DRY RUN]' : '') + ' ═══');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  [['SHIPMENTS', 'shipments', 'shipment_id'],
   ['CUSTOMERS', 'customers', 'customer_id']].forEach(function (spec) {
    var key = spec[0], pgTable = spec[1], idCol = spec[2];
    var fields = RECON_FIELDS[key];

    var pg = _pgFingerprint(pgTable, fields);
    if (!pg) { Logger.log('  ' + pgTable + ': fingerprint failed, skipping'); return; }

    var data = ss.getSheetByName(TAB[key]).getDataRange().getValues();
    var headers = data[0];
    var iId = headers.indexOf(idCol);
    var fIdx = fields.map(function (f) { return headers.indexOf(f); });

    var missing = [], drifted = [], samples = [];
    for (var r = 1; r < data.length; r++) {
      var id = data[r][iId];
      if (!id) continue;
      var pgRow = pg[id];
      if (!pgRow) {
        // customers.email is NOT NULL, so an email-less row can never land in
        // Postgres. Without this it reports as "missing" every night forever.
        if (key === 'CUSTOMERS') {
          var iEmail = headers.indexOf('email');
          if (iEmail < 0 || !String(data[r][iEmail] || '').trim()) continue;
        }
        missing.push(id);
        continue;
      }

      for (var f = 0; f < fields.length; f++) {
        if (fIdx[f] < 0) continue;                       // column not in the sheet
        if (!(fields[f] in pgRow)) continue;             // column not in Postgres
        var dOnly = !!RECON_DATE_ONLY[fields[f]];
        var a = _reconNorm(data[r][fIdx[f]], dOnly);
        var b = _reconNorm(pgRow[fields[f]], dOnly);
        if (a !== b) {
          drifted.push(id);
          if (samples.length < 8) {
            samples.push(id + '.' + fields[f] + ': sheet="' + a + '" pg="' + b + '"');
          }
          break;
        }
      }
    }

    Logger.log('  ' + pgTable + ': ' + missing.length + ' missing, ' + drifted.length + ' drifted');
    if (samples.length) samples.forEach(function (s) { Logger.log('      ' + s); });

    var todo = missing.concat(drifted);
    if (!todo.length) return;
    if (dryRun) { Logger.log('    [dry run] would mirror ' + todo.length + ' row(s)'); return; }

    if (todo.length > RECON_MAX_WRITES) {
      Logger.log('    capped at ' + RECON_MAX_WRITES + ' of ' + todo.length +
                 ' — re-run to continue (this is normal on a first run)');
      todo = todo.slice(0, RECON_MAX_WRITES);
    }

    var ok = 0, bad = [];
    todo.forEach(function (id) {
      var good = (key === 'CUSTOMERS') ? pgMirrorCustomer(id) : pgMirrorShipment(id);
      if (good) ok++; else bad.push(id);
    });
    Logger.log('    repaired ' + ok + '/' + todo.length);
    if (bad.length) Logger.log('    FAILED: ' + bad.slice(0, 20).join(', '));
  });

  Logger.log('done in ' + Math.round((new Date() - started) / 1000) + 's');
}

// Run once to schedule it. Re-running replaces the existing trigger rather than
// stacking a second one.
function pgInstallReconcileTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pgReconcile') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pgReconcile').timeBased().atHour(3).everyDays(1).create();
  Logger.log('pgReconcile scheduled daily ~3am. Remove with pgRemoveReconcileTrigger().');
}

function pgRemoveReconcileTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pgReconcile') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('removed ' + n + ' pgReconcile trigger(s)');
}
