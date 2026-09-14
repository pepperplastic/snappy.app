// ═══════════════════════════════════════════════════════════════════════
//  referral.gs — customer referral program (Sep 9 2026)
//
//  Rides on the affiliate system: each paid customer gets an Affiliates row
//  with cpl = $0 and bonus_amount = $50 at threshold $0, so the Marketing tab
//  counts their referrals and the payout accrues ONLY on a purchase. Codes are
//  r-<first>-<custnum>, link snappy.gold/?ref=<code>. First-touch by email.
//
//  RUN ORDER (this file selected in the editor):
//   1. previewReferralCodes()   — who gets a code, what code
//   2. createReferralCodes()    — writes the Affiliates rows (skips existing)
//   3. previewReferralInvites() — the invite list
//   4. sendReferralInvites()    — Postmark broadcast, 60-ish emails, stamped in notes
//  Ongoing:
//   • referralPayoutReport()    — owed per referrer, with fraud flags
//   • the Paid notice (when we add it) includes the customer's link automatically
// ═══════════════════════════════════════════════════════════════════════

var REFERRAL_BONUS = 50;
var REFERRAL_PREFIX = 'r-';
var REFERRAL_PURCHASED = ['complete', 'pending_payment', 'pending_leadsonline'];

function _refSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10); }
function _refCodeFor(cust) {
  var first = _refSlug(String(cust.name || '').trim().split(/\s+/)[0]) || 'friend';
  var num = String(cust.customer_id || '').replace(/\D/g, '') || '0';
  return REFERRAL_PREFIX + first + '-' + num;
}
function _refPaidCustomers() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var paidCust = {};
  ships.forEach(function (s) {
    if (REFERRAL_PURCHASED.indexOf(String(s.stage || '').toLowerCase()) === -1) return;
    if (!(parseFloat(s.purchase_price) > 0)) return;
    paidCust[s.customer_id] = (paidCust[s.customer_id] || 0) + (parseFloat(s.purchase_price) || 0);
  });
  var out = [];
  getCustomers().forEach(function (c) {
    if (paidCust[c.customer_id] && String(c.email || '').indexOf('@') !== -1) out.push({ cust: c, paid: paidCust[c.customer_id] });
  });
  return out;
}
function _refAffiliateSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('Affiliates');
  if (!sh) throw new Error('Affiliates tab not found');
  return sh;
}

function _refCodesCore(dryRun) {
  var sh = _refAffiliateSheet();
  var data = sh.getDataRange().getValues(), h = data[0];
  var col = {}; h.forEach(function (x, i) { col[x] = i; });
  var existingCodes = {}, maxId = 0;
  for (var r = 1; r < data.length; r++) {
    existingCodes[String(data[r][col.ref_code] || '').toLowerCase()] = true;
    var m = String(data[r][col.affiliate_id] || '').match(/(\d+)/); if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  }
  var rows = [], now = new Date().toISOString();
  _refPaidCustomers().forEach(function (p) {
    var code = _refCodeFor(p.cust);
    if (existingCodes[code]) return;
    maxId++;
    var row = h.map(function (k) {
      switch (k) {
        case 'affiliate_id': return 'AFF-' + String(maxId).padStart(3, '0');
        case 'ref_code': return code;
        case 'name': return (p.cust.name || '') + ' (customer referral)';
        case 'contact': return p.cust.email || '';
        case 'cpl': return 0;
        case 'bonus_amount': return REFERRAL_BONUS;
        case 'bonus_threshold': return 0;
        case 'active': return 'yes';
        case 'notes': return 'Customer referral · ' + (p.cust.customer_id || '') + ' · paid $' + Math.round(p.paid);
        case 'created_at': return now;
        default: return '';
      }
    });
    rows.push(row);
    existingCodes[code] = true;
  });
  if (dryRun) { Logger.log('━━━ REFERRAL CODES PREVIEW — ' + rows.length + ' new ━━━'); rows.forEach(function (r) { Logger.log('  ' + r[col.ref_code] + '  ' + r[col.name] + '  ' + r[col.contact]); }); return rows.length; }
  if (rows.length) sh.getRange(data.length + 1, 1, rows.length, h.length).setValues(rows);
  Logger.log('createReferralCodes: added ' + rows.length + ' Affiliates rows ($0/reg, $' + REFERRAL_BONUS + ' per purchase)');
  return rows.length;
}
function previewReferralCodes() { return _refCodesCore(true); }
function createReferralCodes()  { return _refCodesCore(false); }

