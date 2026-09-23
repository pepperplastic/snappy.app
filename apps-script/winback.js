// ═══════════════════════════════════════════════════════════════════════
//  winback.gs — win-back campaigns + one-click relabel        (Sep 23 2026)
//
//  NOTHING IN HERE SENDS ON A TRIGGER. Every campaign has a dry run and a
//  send function you run by hand from the editor.
//
//    winbackBaseline()                    read-only report on the Aug/Sep sends
//    winbackAudit()                       read-only: the reengage stamp gap + A's funnel
//    winbackADryRun() · winbackASend250() · winbackASend100() (pilot)
//    winbackASmsDryRun() · winbackASmsSend() · winbackASmsSend100() (pilot)
//    winbackBDryRun() · winbackBSend()
//    winbackCDryRun() · winbackCSend250() · winbackCSend100() (pilot)
//
//  Dry runs never write: they print a placeholder link instead of minting a
//  RelabelTokens row. Every send also holds while the away window is open.
//
//  Shared: every email carries a one-click relabel link — a public,
//  token-gated route (same shape as the /verify self-serve token: 30-day TTL,
//  one shipment per token, no CRM key). See the RELABEL section below.
// ═══════════════════════════════════════════════════════════════════════

var WB_TOKENS_TAB      = 'RelabelTokens';
var WB_TOKEN_HEADERS   = ['token', 'shipment_id', 'customer_id', 'campaign', 'created_at', 'expires_at', 'used_at', 'used_ip', 'hits', 'last_hit_at'];
var WB_TOKEN_TTL_DAYS  = 30;
var WB_TOKEN_MAX_HITS  = 30;              // page loads per token before it stops answering
var WB_RELABEL_COOLDOWN_H = 24;           // one new label per shipment per day, whatever the token says
var WB_BASE_URL        = 'https://snappy.gold/relabel?token=';
var WB_PURCHASED_STAGES = ['complete', 'pending_payment', 'pending_leadsonline'];

// Baseline windows (ET dates, inclusive).
var WB_BASE_REENGAGE_FROM = '2026-08-17', WB_BASE_REENGAGE_TO = '2026-08-17';
var WB_BASE_RECOVERY_FROM = '2026-09-09', WB_BASE_RECOVERY_TO = '2026-09-15';

