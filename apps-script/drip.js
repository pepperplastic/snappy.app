// ═══════════════════════════════════════════════════════════════════════
//  drip.gs — pre-registration drip, v3 (Sep 9 2026)
//
//  WHY: the drip trigger (sendFollowUpEmails_v2) has been off since May 4.
//  Root cause of the May 1–4 runaway: v2 built its "already sent" map with
//  y.match(/\|\s*([A-Z_0-9]+)\s*\|/) — no global flag — so it only saw the
//  FIRST stage on each row. Once INCOMPLETE_1 was stamped, INCOMPLETE_2/3 were
//  re-sent on every 10-minute run for the lead's 14-day window (4,618 stamps
//  in four days). v3 fixes that and adds guards so it can never run away again.
//
//  ORDER OF OPERATIONS (all from the editor, this file selected):
//   1. previewDrip()          — what v3 WOULD send right now (no sends)
//   2. drainDripBacklog()     — stamp every lead older than 1h as DRAINED so
//                               the drip only touches registrations from now on
//   3. previewDrip()          — should now be ~0
//   4. createTriggerV3()      — installs the 10-min trigger, removes any v2 one
//
//  Guards in v3: every stage on a row is read; DRAINED rows are skipped; max
//  DRIP_MAX_SENDS per run; a person can receive at most ONE stage per run.
// ═══════════════════════════════════════════════════════════════════════

var DRIP_MAX_SENDS = 25;

// Every stage token stamped on a Y-column string, e.g. "... | INCOMPLETE_1 | msgid || ... | COMPLETE_USPS | msgid"
function _dripStages(y) {
  var out = {}, re = /\|\s*([A-Z_0-9]+)\s*\|/g, m;
  while ((m = re.exec(String(y || ''))) !== null) out[m[1]] = true;
  return out;
}

