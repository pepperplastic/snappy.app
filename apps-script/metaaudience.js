// ═══════════════════════════════════════════════════════════════════════
//  META VALUE-BASED CUSTOM AUDIENCE EXPORT                  (Sep 3, 2026)
//
//  Builds the seed list for a lookalike audience, in Meta's upload format.
//
//  WHO'S IN IT: everyone whose package ACTUALLY ARRIVED — not everyone who
//  registered. That distinction is the whole point. Every audience run so far
//  was optimized toward people who fill in a form, and ~89% of those never
//  ship. Seeding on arrivals asks Meta to find people who resemble SHIPPERS.
//
//  VALUE: what we paid them. Meta weights the lookalike toward the high-value
//  end, so it hunts for people like your best sellers rather than your average
//  one. Arrivals that didn't convert are still included at value 0 — they
//  cleared the hard step (mailing gold to a stranger) and that behaviour is
//  what we want more of.
//
//  Run:  exportMetaAudience()      → writes a CSV to Drive, logs the link
//        previewMetaAudience()     → counts only, writes nothing
//
//  Meta hashes everything client-side at upload; do NOT pre-hash. Upload at
//  Ads Manager → Audiences → Create → Customer list, and tick "include
//  customer value".
// ═══════════════════════════════════════════════════════════════════════

// Stages that mean the package physically reached us.
var META_ARRIVED_STAGES = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];

var META_AUDIENCE_HEADERS = ['email','phone','fn','ln','zip','ct','st','country','value'];

function previewMetaAudience() { return _metaAudienceCore(true); }
function exportMetaAudience()  { return _metaAudienceCore(false); }

function _metaAudienceCore(previewOnly) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));

  var custById = {};
  custs.forEach(function (c) { if (c.customer_id) custById[c.customer_id] = c; });

  // ── Roll shipments up per customer: did anything arrive, and what did we pay? ──
  var byCust = {};
  ships.forEach(function (s) {
    var arrived = META_ARRIVED_STAGES.indexOf(String(s.stage || '')) !== -1 ||
                  String(s.received_at || '').trim() !== '';
    if (!arrived) return;
    var cid = String(s.customer_id || '');
    if (!cid) return;
    if (!byCust[cid]) byCust[cid] = { value: 0, arrivals: 0 };
    byCust[cid].arrivals++;
    // Sum across shipments — a repeat seller's value is their lifetime total,
    // which is exactly the signal we want weighted heaviest.
    var paid = parseFloat(String(s.purchase_price || '').replace(/[^0-9.]/g, '')) || 0;
    byCust[cid].value += paid;
  });

  var rows = [], skippedNoContact = 0, buyers = 0, nonBuyers = 0, totalValue = 0;

  Object.keys(byCust).forEach(function (cid) {
    var c = custById[cid];
    if (!c) { skippedNoContact++; return; }

    var email = String(c.email || '').toLowerCase().trim();
    var phone = _metaPhone(c.phone);
    // Meta needs at least one strong identifier to match on.
    if ((!email || email.indexOf('@') < 0) && !phone) { skippedNoContact++; return; }

    var nameParts = String(c.name || '').trim().split(/\s+/);
    var fn = nameParts[0] || '';
    var ln = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

    var addr = _metaAddressParts(c.address);
    var v = byCust[cid].value;
    if (v > 0) buyers++; else nonBuyers++;
    totalValue += v;

    rows.push([
      email,
      phone,
      _metaClean(fn),
      _metaClean(ln),
      addr.zip,
      _metaClean(addr.city),
      addr.state,
      'US',
      v.toFixed(2)
    ]);
  });

  // Highest value first — makes the file easy to eyeball for sanity.
  rows.sort(function (a, b) { return parseFloat(b[8]) - parseFloat(a[8]); });

  Logger.log('═══ META VALUE-BASED AUDIENCE ═══');
  Logger.log('Customers with an ARRIVED package: ' + Object.keys(byCust).length);
  Logger.log('  → usable rows (have email or phone): ' + rows.length);
  Logger.log('  → skipped, no contact info: ' + skippedNoContact);
  Logger.log('');
  Logger.log('  bought (value > 0): ' + buyers);
  Logger.log('  arrived but declined (value 0): ' + nonBuyers +
             '  ← kept deliberately; they still did the hard part');
  Logger.log('  total value: $' + totalValue.toFixed(2));
  if (rows.length) {
    Logger.log('  top value in file: $' + rows[0][8] + '   median-ish: $' + rows[Math.floor(rows.length/2)][8]);
  }
  Logger.log('');
  if (rows.length < 100) {
    Logger.log('⚠ Meta wants 100+ matched people for a lookalike, and match rates run');
    Logger.log('  70–90%, so ' + rows.length + ' rows may land short. If it rejects the');
    Logger.log('  audience, widen META_ARRIVED_STAGES to include outbound_complete');
    Logger.log('  (label issued) — weaker signal, bigger seed.');
    Logger.log('');
  }

  if (previewOnly) {
    Logger.log('PREVIEW ONLY — no file written. Run exportMetaAudience() to create the CSV.');
    return { rows: rows.length, buyers: buyers, nonBuyers: nonBuyers };
  }

  // ── Write the CSV ──
  var csv = META_AUDIENCE_HEADERS.join(',') + '\n';
  rows.forEach(function (r) { csv += r.map(_csvCell).join(',') + '\n'; });

  var stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var name = 'snappy-meta-audience-arrived-' + stamp + '.csv';
  var file = DriveApp.createFile(name, csv, MimeType.CSV);

  Logger.log('✅ Wrote ' + rows.length + ' rows → ' + name);
  Logger.log(file.getUrl());
  Logger.log('');
  Logger.log('UPLOAD: Ads Manager → Audiences → Create audience → Custom audience');
  Logger.log('  → Customer list → upload this file → TICK "include customer value"');
  Logger.log('  → map value to the "value" column. Do NOT pre-hash; Meta hashes on upload.');
  Logger.log('THEN: Create lookalike → source = this audience → US → start at 1%.');

  return { rows: rows.length, url: file.getUrl() };
}

// Meta wants E.164-ish. Strip everything, prepend country code.
function _metaPhone(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '1' + d;
  if (d.length === 11 && d.charAt(0) === '1') return d;
  return '';   // anything else is unreliable — better blank than wrong
}

function _metaClean(v) {
  return String(v || '').toLowerCase().replace(/[^a-z\u00C0-\u024F\s'-]/g, '').trim();
}

// Addresses are stored as one free-text string; reuse the label parser so we
// get the same city/state/zip the shipping code derives.
function _metaAddressParts(address) {
  try {
    var p = _parseUsAddress(address);
    return {
      zip: String(p.zip || '').slice(0, 5),
      city: p.city || '',
      state: String(p.state || '').toUpperCase()
    };
  } catch (e) {
    return { zip: '', city: '', state: '' };
  }
}

function _csvCell(v) {
  var s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