function _wbDate(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? v : new Date(String(v).indexOf(' ') > 0 && String(v).indexOf('T') < 0 ? String(v).replace(' ', 'T') : v);
  return isNaN(d.getTime()) ? null : d;
}
function _wbDay(d) { return d ? Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') : ''; }
function _wbEmail(v) { return String(v || '').toLowerCase().trim(); }

// Sep 23: the Mar 24–25 2026 rows are migration stamps, not real events. Any
// date before this cutoff is treated as unknown wherever the date matters.
var WB_MIGRATION_CUTOFF = '2026-04-01';
function _wbReliable(d) { return (d && _wbDay(d) >= WB_MIGRATION_CUTOFF) ? d : null; }

// Sep 23: dry runs must not mint RelabelTokens rows. While this is on, _wbLink
// returns a placeholder instead of issuing a token.
var WB_PREVIEW = false;

// '' when we have no usable name, so greetings and subjects can fall back cleanly.
function _wbFirst(name) {
  var n = String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
  if (!n || /^[^a-z]+$/i.test(n)) return '';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}
function _wbHi(first) { return 'Hi ' + (first || 'there') + ',\n\n'; }
function _wbComma(first) { return first ? ', ' + first : ''; }
// "We're back" opener for the first sends after the away window.
function _wbBack() { var l = (typeof awayBackLine === 'function') ? awayBackLine() : ''; return l ? l + '\n\n' : ''; }

// ═══════════════════════════════════════════════════════════════════════
//  STEP 0 — BASELINE (read-only, logs only)
//
//  INFERENCE RULE for "new label issued" (there was no relabel stamp before
//  today, so this is inferred, not recorded): for each person in the cohort,
//  a new label counts when ANY shipment of theirs has sent_at AFTER the
//  campaign send, or a shipment was CREATED after the campaign send. Arrived
//  and purchased use the same "after the send" test on received_at and on the
//  purchased stages. Replies are NOT measurable — inbound email is not stored
//  anywhere (CS Threads is phone-only), so that column stays blank for you to
//  fill in from Zoho.
// ═══════════════════════════════════════════════════════════════════════
function winbackBaseline() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = getCustomers();
  var byId = {}, emailOf = {}, custByEmail = {};
  custs.forEach(function (c) {
    if (!c.customer_id) return;
    byId[c.customer_id] = c; emailOf[c.customer_id] = _wbEmail(c.email);
    if (_wbEmail(c.email)) custByEmail[_wbEmail(c.email)] = c;
  });
  var shipsByCust = {};
  ships.forEach(function (s) { if (s.customer_id) (shipsByCust[s.customer_id] = shipsByCust[s.customer_id] || []).push(s); });

  // ── cohort 1: re-engagement (reengage_sent_at on the shipment) ──
  var reCohort = [];
  ships.forEach(function (s) {
    var d = _wbDate(s.reengage_sent_at);
    if (!d) return;
    var day = _wbDay(d);
    if (day < WB_BASE_REENGAGE_FROM || day > WB_BASE_REENGAGE_TO) return;
    var c = byId[s.customer_id] || {};
    reCohort.push({ who: c.name || s.customer_id, email: emailOf[s.customer_id] || '', customer_id: s.customer_id, sentAt: d, shipment_id: s.shipment_id });
  });

  // ── cohort 2: recovery (RECOV:yyyy-mm-dd in Lead Intake) ──
  var recCohort = [], seenRec = {};
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  for (var r = 1; r < lead.length; r++) {
    var em = _wbEmail(lead[r][COL.EMAIL]);
    if (!em || seenRec[em]) continue;
    var y = String(lead[r][COL.AUTO_REPLY] || '');
    var m = y.match(/RECOV:(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    if (m[1] < WB_BASE_RECOVERY_FROM || m[1] > WB_BASE_RECOVERY_TO) continue;
    seenRec[em] = true;
    var c2 = custByEmail[em] || {};
    recCohort.push({ who: c2.name || em, email: em, customer_id: c2.customer_id || '', sentAt: _wbDate(m[1] + 'T12:00:00'), shipment_id: '' });
  }

  function measure(cohort) {
    var out = { sent: cohort.length, relabel: 0, arrived: 0, purchased: 0, rows: [] };
    cohort.forEach(function (p) {
      var mine = shipsByCust[p.customer_id] || [];
      var t = p.sentAt.getTime();
      var newLabel = mine.some(function (s) {
        var sent = _wbDate(s.sent_at), made = _wbDate(s.created_at);
        return (sent && sent.getTime() > t) || (made && made.getTime() > t);
      });
      var arrived = mine.some(function (s) { var rd = _wbDate(s.received_at); return rd && rd.getTime() > t; });
      var bought = mine.some(function (s) {
        if (WB_PURCHASED_STAGES.indexOf(String(s.stage || '').toLowerCase()) === -1 && !(parseFloat(s.purchase_price) > 0)) return false;
        var when = _wbDate(s.purchased_at) || _wbDate(s.paid_at) || _wbDate(s.received_at);
        return when && when.getTime() > t;
      });
      if (newLabel) out.relabel++;
      if (arrived) out.arrived++;
      if (bought) out.purchased++;
      out.rows.push({ who: p.who, email: p.email, sent: _wbDay(p.sentAt), newLabel: newLabel, arrived: arrived, bought: bought });
    });
    return out;
  }

  var A = measure(reCohort), B = measure(recCohort);
  var pct = function (n, d) { return d ? Math.round(n / d * 100) + '%' : '—'; };

  Logger.log('═══ WIN-BACK BASELINE ═══');
  Logger.log('');
  Logger.log('INFERENCE RULE — "new label issued" is NOT recorded anywhere, so it is inferred:');
  Logger.log('  a person counts when any shipment of theirs has sent_at after the campaign send,');
  Logger.log('  or a shipment was created after it. "Arrived" = received_at after the send.');
  Logger.log('  "Purchased" = a purchased-stage shipment (or purchase_price > 0) dated after the send.');
  Logger.log('  REPLIED is not measurable — inbound email is not stored (CS Threads is phone only).');
  Logger.log('');
  Logger.log(_wbPad('CAMPAIGN', 34) + _wbPadL('SENT', 6) + _wbPadL('REPLIED', 9) + _wbPadL('NEW LABEL', 11) + _wbPadL('ARRIVED', 9) + _wbPadL('PURCHASED', 11));
  Logger.log(_wbPad('Re-engagement (' + WB_BASE_REENGAGE_FROM + ')', 34) + _wbPadL(A.sent, 6) + _wbPadL('(Zoho)', 9) +
             _wbPadL(A.relabel + ' ' + pct(A.relabel, A.sent), 11) + _wbPadL(A.arrived + ' ' + pct(A.arrived, A.sent), 9) + _wbPadL(A.purchased + ' ' + pct(A.purchased, A.sent), 11));
  Logger.log(_wbPad('Recovery (' + WB_BASE_RECOVERY_FROM + '..' + WB_BASE_RECOVERY_TO + ')', 34) + _wbPadL(B.sent, 6) + _wbPadL('(Zoho)', 9) +
             _wbPadL(B.relabel + ' ' + pct(B.relabel, B.sent), 11) + _wbPadL(B.arrived + ' ' + pct(B.arrived, B.sent), 9) + _wbPadL(B.purchased + ' ' + pct(B.purchased, B.sent), 11));
  Logger.log('');
  [['RE-ENGAGEMENT', A], ['RECOVERY', B]].forEach(function (pair) {
    Logger.log('── ' + pair[0] + ' — first 10 of ' + pair[1].sent + ' ──');
    pair[1].rows.slice(0, 10).forEach(function (x) {
      Logger.log('  ' + _wbPad(String(x.who).slice(0, 22), 24) + _wbPad(x.email.replace(/(.{2}).*(@.*)/, '$1***$2').slice(0, 24), 26) + 'sent ' + x.sent +
                 '  label:' + (x.newLabel ? 'Y' : '·') + '  arrived:' + (x.arrived ? 'Y' : '·') + '  bought:' + (x.bought ? 'Y' : '·'));
    });
    Logger.log('');
  });
  return { reengage: { sent: A.sent, relabel: A.relabel, arrived: A.arrived, purchased: A.purchased },
           recovery: { sent: B.sent, relabel: B.relabel, arrived: B.arrived, purchased: B.purchased } };
}

// ═══════════════════════════════════════════════════════════════════════
//  AUDIT (read-only) — why reengage_sent_at covers fewer people than Postmark
//  says went out, and where Campaign A's filters drop people.
// ═══════════════════════════════════════════════════════════════════════
function winbackAudit(fromDay, toDay) {
  fromDay = fromDay || '2026-08-01';
  toDay = toDay || '2026-09-30';
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });

  // ── 1. re-engagement: Postmark vs stamps ──
  var stamped = 0, people = {}, byDay = {};
  ships.forEach(function (s) {
    var d = _wbDate(s.reengage_sent_at);
    if (!d) return;
    var day = _wbDay(d);
    if (day < fromDay || day > toDay) return;
    stamped++; byDay[day] = (byDay[day] || 0) + 1;
    var c = custs[s.customer_id];
    people[_wbEmail(c && c.email) || s.customer_id] = true;
  });
  var pm = null;
  try {
    var token = _reengageToken();
    if (token) {
      var res = UrlFetchApp.fetch('https://api.postmarkapp.com/stats/outbound?fromdate=' + fromDay + '&todate=' + toDay +
        '&messagestream=' + encodeURIComponent(_reengageStream()) + '&tag=' + encodeURIComponent(REENGAGE_TAG),
        { headers: { 'X-Postmark-Server-Token': token, 'Accept': 'application/json' }, muteHttpExceptions: true });
      if (res.getResponseCode() === 200) pm = JSON.parse(res.getContentText());
    }
  } catch (e) { Logger.log('Postmark stats: ' + e); }

  // People holding more than one unshipped label — _reengageCandidates stamps ONE per person.
  var unshippedByPerson = {};
  ships.forEach(function (s) {
    if (String(s.stage || '').toLowerCase() !== 'outbound_complete') return;
    if (String(s.received_at || '').trim()) return;
    var c = custs[s.customer_id];
    var key = _wbEmail(c && c.email) || s.customer_id;
    unshippedByPerson[key] = (unshippedByPerson[key] || 0) + 1;
  });
  var multi = Object.keys(unshippedByPerson).filter(function (k) { return unshippedByPerson[k] > 1; }).length;

  Logger.log('═══ WIN-BACK AUDIT ' + fromDay + ' .. ' + toDay + ' ═══');
  Logger.log('');
  Logger.log('RE-ENGAGEMENT (tag ' + REENGAGE_TAG + ', stream ' + _reengageStream() + ')');
  Logger.log('  Postmark says sent : ' + (pm ? pm.Sent : '(could not read)') + (pm ? '   bounced ' + (pm.Bounced || 0) : ''));
  Logger.log('  reengage_sent_at   : ' + stamped + ' shipments · ' + Object.keys(people).length + ' people');
  if (pm && pm.Sent) Logger.log('  GAP                : ' + (pm.Sent - stamped) + ' sends with no stamp');
  Logger.log('  people holding >1 unshipped label: ' + multi + ' (each gets one stamp, so stamps under-count people with several)');
  Logger.log('  other things that widen the gap: a run that hit the 6-minute limit mid-way (Postmark counted, sheet not stamped),');
  Logger.log('  reengageTestToMe sends, and any send made before the reengage_sent_at column existed.');
  Logger.log('  stamps by day:');
  Object.keys(byDay).sort().forEach(function (d) { Logger.log('    ' + d + '  ' + byDay[d]); });
  Logger.log('');

  // ── 2. Campaign A funnel ──
  var touched = _wbRecentlyTouched(WB_A_QUIET_DAYS), now = Date.now();
  var f = {};
  ships.forEach(function (s) {
    var b = _wbABucket(s, custs, touched, now);
    if (b === 'not_outbound' || b === 'already_arrived') return;
    f[b] = (f[b] || 0) + 1;
  });
  Logger.log('CAMPAIGN A FUNNEL (label sent, never arrived)');
  Object.keys(f).sort().forEach(function (k) { Logger.log('  ' + _wbPad(k, 22) + _wbPadL(f[k], 6)); });
  Logger.log('  → after one-per-person de-dupe: ' + _wbSegmentA().length + ' people');
  Logger.log('');
  Logger.log('"no_usable_date" = only a pre-' + WB_MIGRATION_CUTOFF + ' (migration) date, so label age is unknown — these are held back on purpose.');
  return { reengage: { postmark: pm ? pm.Sent : null, stamped: stamped, people: Object.keys(people).length, multi_label_people: multi }, campaign_a: f };
}

