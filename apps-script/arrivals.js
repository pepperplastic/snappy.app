// ═══════════════════════════════════════════════════════════════════════
//  ARRIVALS BY SOURCE                                       (Sep 3, 2026)
//
//  One row per package that ACTUALLY ARRIVED, with the attribution it came
//  in on. This is the table that answers the question Meta can't: not "how
//  many registrations did we buy" but "which sources produce packages, and
//  do those packages turn into purchases".
//
//  Attribution is resolved the same way getShipments() does it — walk Lead
//  Intake once, keep the EARLIEST attributed row per email, join by customer
//  email. First-touch, so a person who arrived via Facebook and later came
//  back through a direct visit is still credited to Facebook.
//
//  Run:  arrivalsBySource()
//  Writes the "Arrivals by Source" tab and logs a summary.
// ═══════════════════════════════════════════════════════════════════════

var ARR_STAGES = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];
var ARR_PURCHASED = ['pending_payment','pending_leadsonline','complete'];

function arrivalsBySource() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));

  var custById = {}, emailById = {};
  custs.forEach(function (c) {
    if (!c.customer_id) return;
    custById[c.customer_id] = c;
    emailById[c.customer_id] = String(c.email || '').toLowerCase().trim();
  });

  // ── Earliest attributed Lead Intake row per email (one pass) ──
  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var attrByEmail = {};
  for (var r = 1; r < leadData.length; r++) {
    var em = String(leadData[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em) continue;

    var src   = String(leadData[r][COL.TRAFFIC_SRC] || '').trim();
    var camp  = String(leadData[r][COL.CAMPAIGN]    || '').trim();
    var cont  = String(leadData[r][COL.AD_CONTENT]  || '').trim();
    var ref   = String(leadData[r][COL.REF]         || '').trim();
    var fbclid= String(leadData[r][COL.FBCLID]      || '').trim();
    var gclid = String(leadData[r][COL.GCLID]       || '').trim();
    var vari  = String(leadData[r][COL.VARIANT]     || '').trim().toUpperCase();
    if (!src && !camp && !cont && !ref && !fbclid && !gclid && !vari) continue;

    var ts = leadData[r][COL.TIMESTAMP];
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) continue;

    var cur = attrByEmail[em];
    if (cur && cur._ts <= d) {
      // Keep the earliest row, but backfill any field it was missing.
      if (!cur.variant && vari) cur.variant = vari;
      if (!cur.ref && ref) cur.ref = ref;
      if (!cur.content && cont) cur.content = cont;
      continue;
    }
    attrByEmail[em] = { _ts: d, src: src, camp: camp, content: cont, ref: ref,
                        fbclid: fbclid, gclid: gclid, variant: vari,
                        first: Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') };
  }

  // ── Bucket a row into a channel we can actually act on ──
  function channelOf(a) {
    if (!a) return 'Unknown';
    var blob = (a.src + ' ' + a.camp + ' ' + a.content + ' ' + a.ref).toLowerCase();
    if (a.gclid || /google|gads|adwords/.test(blob)) return 'Google';
    if (a.fbclid || /facebook|fb_|ig_|instagram|meta|convert/.test(blob)) return 'Facebook';
    if (/cfd_flyer/.test(blob)) return 'CFD flyer';
    if (a.ref) return 'Ref: ' + a.ref;
    if (a.src) return a.src;
    return 'Direct / unknown';
  }

  // ── Which A/B ad set, where we can tell ──
  function adSetOf(a) {
    if (!a) return '';
    var blob = (a.camp + ' ' + a.content + ' ' + a.ref).toLowerCase();
    if (/convert_a|convert a|conv_a/.test(blob)) return 'convert A';
    if (/convert_b|convert b|conv_b/.test(blob)) return 'convert B';
    return '';
  }

  var rows = [], stats = {};
  ships.forEach(function (s) {
    var arrived = ARR_STAGES.indexOf(String(s.stage || '')) !== -1 ||
                  String(s.received_at || '').trim() !== '';
    if (!arrived) return;

    var cid = String(s.customer_id || '');
    var c = custById[cid] || {};
    var a = attrByEmail[emailById[cid]] || null;
    var channel = channelOf(a);
    var adset = adSetOf(a);
    var purchased = ARR_PURCHASED.indexOf(String(s.stage || '')) !== -1;
    var paid = parseFloat(String(s.purchase_price || '').replace(/[^0-9.]/g, '')) || 0;
    var appr = parseFloat(String(s.appraised_value || '').replace(/[^0-9.]/g, '')) || 0;

    var recv = s.received_at ? String(s.received_at).slice(0, 10) : '';
    var reg  = s.created_at  ? String(s.created_at).slice(0, 10)  : '';

    rows.push([
      channel, adset, a ? (a.variant || '') : '',
      c.name || cid, s.shipment_id, s.stage,
      purchased ? 'BOUGHT' : (s.stage === 'returned' ? 'RETURNED' : 'in progress'),
      paid || '', appr || '',
      String(s.item || '').slice(0, 60),
      reg, recv,
      a ? a.camp : '', a ? a.content : '', a ? a.ref : '',
      a ? a.first : ''
    ]);

    if (!stats[channel]) stats[channel] = { arrived: 0, bought: 0, returned: 0, paid: 0, appraised: 0 };
    var st = stats[channel];
    st.arrived++;
    if (purchased) { st.bought++; st.paid += paid; st.appraised += appr; }
    if (String(s.stage) === 'returned') st.returned++;
  });

  rows.sort(function (a, b) {
    if (a[0] !== b[0]) return String(a[0]).localeCompare(String(b[0]));
    return String(b[11]).localeCompare(String(a[11]));   // newest arrival first
  });

  // ── Write the tab ──
  var headers = ['Channel','Ad set','Variant','Customer','Shipment','Stage','Outcome',
                 'Paid','Appraised','Item','Registered','Arrived',
                 'utm_campaign','utm_content','ref','First seen'];
  var tab = ss.getSheetByName('Arrivals by Source');
  if (!tab) tab = ss.insertSheet('Arrivals by Source');
  tab.clear();
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  tab.getRange(1, 1, 1, headers.length)
     .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  tab.setFrozenRows(1);
  if (rows.length) tab.getRange(2, 1, rows.length, headers.length).setValues(rows);
  tab.getRange(2, 8, Math.max(rows.length, 1), 2).setNumberFormat('$#,##0');
  tab.autoResizeColumns(1, headers.length);

  // ── Summary ──
  Logger.log('═══ ARRIVALS BY SOURCE — ' + rows.length + ' packages ═══');
  Logger.log('');
  Logger.log('CHANNEL              ARRIVED  BOUGHT   BUY%   RETURNED   PAID      MARGIN');
  Object.keys(stats).sort(function (a, b) { return stats[b].arrived - stats[a].arrived; })
    .forEach(function (k) {
      var s = stats[k];
      var buyPct = s.arrived ? Math.round(s.bought / s.arrived * 100) + '%' : '—';
      Logger.log(
        _pad(k, 20) + _padL(s.arrived, 7) + _padL(s.bought, 8) + _padL(buyPct, 7) +
        _padL(s.returned, 10) + _padL('$' + s.paid.toFixed(0), 9) +
        _padL('$' + (s.appraised - s.paid).toFixed(0), 11));
    });
  Logger.log('');
  Logger.log('Written to the "Arrivals by Source" tab.');
  Logger.log('');
  Logger.log('TO GET COST PER ARRIVAL: divide each channel\'s ad spend by its ARRIVED');
  Logger.log('count. That is the number worth optimising — not cost per registration,');
  Logger.log('which counts people who never send anything.');
  return { arrivals: rows.length, channels: Object.keys(stats).length };
}

