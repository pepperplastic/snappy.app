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


// ═══════════════════════════════════════════════════════════════════════
//  FUNNEL BY STEP — editor-run, logs only                   (Nov 23, 2026)
//
//  funnelByStep(daysBack=30): one line per day.
//    EST   photo_browse rows in Lead Intake (one per estimate generated)
//    GATE  distinct emails on variant_b_gate rows (B-variant email capture)
//    LEAD  people whose first lead form (name + phone) in the window was that day
//  From LEAD on it is a cohort: each person is followed forward to today.
//    SHIP  address on a later Lead Intake row, or a label on their shipment
//    SCAN  carrier scan (tracking_status / inbound_status), or the package arrived
//    ARR   received_at set or a received-or-later stage
//    BUY   pending_payment / pending_leadsonline / complete, or purchased_at / paid_at
//  Then: leads with a phone and no shipping step within 24h — how many got a
//  follow-up (Contact Log out row or RECOV stamp, label sends excluded), and
//  how many later shipped / arrived.
//  Reads only: nothing is written or sent.
// ═══════════════════════════════════════════════════════════════════════

function funnelByStep(daysBack) {
  daysBack = (parseInt(daysBack, 10) > 0) ? parseInt(daysBack, 10) : 30;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var TZ = 'America/New_York';
  var H24 = 86400000;
  var toDate = function (v) { if (!v) return null; var d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
  var dayKey = function (d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; };

  var days = [], byDay = {};
  for (var i = daysBack - 1; i >= 0; i--) {
    var k = dayKey(new Date(Date.now() - i * H24));
    if (byDay[k]) continue;
    days.push(k);
    byDay[k] = { est: 0, estB: 0, gate: {}, gateAnon: 0, lead: 0, ship: 0, scan: 0, arr: 0, buy: 0 };
  }

  // ── Lead Intake: top-of-funnel counts, lead-form people, address + recovery times ──
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var people = {}, addrAt = {}, recovAt = {};
  for (var r = 1; r < lead.length; r++) {
    var row = lead[r];
    var d = toDate(row[COL.TIMESTAMP]);
    if (!d) continue;
    var type = String(row[COL.TYPE] || '').trim();
    var em = String(row[COL.EMAIL] || '').toLowerCase().trim();

    if (em && String(row[COL.ADDRESS] || '').trim()) (addrAt[em] = addrAt[em] || []).push(d);
    var y = String(row[COL.AUTO_REPLY] || ''), re = /RECOV:(\d{4}-\d{2}-\d{2})/g, m;
    while (em && (m = re.exec(y)) !== null) {
      var rd = toDate(m[1] + 'T12:00:00');
      if (rd) (recovAt[em] = recovAt[em] || []).push(rd);
    }

    var D = byDay[dayKey(d)];
    if (!D) continue;
    if (type === 'photo_browse') {
      D.est++;
      if (String(row[COL.VARIANT] || '').trim().toUpperCase() === 'B') D.estB++;
      continue;
    }
    if (type === 'variant_b_gate') { if (em) D.gate[em] = 1; else D.gateAnon++; continue; }

    var name = String(row[COL.NAME] || '').trim();
    var phone = String(row[COL.PHONE] || '').replace(/\D/g, '');
    if (!name || phone.length < 10) continue;
    var key = em || (row[COL.SESSION_ID] ? 'sess:' + row[COL.SESSION_ID] : '');
    if (!key) continue;
    if (!people[key] || d < people[key].at) people[key] = { at: d, day: dayKey(d), email: em };
  }

  // ── Customers / Shipments / Contact Log ──
  var custIdByEmail = {};
  sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).forEach(function (c) {
    var e = String(c.email || '').toLowerCase().trim();
    if (e && c.customer_id && !custIdByEmail[e]) custIdByEmail[e] = c.customer_id;
  });
  var shipsByCust = {};
  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function (s) {
    if (s.customer_id) (shipsByCust[s.customer_id] = shipsByCust[s.customer_id] || []).push(s);
  });
  var touchesByCust = {};
  var clSheet = ss.getSheetByName(TAB.CONTACT_LOG);
  (clSheet ? sheetToObjects(clSheet) : []).forEach(function (c) {
    var t = toDate(c.timestamp);
    if (!t || !c.customer_id) return;
    if (String(c.direction || '').toLowerCase() === 'in') return;
    var kind = String(c.kind || '');
    if (/^label:|^auto:triage|^postlabel:/.test(kind)) return;   // label sends, not lead follow-up
    (touchesByCust[c.customer_id] = touchesByCust[c.customer_id] || [])
      .push({ at: t, what: kind || (String(c.source || 'manual') + ':' + String(c.type || '?')) });
  });

  // ── Follow each lead-form person forward ──
  var statusScans = 0;
  var fu = { n: 0, followed: 0, laterShip: 0, laterShipAfterFu: 0, laterShipNoFu: 0, laterArr: 0, kinds: {} };
  Object.keys(people).forEach(function (key) {
    var p = people[key], D = byDay[p.day];
    D.lead++;
    var cid = p.email ? custIdByEmail[p.email] : null;
    var ships = (cid ? shipsByCust[cid] || [] : []).filter(function (s) {
      var c = toDate(s.created_at), rcv = toDate(s.received_at);
      return (!c || c.getTime() >= p.at.getTime() - 15 * H24) && (!rcv || rcv >= p.at);
    });

    var labelAt = null, scan = false, arr = false, buy = false;
    ships.forEach(function (s) {
      var hasLabel = s.sent_at || s.outbound_tracking || s.easypost_shipment_id || s.shippo_transaction_id;
      if (hasLabel) {
        var la = toDate(s.sent_at) || toDate(s.created_at) || p.at;
        if (!labelAt || la < labelAt) labelAt = la;
      }
      var st = String(s.stage || '');
      var a = String(s.received_at || '').trim() !== '' || ARR_STAGES.indexOf(st) !== -1;
      var stat = /transit|accepted|picked|out_for|delivered|arriv/.test(String(s.inbound_status || s.tracking_status || '').toLowerCase());
      if (stat) statusScans++;
      if (stat || a) scan = true;
      if (a) arr = true;
      if (st !== 'returned' && (ARR_PURCHASED.indexOf(st) !== -1 || s.purchased_at || s.paid_at)) buy = true;
    });

    var shipAt = labelAt;
    (p.email ? addrAt[p.email] || [] : []).forEach(function (t) {
      if (t.getTime() >= p.at.getTime() - 60000 && (!shipAt || t < shipAt)) shipAt = t;
    });

    if (shipAt) D.ship++;
    if (scan) D.scan++;
    if (arr) D.arr++;
    if (buy) D.buy++;

    // Lead with phone, no shipping step within 24h of the lead form.
    if (shipAt && shipAt.getTime() - p.at.getTime() <= H24) return;
    fu.n++;
    var touches = (cid ? touchesByCust[cid] || [] : []).filter(function (t) { return t.at > p.at; });
    (p.email ? recovAt[p.email] || [] : []).forEach(function (t) {
      if (dayKey(t) >= p.day) touches.push({ at: t, what: 'recovery (RECOV stamp)' });
    });
    touches.sort(function (a, b) { return a.at - b.at; });
    var seen = {};
    touches.forEach(function (t) { if (!seen[t.what]) { seen[t.what] = 1; fu.kinds[t.what] = (fu.kinds[t.what] || 0) + 1; } });
    if (touches.length) fu.followed++;
    if (shipAt) {
      fu.laterShip++;
      if (touches.length && touches[0].at < shipAt) fu.laterShipAfterFu++; else fu.laterShipNoFu++;
    }
    if (arr) fu.laterArr++;
  });

  // ── Print ──
  var cols = ['est', 'gate', 'lead', 'ship', 'scan', 'arr', 'buy'];
  var tot = { est: 0, estB: 0, gate: 0, lead: 0, ship: 0, scan: 0, arr: 0, buy: 0 };
  Logger.log('═══ FUNNEL BY STEP — last ' + daysBack + ' days (ET) ═══');
  Logger.log('');
  Logger.log(_pad('DAY', 12) + _padL('EST', 6) + _padL('GATE', 6) + _padL('LEAD', 6) + _padL('SHIP', 6) +
             _padL('SCAN', 6) + _padL('ARR', 6) + _padL('BUY', 6) + _padL('LEAD%', 7) + _padL('SHIP%', 7));
  days.forEach(function (k) {
    var D = byDay[k];
    var v = { est: D.est, gate: Object.keys(D.gate).length + D.gateAnon, lead: D.lead, ship: D.ship, scan: D.scan, arr: D.arr, buy: D.buy };
    tot.estB += D.estB;
    var line = _pad(k, 12);
    cols.forEach(function (c) { tot[c] += v[c]; line += _padL(v[c], 6); });
    Logger.log(line + _padL(pct(v.lead, v.est), 7) + _padL(pct(v.ship, v.lead), 7));
  });
  var tl = _pad('TOTAL', 12);
  cols.forEach(function (c) { tl += _padL(tot[c], 6); });
  Logger.log(tl + _padL(pct(tot.lead, tot.est), 7) + _padL(pct(tot.ship, tot.lead), 7));

  Logger.log('');
  Logger.log('STEP-TO-STEP');
  Logger.log('  Estimate → email gate (B estimates only)  ' + _padL(pct(tot.gate, tot.estB), 5) + '   ' + tot.gate + ' / ' + tot.estB);
  Logger.log('  Estimate → lead form                      ' + _padL(pct(tot.lead, tot.est), 5) + '   ' + tot.lead + ' / ' + tot.est);
  Logger.log('  Lead form → shipping step                 ' + _padL(pct(tot.ship, tot.lead), 5) + '   ' + tot.ship + ' / ' + tot.lead);
  Logger.log('  Shipping step → label scanned             ' + _padL(pct(tot.scan, tot.ship), 5) + '   ' + tot.scan + ' / ' + tot.ship);
  Logger.log('  Label scanned → arrived                   ' + _padL(pct(tot.arr, tot.scan), 5) + '   ' + tot.arr + ' / ' + tot.scan);
  Logger.log('  Arrived → purchased                       ' + _padL(pct(tot.buy, tot.arr), 5) + '   ' + tot.buy + ' / ' + tot.arr);
  Logger.log('  Lead form → purchased (end to end)        ' + _padL(pct(tot.buy, tot.lead), 5));

  Logger.log('');
  Logger.log('LEADS WITH PHONE, NO SHIPPING STEP WITHIN 24H: ' + fu.n);
  Logger.log('  got any follow-up after the lead form      ' + _padL(fu.followed, 5) + '  ' + pct(fu.followed, fu.n));
  Logger.log('  no follow-up at all                        ' + _padL(fu.n - fu.followed, 5) + '  ' + pct(fu.n - fu.followed, fu.n));
  Logger.log('  later completed shipping                   ' + _padL(fu.laterShip, 5) + '  ' + pct(fu.laterShip, fu.n));
  Logger.log('    … after a follow-up                      ' + _padL(fu.laterShipAfterFu, 5));
  Logger.log('    … with no follow-up before it            ' + _padL(fu.laterShipNoFu, 5));
  Logger.log('  later arrived                              ' + _padL(fu.laterArr, 5) + '  ' + pct(fu.laterArr, fu.n));
  var kinds = Object.keys(fu.kinds).sort(function (a, b) { return fu.kinds[b] - fu.kinds[a]; });
  if (kinds.length) {
    Logger.log('  follow-up reached (people per kind):');
    kinds.forEach(function (k) { Logger.log('    ' + _pad(k, 40) + _padL(fu.kinds[k], 5)); });
  }

  Logger.log('');
  Logger.log('Notes: LEAD onward is a cohort by lead-form day, followed to today, so recent days');
  Logger.log('have not had time to ship or arrive. SCAN uses tracking_status / inbound_status where');
  Logger.log('present (' + statusScans + ' shipment(s) had one); otherwise an arrival counts as a scan.');
  return { days: daysBack, totals: tot, noShipLeads: fu };
}