// Where did one cohort land in Campaign A's funnel? Defaults to the shipments
// stamped reengage_sent_at on a given day:  winbackAuditCohort('2026-09-14')
// Any stamp column works:                   winbackAuditCohort('2026-09-14', 'winback_a_sent_at')
function winbackAuditCohort(day, field) {
  field = field || 'reengage_sent_at';
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var touched = _wbRecentlyTouched(WB_A_QUIET_DAYS), now = Date.now();

  var cohort = ships.filter(function (s) { var d = _wbDate(s[field]); return d && (!day || _wbDay(d) === day); });
  var buckets = {}, rows = [];
  cohort.forEach(function (s) {
    var b = _wbABucket(s, custs, touched, now);
    buckets[b] = (buckets[b] || 0) + 1;
    var c = custs[s.customer_id] || {};
    rows.push({ id: s.shipment_id, who: String(c.name || s.customer_id).slice(0, 20), bucket: b,
                why: (b === 'touched_recently') ? _wbTouchReason(s, custs, touched) : '' });
  });

  Logger.log('═══ COHORT · ' + field + (day ? ' = ' + day : ' (any date)') + ' — ' + cohort.length + ' shipments ═══');
  Logger.log('  quiet window: ' + WB_A_QUIET_DAYS + ' days   ·   today: ' + _wbDay(new Date()));
  Object.keys(buckets).sort(function (a, b) { return buckets[b] - buckets[a]; }).forEach(function (b) {
    Logger.log('  ' + _wbPad(b, 22) + _wbPadL(buckets[b], 6) + (b === 'eligible' ? '   ← Campaign A WOULD email these' : ''));
  });
  Logger.log('');
  Logger.log('  first 15:');
  rows.slice(0, 15).forEach(function (r) { Logger.log('    ' + _wbPad(r.id, 10) + _wbPad(r.who, 22) + _wbPad(r.bucket, 20) + r.why); });
  if (buckets.eligible) {
    Logger.log('');
    Logger.log('  ⚠ ' + buckets.eligible + ' of this cohort would still be emailed. If that is unexpected, their stamp is');
    Logger.log('    older than the ' + WB_A_QUIET_DAYS + '-day quiet window, or the stamp column is empty on those rows.');
  }
  return { cohort: cohort.length, buckets: buckets };
}

// ═══════════════════════════════════════════════════════════════════════
//  LIVE TEST LINK (editor-run). Prints a working /relabel URL for one
//  customer. The token is REAL: clicking through generates and emails an
//  actual label (Shippo, billed on scan). Uses campaign 'manual' so it does
//  not consume or collide with the token a win-back send would mint, and so
//  the ref= tag doesn't land in the campaign's attribution.
//
//  Editor: select relabelLinkForCustomer and Run (edit the address inside),
//  or call relabelLinkFor('someone@example.com') from another function.
// ═══════════════════════════════════════════════════════════════════════
function relabelLinkForCustomer() {
  var EMAIL = 'senditherepleasethanks@gmail.com';   // ← edit me
  return relabelLinkFor(EMAIL);
}

function relabelLinkFor(email) {
  var want = _wbEmail(email);
  if (!want) { Logger.log('Pass an email address.'); return null; }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var cust = getCustomers().filter(function (c) { return _wbEmail(c.email) === want; });
  if (!cust.length) { Logger.log('No customer with email ' + want); return null; }
  if (cust.length > 1) Logger.log('NOTE: ' + cust.length + ' customer rows share this email — using ' + cust[0].customer_id);
  var c = cust[0];

  var mine = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function (s) { return s.customer_id === c.customer_id; });
  var open = mine.filter(function (s) { return String(s.stage || '').toLowerCase() === 'outbound_complete'; })
                 .sort(function (a, b) {
                   var ad = _wbDate(a.sent_at) || _wbDate(a.created_at), bd = _wbDate(b.sent_at) || _wbDate(b.created_at);
                   return (bd ? bd.getTime() : 0) - (ad ? ad.getTime() : 0);
                 });
  Logger.log('═══ RELABEL LINK — ' + (c.name || c.customer_id) + ' <' + c.email + '> ═══');
  Logger.log('  shipments on file: ' + mine.map(function (s) { return s.shipment_id + ' (' + s.stage + ')'; }).join(', ') || '(none)');
  if (!open.length) { Logger.log('  ✗ nothing in outbound_complete — no relabel link to give.'); return null; }
  if (open.length > 1) Logger.log('  NOTE: ' + open.length + ' in outbound_complete — using the most recently sent.');

  var s = open[0];
  WB_PREVIEW = false;                       // this one is real
  var url = _wbLink(s.shipment_id, c.customer_id, 'manual');
  var type = normalizeShipType(s.shipping_type);
  Logger.log('');
  Logger.log('  ' + url);
  Logger.log('');
  Logger.log('  shipment : ' + s.shipment_id + ' · ' + (s.item || '(no item)') + ' · ' + (type || 'no type'));
  Logger.log('  sent     : ' + (_wbDay(_wbDate(s.sent_at)) || '(no sent_at)') +
             '   ·   relabel_requested_at: ' + (String(s.relabel_requested_at || '').trim() || 'none'));
  Logger.log('  address  : ' + (String(c.address || '').trim() ? 'on file → the page shows the one-click button' : 'MISSING → the page shows the address form first'));
  Logger.log('  token TTL: ' + WB_TOKEN_TTL_DAYS + ' days · ' + WB_TOKEN_MAX_HITS + ' page loads · one label per shipment per ' + WB_RELABEL_COOLDOWN_H + 'h');
  if (type === 'kit') Logger.log('  NOTE: this is a KIT — the page offers a new kit and texts you; it does not buy a label.');
  Logger.log('');
  Logger.log('  ⚠ This is a live customer link. Clicking the button emails them a real label.');
  return url;
}

