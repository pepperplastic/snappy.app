// ═══════════════════════════════════════════════════════════════════════
//  RE-ENGAGEMENT SEGMENT SIZING                            (Aug 17, 2026)
//
//  Run sizeReengagementSegments(). Sends nothing — counts only.
//
//  1. LABEL SENT, NEVER SHIPPED   stage=outbound_complete, no received_at
//  2. EMAIL BUT NO ADDRESS        gave an email, never completed the ship form
//  3. PAID CUSTOMERS              candidates for a referral ask
//
//  WHY AGE BUCKETS MATTER FOR #1: carrier labels expire — USPS and FedEx both
//  stop honouring them after roughly 90 days. Anyone past that needs a NEW
//  label generated, not a reminder to use the old one. And labels issued before
//  Aug 6 were pre-paid under the old EasyPost setup; from Aug 6 they're
//  pay-on-use, so re-issuing costs nothing unless the customer actually ships.
// ═══════════════════════════════════════════════════════════════════════

var PAY_ON_USE_FROM = new Date('2026-08-06T00:00:00Z');

function sizeReengagementSegments() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var now = new Date();
  var DAY = 86400000;

  // ── customers: id → {email, name} ──
  var cData = ss.getSheetByName(TAB.CUSTOMERS).getDataRange().getValues();
  var cH = cData[0];
  var ci = cH.indexOf('customer_id'), ce = cH.indexOf('email'), cn = cH.indexOf('name');
  var cust = {}, custEmails = {};
  for (var i = 1; i < cData.length; i++) {
    var id = cData[i][ci];
    if (!id) continue;
    var em = String(cData[i][ce] || '').toLowerCase().trim();
    cust[id] = { email: em, name: String(cData[i][cn] || '').trim() };
    if (em) custEmails[em] = true;
  }

  // ── shipments ──
  var sData = ss.getSheetByName(TAB.SHIPMENTS).getDataRange().getValues();
  var sH = sData[0], ix = {};
  ['shipment_id','customer_id','stage','sent_at','received_at','created_at',
   'purchase_price','outbound_tracking','shipping_type'].forEach(function (k) { ix[k] = sH.indexOf(k); });

  var seg1 = { '0-30d': 0, '31-90d': 0, '91-180d': 0, '180d+': 0 };
  var seg1People = {}, seg1NoEmail = 0, seg1PayOnUse = 0, seg1Prepaid = 0, seg1Total = 0;
  var paidCust = {}, paidTotal = 0;

  for (var r = 1; r < sData.length; r++) {
    var stage = String(sData[r][ix.stage] || '').toLowerCase().trim();
    var cid = sData[r][ix.customer_id];

    // segment 3 — anyone we've actually paid
    var price = parseFloat(sData[r][ix.purchase_price]);
    if (isFinite(price) && price > 0 && cid) { paidCust[cid] = true; paidTotal += price; }

    // segment 1 — label issued, package never arrived
    if (stage !== 'outbound_complete') continue;
    if (String(sData[r][ix.received_at] || '').trim()) continue;

    seg1Total++;
    var sentRaw = sData[r][ix.sent_at] || sData[r][ix.created_at];
    var sent = sentRaw instanceof Date ? sentRaw : new Date(sentRaw);
    if (isNaN(sent.getTime())) continue;

    var age = (now - sent) / DAY;
    if (age <= 30) seg1['0-30d']++;
    else if (age <= 90) seg1['31-90d']++;
    else if (age <= 180) seg1['91-180d']++;
    else seg1['180d+']++;

    if (sent >= PAY_ON_USE_FROM) seg1PayOnUse++; else seg1Prepaid++;
    if (cid) {
      seg1People[cid] = true;
      if (!cust[cid] || !cust[cid].email) seg1NoEmail++;
    }
  }

  // ── segment 2 — email captured, address never given, never a customer ──
  var lData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var byEmail = {};
  for (var j = 1; j < lData.length; j++) {
    var em2 = String(lData[j][COL.EMAIL] || '').toLowerCase().trim();
    if (!em2 || em2.indexOf('@') < 0) continue;
    var ts = lData[j][COL.TIMESTAMP];
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) continue;
    if (!byEmail[em2]) byEmail[em2] = { last: d, addr: false, est: '' };
    var rec = byEmail[em2];
    if (d > rec.last) rec.last = d;
    if (String(lData[j][COL.ADDRESS] || '').trim()) rec.addr = true;
    var e = String(lData[j][COL.ESTIMATE] || '').trim();
    if (e) rec.est = e;
  }
  var seg2 = { '0-30d': 0, '31-90d': 0, '91-180d': 0, '180d+': 0 };
  var seg2Total = 0, seg2WithEst = 0;
  Object.keys(byEmail).forEach(function (em3) {
    var rec = byEmail[em3];
    if (rec.addr || custEmails[em3]) return;
    seg2Total++;
    if (rec.est) seg2WithEst++;
    var age2 = (now - rec.last) / DAY;
    if (age2 <= 30) seg2['0-30d']++;
    else if (age2 <= 90) seg2['31-90d']++;
    else if (age2 <= 180) seg2['91-180d']++;
    else seg2['180d+']++;
  });

  // ── segment 3 ──
  var seg3 = Object.keys(paidCust).length;
  var seg3Email = 0;
  Object.keys(paidCust).forEach(function (id2) { if (cust[id2] && cust[id2].email) seg3Email++; });

  // ── report ──
  function bucketLines(b) {
    Object.keys(b).forEach(function (k) { Logger.log('    ' + k + ': ' + b[k]); });
  }
  Logger.log('═══ RE-ENGAGEMENT SEGMENTS ═══');
  Logger.log('');
  Logger.log('1. LABEL SENT, NEVER SHIPPED — ' + seg1Total + ' shipments, ' +
             Object.keys(seg1People).length + ' distinct people');
  Logger.log('   by age since the label went out:');
  bucketLines(seg1);
  Logger.log('   pre-Aug 6 (pre-paid, money already spent): ' + seg1Prepaid);
  Logger.log('   Aug 6 onward (pay-on-use, costs nothing unless used): ' + seg1PayOnUse);
  Logger.log('   ⚠ anything past ~90 days needs a NEW label — carrier labels expire');
  Logger.log('   rows with no email on the customer: ' + seg1NoEmail);
  Logger.log('');
  Logger.log('2. EMAIL BUT NO ADDRESS (never completed registration) — ' + seg2Total + ' people');
  Logger.log('   …of whom have an estimate on file: ' + seg2WithEst);
  Logger.log('   by how long since we last saw them:');
  bucketLines(seg2);
  Logger.log('');
  Logger.log('3. PAID CUSTOMERS (referral candidates) — ' + seg3 + ' people, ' +
             seg3Email + ' with an email');
  Logger.log('   total paid to them: $' + paidTotal.toFixed(2));
  Logger.log('');
  Logger.log('nothing was sent — sizing only');
}