function _pad(s, n)  { s = String(s); while (s.length < n) s += ' '; return s; }
function _padL(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }


// ═══════════════════════════════════════════════════════════════════════
//  ARRIVALS REPORT — editor-run, logs only          (Sep 23, 2026)
//
//  arrivalsReport(days) / arrivals7(): one line per package RECEIVED in the
//  last N days — customer, shipment, arrival + registration dates, the
//  first-touch channel and ad set (the ROI index + _mkClassify, same
//  attribution the ROI tab uses), whether that registration followed a
//  recovery or re-engagement email, item and estimate. Totals by channel /
//  ad set at the end. Reads only: nothing is written or sent.
// ═══════════════════════════════════════════════════════════════════════

function arrivals7() { return arrivalsReport(7); }

function arrivalsReport(days) {
  days = (parseInt(days, 10) > 0) ? parseInt(days, 10) : 7;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var TZ = 'America/New_York';
  var cutoff = new Date(Date.now() - days * 86400000);
  var toDate = function (v) { if (!v) return null; var d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
  var fmt = function (d) { return d ? Utilities.formatDate(d, TZ, 'MMM d') : '—'; };

  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custById = {};
  sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).forEach(function (c) { if (c.customer_id) custById[c.customer_id] = c; });
  var idx = _roiLoadIndex(ss);

  // Recovery emails: "RECOV:yyyy-mm-dd" stamps in the lead's AUTO_REPLY column.
  var recovByEmail = {};
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  for (var r = 1; r < lead.length; r++) {
    var em = String(lead[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em) continue;
    var y = String(lead[r][COL.AUTO_REPLY] || '');
    if (y.indexOf('RECOV:') === -1) continue;
    var re = /RECOV:(\d{4}-\d{2}-\d{2})/g, m;
    while ((m = re.exec(y)) !== null) {
      var rd = toDate(m[1] + 'T12:00:00');
      if (rd) (recovByEmail[em] = recovByEmail[em] || []).push(rd);
    }
  }

  // Re-engagement emails: stamped on the shipment that held the unused label.
  var reengageByCust = {};
  ships.forEach(function (s) {
    var d = toDate(s.reengage_sent_at);
    if (d && s.customer_id) (reengageByCust[s.customer_id] = reengageByCust[s.customer_id] || []).push(d);
  });

  // Sep 23: win-back campaigns (winback.gs) count as win-back touches too —
  // A is stamped on the shipment, B and C on the customer.
  var winbackByCust = {};
  var addWb = function (cid, d) { if (cid && d) (winbackByCust[cid] = winbackByCust[cid] || []).push(d); };
  ships.forEach(function (s) { addWb(s.customer_id, toDate(s.winback_a_sent_at)); addWb(s.customer_id, toDate(s.winback_a_sms_at)); });
  Object.keys(custById).forEach(function (cid) {
    addWb(cid, toDate(custById[cid].winback_b_sent_at));
    addWb(cid, toDate(custById[cid].winback_c_sent_at));
  });

  var latestBefore = function (list, when) {
    var best = null;
    (list || []).forEach(function (d) { if (when && d < when && (!best || d > best)) best = d; });
    return best;
  };

  var rows = [], byChannel = {};
  ships.forEach(function (s) {
    var recv = toDate(s.received_at);
    if (!recv || recv < cutoff) return;

    var c = custById[s.customer_id] || {};
    var em = String(c.email || '').toLowerCase().trim();
    var attr = em ? idx.attrByEmail[em] : null;
    var cls = attr ? _mkClassify(attr) : { key: 'direct', label: 'Direct / unknown', sub: '', subLabel: '' };
    var adset = cls.subLabel || cls.sub || '';
    var reg = toDate(s.created_at);

    var rec = latestBefore(recovByEmail[em], reg);
    var ree = latestBefore(reengageByCust[s.customer_id], reg);
    var wb  = latestBefore(winbackByCust[s.customer_id], reg);
    var touch = '';
    if (rec && ree) touch = 'recovery ' + fmt(rec) + ' + re-engage ' + fmt(ree);
    else if (rec)   touch = 'after recovery ' + fmt(rec);
    else if (ree)   touch = 'after re-engage ' + fmt(ree);
    if (wb) touch = (touch ? touch + ' + ' : 'after ') + 'win-back ' + fmt(wb);

    rows.push({ channel: cls.label, adset: adset, name: c.name || s.customer_id || '(no name)',
                shp: s.shipment_id, recv: recv, reg: reg, touch: touch,
                item: String(s.item || '').replace(/\s+/g, ' ').slice(0, 34),
                est: String(s.estimate || '').trim() });

    var ch = byChannel[cls.label] = byChannel[cls.label] || { n: 0, winback: 0, sets: {} };
    ch.n++;
    if (touch) ch.winback++;
    var k = adset || '(no ad set)';
    ch.sets[k] = (ch.sets[k] || 0) + 1;
  });

  rows.sort(function (a, b) {
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
    if (a.adset !== b.adset) return String(a.adset).localeCompare(String(b.adset));
    return b.recv - a.recv;
  });

  Logger.log('═══ ARRIVALS — last ' + days + ' days — ' + rows.length + ' package' + (rows.length === 1 ? '' : 's') +
             ' (attribution: ' + idx.source + ') ═══');
  Logger.log('');
  Logger.log(_pad('CUSTOMER', 22) + _pad('SHIPMENT', 9) + _pad('ARRIVED', 8) + _pad('REGISTERED', 11) +
             _pad('CHANNEL / AD SET', 30) + _pad('WIN-BACK', 30) + _pad('ITEM', 35) + 'ESTIMATE');
  if (!rows.length) Logger.log('  (nothing received in this window)');
  rows.forEach(function (x) {
    Logger.log(_pad(String(x.name).slice(0, 21), 22) + _pad(x.shp, 9) + _pad(fmt(x.recv), 8) + _pad(fmt(x.reg), 11) +
               _pad((x.channel + (x.adset ? ' / ' + x.adset : '')).slice(0, 29), 30) +
               _pad(x.touch || '—', 30) + _pad(x.item, 35) + (x.est || '—'));
  });

  Logger.log('');
  Logger.log('═══ TOTALS BY CHANNEL / AD SET ═══');
  Logger.log(_pad('CHANNEL', 30) + _padL('ARRIVED', 8) + _padL('AFTER WIN-BACK', 16));
  Object.keys(byChannel).sort(function (a, b) { return byChannel[b].n - byChannel[a].n; }).forEach(function (k) {
    var ch = byChannel[k];
    Logger.log(_pad(k, 30) + _padL(ch.n, 8) + _padL(ch.winback, 16));
    Object.keys(ch.sets).sort(function (a, b) { return ch.sets[b] - ch.sets[a]; }).forEach(function (sub) {
      Logger.log(_pad('    ' + sub, 30) + _padL(ch.sets[sub], 8));
    });
  });
  Logger.log('');
  Logger.log('Win-back = the registration came after a recovery or re-engagement email to that person.');
  return { days: days, arrivals: rows.length, channels: Object.keys(byChannel).length };
}