// ═══════════════════════════════════════════════════════════════════════
//  SHARED — ONE-CLICK RELABEL (public, token-gated)
//
//  Issued per shipment, 30-day TTL, no CRM key. The public page (/relabel)
//  calls relabelValidate then relabelRequest through /api/crm, exactly like
//  the /verify self-serve page. Rate-limited per token (WB_TOKEN_MAX_HITS
//  loads) and per shipment (one label per WB_RELABEL_COOLDOWN_H hours).
// ═══════════════════════════════════════════════════════════════════════
function _wbTokenSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(WB_TOKENS_TAB);
  if (!sh) {
    sh = ss.insertSheet(WB_TOKENS_TAB);
    sh.getRange(1, 1, 1, WB_TOKEN_HEADERS.length).setValues([WB_TOKEN_HEADERS])
      .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    sh.setFrozenRows(1);
  }
  return sh;
}

var _wbRelabelColChecked = false;
function _wbEnsureShipmentCols() {
  if (_wbRelabelColChecked) return;
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.SHIPMENTS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ['relabel_requested_at', 'winback_a_sent_at', 'winback_a_sms_at'].forEach(function (col) {
    if (headers.indexOf(col) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col)
        .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
      headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      Logger.log('winback: added Shipments.' + col);
    }
  });
  _wbRelabelColChecked = true;
}

var _wbCustColChecked = false;
function _wbEnsureCustomerCols() {
  if (_wbCustColChecked) return;
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.CUSTOMERS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ['winback_b_sent_at', 'winback_c_sent_at'].forEach(function (col) {
    if (headers.indexOf(col) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col)
        .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
      headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      Logger.log('winback: added Customers.' + col);
    }
  });
  _wbCustColChecked = true;
}

// One token per shipment per campaign; reuses a live one so a resend keeps the same link.
function _wbIssueToken(shipmentId, customerId, campaign) {
  var sh = _wbTokenSheet();
  var data = sh.getDataRange().getValues(), h = data[0];
  var ix = {}; h.forEach(function (x, i) { ix[x] = i; });
  var now = new Date();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][ix.shipment_id]) !== String(shipmentId)) continue;
    if (String(data[r][ix.campaign]) !== String(campaign)) continue;
    var exp = _wbDate(data[r][ix.expires_at]);
    if (exp && exp > now && !String(data[r][ix.used_at] || '').trim()) return String(data[r][ix.token]);
  }
  var token = _randomToken(24);
  sh.appendRow([token, shipmentId, customerId, campaign, now.toISOString(),
                new Date(now.getTime() + WB_TOKEN_TTL_DAYS * 86400000).toISOString(), '', '', 0, '']);
  return token;
}

function _wbLink(shipmentId, customerId, campaign) {
  if (WB_PREVIEW) return WB_BASE_URL + '<token issued at send time>&ref=' + campaign;
  return WB_BASE_URL + _wbIssueToken(shipmentId, customerId, campaign) + '&ref=' + campaign;
}

// Finds the token row and counts the hit. → { row, rowNum, ix, error }
function _wbLoadToken(token, countHit) {
  var sh = _wbTokenSheet();
  var data = sh.getDataRange().getValues(), h = data[0];
  var ix = {}; h.forEach(function (x, i) { ix[x] = i; });
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][ix.token]) !== String(token)) continue;
    var hits = parseInt(data[r][ix.hits], 10) || 0;
    if (hits >= WB_TOKEN_MAX_HITS) return { error: 'rate_limited' };
    var exp = _wbDate(data[r][ix.expires_at]);
    if (!exp || exp < new Date()) return { error: 'expired' };
    if (countHit) {
      sh.getRange(r + 1, ix.hits + 1).setValue(hits + 1);
      sh.getRange(r + 1, ix.last_hit_at + 1).setValue(new Date().toISOString());
    }
    return { row: data[r], rowNum: r + 1, ix: ix, sheet: sh };
  }
  return { error: 'invalid_token' };
}

// PUBLIC: what the /relabel page shows before the customer clicks.
function handleRelabelValidate(parsed) {
  try {
    if (!parsed.token) return { success: false, error: 'token required' };
    var t = _wbLoadToken(parsed.token, true);
    if (t.error) return { success: false, error: t.error };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var shipment = _findShipmentById(ss, t.row[t.ix.shipment_id]);
    var customer = _findCustomerById(ss, t.row[t.ix.customer_id]);
    if (!shipment || !customer) return { success: false, error: 'record_not_found' };
    var type = normalizeShipType(shipment.shipping_type);
    return {
      success: true,
      already_requested: !!String(shipment.relabel_requested_at || '').trim(),
      shipping_type: type,
      is_kit: type === 'kit',
      has_address: !!String(customer.address || '').trim(),
      away_notice: awayNoticeLine(),   // '' unless we're inside the away window
      customer: { name: customer.name || '', email: customer.email || '' },
      shipment: { shipment_id: shipment.shipment_id, item: shipment.item || '' },
    };
  } catch (err) { return { success: false, error: String(err && err.message || err) }; }
}

// PUBLIC: the click. Generates the label (or takes the address first).
function handleRelabelRequest(parsed) {
  try {
    if (!parsed.token) return { success: false, error: 'token required' };
    var t = _wbLoadToken(parsed.token, true);
    if (t.error) return { success: false, error: t.error };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var shipmentId = t.row[t.ix.shipment_id], customerId = t.row[t.ix.customer_id];
    var shipment = _findShipmentById(ss, shipmentId);
    var customer = _findCustomerById(ss, customerId);
    if (!shipment || !customer) return { success: false, error: 'record_not_found' };

    // Address: from file, or from the form on this page.
    var address = String(customer.address || '').trim();
    var given = String(parsed.address || '').trim();
    if (given) {
      var parsedAddr = _parseUsAddress(given);
      if (!parsedAddr.street1 || !parsedAddr.city || !parsedAddr.state || !parsedAddr.zip) return { success: false, error: 'bad_address' };
      upsertCustomer({ email: customer.email, address: given });
      address = given;
    }
    if (!address) return { success: false, error: 'need_address' };

    // One label per shipment per cooldown, whatever the token says.
    var last = _wbDate(shipment.relabel_requested_at);
    if (last && (Date.now() - last.getTime()) < WB_RELABEL_COOLDOWN_H * 3600000) {
      return { success: true, already: true, message: 'A new label is already on its way — check your email.' };
    }

    _wbEnsureShipmentCols();
    var stamp = new Date().toISOString();
    var type = normalizeShipType(shipment.shipping_type);

    // Kits have no printable label — flag it for DW instead of failing.
    if (type === 'kit') {
      updateShipment(shipmentId, { relabel_requested_at: stamp });
      _wbLog(customerId, shipmentId, 'auto:winback_relabel', 'Kit re-send requested from the win-back link — needs a kit mailed');
      try { COMMS_KIND = ''; sendSms(REG_ALERT_PHONE, 'David', 'Win-back: ' + (customer.name || customerId) + ' asked for another KIT (' + shipmentId + ')'); } catch (e) {}
      return { success: true, kit: true, message: "Thanks — I'll get a new kit in the mail to you." };
    }
    if (type !== 'usps' && type !== 'fedex') return { success: false, error: 'unrecognized shipping type' };

    // Scan-based (Shippo) only. This route is public, so it must never be able
    // to buy an EasyPost label, which bills the moment it is created.
    COMMS_KIND = 'auto:winback_relabel';
    LABEL_SHIPPO_ONLY = true;
    var res;
    try { res = generateAndSendLabel(customerId, shipmentId, type, address, customer.name || '', customer.email, customer.phone || '', shipment.item || ''); }
    finally { COMMS_KIND = ''; LABEL_SHIPPO_ONLY = false; }
    if (!res || !res.success) return { success: false, error: (res && res.error) || 'label failed' };

    updateShipment(shipmentId, { relabel_requested_at: stamp });
    if (t.sheet) t.sheet.getRange(t.rowNum, t.ix.used_at + 1).setValue(stamp);
    _wbLog(customerId, shipmentId, 'auto:winback_relabel', 'New ' + type.toUpperCase() + ' label sent from the win-back link (' + (res.tracking || 'no tracking') + ')');
    var away = awayNoticeLine();
    return { success: true, away_notice: away,
             message: 'Your new prepaid label is on its way to ' + customer.email + '.' + (away ? ' ' + away : '') };
  } catch (err) { return { success: false, error: String(err && err.message || err) }; }
}

