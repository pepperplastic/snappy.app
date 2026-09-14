// ═══════════════════════════════════════════════════════════════════════
//  postlabel-v2.gs — replacement post-label follow-ups (Sep 12 2026)
//
//  WHY: the Aug sender (sendPostLabelFollowups in Code.gs) hard-codes "drop it
//  at USPS" for FedEx customers, promises a QR code Shippo labels don't have,
//  and has no quiet hours — it texted Bruce Alday at 12:42 AM. This file keeps
//  the SAME four touches (day 2 SMS, 4 email, 7 SMS, 12 email) and fixes:
//   • carrier-aware wording (from shipping_service / shipping_type)
//   • QR line only when label_qr_url exists
//   • itemPhrase() instead of the raw "Ring + Necklace" joiner
//   • SMS only 9am–8pm ET (emails any time)
//   • skips shipments whose inbound tracking already shows a scan
//   • per-run cap of 40
//  SETUP: paste as new file `postlabel-v2`, Save, run previewPostLabelV2(),
//  then createPostLabelTriggerV2() — it removes the old trigger.
// ═══════════════════════════════════════════════════════════════════════

var PL2_QUIET_START = 9, PL2_QUIET_END = 20;   // ET, SMS allowed [9, 20)
var PL2_MAX_PER_RUN = 40;
var PL2_GRACE_DAYS  = 10;   // a touch fires only within this many days after its slot
var PL2_TOUCHES = [
  { key: 'POST_LABEL_1', day: 2,  channel: 'sms' },
  { key: 'POST_LABEL_2', day: 4,  channel: 'email' },
  { key: 'POST_LABEL_3', day: 7,  channel: 'sms' },
  { key: 'POST_LABEL_4', day: 12, channel: 'email' },
];