// ═══════════════════════════════════════════════════════════════════════
//  SHIP RATE BY CARRIER — editor-run, logs only             (Nov 23, 2026)
//
//  shipRateByCarrier(daysBack=120): labels issued in the window (sent_at,
//  stamped when the shipment goes outbound_complete), grouped by the carrier
//  the label actually went out on (shipping_service; falls back to
//  shipping_type), then split by what the customer submitted:
//    FedEx has been the preselected option since launch ('label' until
//    Sep 14, 'fedex' after), so shipping_type 'usps' = customer switched,
//    'fedex'/'label' = kept the default, blank = created in the CRM.
//  Per group: labels, immature (< 14 days, left out of ship %), arrived,
//  ship %, median days label → arrival, purchased, buy % (of arrived),
//  avg paid, label cost (shipping_cost when stored, else $14.16 FedEx /
//  $5.89 USPS). Reads only: nothing is written or sent.
// ═══════════════════════════════════════════════════════════════════════

var SRC_FALLBACK_COST = { FedEx: 14.16, USPS: 5.89 };
var SRC_MATURE_DAYS = 14;

function shipRateByCarrier(daysBack) {
  daysBack = (parseInt(daysBack, 10) > 0) ? parseInt(daysBack, 10) : 120;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var D1 = 86400000, now = Date.now();
  var cutoff = new Date(now - daysBack * D1), matureBefore = now - SRC_MATURE_DAYS * D1;
  var toDate = function (v) { if (!v) return null; var d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
  var num = function (v) { return parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0; };
  var pct = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; };
  var money = function (v) { return '$' + v.toFixed(2); };
  var median = function (a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  var carrierOf = function (s) {
    var svc = String(s.shipping_service || '').toLowerCase();
    var t = String(s.shipping_type || '').trim().toLowerCase();
    if (/fedex/.test(svc)) return 'FedEx';   // first: "FedEx Priority" must not match USPS "priority"
    if (/usps|ground ?advantage|priority|first ?class/.test(svc)) return 'USPS';
    if (t === 'kit' || String(s.kit_tracking || '').trim()) return 'Kit / other';
    if (t === 'fedex' || t === 'label') return 'FedEx';
    if (t === 'usps') return 'USPS';
    return 'Kit / other';
  };
  var choiceOf = function (s) {
    var t = String(s.shipping_type || '').trim().toLowerCase();
    if (t === 'usps') return 'picked USPS';
    if (t === 'fedex' || t === 'label') return 'kept FedEx default';
    if (t === 'kit') return 'asked for kit';
    return t ? 'type "' + t + '"' : 'not recorded (CRM)';
  };

  var groups = {}, order = ['FedEx', 'USPS', 'Kit / other'];
  var bucket = function (key) {
    return groups[key] = groups[key] || { labels: 0, young: 0, youngArr: 0, mature: 0, matureArr: 0, arr: 0, days: [],
                                          buy: 0, paid: 0, paidN: 0, cost: 0, costActual: 0, costFallback: 0, costUnknown: 0,
                                          refunded: 0, mismatch: 0 };
  };

  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function (s) {
    var hasLabel = String(s.outbound_tracking || s.easypost_shipment_id || s.shippo_transaction_id || s.kit_tracking || '').trim();
    var issued = toDate(s.sent_at) || (hasLabel ? toDate(s.created_at) : null);
    if (!issued || issued < cutoff || issued.getTime() > now) return;

    var carrier = carrierOf(s), choice = choiceOf(s);
    var st = String(s.stage || '');
    var recv = toDate(s.received_at);
    var arrived = !!recv || ARR_STAGES.indexOf(st) !== -1;
    var bought = st !== 'returned' && (ARR_PURCHASED.indexOf(st) !== -1 || !!s.purchased_at || !!s.paid_at);
    var mature = issued.getTime() <= matureBefore;
    var stored = num(s.shipping_cost);
    var cost = stored > 0 ? stored : (SRC_FALLBACK_COST[carrier] || 0);
    var requested = choice === 'picked USPS' ? 'USPS' : (choice === 'kept FedEx default' ? 'FedEx' : null);

    [carrier, carrier + '|' + choice].forEach(function (key) {
      var g = bucket(key);
      g.labels++;
      if (mature) { g.mature++; if (arrived) g.matureArr++; }
      else { g.young++; if (arrived) g.youngArr++; }
      if (arrived) g.arr++;
      if (arrived && recv && recv >= issued) g.days.push((recv - issued) / D1);
      if (bought) {
        g.buy++;
        var p = num(s.purchase_price);
        if (p > 0) { g.paid += p; g.paidN++; }
      }
      g.cost += cost;
      if (stored > 0) g.costActual++; else if (cost > 0) g.costFallback++; else g.costUnknown++;
      if (String(s.label_refunded_at || '').trim()) g.refunded++;
      if (requested && carrier !== 'Kit / other' && requested !== carrier) g.mismatch++;
    });
  });

  var line = function (label, g) {
    var md = median(g.days);
    return _pad(label, 28) + _padL(g.labels, 7) + _padL(g.young, 6) + _padL(g.matureArr + '/' + g.mature, 9) +
           _padL(pct(g.matureArr, g.mature), 7) + _padL(md == null ? '—' : md.toFixed(1), 7) +
           _padL(g.buy, 5) + _padL(pct(g.buy, g.arr), 6) + _padL(g.paidN ? '$' + Math.round(g.paid / g.paidN) : '—', 9) +
           _padL(g.labels ? money(g.cost / g.labels) : '—', 9) + _padL('$' + Math.round(g.cost), 8);
  };

  Logger.log('═══ SHIP RATE BY CARRIER — labels issued in the last ' + daysBack + ' days ═══');
  Logger.log('');
  Logger.log(_pad('GROUP', 28) + _padL('LABELS', 7) + _padL('<14d', 6) + _padL('ARR/MAT', 9) + _padL('SHIP%', 7) +
             _padL('MED D', 7) + _padL('BUY', 5) + _padL('BUY%', 6) + _padL('AVG PAID', 9) + _padL('AVG COST', 9) + _padL('TOTAL', 8));
  var keys = Object.keys(groups);
  var tops = order.filter(function (k) { return groups[k]; });
  if (!tops.length) Logger.log('  (no labels issued in this window)');
  tops.forEach(function (top) {
    Logger.log(line(top, groups[top]));
    keys.filter(function (k) { return k.indexOf(top + '|') === 0; })
        .sort(function (a, b) { return groups[b].labels - groups[a].labels; })
        .forEach(function (k) { Logger.log(line('  ' + k.split('|')[1], groups[k])); });
  });

  Logger.log('');
  Logger.log('DETAILS');
  tops.forEach(function (top) {
    var g = groups[top];
    Logger.log('  ' + _pad(top, 12) + 'cost: ' + g.costActual + ' from shipping_cost, ' + g.costFallback + ' at fallback rate' +
               (g.costUnknown ? ', ' + g.costUnknown + ' unknown ($0)' : '') +
               ' · refunded labels: ' + g.refunded +
               ' · immature already arrived: ' + g.youngArr + '/' + g.young +
               (g.mismatch ? ' · label carrier ≠ requested: ' + g.mismatch : ''));
  });
  Logger.log('');
  Logger.log('ARR/MAT and SHIP% count only labels at least ' + SRC_MATURE_DAYS + ' days old; <14d shows the rest.');
  Logger.log('MED D = median days from label issued (sent_at) to received_at. BUY% = purchased / all arrived.');
  Logger.log('Choice: FedEx is preselected on the site, so "picked USPS" is an active switch; "kept FedEx');
  Logger.log('default" may include people who clicked FedEx themselves — the site does not record that click.');
  Logger.log('TOTAL is gross label spend; refunded labels are still counted at cost.');
  var out = {};
  keys.forEach(function (k) { var g = groups[k]; out[k] = { labels: g.labels, immature: g.young, mature: g.mature, arrived_mature: g.matureArr, purchased: g.buy, cost: Math.round(g.cost * 100) / 100 }; });
  return { days: daysBack, groups: out };
}