function _wbLog(customerId, shipmentId, kind, notes) {
  try {
    _ensureContactLogColumns(SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.CONTACT_LOG));
    addContactLog({ customer_id: customerId, shipment_id: shipmentId || '', type: 'note', direction: '', source: 'auto', kind: kind, notes: String(notes).slice(0, 300) });
  } catch (e) { Logger.log('winback log: ' + e); }
}

// ═══════════════════════════════════════════════════════════════════════
//  SHARED SENDING — broadcast stream, tagged, bounce watch
// ═══════════════════════════════════════════════════════════════════════
var WB_BOUNCE_LIMIT_PCT = 5;      // stop the run above this
var WB_BOUNCE_CHECK_EVERY = 25;   // ...checked every N sends
var WB_THROTTLE_MS = 300;

function _wbSendEmail(to, subject, bodyText, tag) {
  var token = _reengageToken();
  if (!token) return { success: false, error: 'no Postmark token' };
  var html = buildPlainEmail('', bodyText +
    '\n\n<span style="font-size:12px;color:#aaa;">' + REENGAGE_PHYSICAL +
    '<br>Don\'t want these? <a href="{{{ pm:unsubscribe }}}" style="color:#aaa;">Unsubscribe</a> (one click) or reply STOP.</span>');
  var res = UrlFetchApp.fetch('https://api.postmarkapp.com/email', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Postmark-Server-Token': token, 'Accept': 'application/json' },
    payload: JSON.stringify({
      From: REENGAGE_FROM, To: to, ReplyTo: REENGAGE_REPLY_TO, Subject: subject,
      HtmlBody: html, TextBody: _stripHtml(html),
      MessageStream: _reengageStream(), Tag: tag,
    }),
  });
  if (res.getResponseCode() !== 200) return { success: false, error: 'HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 140) };
  return { success: true };
}

