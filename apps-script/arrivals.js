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