function _dripCore(dryRun) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
  var data  = sheet.getDataRange().getValues();
  var now   = new Date();
  var sent = 0, skipped = 0, errors = 0, would = [];

  var THRESHOLD_1_MIN = 45, THRESHOLD_2_MIN = 24 * 60, THRESHOLD_3_MIN = 72 * 60, MAX_AGE_MIN = 14 * 24 * 60;

  var leads = buildLeadRecords(data);
  var yRange = sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).getValues();
  var yChanged = false;

  // Stages already sent, per email — reads EVERY token, and honours DRAINED.
  var stagesSent = {};
  for (var i = 1; i < data.length; i++) {
    var em = String(data[i][COL.EMAIL] || '').trim().toLowerCase();
    if (!em) continue;
    var y = String(data[i][COL.AUTO_REPLY] || '');
    if (!y) continue;
    var s = stagesSent[em] = stagesSent[em] || {};
    var st = _dripStages(y);
    Object.keys(st).forEach(function (k) { s[k] = true; if (k.indexOf('COMPLETE_') === 0) s._anyComplete = true; });
    if (y.indexOf('DRAINED') !== -1 || y.indexOf('RECOV:') !== -1) s._drained = true;
  }

  var touchedThisRun = {};
  for (var j = 0; j < leads.length; j++) {
    if (sent >= DRIP_MAX_SENDS) break;
    var lead = leads[j];
    if (!lead.email || lead.email.indexOf('@') === -1) { skipped++; continue; }
    var st2 = stagesSent[lead.email] || {};
    if (st2._drained) { skipped++; continue; }
    if (touchedThisRun[lead.email]) { skipped++; continue; }   // one stage per person per run

    var minutesAgo = (now - new Date(lead.timestamp)) / 60000;
    if (minutesAgo > MAX_AGE_MIN || minutesAgo < THRESHOLD_1_MIN) { skipped++; continue; }

    var isComplete = !!(lead.address && lead.shipping);
    var emailType = null;
    if (isComplete) {
      // Sep 9: no "got your request" email. DW reviews each registration
      // (notifyNewRegistrations below) and the label email IS the confirmation.
      skipped++; continue;
    } else {
      if (minutesAgo >= THRESHOLD_3_MIN && !st2.INCOMPLETE_3) emailType = 'INCOMPLETE_3';
      else if (minutesAgo >= THRESHOLD_2_MIN && !st2.INCOMPLETE_2) emailType = 'INCOMPLETE_2';
      else if (minutesAgo >= THRESHOLD_1_MIN && !st2.INCOMPLETE_1) emailType = 'INCOMPLETE_1';
    }
    if (!emailType) { skipped++; continue; }

    var rawName = (lead.name || '').replace('(anonymous)', '').trim().split(' ')[0] || '';
    var firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : '';

    if (dryRun) { would.push(emailType + ' → ' + lead.email + ' (' + Math.round(minutesAgo / 60) + 'h)'); sent++; touchedThisRun[lead.email] = true; continue; }

    var currentShipment = null;
    try {
      var customer = getCustomerByEmail(lead.email);
      if (customer) {
        var cs = getShipmentsLite(customer.customer_id);
        for (var k = 0; k < cs.length; k++) if (!currentShipment || new Date(cs[k].created_at) > new Date(currentShipment.created_at)) currentShipment = cs[k];
      }
    } catch (e) {}

    var template = getTemplate(emailType, firstName, lead.item, lead.estimate, lead.shipping, currentShipment);
    if (!template) { skipped++; continue; }

    var result = sendViaPostmark(lead.email, template.subject, template.html);
    var tsStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var statusMsg = result.success ? tsStr + ' | ' + emailType + ' | ' + result.messageId
                                   : tsStr + ' | ERROR_' + emailType + ': ' + result.error;
    if (result.success) { sent++; touchedThisRun[lead.email] = true; } else errors++;

    for (var ri = 0; ri < lead.rowIndices.length; ri++) {
      var rowIdx = lead.rowIndices[ri];
      var prev = yRange[rowIdx][0] || '';
      yRange[rowIdx][0] = prev ? (prev + ' || ' + statusMsg) : statusMsg;
    }
    yChanged = true;
    Utilities.sleep(THROTTLE_MS);
  }

  if (yChanged && !dryRun) sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).setValues(yRange);
  if (dryRun) { Logger.log('━━━ DRIP PREVIEW (no sends) — ' + would.length + ' would go out ━━━'); would.forEach(function (w) { Logger.log('  ' + w); }); }
  else Logger.log('sendFollowUpEmails_v3: sent=' + sent + ' skipped=' + skipped + ' errors=' + errors + (sent >= DRIP_MAX_SENDS ? '  (hit per-run cap)' : ''));
  return { sent: sent, skipped: skipped, errors: errors };
}

function sendFollowUpEmails_v3() { return _dripCore(false); }
function previewDrip()          { return _dripCore(true); }

// One-time: stamp every lead row older than 1 hour as DRAINED so the drip
// only ever acts on registrations that happen after re-enable.
function drainDripBacklog() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
  var data  = sheet.getDataRange().getValues();
  var yRange = sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).getValues();
  var cutoff = Date.now() - 60 * 60000;
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') + ' | DRAINED | sep9';
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    var em = String(data[i][COL.EMAIL] || '').trim();
    if (!em || em.indexOf('@') === -1) continue;
    var ts = data[i][COL.TIMESTAMP]; var t = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(t.getTime()) || t.getTime() > cutoff) continue;
    var prev = String(yRange[i][0] || '');
    if (prev.indexOf('DRAINED') !== -1) continue;
    yRange[i][0] = prev ? (prev + ' || ' + stamp) : stamp;
    n++;
  }
  if (n) sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).setValues(yRange);
  Logger.log('drainDripBacklog: stamped ' + n + ' rows as DRAINED. Run previewDrip() — it should now be ~0.');
  return n;
}