// Bounce rate for this tag today, from Postmark. null when it can't be read.
function _wbBounceRate(tag) {
  var token = _reengageToken();
  if (!token) return null;
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  try {
    var res = UrlFetchApp.fetch('https://api.postmarkapp.com/stats/outbound?fromdate=' + today + '&todate=' + today +
      '&messagestream=' + encodeURIComponent(_reengageStream()) + '&tag=' + encodeURIComponent(tag),
      { headers: { 'X-Postmark-Server-Token': token, 'Accept': 'application/json' }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var j = JSON.parse(res.getContentText());
    if (!j.Sent) return null;
    return (j.Bounced || 0) / j.Sent * 100;
  } catch (e) { Logger.log('bounce check: ' + e); return null; }
}

// Anyone automatically emailed/texted in the last N days (Contact Log, source=auto).
// Sep 23: was Contact Log only — which is not enough. The Contact Log rows for
// re-engagement and recovery only exist for sends made AFTER logAutoSend shipped
// (Sep 14), and only when the address matched a customer row. The campaigns'
// own stamps are the authoritative record, so read those too. Returns a map
// keyed by BOTH customer_id and normalized email → why they were touched.
function _wbRecentlyTouched(days) {
  var cutoff = Date.now() - days * 86400000, out = {};
  var mark = function (key, why) { if (key && !out[key]) out[key] = why; };
  var fresh = function (v) { var d = _wbDate(v); return (d && d.getTime() >= cutoff) ? d : null; };
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var custs = getCustomers(), emailOf = {};
  custs.forEach(function (c) { if (c.customer_id) emailOf[c.customer_id] = _wbEmail(c.email); });
  var both = function (custId, why) { mark(custId, why); mark(emailOf[custId], why); };

  // 1. Contact Log, any automated send (drip, post-label, label email, win-back…)
  getContactLog(null).forEach(function (l) {
    if (String(l.source || '') !== 'auto' || !l.customer_id) return;
    var d = fresh(l.timestamp);
    if (d) both(l.customer_id, 'contact log ' + _wbDay(d) + ' (' + (l.kind || 'auto') + ')');
  });

  // 2. Campaign stamps on the shipment — re-engagement and win-back A
  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function (s) {
    if (!s.customer_id) return;
    var re = fresh(s.reengage_sent_at);      if (re) both(s.customer_id, 'reengage_sent_at ' + _wbDay(re));
    var wa = fresh(s.winback_a_sent_at);     if (wa) both(s.customer_id, 'winback_a_sent_at ' + _wbDay(wa));
    var ws = fresh(s.winback_a_sms_at);      if (ws) both(s.customer_id, 'winback_a_sms_at ' + _wbDay(ws));
  });

  // 3. Campaign stamps on the customer — win-back B and C
  custs.forEach(function (c) {
    if (!c.customer_id) return;
    var b = fresh(c.winback_b_sent_at); if (b) both(c.customer_id, 'winback_b_sent_at ' + _wbDay(b));
    var cc = fresh(c.winback_c_sent_at); if (cc) both(c.customer_id, 'winback_c_sent_at ' + _wbDay(cc));
  });

  // 4. Recovery — RECOV:yyyy-mm-dd stamps in Lead Intake, keyed by email only
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  for (var r = 1; r < lead.length; r++) {
    var em = _wbEmail(lead[r][COL.EMAIL]);
    if (!em) continue;
    var y = String(lead[r][COL.AUTO_REPLY] || '');
    var m = y.match(/RECOV:(\d{4}-\d{2}-\d{2})/g);
    if (!m) continue;
    m.forEach(function (tag) {
      var d = fresh(tag.slice(6) + 'T12:00:00');
      if (d) mark(em, 'RECOV: ' + _wbDay(d));
    });
  }
  return out;
}

// Why a shipment is or isn't eligible for Campaign A. One place, so the segment
// and the audit can never disagree.
function _wbABucket(s, custs, touched, now) {
  if (String(s.stage || '').toLowerCase() !== 'outbound_complete') return 'not_outbound';
  if (String(s.received_at || '').trim()) return 'already_arrived';
  if (normalizeShipType(s.shipping_type) === 'kit') return 'kit';
  var sent = _wbReliable(_wbDate(s.sent_at)) || _wbReliable(_wbDate(s.created_at));
  if (!sent) return 'no_usable_date';
  if ((now - sent.getTime()) / 86400000 < WB_A_MIN_DAYS) return 'too_new';
  if (String(s.relabel_requested_at || '').trim()) return 'already_relabeled';
  if (String(s.winback_a_sent_at || '').trim()) return 'already_sent';
  var c = custs[s.customer_id];
  if (!c) return 'no_customer';
  var to = isPlausibleEmail(c.email);
  if (!to) return 'bad_email';
  if (isDoNotContact(c.email) || (c.phone && isDoNotContact(c.phone)) || isDoNotContact(to)) return 'dnc';
  if (touched[c.customer_id] || touched[_wbEmail(c.email)] || touched[to]) return 'touched_recently';
  return 'eligible';
}
function _wbTouchReason(s, custs, touched) {
  var c = custs[s.customer_id] || {};
  return touched[s.customer_id] || touched[_wbEmail(c.email)] || touched[isPlausibleEmail(c.email)] || '';
}

function _wbIsTest(c) {
  var email = String(c.email || ''), phone = _dncNormPhone(c.phone), name = String(c.name || '');
  var pats = (typeof MY_EMAIL_PATTERNS !== 'undefined') ? MY_EMAIL_PATTERNS : [];
  var phones = (typeof MY_PHONES !== 'undefined') ? MY_PHONES : [];
  var names = (typeof MY_NAMES !== 'undefined') ? MY_NAMES : [];
  return pats.some(function (re) { return re.test(email); }) || (phone && phones.indexOf(phone) !== -1) ||
         names.some(function (re) { return re.test(name); });
}

function _wbBlocked(c, to) {
  if (!to) return 'implausible email';
  if (isDoNotContact(c.email) || (c.phone && isDoNotContact(c.phone)) || isDoNotContact(to)) return 'do not contact';
  return '';
}

// Shared runner: dry run prints counts + first 10; live sends with the bounce watch.
function _wbRun(campaign, tag, list, limit, dryRun, build, stampFn) {
  var label = campaign.toUpperCase();
  if (!dryRun && awayHoldsNudges()) {
    Logger.log('AWAY WINDOW — ' + label + ' held (nothing sent). Clear AWAY_FROM/AWAY_TO or wait for the window to pass.');
    return { eligible: list.length, sent: 0, held: 'away window' };
  }
  Logger.log('━━━ WIN-BACK ' + label + (dryRun ? ' — DRY RUN (nothing sent)' : ' — SENDING') + ' ━━━');
  Logger.log('eligible: ' + list.length + (dryRun ? '' : '   sending up to ' + limit));
  if (dryRun) {
    list.slice(0, 10).forEach(function (p, i) {
      Logger.log('  ' + (i + 1) + '. ' + _wbPad(String(p.name || '(no name)').slice(0, 22), 24) +
                 _wbPad(String(p.email).replace(/(.{2}).*(@.*)/, '$1***$2').slice(0, 26), 28) + (p.note || ''));
    });
    if (list.length > 10) Logger.log('  … and ' + (list.length - 10) + ' more');
    Logger.log('nothing sent. Run the send function when you are ready.');
    return { eligible: list.length, sent: 0, dryRun: true };
  }
  var sent = 0, failed = [];
  for (var i = 0; i < list.length && sent < limit; i++) {
    var p = list[i];
    if (sent && sent % WB_BOUNCE_CHECK_EVERY === 0) {
      var rate = _wbBounceRate(tag);
      if (rate !== null && rate > WB_BOUNCE_LIMIT_PCT) {
        Logger.log('⛔ STOPPED: bounce rate ' + rate.toFixed(1) + '% is over ' + WB_BOUNCE_LIMIT_PCT + '% after ' + sent + ' sends');
        break;
      }
    }
    var msg = build(p);
    var r = _wbSendEmail(p.to, msg.subject, msg.body, tag);
    if (r.success) {
      sent++;
      try { stampFn(p); } catch (e) { Logger.log('stamp ' + p.email + ': ' + e); }
      _wbLog(p.customer_id, p.shipment_id || '', 'auto:' + campaign, msg.subject);
    } else failed.push(p.email + ' — ' + r.error);
    Utilities.sleep(WB_THROTTLE_MS);
  }
  Logger.log('sent ' + sent + ' of ' + Math.min(limit, list.length));
  if (failed.length) { Logger.log('failures (' + failed.length + '):'); failed.slice(0, 15).forEach(function (f) { Logger.log('  ' + f); }); }
  var finalRate = _wbBounceRate(tag);
  if (finalRate !== null) Logger.log('bounce rate for ' + tag + ' today: ' + finalRate.toFixed(1) + '%');
  return { eligible: list.length, sent: sent, failed: failed.length };
}

// ═══════════════════════════════════════════════════════════════════════
//  CAMPAIGN A — never shipped, second touch (per person, not per shipment)
//  label sent · never arrived · label ≥14 days old · not DNC · plausible
//  email · no automated send in the last 14 days · not already relabeled
// ═══════════════════════════════════════════════════════════════════════
var WB_A_MIN_DAYS = 14, WB_A_QUIET_DAYS = 14;

function _wbSegmentA() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var touched = _wbRecentlyTouched(WB_A_QUIET_DAYS);
  var now = Date.now(), best = {};
  ships.forEach(function (s) {
    if (_wbABucket(s, custs, touched, now) !== 'eligible') return;
    var sent = _wbReliable(_wbDate(s.sent_at)) || _wbReliable(_wbDate(s.created_at));
    var days = (now - sent.getTime()) / 86400000;
    var c = custs[s.customer_id];
    var to = isPlausibleEmail(c.email);
    // Sep 23: key on the EMAIL, not customer_id — duplicate customer rows for one
    // person were putting them in the list twice (Shanna Beasley).
    var key = to || _wbEmail(c.email) || c.customer_id;
    var cur = best[key];
    if (cur && cur.days <= days) return;                     // one per person: freshest label
    best[key] = { customer_id: c.customer_id, shipment_id: s.shipment_id, name: c.name, email: c.email,
                            to: to, phone: c.phone || '', item: s.item || '', days: Math.round(days),
                            note: 'label ' + Math.round(days) + 'd old · ' + s.shipment_id };
  });
  return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return a.days - b.days; });
}

