// ═══════════════════════════════════════════════════════════════════════
//  RE-ENGAGEMENT CAMPAIGN — label sent, never shipped     (Aug 17, 2026)
//
//  795 people have a prepaid label and never mailed anything. Acquisition is
//  already paid for, so this is the cheapest revenue available.
//
//  SETUP: nothing new needed if you already have a broadcast stream.
//  A Postmark SERVER token covers every stream on that server — the
//  MessageStream field is what routes the message. So POSTMARK_API_TOKEN
//  works; it just has to be pointed at the broadcast stream, which is what
//  REENGAGE_STREAM below does.
//
//  Optional Script Properties:
//      POSTMARK_BROADCAST_TOKEN  only if the broadcast stream lives on a
//                                DIFFERENT Postmark server
//      POSTMARK_BROADCAST_STREAM the stream ID, if it isn't 'broadcast'
//                                (Postmark → Message Streams → click the
//                                 stream → the ID is shown under its name)
//
//  It MUST go out on the broadcast stream. 795 marketing emails on the
//  transactional stream risks the account that also delivers shipping labels
//  and payment confirmations.
//
//  ALSO: add a 'reengage_sent_at' column to the Shipments tab first —
//      append 'reengage_sent_at' to COLS.SHIPMENTS, then run ensureAllColumns()
//  That's what stops anyone being emailed twice.
//
//  ORDER OF OPERATIONS:
//      1. reengageDryRun()      — see who qualifies, sends nothing
//      2. reengageSend(25)      — a small first batch, check replies land
//      3. reengageSend(100)     — then daily until done
//
//  WHY BATCHED: some of these addresses are six months old and will bounce.
//  A single 795 blast to a partly-stale list damages the domain reputation
//  that your LABEL emails depend on. Freshest first, so the early batches are
//  the cleanest and you learn the reply rate before committing the rest.
//
//  WHY NO ESTIMATE IN THE EMAIL: the original AI estimate was, on median,
//  ~2.6x what we actually pay. Re-quoting it walks the customer straight into
//  the disappointment already driving a 42% return rate. Reactivate them with
//  no number in their head rather than the wrong one.
// ═══════════════════════════════════════════════════════════════════════

var REENGAGE_FROM      = 'David at Snappy Gold <hello@snappy.gold>';
var REENGAGE_REPLY_TO  = 'hello@snappy.gold';
var REENGAGE_PHYSICAL  = 'DW5 LLC · 1686 S Federal Hwy #318 · Delray Beach, FL 33483';
var REENGAGE_TAG       = 'reengage-label-holders';

// Don't email someone whose label is still in flight. The dry run surfaced
// six labels 0 DAYS old — including one generated an hour earlier — and
// "we sent you a label and it never made it to us" is simply false at that
// point. USPS transit alone is 2-5 days, and people reasonably take a week or
// two to get to the post office. 14 days is the earliest the message is true.
var REENGAGE_MIN_DAYS = 14;

// Falls back to the normal server token — same server, different stream.
function _reengageToken() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty('POSTMARK_BROADCAST_TOKEN') ||
         p.getProperty('POSTMARK_API_TOKEN') || '';
}

function _reengageStream() {
  return PropertiesService.getScriptProperties()
           .getProperty('POSTMARK_BROADCAST_STREAM') || 'broadcast';
}