function createTriggerV3() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendFollowUpEmails' || fn === 'sendFollowUpEmails_v2' || fn === 'sendFollowUpEmails_v3') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendFollowUpEmails_v3').timeBased().everyMinutes(10).create();
  Logger.log('Trigger created: sendFollowUpEmails_v3 every 10 minutes (v2 triggers removed)');
}


// ═══════════════════════════════════════════════════════════════════════
//  NEW-REGISTRATION ALERT (Sep 9) — SMS + email to DW within 5 minutes of a
//  shipment landing in ready_to_fulfill. Nothing goes to the customer; the
//  label email on Outbound Complete is their confirmation.
//  Run createRegAlertTrigger() once. State: Script Property REG_ALERT_LAST_ISO.
// ═══════════════════════════════════════════════════════════════════════
var REG_ALERT_PHONE = '5617026269';
var REG_ALERT_EMAIL = 'davidisaacweiss@yahoo.com';
var REG_ALERT_CRM   = 'https://snappy.gold/crm';

function notifyNewRegistrations() {
  var props = PropertiesService.getScriptProperties();
  var lastIso = props.getProperty('REG_ALERT_LAST_ISO') || new Date(Date.now() - 15 * 60000).toISOString();
  var last = new Date(lastIso);
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var fresh = ships.filter(function (s) {
    var c = s.created_at ? new Date(s.created_at) : null;
    return c && !isNaN(c.getTime()) && c > last && String(s.stage || '').toLowerCase() === 'ready_to_fulfill';
  }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  var newest = last;
  fresh.forEach(function (s) {
    var cu = custs[s.customer_id] || {};
    var name = cu.name || '(no name)';
    var item = String(s.item || '').trim() || '(no item text)';
    var est  = String(s.estimate || '').trim();
    var type = String(s.shipping_type || '').trim() || 'label';
    var sms  = 'New reg: ' + name + ' — ' + item.slice(0, 60) + (est ? ' (' + est + ')' : '') + ' · ' + type +
               (s.customer_message ? ' · "' + String(s.customer_message).slice(0, 60) + '"' : '') + ' · ' + REG_ALERT_CRM + '?shp=' + s.shipment_id;
    try { sendSms(REG_ALERT_PHONE, 'David', sms); } catch (e) { Logger.log('reg alert sms: ' + e); }
    try {
      var body = 'Name: ' + name + '\nEmail: ' + (cu.email || '') + '\nPhone: ' + (cu.phone || '') +
        '\nItem: ' + item + '\nEstimate: ' + (est || '—') + '\nShipping: ' + type + '\nAddress: ' + (cu.address || '') +
        (s.customer_message ? '\nMessage: ' + s.customer_message : '') +
        (s.ai_rationale ? '\nAI notes: ' + s.ai_rationale : '') +
        '\n\n' + s.shipment_id + ' → ' + REG_ALERT_CRM + '?shp=' + s.shipment_id;
      MailApp.sendEmail(REG_ALERT_EMAIL, '📥 New registration: ' + name + ' — ' + item.slice(0, 50), body);
    } catch (e) { Logger.log('reg alert email: ' + e); }
    var c = new Date(s.created_at); if (c > newest) newest = c;
  });
  props.setProperty('REG_ALERT_LAST_ISO', newest.toISOString());
  Logger.log('notifyNewRegistrations: ' + fresh.length + ' new since ' + lastIso);
  return fresh.length;
}

function createRegAlertTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'notifyNewRegistrations') ScriptApp.deleteTrigger(t); });
  PropertiesService.getScriptProperties().setProperty('REG_ALERT_LAST_ISO', new Date().toISOString());  // start from now, no backlog
  ScriptApp.newTrigger('notifyNewRegistrations').timeBased().everyMinutes(5).create();
  Logger.log('Trigger created: notifyNewRegistrations every 5 min (starting from now)');
}