// Carrier labels stop being usable around 90 days, so don't tell someone an
// old one is "still open" — at that age it has expired and needs replacing.
var WB_A_EXPIRED_DAYS = 90;

function _wbCopyA(p) {
  var first = _wbFirst(p.name);
  var link = _wbLink(p.shipment_id, p.customer_id, 'winback_a');
  var expired = p.days >= WB_A_EXPIRED_DAYS;
  return {
    subject: (expired ? 'Your prepaid label expired' : 'Your prepaid label is still good') + _wbComma(first),
    body: _wbHi(first) + _wbBack() +
      (expired
        ? 'You asked us for a prepaid label a while back and it never made it to us. That label has since expired — carrier labels stop working after about ' + WB_A_EXPIRED_DAYS + ' days — but replacing it takes one click.\n\n'
        : 'You asked us for a prepaid label a while back and it never made it to us — no problem, that happens. Your label is still open, and I can send a fresh one if you no longer have it.\n\n') +
      'Gold is trading well above where it was when you registered, so it is a good moment to send it in.\n\n' +
      '<strong><a href="' + link + '">' + (expired ? 'Tap here and I will email you a new prepaid label' : 'Click here and I will email you a fresh prepaid label') + '</a></strong> — one click, nothing to fill in.\n\n' +
      'Don\'t want to go to the post office? Schedule a free USPS pickup at <a href="https://usps.com/pickup">usps.com/pickup</a> and the carrier collects it from your door on the next delivery day.\n\n' +
      'Free shipping both ways, and everything comes back free if my offer isn\'t right for you.\n\nDavid\nSnappy Gold\n866-613-0704',
  };
}

function winbackADryRun() {
  WB_PREVIEW = true;
  try { return _wbRun('winback_a', 'winback_a', _wbSegmentA(), 0, true, _wbCopyA, null); }
  finally { WB_PREVIEW = false; }
}
function _wbSendA(limit) {
  _wbEnsureShipmentCols();
  return _wbRun('winback_a', 'winback_a', _wbSegmentA(), limit, false, _wbCopyA, function (p) {
    updateShipment(p.shipment_id, { winback_a_sent_at: new Date().toISOString() });
  });
}
function winbackASend250() { return _wbSendA(250); }   // full run
function winbackASend100() { return _wbSendA(100); }   // pilot

// ── Campaign A by SMS — separate run, label-only copy (no gold price, no offer) ──
var WB_SMS_START = 9, WB_SMS_END = 20;   // ET

function _wbSegmentASms() {
  return _wbSegmentA().filter(function (p) {
    if (!_dncNormPhone(p.phone)) return false;
    return !isDoNotContact(p.phone);
  }).map(function (p) { p.note = p.note + ' · ' + fmtPhoneSafe(p.phone); return p; });
}
function fmtPhoneSafe(v) { var d = _dncNormPhone(v); return d ? '(' + d.slice(0, 3) + ') ***-' + d.slice(6) : ''; }

function _wbSmsTextA(p) {
  var first = _wbFirst(p.name) || 'there';
  var link = _wbLink(p.shipment_id, p.customer_id, 'winback_a');
  return p.days >= WB_A_EXPIRED_DAYS
    ? 'Hi ' + first + ' — David at Snappy Gold. The prepaid label I sent you has expired, but I can send you a new one: ' + link + ' Reply STOP to opt out.'
    : 'Hi ' + first + ' — David at Snappy Gold. The prepaid label I sent you is still open, and I can send a fresh one if the old one is gone: ' + link + ' Reply STOP to opt out.';
}

function winbackASmsDryRun() {
  WB_PREVIEW = true;
  try { return _wbSmsDryRun(); } finally { WB_PREVIEW = false; }
}
function _wbSmsDryRun() {
  var list = _wbSegmentASms();
  Logger.log('━━━ WIN-BACK A · SMS — DRY RUN (nothing sent) ━━━');
  Logger.log('eligible (phone on file, not DNC): ' + list.length);
  Logger.log('quiet hours: SMS only ' + WB_SMS_START + ':00–' + WB_SMS_END + ':00 ET · right now: ' + (_wbSmsOk() ? 'OK to send' : 'OUTSIDE the window'));
  list.slice(0, 10).forEach(function (p, i) { Logger.log('  ' + (i + 1) + '. ' + _wbPad(String(p.name || '').slice(0, 22), 23) + p.note); });
  if (list.length) { Logger.log(''); Logger.log('message as it will read:'); Logger.log('  ' + _wbSmsTextA(list[0])); }
  return { eligible: list.length, sent: 0, dryRun: true };
}

function _wbSmsOk() {
  var h = parseInt(Utilities.formatDate(new Date(), 'America/New_York', 'H'), 10);
  return h >= WB_SMS_START && h < WB_SMS_END;
}

function winbackASmsSend100() { return winbackASmsSend(100); }   // pilot
function winbackASmsSend(limit) {
  limit = limit || 250;
  if (awayHoldsNudges()) { Logger.log('AWAY WINDOW — win-back A SMS held (nothing sent)'); return { sent: 0, held: 'away window' }; }
  if (!_wbSmsOk()) { Logger.log('Outside ' + WB_SMS_START + ':00–' + WB_SMS_END + ':00 ET — nothing sent.'); return { sent: 0, blocked: 'quiet hours' }; }
  _wbEnsureShipmentCols();
  var list = _wbSegmentASms(), sent = 0, failed = [];
  for (var i = 0; i < list.length && sent < limit; i++) {
    var p = list[i];
    if (!_wbSmsOk()) { Logger.log('hit ' + WB_SMS_END + ':00 ET — stopping at ' + sent); break; }
    COMMS_KIND = 'auto:winback_a_sms';
    var r;
    try { r = sendSms(p.phone, p.name, _wbSmsTextA(p)); } catch (e) { r = { success: false, error: String(e) }; }
    COMMS_KIND = '';
    if (r && r.success) {
      sent++;
      try { updateShipment(p.shipment_id, { winback_a_sms_at: new Date().toISOString() }); } catch (e2) { Logger.log('stamp: ' + e2); }
      _wbLog(p.customer_id, p.shipment_id, 'auto:winback_a_sms', 'Win-back A SMS — fresh label offer');
    } else failed.push(p.phone + ' — ' + ((r && r.error) || 'unknown'));
    Utilities.sleep(400);
  }
  Logger.log('SMS sent ' + sent + ' of ' + Math.min(limit, list.length));
  if (failed.length) failed.slice(0, 10).forEach(function (f) { Logger.log('  ✗ ' + f); });
  return { eligible: list.length, sent: sent, failed: failed.length };
}

