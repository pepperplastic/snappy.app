// ═══════════════════════════════════════════════════════════════════════
//  BACKGROUND JOB QUEUE                                     (Sep 3, 2026)
//
//  WHY THIS EXISTS
//  Two of the worst problems in the CRM had the same shape: slow work was
//  running INSIDE a request that something else was waiting on.
//
//   1. Quo's webhook posts an inbound text and waits for a reply. The handler
//      was reading the whole Customers tab, the whole Shipments tab, calling
//      Claude, fetching OpenPhone history, and sending an email — all before
//      answering. Quo gave up, retried, failed again, and disabled the
//      webhook. Twice.
//
//   2. Every stage change called _fireCapiForShipment, which read the whole
//      Shipments tab, then getCustomers(), then getAttributionForCustomer() —
//      which scans all ~17,000 rows of Lead Intake. That is the ~10 seconds
//      between clicking Received and the photo prompt appearing.
//
//  THE FIX IS THE SAME FOR BOTH: write one row to a queue and return
//  immediately. A trigger drains the queue a minute later. Nothing that the
//  user or Quo waits on touches a big sheet.
//
//  SETUP — run these two once, from the editor:
//      setupQueueTab()
//      createQueueTrigger()
// ═══════════════════════════════════════════════════════════════════════

var QUEUE_TAB = '_Queue';
var QUEUE_HEADERS = ['queue_id', 'kind', 'payload_json', 'created_at', 'processed_at', 'error'];
var QUEUE_BATCH = 25;          // jobs per trigger run
var QUEUE_MAX_MS = 4.5 * 60 * 1000;  // stop before the 6-min kill

function setupQueueTab() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) {
    sh = ss.insertSheet(QUEUE_TAB);
    sh.appendRow(QUEUE_HEADERS);
    sh.getRange(1, 1, 1, QUEUE_HEADERS.length)
      .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    sh.setFrozenRows(1);
    Logger.log('Created ' + QUEUE_TAB);
  } else {
    Logger.log(QUEUE_TAB + ' already exists');
  }
}

function createQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(1).create();
  Logger.log('Trigger created: processQueue every minute');
}

// Fast path. ONE appendRow, nothing else. Never throws into the caller.
function _enqueue(kind, payload) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(QUEUE_TAB);
    if (!sh) { sh = ss.insertSheet(QUEUE_TAB); sh.appendRow(QUEUE_HEADERS); }
    sh.appendRow([
      'Q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      kind,
      JSON.stringify(payload || {}),
      new Date().toISOString(),
      '', ''
    ]);
    return true;
  } catch (e) {
    Logger.log('_enqueue failed (' + kind + '): ' + e);
    return false;
  }
}

// Drains the queue. Runs on a trigger, so it can afford to be slow.
function processQueue() {
  var started = Date.now();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) { Logger.log('processQueue: no queue tab — run setupQueueTab()'); return; }

  var data = sh.getDataRange().getValues();
  var h = data[0];
  var iKind = h.indexOf('kind'), iPayload = h.indexOf('payload_json'),
      iDone = h.indexOf('processed_at'), iErr = h.indexOf('error');

  var done = 0, failed = 0;
  for (var r = 1; r < data.length; r++) {
    if (Date.now() - started > QUEUE_MAX_MS) break;
    if (done + failed >= QUEUE_BATCH) break;
    if (String(data[r][iDone] || '').trim()) continue;   // already handled

    var kind = String(data[r][iKind] || '');
    var payload = {};
       try { payload = JSON.parse(data[r][iPayload] || '{}'); } catch (e) {}

    try {
      if (kind === 'capi')        _processCapiJob(payload);
      else if (kind === 'sms_in') _processSmsInboundJob(payload);
      else if (kind === 'flex')   _processFlexJob(payload);
      else Logger.log('processQueue: unknown kind "' + kind + '" — skipping');
      sh.getRange(r + 1, iDone + 1).setValue(new Date().toISOString());
      done++;
    } catch (err) {
      // Stamp processed_at anyway so one poisoned job can't block the queue
      // Stamp processed_at anyway so one poisoned job can't block the queue.
      sh.getRange(r + 1, iDone + 1).setValue(new Date().toISOString());
      sh.getRange(r + 1, iErr + 1).setValue(String(err).slice(0, 250));
      failed++;
      Logger.log('processQueue job failed (' + kind + '): ' + err);
    }
  }
  if (done || failed) Logger.log('processQueue: ' + done + ' done, ' + failed + ' failed');
}

// ── Job: Meta CAPI conversion event ──────────────────────────────────
// Same work the old inline hook did — just no longer on the user's clock.
function _processCapiJob(p) {
  if (typeof _fireCapiForShipment !== 'function') return;
  _fireCapiForShipment(p.shipment_id, p.stage);
}

// ── Job: inbound SMS from Quo ────────────────────────────────────────
// The matching, Claude draft, CS-thread upsert and review email all happen
// here now, a minute after Quo already got its 200.
function _processSmsInboundJob(p) {
  // handleOpenPhoneInbound is unchanged — it just runs here now instead of
  // while Quo is holding the connection open waiting for a 200.
  handleOpenPhoneInbound(p);
}

// ── Housekeeping: trim processed rows older than 7 days ──────────────
// Run occasionally, or wire to a weekly trigger. Keeps the tab small.
function pruneQueue() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  var h = data[0];
  var iDone = h.indexOf('processed_at');
  var cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  var removed = 0;
  for (var r = data.length - 1; r >= 1; r--) {
    var d = String(data[r][iDone] || '');
    if (d && d < cutoff) { sh.deleteRow(r + 1); removed++; }
  }
  Logger.log('pruneQueue: removed ' + removed + ' old row(s)');
}

// ── Diagnostic ───────────────────────────────────────────────────────
function queueStatus() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) { Logger.log('No queue tab.'); return; }
  var data = sh.getDataRange().getValues();
  var h = data[0];
  var iKind = h.indexOf('kind'), iDone = h.indexOf('processed_at'), iErr = h.indexOf('error');
  var pending = {}, errors = 0, total = data.length - 1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][iErr] || '').trim()) errors++;
    if (!String(data[r][iDone] || '').trim()) {
      var k = String(data[r][iKind] || '?');
      pending[k] = (pending[k] || 0) + 1;
    }
  }
  Logger.log('═══ QUEUE STATUS ═══');
  Logger.log('total rows: ' + total + '  ·  errored: ' + errors);
  var keys = Object.keys(pending);
  if (!keys.length) Logger.log('pending: none — queue is drained');
  else keys.forEach(function (k) { Logger.log('pending ' + k + ': ' + pending[k]); });
}
