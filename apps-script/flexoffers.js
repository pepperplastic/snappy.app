// ═══════════════════════════════════════════════════════════════════════
//  FLEXOFFERS SERVER-TO-SERVER POSTBACK                     (Sep 3, 2026)
//
//  WHY S2S AND WHY ON ARRIVAL
//  Their JavaScript pixel can only fire in the browser, which means it fires
//  at REGISTRATION. Paying publishers per registration is the one thing we
//  know breaks: convert B bought 65 registrations at $3.91 and produced a
//  single package. A network publisher optimises against a payout far harder
//  than an ad algorithm does, because it is their income.
//
//  So the conversion is reported when the package ARRIVES. FlexOffers matches
//  it by the click id they hand us on landing (?refid=...), which we store on
//  the shipment at registration and read back days or weeks later.
//
//  SETUP
//    1. Add 'flex_click_id' to COLS.SHIPMENTS in Code.gs, run ensureAllColumns()
//    2. The three small Code.gs / queue.gs edits in FLEXOFFERS-EDITS.md
//    3. The App.jsx snippet, so ?refid= is captured and passed with the lead
//    4. Leave FlexOffers' "Subtracking Variable" blank — the default is refid
//
//  TEST
//    flexTestPostback()          — sends a dummy conversion, logs the response
//    flexPendingCheck()          — arrivals carrying a click id, and whether sent
// ═══════════════════════════════════════════════════════════════════════

var FLEX_ADVERTISER_ID = '674ea9cd-5892-4e45-9e4a-60c32306941c';
var FLEX_POSTBACK_URL  = 'https://track.flexlinkspro.com/da.ashx';

// The stage at which we report a conversion. 'received' = the package is in
// our hands, which is the moment worth paying for. Change to 'complete' only
// if you renegotiate to a revenue share on completed purchases.
var FLEX_FIRE_STAGE = 'received';

// Lead-style conversion: there is no sale amount at arrival, so 0. The payout
// is the flat per-arrival rate agreed with FlexOffers, not derived from this.
// If you later switch FLEX_FIRE_STAGE to 'complete', set this to 'appraised'
// to send the expected revenue instead and support a percentage commission.
var FLEX_AMOUNT_MODE = 'zero';   // 'zero' | 'appraised' | 'paid'

/**
 * Fire one conversion to FlexOffers. Called from the queue, never inline.
 * Idempotent via the flex_postback_sent column — a shipment reports once.
 */
function flexSendPostback(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var iId    = h.indexOf('shipment_id');
  var iClick = h.indexOf('flex_click_id');
  var iSent  = h.indexOf('flex_postback_sent');
  var iAppr  = h.indexOf('appraised_value');
  var iPaid  = h.indexOf('purchase_price');

  if (iClick < 0 || iSent < 0) {
    Logger.log('flexSendPostback: flex_click_id / flex_postback_sent columns missing — run ensureAllColumns()');
    return { skipped: 'no_columns' };
  }

  var row = -1;
  for (var r = 1; r < data.length; r++) { if (data[r][iId] === shipmentId) { row = r; break; } }
  if (row < 0) return { skipped: 'not_found' };

  var clickId = String(data[row][iClick] || '').trim();
  if (!clickId) return { skipped: 'no_click_id' };            // not a FlexOffers lead
  if (String(data[row][iSent] || '').trim()) return { skipped: 'already_sent' };

  var amount = 0;
  if (FLEX_AMOUNT_MODE === 'appraised') amount = parseFloat(data[row][iAppr]) || 0;
  else if (FLEX_AMOUNT_MODE === 'paid') amount = parseFloat(data[row][iPaid]) || 0;

  var url = FLEX_POSTBACK_URL +
    '?advertiserid=' + encodeURIComponent(FLEX_ADVERTISER_ID) +
    '&clickid='      + encodeURIComponent(clickId) +
    '&ordernumber='  + encodeURIComponent(shipmentId) +   // unique per conversion
    '&orderamount='  + encodeURIComponent(amount.toFixed(2)) +
    '&currency=USD&geo=USA&platform=S2S';

  var res = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true });
  var code = res.getResponseCode();
  var body = res.getContentText().slice(0, 300);

  if (code >= 200 && code < 300) {
    sheet.getRange(row + 1, iSent + 1).setValue(new Date().toISOString());
    Logger.log('FlexOffers postback OK · ' + shipmentId + ' · click ' + clickId.slice(0, 12) + '… · HTTP ' + code);
    try {
      addContactLog({ customer_id: '', shipment_id: shipmentId, type: 'note',
        notes: 'FlexOffers conversion reported (arrival, $' + amount.toFixed(2) + ')' });
    } catch (e) {}
    return { success: true, code: code };
  }

  // Left unstamped on failure so the next arrival-stage change retries it.
  Logger.log('FlexOffers postback FAILED · ' + shipmentId + ' · HTTP ' + code + ' · ' + body);
  return { success: false, code: code, body: body };
}