function _pl2SmsOk() { var h = parseInt(Utilities.formatDate(new Date(), 'America/New_York', 'H'), 10); return h >= PL2_QUIET_START && h < PL2_QUIET_END; }
function _pl2IsUsps(s) {
  var svc = String(s.shipping_service || '').toLowerCase();
  if (/fedex/.test(svc)) return false;
  if (/usps|ground advantage|priority|first class/.test(svc)) return true;
  var t = normalizeShipType(s.shipping_type);
  return t === 'usps' || t === '';   // Sep 14: fedex (incl. legacy 'label') and kits ship FedEx; blank defaults to USPS
}
function _pl2First(name) { var f = String(name || '').trim().split(/\s+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : 'there'; }
function _pl2Days(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / 86400000; }
// Has the inbound label been scanned? Uses the tracking status columns the
// Shippo/EasyPost webhooks and the sweep already write; falls back to "no".
function _pl2InTransit(s) {
  var st = String(s.inbound_status || s.tracking_status || '').toLowerCase();
  return /transit|accepted|picked|in_transit|out_for|delivered|arriv/.test(st);
}

function _pl2Content(key, first, item, s) {
  var usps = _pl2IsUsps(s);
  var carrier = usps ? 'USPS' : 'FedEx';
  var drop = usps ? 'hand it to your mail carrier or drop it at any post office' : 'drop it at any FedEx location';
  var pickup = usps ? ' You can even schedule a free pickup at usps.com/pickup and the carrier takes it from your door.' : '';
  var pickupEmail = usps ? '\n\n<strong>Don\'t want to go to the post office?</strong> Schedule a free pickup at usps.com/pickup and the carrier collects it from your door on the next delivery day.' : '';
  var hasQr = !!String(s.label_qr_url || '').trim();
  var noPrinter = hasQr
    ? '\n\n<strong>No printer?</strong> Bring the QR code from your label email to any post office and the clerk prints it for you, free.'
    : (usps ? '\n\n<strong>No printer?</strong> Reply here and I\'ll send a scannable code to show at the post office.'
            : '\n\n<strong>No printer?</strong> Pull the label up on your phone at any FedEx Office and they\'ll print it for you.');
  switch (key) {
    case 'POST_LABEL_1': return { sms: 'Hi ' + first + ', your prepaid ' + carrier + ' label from Snappy Gold is ready to go — tape it on any box and ' + drop + '. Postage is already covered.' + pickup + ' Questions? Just reply. — David' };
    case 'POST_LABEL_2': return { subject: 'Quick tip for sending in ' + item + ', ' + first,
      body: 'Just checking in — your prepaid ' + carrier + ' label is ready whenever you are. Print it, tape it to any box or padded envelope, and ' + drop + '. About five minutes, start to finish.' + pickupEmail + noPrinter +
        '\n\n<strong>Free shipping, no commitment</strong> — if my offer isn\'t good enough, I send everything back at no charge.\n\nAny questions, reply here or call/text 866-613-0704.' };
    case 'POST_LABEL_3': return { sms: 'Hi ' + first + ' — gold prices are strong right now, so it\'s a good time to send ' + item + ' in. Your prepaid ' + carrier + ' label is still good.' + (usps ? ' Free door pickup at usps.com/pickup.' : '') + ' Want me to resend it? — David @ Snappy Gold' };
    case 'POST_LABEL_4': return { subject: 'Gold\'s running high — still happy to buy ' + item + ', ' + first,
      body: 'Wanted to check in one more time this week.\n\nGold prices have been strong, so if you\'ve been meaning to send ' + item + ' in, now is a good moment. Your prepaid ' + carrier + ' label is still active — tape it to any box and ' + drop + ', postage covered.' + pickupEmail +
        '\n\nNo pressure and no commitment — I send everything back free if my offer isn\'t right for you. If you\'d like the label resent, just reply.\n\nDavid\nSnappy Gold' };
    default: return null;
  }
}

// asData (dry run only): return { would: [...], sms_quiet_hours } instead of the count — used by the CRM Comms tab.
function _pl2Core(dryRun, asData) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues(), h = data[0];
  var col = {}; h.forEach(function (x, i) { col[x] = i; });
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var smsOk = _pl2SmsOk(), sent = 0, would = [], deferredSms = 0;
  for (var r = 1; r < data.length && sent < PL2_MAX_PER_RUN; r++) {
    var s = {}; h.forEach(function (x, i) { s[x] = data[r][i]; });
    if (String(s.stage || '').toLowerCase() !== 'outbound_complete') continue;
    if (String(s.received_at || '').trim()) continue;
    if (_pl2InTransit(s)) continue;
    var days = _pl2Days(s.sent_at);
    if (days === null || days > 90) continue;
    var re = _pl2Days(s.reengage_sent_at);
    if (re !== null && re < 14) continue;                 // just got the re-engagement email — leave them be
    var already = {}; String(s.ship_followups_sent || '').split(',').forEach(function (k) { k = k.trim(); if (k) already[k] = true; });
    var due = null;
    for (var i = 0; i < PL2_TOUCHES.length; i++) { var t = PL2_TOUCHES[i]; if (days >= t.day && !already[t.key]) due = t; }
    if (!due) continue;
    if (days > due.day + PL2_GRACE_DAYS) continue;        // missed its window — no months-late "catch-up" texts
    var cust = custs[s.customer_id]; if (!cust) continue;
    if (due.channel === 'sms' && !cust.phone) continue;
    if (due.channel === 'email' && !cust.email) continue;
    if (isDoNotContact(cust.email) || isDoNotContact(cust.phone)) continue;   // Sep 14: Do Not Contact — skipped and kept out of the preview
    var first = _pl2First(cust.name);
    var item = (typeof itemPhrase === 'function') ? itemPhrase(s) : ('your ' + (s.item || 'items'));
    var content = _pl2Content(due.key, first, item, s);
    if (dryRun) { would.push({ key: due.key, channel: due.channel, carrier: _pl2IsUsps(s) ? 'USPS' : 'FedEx', shipment_id: s.shipment_id, first: first, day: Math.round(days) }); sent++; continue; }
    if (due.channel === 'sms' && !smsOk) { deferredSms++; continue; }
    var ok = false;
    COMMS_KIND = 'postlabel:' + due.key;
    try {
      if (due.channel === 'sms') { var sr = sendSms(cust.phone, cust.name, content.sms); ok = !!(sr && sr.success); }
      else { var er = sendViaPostmark(cust.email, content.subject, buildPlainEmail(first, content.body)); ok = !!(er && er.success); }
    } catch (e) { Logger.log('post-label v2 ' + s.shipment_id + ': ' + e); }
    COMMS_KIND = '';
    if (ok) {
      var cur = String(s.ship_followups_sent || '');
      sheet.getRange(r + 1, col.ship_followups_sent + 1).setValue(cur ? cur + ',' + due.key : due.key);
      sent++; Utilities.sleep(250);
    }
  }
  if (dryRun) { Logger.log('━━━ POST-LABEL V2 PREVIEW — ' + would.length + ' due now (SMS quiet hours ' + (smsOk ? 'off' : 'ON') + ') ━━━'); would.forEach(function (w) { Logger.log('  ' + w.key + ' ' + w.channel + ' (' + w.carrier + ') → ' + w.shipment_id + ' ' + w.first + ' day ' + w.day); }); }
  else Logger.log('sendPostLabelFollowups_v2: sent ' + sent + (deferredSms ? ' · ' + deferredSms + ' SMS deferred to daytime' : ''));
  if (dryRun && asData) return { would: would, sms_quiet_hours: !smsOk };
  return sent;
}
function sendPostLabelFollowups_v2() { return _pl2Core(false); }
function previewPostLabelV2()        { return _pl2Core(true); }

function createPostLabelTriggerV2() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendPostLabelFollowups' || fn === 'sendPostLabelFollowups_v2') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendPostLabelFollowups_v2').timeBased().everyHours(6).create();
  Logger.log('Trigger: sendPostLabelFollowups_v2 every 6 h (old post-label trigger removed). SMS only 9am–8pm ET.');
}
