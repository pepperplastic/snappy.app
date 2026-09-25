// ═══════════════════════════════════════════════════════════════════════
//  backfill-appraised.gs — purchases with no appraised_value (Sep 25 2026)
//
//  WHY: margin and net on the ROI and Marketing tabs are appraised_value −
//  purchase_price. A purchased shipment with a blank appraisal counts toward
//  every rate but contributes 0 margin, which drags Net down and shows up as
//  the "missing appraisal" count. Some of those rows already carry the answer:
//  the Inspection panel wrote per-item values into inspection_json even when
//  appraised_value never got filled in.
//
//  Run from the editor, in this order:
//    1. listMissingAppraised()            — read-only, logs only
//    2. backfillAppraisedFromInspection() — writes ONLY appraised_value, and
//                                           only where inspection_json has a sum
//
//  The write goes through updateShipment so the Postgres mirror stays in step;
//  appraised_value is not in ACTIVITY_FIELDS and no stage is passed, so nothing
//  else on the row is touched — no last_activity_at, no stage stamps.
// ═══════════════════════════════════════════════════════════════════════

var BFA_STAGES = ['complete', 'pending_payment', 'pending_leadsonline'];

function _bfaBlank(v) { return String(v === null || v === undefined ? '' : v).trim() === ''; }

// Sum of the per-item values InspectionPanel writes: finalValue (the override,
// or the suggestion when it wasn't overridden), falling back to suggested.
// Returns null when there is nothing usable — never 0-by-accident.
function _bfaInspectionSum(raw) {
  if (_bfaBlank(raw)) return null;
  var arr;
  try { arr = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) { return null; }
  if (!arr || !arr.length || typeof arr.length !== 'number') return null;
  var sum = 0, found = false;
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i] || {};
    var pick = (it.finalValue !== undefined && it.finalValue !== '' && it.finalValue !== null) ? it.finalValue : it.suggested;
    var n = parseFloat(pick);
    if (!isNaN(n)) { sum += n; found = true; }
  }
  return found ? Math.round(sum * 100) / 100 : null;
}

function _bfaRows() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var custName = {};
  getCustomers().forEach(function (c) { if (c.customer_id) custName[c.customer_id] = String(c.name || '').trim() || String(c.email || ''); });
  var out = [];
  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function (s) {
    var stage = String(s.stage || '').toLowerCase().trim();
    if (BFA_STAGES.indexOf(stage) === -1) return;
    var paid = parseFloat(s.purchase_price) || 0;
    if (!(paid > 0)) return;
    if (!_bfaBlank(s.appraised_value)) return;
    out.push({
      shipment_id: s.shipment_id, stage: stage, paid: paid,
      customer: custName[s.customer_id] || s.customer_id || '?',
      item: String(s.item || '').replace(/\s+/g, ' ').trim(),
      purchased_at: String(s.purchased_at || s.paid_at || '').slice(0, 10),
      has_json: !_bfaBlank(s.inspection_json),
      sum: _bfaInspectionSum(s.inspection_json),
    });
  });
  out.sort(function (a, b) { return b.paid - a.paid; });
  return out;
}

function _bfaCut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ── READ-ONLY: what's missing, and what can be recovered ──
function listMissingAppraised() {
  var rows = _bfaRows();
  var totalPaid = 0, recoverable = 0, recoverableSum = 0, hasJsonNoSum = 0;
  Logger.log('═══ PURCHASES WITH NO APPRAISED VALUE — ' + rows.length + ' ═══');
  rows.forEach(function (r) {
    totalPaid += r.paid;
    if (r.sum !== null) { recoverable++; recoverableSum += r.sum; }
    else if (r.has_json) hasJsonNoSum++;
    Logger.log('  ' + r.shipment_id +
      ' · ' + _bfaCut(r.customer, 22) +
      ' · ' + _bfaCut(r.item || '(no item)', 34) +
      ' · paid $' + r.paid.toFixed(2) +
      ' · ' + (r.purchased_at || 'no purchase date') +
      ' · ' + (r.has_json ? (r.sum !== null ? 'inspection_json → $' + r.sum.toFixed(2) : 'inspection_json (no item values)') : 'no inspection_json') +
      ' · ' + r.stage);
  });
  Logger.log('');
  Logger.log('  count:              ' + rows.length);
  Logger.log('  total paid:         $' + totalPaid.toFixed(2));
  Logger.log('  recoverable sum:    ' + recoverable + ' (would write $' + recoverableSum.toFixed(2) + ' of appraised value)');
  if (hasJsonNoSum) Logger.log('  inspection_json but no usable item values: ' + hasJsonNoSum);
  Logger.log('  the other ' + (rows.length - recoverable) + ' need the value by hand.');
  return rows;
}

// ── WRITE: appraised_value = the inspection sum, where there is one ──
function backfillAppraisedFromInspection() {
  var rows = _bfaRows().filter(function (r) { return r.sum !== null; });
  if (!rows.length) { Logger.log('backfillAppraisedFromInspection: nothing to write.'); return 0; }
  Logger.log('═══ BACKFILL APPRAISED VALUE — ' + rows.length + ' shipment(s) ═══');
  var wrote = 0, failed = 0;
  rows.forEach(function (r) {
    try {
      var ok = updateShipment(r.shipment_id, { appraised_value: String(r.sum) });
      if (ok === false) { failed++; Logger.log('  FAILED ' + r.shipment_id + ' — row not found'); return; }
      wrote++;
      Logger.log('  ' + r.shipment_id + ' · ' + _bfaCut(r.customer, 22) + ' · paid $' + r.paid.toFixed(2) + ' → appraised_value $' + r.sum.toFixed(2));
    } catch (e) {
      failed++;
      Logger.log('  FAILED ' + r.shipment_id + ' — ' + e);
    }
  });
  Logger.log('');
  Logger.log('  wrote ' + wrote + (failed ? ' · failed ' + failed : '') + ' · nothing else on those rows was touched.');
  return wrote;
}