// ── invite email ───────────────────────────────────────────────────────
function _refInviteHtml(first, link) {
  var body =
    'Thanks again for selling with Snappy Gold. A quick favor, with something in it for you:' +
    '\n\nIf you know someone with old gold or jewelry sitting in a drawer — a parent downsizing, a friend with a ring they never wear — send them your link:' +
    '\n\n<strong><a href="' + link + '">' + link + '</a></strong>' +
    '\n\nWhen they sell to us, I send you <strong>$' + REFERRAL_BONUS + '</strong>, same way I paid you. No limit on how many. They get exactly what you got: free insured shipping, my personal inspection, a firm offer, and everything back free if they\'d rather keep it.' +
    '\n\nForward this email, text the link, or just tell them to mention your name.' +
    '\n\nDavid\nSnappy Gold\n866-613-0704' +
    '\n\n<span style="font-size:12px;color:#aaa;">Don\'t want these? <a href="{{{ pm:unsubscribe }}}" style="color:#aaa;">Unsubscribe</a></span>';
  return buildPlainEmail(first, body);
}
function _refInvitesCore(dryRun) {
  var sh = _refAffiliateSheet();
  var data = sh.getDataRange().getValues(), h = data[0];
  var col = {}; h.forEach(function (x, i) { col[x] = i; });
  var sent = 0, would = [];
  for (var r = 1; r < data.length; r++) {
    var code = String(data[r][col.ref_code] || '');
    if (code.indexOf(REFERRAL_PREFIX) !== 0) continue;
    var notes = String(data[r][col.notes] || '');
    if (notes.indexOf('invited ') !== -1) continue;
    var email = String(data[r][col.contact] || '').trim();
    if (email.indexOf('@') === -1) continue;
    var first = String(data[r][col.name] || '').replace(/\(customer referral\)/, '').trim().split(/\s+/)[0] || 'there';
    var link = SITE_BASE_URL_SAFE() + '/?ref=' + code;
    if (typeof isDoNotContact === 'function' && isDoNotContact(email)) { Logger.log('  ⛔ DNC: ' + email); continue; }
    if (dryRun) { would.push(email + '  ' + link); sent++; continue; }
    var res = UrlFetchApp.fetch('https://api.postmarkapp.com/email', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'X-Postmark-Server-Token': _reengageToken(), 'Accept': 'application/json' },
      payload: JSON.stringify({ From: FROM_NAME + ' <' + FROM_EMAIL + '>', To: email,
        Subject: '$' + REFERRAL_BONUS + ' for every friend who sells with Snappy Gold, ' + first,
        HtmlBody: _refInviteHtml(first, link), TextBody: _stripHtml(_refInviteHtml(first, link)),
        MessageStream: _reengageStream(), Tag: 'referral-invite' })
    });
    if (res.getResponseCode() === 200) {
      sh.getRange(r + 1, col.notes + 1).setValue(notes + (notes ? ' · ' : '') + 'invited ' + new Date().toISOString().slice(0, 10));
      sent++;
    } else Logger.log('  ✗ ' + email + ': ' + res.getContentText().slice(0, 150));
    Utilities.sleep(300);
  }
  if (dryRun) { Logger.log('━━━ REFERRAL INVITES PREVIEW — ' + would.length + ' ━━━'); would.forEach(function (w) { Logger.log('  ' + w); }); }
  else Logger.log('sendReferralInvites: sent ' + sent);
  return sent;
}
function previewReferralInvites() { return _refInvitesCore(true); }
function sendReferralInvites()    { return _refInvitesCore(false); }
function SITE_BASE_URL_SAFE() { return 'https://snappy.gold'; }