function _firstName(full) {
  var n = String(full || '').trim().split(/\s+/)[0] || '';
  if (!n) return 'there';
  // Titlecase — a lot of these arrive ALL CAPS from the form
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

// Returns [{email, name, shipmentId, rowNum, sentDays}], newest label first,
// one entry per PERSON (845 shipments across 795 people — nobody gets two).
function _reengageCandidates() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var cData = ss.getSheetByName(TAB.CUSTOMERS).getDataRange().getValues();
  var cH = cData[0];
  var ci = cH.indexOf('customer_id'), ce = cH.indexOf('email'), cn = cH.indexOf('name');
  var cust = {};
  for (var i = 1; i < cData.length; i++) {
    if (cData[i][ci]) cust[cData[i][ci]] = {
      email: String(cData[i][ce] || '').toLowerCase().trim(),
      name:  String(cData[i][cn] || '').trim()
    };
  }

  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var sData = sheet.getDataRange().getValues();
  var sH = sData[0], ix = {};
  ['shipment_id','customer_id','stage','sent_at','created_at','received_at','reengage_sent_at']
    .forEach(function (k) { ix[k] = sH.indexOf(k); });

  if (ix.reengage_sent_at < 0) {
    throw new Error("Shipments tab has no 'reengage_sent_at' column. " +
      "Append it to COLS.SHIPMENTS and run ensureAllColumns() first.");
  }

  var now = new Date(), seen = {}, out = [];
  for (var r = 1; r < sData.length; r++) {
    if (String(sData[r][ix.stage] || '').toLowerCase().trim() !== 'outbound_complete') continue;
    if (String(sData[r][ix.received_at] || '').trim()) continue;        // it arrived
    if (String(sData[r][ix.reengage_sent_at] || '').trim()) continue;    // already emailed

    var c = cust[sData[r][ix.customer_id]];
    if (!c || !c.email || c.email.indexOf('@') < 0) continue;
    var to = isPlausibleEmail(c.email);                                  // Sep 14: typo domains fixed, junk addresses skipped
    if (!to) continue;
    if (seen[to]) continue;                                              // one per person
    seen[to] = true;

    var sentRaw = sData[r][ix.sent_at] || sData[r][ix.created_at];
    var sent = sentRaw instanceof Date ? sentRaw : new Date(sentRaw);
    var days = isNaN(sent.getTime()) ? 9999 : Math.round((now - sent) / 86400000);
    if (days < REENGAGE_MIN_DAYS) { delete seen[to]; continue; }   // still in flight

    out.push({ email: to, raw: c.email, name: c.name, shipmentId: sData[r][ix.shipment_id],
               rowNum: r + 1, col: ix.reengage_sent_at + 1, days: days });
  }

  out.sort(function (a, b) { return a.days - b.days; });   // freshest first
  return out;
}

function _reengageHtml(firstName) {
  return '' +
  '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2A2015;max-width:520px">' +
  '<p>Hi ' + firstName + ',</p>' +
  '<p>A while back you asked us about selling your jewelry, and we sent you a prepaid shipping label. ' +
  'It looks like it never made it to us.</p>' +
  '<p>No problem at all &mdash; that happens more than you\'d think. Life gets busy, or the box sits by ' +
  'the door for a week and then it\'s a month.</p>' +
  '<p><strong>If you\'d still like to sell it, just reply to this email and I\'ll send you a fresh prepaid ' +
  'label.</strong> Shipping is free and fully insured both ways.</p>' +
  '<p>A few things worth knowing:</p>' +
  '<ul style="padding-left:20px">' +
  '<li>We inspect everything by hand and make you a firm offer before any money moves</li>' +
  '<li>If you don\'t like the offer, we mail your item back free &mdash; no obligation at all</li>' +
  '<li>Payment usually goes out within 24 hours of you accepting</li>' +
  '</ul>' +
  '<p>And if you\'ve changed your mind or already sold it elsewhere, no worries &mdash; just ignore this ' +
  'and I won\'t follow up again.</p>' +
  '<p style="margin-top:24px">&mdash; David<br>' +
  '<span style="font-size:14px;color:#6B6259">Snappy Gold &middot; Licensed Florida precious metals dealer &middot; BBB A+ rated</span></p>' +
  '<hr style="border:none;border-top:1px solid #E4DFD7;margin:28px 0 12px">' +
  '<p style="font-size:12px;color:#8A8078;line-height:1.5">' +
  REENGAGE_PHYSICAL + '<br>' +
  'Don\'t want these? <a href="{{{ pm:unsubscribe }}}" style="color:#8A8078">Unsubscribe</a> ' +
  '(one click) or reply STOP and we\'ll take you off the list.' +
  '</p></div>';
}

function _reengageText(firstName) {
  return 'Hi ' + firstName + ',\n\n' +
  'A while back you asked us about selling your jewelry, and we sent you a prepaid shipping label. ' +
  'It looks like it never made it to us.\n\n' +
  'No problem at all - that happens more than you\'d think. Life gets busy, or the box sits by the door ' +
  'for a week and then it\'s a month.\n\n' +
  'If you\'d still like to sell it, just reply to this email and I\'ll send you a fresh prepaid label. ' +
  'Shipping is free and fully insured both ways.\n\n' +
  'A few things worth knowing:\n' +
  '  - We inspect everything by hand and make you a firm offer before any money moves\n' +
  '  - If you don\'t like the offer, we mail your item back free - no obligation at all\n' +
  '  - Payment usually goes out within 24 hours of you accepting\n\n' +
  'And if you\'ve changed your mind or already sold it elsewhere, no worries - just ignore this and ' +
  'I won\'t follow up again.\n\n' +
  '-- David\nSnappy Gold - Licensed Florida precious metals dealer - BBB A+ rated\n\n' +
  '---\n' + REENGAGE_PHYSICAL + '\n' +
  'Unsubscribe: reply to this email with "Unsubscribe" in the subject.\n';
}

