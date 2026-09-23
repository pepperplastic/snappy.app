// ═══════════════════════════════════════════════════════════════════════
//  ESTIMATE TOTALS BY MONTH  (Aug 6)
//
//  Run estimatesByMonth() from the editor. Reads Lead Intake, parses the
//  estimate range on each row, and totals by calendar month.
//
//  WHY THREE NUMBERS PER MONTH:
//  Estimates are RANGES ("$115 – $285"), not single figures. Summing the high
//  end gives the biggest number and is the least defensible; the midpoint is
//  what an honest "we quoted roughly $X" claim rests on. If this is going in a
//  press release, use the MIDPOINT and say "estimated value" — a reporter who
//  asks how you got the number should get an answer that survives the asking.
//
//  ALSO NOTE: an estimate is not a transaction. Roughly 90% never ship. Any
//  public claim should say "provided estimates on" — never "bought" or
//  "paid out" — and purchasedByMonth() below gives the real money figure.
// ═══════════════════════════════════════════════════════════════════════

function _findCol(headers, candidates) {
  for (var c = 0; c < candidates.length; c++) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).toLowerCase().trim() === candidates[c]) return i;
    }
  }
  // fall back to a contains-match
  for (var c2 = 0; c2 < candidates.length; c2++) {
    for (var j = 0; j < headers.length; j++) {
      if (String(headers[j]).toLowerCase().indexOf(candidates[c2]) !== -1) return j;
    }
  }
  return -1;
}

// "$115 – $285" → {low:115, high:285}.  "$800" → {low:800, high:800}
function _parseEstimate(raw) {
  var s = String(raw || '');
  if (!s) return null;
  var nums = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  var vals = nums.map(parseFloat).filter(function (n) { return !isNaN(n) && n > 0; });
  if (!vals.length) return null;
  return { low: Math.min.apply(null, vals), high: Math.max.apply(null, vals) };
}

function _monthKey(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function estimatesByMonth() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.LEADS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var iTs  = _findCol(headers, ['timestamp', 'date', 'created']);
  var iEm  = _findCol(headers, ['email']);
  var iEst = _findCol(headers, ['estimate', 'quote', 'range']);

  Logger.log('Columns → timestamp:' + iTs + ' (' + headers[iTs] + ')  email:' + iEm +
             ' (' + headers[iEm] + ')  estimate:' + iEst + ' (' + headers[iEst] + ')');
  if (iTs < 0 || iEst < 0) { Logger.log('!! Could not find required columns'); return; }

  var months = {};
  var skippedNoEstimate = 0, skippedNoDate = 0;

  for (var r = 1; r < data.length; r++) {
    var ts = data[r][iTs];
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) { skippedNoDate++; continue; }

    var est = _parseEstimate(data[r][iEst]);
    if (!est) { skippedNoEstimate++; continue; }

    var k = _monthKey(d);
    if (!months[k]) months[k] = { n: 0, low: 0, high: 0, emails: {} };
    var m = months[k];
    m.n++;
    m.low  += est.low;
    m.high += est.high;
    var em = String(data[r][iEm] || '').toLowerCase().trim();
    if (em) m.emails[em] = true;
  }

  var keys = Object.keys(months).sort();
  Logger.log('');
  Logger.log('═══ ESTIMATES BY MONTH (Lead Intake) ═══');
  Logger.log('month     estimates  people    sum(low)      sum(mid)      sum(high)');
  keys.forEach(function (k) {
    var m = months[k];
    var mid = (m.low + m.high) / 2;
    var people = Object.keys(m.emails).length;
    Logger.log(
      k + '   ' +
      _estPad(m.n, 9) + '  ' + _estPad(people, 7) + '  ' +
      _estPad(_usd(m.low), 12) + '  ' + _estPad(_usd(mid), 12) + '  ' + _estPad(_usd(m.high), 12)
    );
  });
  Logger.log('');
  Logger.log('rows with no parsable estimate: ' + skippedNoEstimate + ' · unusable date: ' + skippedNoDate);
  return months;
}

// The number that actually matters — what you PAID, not what you quoted.
function purchasedByMonth() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var data = ss.getSheetByName(TAB.SHIPMENTS).getDataRange().getValues();
  var h = data[0];
  var iPrice = h.indexOf('purchase_price');
  var iPaid  = h.indexOf('paid_at');
  var iRecv  = h.indexOf('received_at');
  var iItem  = h.indexOf('item');
  var iCust  = h.indexOf('customer_id');

  var months = {}, ringCount = 0, ringWords = /\bengagement ring|wedding (?:band|ring)\b/i;
  for (var r = 1; r < data.length; r++) {
    var price = parseFloat(data[r][iPrice]);
    if (isNaN(price) || price <= 0) continue;
    var when = data[r][iPaid] || data[r][iRecv];
    var d = when instanceof Date ? when : new Date(when);
    if (isNaN(d.getTime())) continue;
    var k = _monthKey(d);
    if (!months[k]) months[k] = { n: 0, total: 0, custs: {} };
    months[k].n++;
    months[k].total += price;
    if (data[r][iCust]) months[k].custs[data[r][iCust]] = true;
    if (ringWords.test(String(data[r][iItem] || ''))) ringCount++;
  }

  Logger.log('');
  Logger.log('═══ ACTUALLY PURCHASED BY MONTH ═══');
  Logger.log('month     items    sellers   paid out');
  Object.keys(months).sort().forEach(function (k) {
    var m = months[k];
    Logger.log(k + '   ' + _estPad(m.n, 7) + '  ' + _estPad(Object.keys(m.custs).length, 8) + '  ' + _usd(m.total));
  });
  Logger.log('');
  Logger.log('items whose description mentions an engagement/wedding ring: ' + ringCount);
  Logger.log('(if that number is small, it is an anecdote — not a trend to publish)');
  return months;
}

function _usd(n) {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function _estPad(v, w) {
  var s = String(v);
  while (s.length < w) s = ' ' + s;
  return s;
}
