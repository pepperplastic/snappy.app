// ═══════════════════════════════════════════════════════════════════════
//  diagMyTests.gs — how many registrations are DW's own tests? Read-only.
//  Run diagMyTests(). Flags a registration when ANY of these match:
//    • email matches MY_EMAIL_PATTERNS (add your aliases below)
//    • phone matches MY_PHONES
//    • customer name matches MY_NAMES
//    • its IP is one that a known test email also used (derived, not typed)
//  Reports totals, the Direct share, arrivals/purchases among them (so we
//  know how much they distort the funnel), and the list.
// ═══════════════════════════════════════════════════════════════════════
var MY_EMAIL_PATTERNS = [/davidisaacweiss/i, /dweiss/i, /pepperplastic/i, /@snappy\.gold$/i, /@dw5\.llc/i, /^test/i, /\+test/i, /parnasa/i, /beachedgold/i];
var MY_PHONES = ['5617026269'];
var MY_NAMES  = [/^david\s+(isaac\s+)?weiss$/i, /^test\b/i, /^dw\b/i];

function diagMyTests() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var custs = getCustomers();
  var custByEmail = {}; custs.forEach(function (c) { var e = String(c.email || '').toLowerCase().trim(); if (e) custByEmail[e] = c; });
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var ARR = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var PUR = ['complete','pending_payment','pending_leadsonline'];
  var arrivedBy = {}, boughtBy = {};
  ships.forEach(function (s) {
    var st = String(s.stage || '').toLowerCase();
    if (ARR.indexOf(st) !== -1 || String(s.received_at || '').trim()) arrivedBy[s.customer_id] = true;
    if (PUR.indexOf(st) !== -1) boughtBy[s.customer_id] = true;
  });
  var idx = _roiLoadIndex(ss);
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var ipsByEmail = {};
  for (var r = 1; r < lead.length; r++) {
    var em = String(lead[r][COL.EMAIL] || '').toLowerCase().trim(); var ip = String(lead[r][COL.IP] || '').trim();
    if (em && ip) (ipsByEmail[em] = ipsByEmail[em] || {})[ip] = true;
  }
  var norm = function (p) { return String(p || '').replace(/\D/g, '').slice(-10); };
  var isMineDirect = function (em) {
    var c = custByEmail[em] || {};
    if (MY_EMAIL_PATTERNS.some(function (re) { return re.test(em); })) return 'email';
    if (MY_PHONES.indexOf(norm(c.phone)) !== -1) return 'phone';
    if (MY_NAMES.some(function (re) { return re.test(String(c.name || '').trim()); })) return 'name';
    return null;
  };
  // Pass 1: direct identifiers → collect their IPs
  var mine = {}, myIps = {};
  Object.keys(idx.regByEmail).forEach(function (em) {
    var why = isMineDirect(em);
    if (why) { mine[em] = why; Object.keys(ipsByEmail[em] || {}).forEach(function (ip) { myIps[ip] = true; }); }
  });
  // Pass 2: anyone else who registered from one of those IPs
  Object.keys(idx.regByEmail).forEach(function (em) {
    if (mine[em]) return;
    var ips = Object.keys(ipsByEmail[em] || {});
    if (ips.some(function (ip) { return myIps[ip]; })) mine[em] = 'shared IP with a known test';
  });
  var all = Object.keys(idx.regByEmail).length, n = 0, direct = 0, directMine = 0, arrived = 0, bought = 0, byWhy = {};
  var rows = [];
  Object.keys(idx.regByEmail).forEach(function (em) {
    var cls = _mkClassify(idx.attrByEmail[em] || {});
    var isDirect = cls.key === 'direct';
    if (isDirect) direct++;
    if (!mine[em]) return;
    n++; if (isDirect) directMine++;
    byWhy[mine[em]] = (byWhy[mine[em]] || 0) + 1;
    var c = custByEmail[em] || {};
    if (arrivedBy[c.customer_id]) arrived++;
    if (boughtBy[c.customer_id]) bought++;
    rows.push({ em: em, why: mine[em], chan: cls.key, reg: idx.regByEmail[em].toISOString().slice(0, 10), name: c.name || '', arrived: !!arrivedBy[c.customer_id], bought: !!boughtBy[c.customer_id] });
  });
  Logger.log('═══ MY TEST REGISTRATIONS ═══');
  Logger.log('  flagged ' + n + ' of ' + all + ' registrations · ' + directMine + ' of the ' + direct + ' Direct ones (' + Math.round(100 * directMine / Math.max(direct, 1)) + '%)');
  Logger.log('  of the flagged: ' + arrived + ' arrived, ' + bought + ' purchased  ← these are inflating the funnel');
  Logger.log('  matched by: ' + Object.keys(byWhy).map(function (k) { return k + ' ' + byWhy[k]; }).join(' · '));
  Logger.log('  distinct test IPs: ' + Object.keys(myIps).length);
  Logger.log('');
  rows.sort(function (a, b) { return a.reg.localeCompare(b.reg); }).forEach(function (x) {
    Logger.log('  ' + x.reg + '  ' + x.em + '  ' + (x.name ? '(' + x.name + ') ' : '') + '· ' + x.chan + ' · ' + x.why + (x.arrived ? ' · ARRIVED' : '') + (x.bought ? ' · BOUGHT' : ''));
  });
  Logger.log('');
  Logger.log('If "shared IP" caught real customers (e.g. someone on your office Wi-Fi), tell Claude which; otherwise the next');
  Logger.log('step is a TEST_EMAILS exclusion list in marketing.gs so the ROI/Marketing tabs ignore these entirely.');
}