// ── Preview. Sends nothing. ──
function reengageDryRun() {
  var list = _reengageCandidates();
  var b = { '0-30d': 0, '31-90d': 0, '91-180d': 0, '180d+': 0 };
  list.forEach(function (p) {
    if (p.days <= 30) b['0-30d']++;
    else if (p.days <= 90) b['31-90d']++;
    else if (p.days <= 180) b['91-180d']++;
    else b['180d+']++;
  });
  Logger.log('═══ RE-ENGAGE DRY RUN ═══');
  Logger.log('token found: ' + !!_reengageToken() + '   stream: ' + _reengageStream());
  Logger.log('people who would receive this: ' + list.length +
             '   (labels under ' + REENGAGE_MIN_DAYS + ' days old are excluded — still in transit)');
  Object.keys(b).forEach(function (k) { Logger.log('  ' + k + ': ' + b[k]); });
  Logger.log('');
  Logger.log('first 10 (freshest label first):');
  list.slice(0, 10).forEach(function (p) {
    Logger.log('  ' + p.email.replace(/(.{2}).*(@.*)/, '$1***$2') +
               '  ' + _firstName(p.name) + '  label ' + p.days + 'd old  ' + p.shipmentId);
  });
  Logger.log('');
  Logger.log('nothing sent. reengageSend(25) to send a first batch.');
}

// ── Send. Freshest labels first. ──
function reengageSend(limit) {
  if (awayHoldsNudges()) { Logger.log('AWAY WINDOW — re-engagement held (nothing sent)'); return; }
  var token = _reengageToken();
  if (!token) { Logger.log('No Postmark token found — stopping.'); return; }
  Logger.log('sending on stream: ' + _reengageStream());
  limit = limit || 25;

  var list = _reengageCandidates().slice(0, limit);
  if (!list.length) { Logger.log('nobody left to email.'); return; }

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.SHIPMENTS);
  var sent = 0, failed = [];

  list.forEach(function (p) {
    // Sep 14: Do-Not-Contact guard (dnc.gs)
    if (typeof isDoNotContact === 'function' && (isDoNotContact(p.email) || isDoNotContact(p.raw))) { Logger.log('  ⛔ DNC: ' + p.email); return; }
    var fn = _firstName(p.name);
    var payload = {
      From: REENGAGE_FROM,
      To: p.email,
      ReplyTo: REENGAGE_REPLY_TO,
      Subject: 'Your prepaid label is still waiting',
      HtmlBody: _reengageHtml(fn),
      TextBody: _reengageText(fn),
      MessageStream: _reengageStream(),
      Tag: REENGAGE_TAG
    };
    try {
      var res = UrlFetchApp.fetch('https://api.postmarkapp.com/email', {
        method: 'post', contentType: 'application/json',
        headers: { 'X-Postmark-Server-Token': token, 'Accept': 'application/json' },
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code === 200) {
        // Stamp immediately so a mid-run timeout can't double-send on the retry.
        sheet.getRange(p.rowNum, p.col).setValue(new Date().toISOString());
        sent++;
        COMMS_KIND = 'reengage'; logAutoSend(p.email, 'email', payload.Subject); COMMS_KIND = '';
      } else {
        failed.push(p.email + ' HTTP ' + code + ' ' + res.getContentText().slice(0, 120));
      }
    } catch (e) {
      failed.push(p.email + ' ' + e);
    }
    Utilities.sleep(250);   // gentle on Postmark and on the receiving domains
  });

  Logger.log('sent ' + sent + ' of ' + list.length);
  if (failed.length) {
    Logger.log('failures (' + failed.length + '):');
    failed.slice(0, 15).forEach(function (f) { Logger.log('  ' + f); });
  }
  var remaining = _reengageCandidates().length;
  Logger.log('remaining in the segment: ' + remaining);
}
function reengageTestToMe() {
  var t = _reengageToken();
  var res = UrlFetchApp.fetch('https://api.postmarkapp.com/email', {
    method:'post', contentType:'application/json',
    headers:{'X-Postmark-Server-Token':t,'Accept':'application/json'},
    payload: JSON.stringify({
      From: REENGAGE_FROM, To: 'davidisaacweiss@yahoo.com', ReplyTo: REENGAGE_REPLY_TO,
      Subject: 'Your prepaid label is still waiting',
      HtmlBody: _reengageHtml('David'), TextBody: _reengageText('David'),
      MessageStream: _reengageStream(), Tag: 'reengage-test'
    }), muteHttpExceptions:true });
  Logger.log('HTTP ' + res.getResponseCode() + ' — ' + res.getContentText().slice(0,200));
}
// Safe wrappers for the function dropdown, which can't pass arguments.
function reengageSend25()  { reengageSend(25); }
function reengageSend100() { reengageSend(100); }