// ═══════════════════════════════════════════════════════════════════════
//  CAMPAIGN B — past buyers: "anything else in the drawer?" + referral
//  any purchased shipment · not DNC · plausible email · not already sent
// ═══════════════════════════════════════════════════════════════════════
function _wbReferralCodeByEmail() {
  var out = {};
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Affiliates');
    if (!sh) return out;
    sheetToObjects(sh).forEach(function (a) {
      var code = String(a.ref_code || '');
      if (code.indexOf(REFERRAL_PREFIX) !== 0) return;
      var em = _wbEmail(a.contact);
      if (em && !out[em]) out[em] = code;
    });
  } catch (e) { Logger.log('referral codes: ' + e); }
  return out;
}

function _wbSegmentB() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var codes = _wbReferralCodeByEmail();
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var byCust = {};
  ships.forEach(function (s) {
    var bought = WB_PURCHASED_STAGES.indexOf(String(s.stage || '').toLowerCase()) !== -1 || parseFloat(s.purchase_price) > 0;
    if (!bought) return;
    var c = custs[s.customer_id];
    if (!c || String(c.winback_b_sent_at || '').trim()) return;
    var to = isPlausibleEmail(c.email);
    if (_wbBlocked(c, to)) return;
    var when = _wbDate(s.purchased_at) || _wbDate(s.paid_at) || _wbDate(s.created_at);
    var cur = byCust[c.customer_id];
    if (cur && cur._when && when && cur._when >= when) return;      // keep their most recent purchase
    byCust[c.customer_id] = { customer_id: c.customer_id, shipment_id: s.shipment_id, name: c.name, email: c.email, to: to,
                              code: codes[_wbEmail(c.email)] || '', _when: when,
                              note: 'bought ' + (_wbReliable(when) ? _wbDay(when) : '(pre-Apr migration date)') + ' · ' + (codes[_wbEmail(c.email)] || 'no ref code') };
  });
  return Object.keys(byCust).map(function (k) { return byCust[k]; });
}

function _wbCopyB(p) {
  var first = _wbFirst(p.name);
  var link = _wbLink(p.shipment_id, p.customer_id, 'winback_b');
  var referral = p.code
    ? '\n\nAnd the $' + REFERRAL_BONUS + ' referral still stands: send anyone you know to <strong><a href="' + SITE_BASE_URL_SAFE() + '/?ref=' + p.code + '">' +
      SITE_BASE_URL_SAFE() + '/?ref=' + p.code + '</a></strong> and I pay you $' + REFERRAL_BONUS + ' when they sell to me. No limit.'
    : '';
  return {
    subject: 'Anything else in the drawer' + _wbComma(first) + '?',
    body: _wbHi(first) + _wbBack() +
      'Thanks again for selling with me. If there is anything else sitting in a drawer — odd earrings, a broken chain, an old class ring — I am happy to take a look.\n\n' +
      '<strong><a href="' + link + '">Click here and I will email you a prepaid label</a></strong>, same as last time. Free both ways, and anything I don\'t buy comes straight back.' +
      referral + '\n\nDavid\nSnappy Gold\n866-613-0704',
  };
}

function winbackBDryRun() {
  WB_PREVIEW = true;
  try { return _wbRun('winback_b', 'winback_b', _wbSegmentB(), 0, true, _wbCopyB, null); }
  finally { WB_PREVIEW = false; }
}
function winbackBSend(limit) {
  _wbEnsureCustomerCols();
  return _wbRun('winback_b', 'winback_b', _wbSegmentB(), limit || 250, false, _wbCopyB, function (p) {
    upsertCustomer({ email: p.email, winback_b_sent_at: new Date().toISOString() });
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  CAMPAIGN C — customers with an email and no shipment at all
//  ≥14 days old · not DNC · plausible email · not one of DW's test accounts
//  The link goes to the normal registration flow (there is no shipment to
//  relabel), so they land on the shipping form with ref=winback_c.
// ═══════════════════════════════════════════════════════════════════════
var WB_C_MIN_AGE_DAYS = 14;

function _wbSegmentC() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var withShipments = {};
  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function (s) { if (s.customer_id) withShipments[s.customer_id] = true; });
  var now = Date.now(), out = [], skippedTest = 0;
  getCustomers().forEach(function (c) {
    if (!c.customer_id || withShipments[c.customer_id]) return;
    if (String(c.winback_c_sent_at || '').trim()) return;
    var made = _wbDate(c.created_at);
    if (!made || (now - made.getTime()) / 86400000 < WB_C_MIN_AGE_DAYS) return;
    var to = isPlausibleEmail(c.email);
    if (_wbBlocked(c, to)) return;
    if (_wbIsTest(c)) { skippedTest++; return; }
    out.push({ customer_id: c.customer_id, shipment_id: '', name: c.name, email: c.email, to: to,
               note: 'customer since ' + _wbDay(made) });
  });
  out._skippedTest = skippedTest;
  return out;
}

function _wbCopyC(p) {
  var first = _wbFirst(p.name);
  var link = buildReturnUrl('shipping', first, '', '') + '&ref=winback_c';
  return {
    subject: 'Still have it' + _wbComma(first) + '?',
    body: _wbHi(first) + _wbBack() +
      'You started with us a while back but never got as far as sending anything in. If the piece is still sitting there, I will send you a prepaid label — free both ways, and it comes back free if my offer isn\'t right.\n\n' +
      '<strong><a href="' + link + '">Click here and tell me where to send the label</a></strong> — takes about a minute.\n\n' +
      'David\nSnappy Gold\n866-613-0704',
  };
}

function winbackCDryRun() {
  WB_PREVIEW = true;
  try { return _wbCDryRun(); } finally { WB_PREVIEW = false; }
}
function _wbCDryRun() {
  var list = _wbSegmentC();
  Logger.log('(excluded ' + (list._skippedTest || 0) + ' test/own accounts via MY_EMAIL_PATTERNS / MY_PHONES / MY_NAMES)');
  var r = _wbRun('winback_c', 'winback_c', list, 0, true, _wbCopyC, null);
  Logger.log(list.length < 100
    ? '⚠ Segment is under 100 (' + list.length + ') — per the brief, consider skipping Campaign C.'
    : 'Segment is ' + list.length + ' — above the 100 threshold.');
  return r;
}
function _wbSendC(limit) {
  _wbEnsureCustomerCols();
  return _wbRun('winback_c', 'winback_c', _wbSegmentC(), limit, false, _wbCopyC, function (p) {
    upsertCustomer({ email: p.email, winback_c_sent_at: new Date().toISOString() });
  });
}
function winbackCSend250() { return _wbSendC(250); }   // full run
function winbackCSend100() { return _wbSendC(100); }   // pilot

// Private column helpers. NOTE: _pad is defined twice in the project
// (arrivals.gs right-pads, Estimates.gs left-pads) and whichever file loads
// last wins, so win-back output uses its own.
function _wbPad(s, n)  { s = String(s); while (s.length < n) s += ' '; return s; }
function _wbPadL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