// ── payout + fraud report ──────────────────────────────────────────────
// For each r- code: referred emails (first-touch ref from the ROI index),
// their purchases, $ owed, and FLAGS where the referred person shares the
// referrer's email/phone/address (self-referral).
function referralPayoutReport() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var idx = _roiLoadIndex(ss);
  var custs = getCustomers();
  var byEmail = {}, byId = {};
  custs.forEach(function (c) { var e = String(c.email || '').toLowerCase().trim(); if (e) byEmail[e] = c; byId[c.customer_id] = c; });
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var purchasedBy = {};
  ships.forEach(function (s) {
    if (REFERRAL_PURCHASED.indexOf(String(s.stage || '').toLowerCase()) === -1) return;
    if (!(parseFloat(s.purchase_price) > 0)) return;
    (purchasedBy[s.customer_id] = purchasedBy[s.customer_id] || []).push(s);
  });
  var aff = sheetToObjects(_refAffiliateSheet());
  var refToAff = {}; aff.forEach(function (a) { if (String(a.ref_code || '').indexOf(REFERRAL_PREFIX) === 0) refToAff[String(a.ref_code).toLowerCase()] = a; });
  var norm = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var report = {};
  Object.keys(idx.attrByEmail).forEach(function (em) {
    var ref = String(idx.attrByEmail[em].ref || '').toLowerCase();
    if (!refToAff[ref]) return;
    var a = refToAff[ref];
    var referrer = byEmail[String(a.contact || '').toLowerCase()] || {};
    var referred = byEmail[em] || { email: em };
    var flags = [];
    if (norm(referred.email) && norm(referred.email) === norm(referrer.email)) flags.push('same email');
    if (norm(referred.phone) && norm(referred.phone) === norm(referrer.phone)) flags.push('same phone');
    if (norm(referred.address) && norm(referred.address) === norm(referrer.address) && norm(referred.zip) === norm(referrer.zip)) flags.push('same address');
    var buys = purchasedBy[referred.customer_id] || [];
    var rep = report[ref] = report[ref] || { referrer: a.name, contact: a.contact, referred: [], owed: 0, flagged: 0 };
    var owed = buys.length ? REFERRAL_BONUS : 0;
    if (flags.length) { rep.flagged += owed; owed = 0; }
    rep.owed += owed;
    rep.referred.push({ email: em, registered: idx.regByEmail[em] ? idx.regByEmail[em].toISOString().slice(0, 10) : '', purchases: buys.length, paid: buys.reduce(function (t, s) { return t + (parseFloat(s.purchase_price) || 0); }, 0), flags: flags });
  });
  Logger.log('━━━ REFERRAL PAYOUT REPORT ($' + REFERRAL_BONUS + ' per referred purchase) ━━━');
  var keys = Object.keys(report);
  if (!keys.length) Logger.log('  No referred registrations yet.');
  keys.forEach(function (k) {
    var r = report[k];
    Logger.log(r.referrer + ' <' + r.contact + '> · ' + k + ' · OWED $' + r.owed + (r.flagged ? ' · WITHHELD $' + r.flagged + ' (fraud flags)' : ''));
    r.referred.forEach(function (x) { Logger.log('    ' + x.email + ' · reg ' + x.registered + ' · ' + x.purchases + ' purchase(s) $' + Math.round(x.paid) + (x.flags.length ? ' · ⚠ ' + x.flags.join(', ') : '')); });
  });
  Logger.log('Mark payments in the Affiliates row notes (e.g. "paid $50 2026-10-01") — the report is cumulative.');
  return report;
}