// Queue job handler — wired into processQueue by the edit in FLEXOFFERS-EDITS.md
function _processFlexJob(p) {
  flexSendPostback(p.shipment_id);
}

// ── Diagnostics ──────────────────────────────────────────────────────

// Sends a dummy conversion so you can confirm FlexOffers receives it.
// The click id is fake, so expect them to reject it — what matters is that
// the request goes out and comes back with a readable response.
function flexTestPostback() {
  var url = FLEX_POSTBACK_URL +
    '?advertiserid=' + encodeURIComponent(FLEX_ADVERTISER_ID) +
    '&clickid=TEST_CLICK_' + Date.now() +
    '&ordernumber=TEST-' + Date.now() +
    '&orderamount=0.00&currency=USD&geo=USA&platform=S2S';
  Logger.log('POST ' + url);
  var res = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true });
  Logger.log('HTTP ' + res.getResponseCode());
  Logger.log('Body: ' + res.getContentText().slice(0, 500));
}

// Which arrivals carry a FlexOffers click id, and have we reported them?
function flexPendingCheck() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var arrived = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var withClick = rows.filter(function (s) { return String(s.flex_click_id || '').trim(); });
  var arrivedWithClick = withClick.filter(function (s) {
    return arrived.indexOf(String(s.stage || '')) !== -1 || String(s.received_at || '').trim();
  });
  var sent = arrivedWithClick.filter(function (s) { return String(s.flex_postback_sent || '').trim(); });

  Logger.log('═══ FLEXOFFERS STATUS ═══');
  Logger.log('shipments carrying a click id: ' + withClick.length);
  Logger.log('  of those, arrived: ' + arrivedWithClick.length);
  Logger.log('  of those, reported: ' + sent.length + '   pending: ' + (arrivedWithClick.length - sent.length));
  if (!withClick.length) {
    Logger.log('');
    Logger.log('None yet. Either no FlexOffers traffic has registered, or ?refid=');
    Logger.log('is not being captured — check the App.jsx snippet is live.');
  }
  arrivedWithClick.slice(0, 15).forEach(function (s) {
    Logger.log('  ' + s.shipment_id + ' · ' + s.stage +
               ' · ' + (String(s.flex_postback_sent || '').trim() ? 'reported' : 'PENDING'));
  });
}

// Catch-up: report any arrival that carries a click id and hasn't been sent.
// Useful after fixing a config problem. Safe to re-run — idempotent.
function flexSendPending() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var arrived = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var todo = rows.filter(function (s) {
    if (!String(s.flex_click_id || '').trim()) return false;
    if (String(s.flex_postback_sent || '').trim()) return false;
    return arrived.indexOf(String(s.stage || '')) !== -1 || String(s.received_at || '').trim();
  });
  Logger.log('flexSendPending: ' + todo.length + ' to report');
  todo.forEach(function (s) {
    var r = flexSendPostback(s.shipment_id);
    Logger.log('  ' + s.shipment_id + ' → ' + JSON.stringify(r));
    Utilities.sleep(300);
  });
}