// ═══════════════════════════════════════════════════════════════════════
//  inventory.gs — what is physically on the shelf, by bin (Sep 28 2026)
//
//  getInventoryByBin: read-only. Everything we're holding that hasn't been
//  sold — any stage, because a bin means the box is here whether it's still
//  being inspected, out for an offer, waiting on a return, or bought and
//  sitting out its 30-day hold.
//
//  A BIN IS THE TEST. A shipment with no bin is not inventory, bought or not:
//  a blank bin on something we own means it was cleared to the refiner.
//
//  SOLD = any Sales row that names the shipment in shipment_ids, whatever its
//  sale_type. A refiner lot with no ids named can't release anything, so its
//  items stay listed until they're linked.
//
//  The FL 538 hold runs from the purchase date (purchased_at, stamped when a
//  shipment reaches pending_payment — see the stampMap in updateShipment).
// ═══════════════════════════════════════════════════════════════════════

var INV_PURCHASED_STAGES = ['pending_payment', 'pending_leadsonline', 'complete'];
// The physical shelf: bins 1..N always render, empty ones included, so a bin
// that should be empty can be seen to be empty. Script Property
// INVENTORY_BIN_COUNT overrides it without a deploy.
var INV_BIN_COUNT = 67;
var INV_HOLD_DAYS = 30;
var INV_ITEM_CHARS = 60;

// The bin column is read off the live header row, never assumed: the schema
// calls it bin_number today, and a rename shouldn't silently empty this tab.
function _invBinColumn(headers) {
  var preferred = ['bin_number', 'bin', 'bin_id', 'bin_no'];
  for (var i = 0; i < preferred.length; i++) {
    if (headers.indexOf(preferred[i]) !== -1) return preferred[i];
  }
  for (var h = 0; h < headers.length; h++) {
    if (/(^|_)bins?(_|$)/i.test(String(headers[h] || ''))) return headers[h];
  }
  return '';
}

function _invBinCount() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty('INVENTORY_BIN_COUNT'), 10);
    if (!isNaN(v) && v > 0 && v <= 500) return v;
  } catch (e) {}
  return INV_BIN_COUNT;
}
// "1", "01" and "Bin 1" are the same shelf. Anything non-numeric keeps its own
// label, uppercased, so A1 and a1 don't split into two bins either.
function _invBinKey(raw) {
  var t = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!t) return '';
  var m = t.match(/^(?:bin\s*)?(\d+)$/i);
  if (m) return String(parseInt(m[1], 10));
  return t.toUpperCase();
}

function _invDate(v) {
  if (v === null || v === undefined || v === '') return null;
  var d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function _invIso(d) { return d ? d.toISOString() : ''; }
function _invDays(from, to) {
  if (!from) return null;
  return Math.floor(((to || new Date()).getTime() - from.getTime()) / 86400000);
}
// Everything after the first " — " is the AI's description, not the item name.
function _invItem(v) {
  var t = String(v || '').replace(/\s+/g, ' ').trim().split(/\s+[—–]\s+/)[0].trim();
  if (t.length <= INV_ITEM_CHARS) return t;
  var cut = t.slice(0, INV_ITEM_CHARS), sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—'"]+$/, '') + '…';
}
// "A1" before "A10" before "B2"; a plain number before a letter.
function _invBinSort(a, b) {
  var ra = String(a).match(/^(\D*)(\d*)/), rb = String(b).match(/^(\D*)(\d*)/);
  var pa = (ra[1] || '').toUpperCase(), pb = (rb[1] || '').toUpperCase();
  if (pa !== pb) return pa < pb ? -1 : 1;
  var na = ra[2] === '' ? null : parseInt(ra[2], 10), nb = rb[2] === '' ? null : parseInt(rb[2], 10);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

function getInventoryByBin() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Sold: every shipment id any Sales row points at ──
  var sold = {};
  try {
    var salesSheet = ss.getSheetByName(TAB.SALES);
    if (salesSheet) {
      sheetToObjects(salesSheet).forEach(function (sale) {
        String(sale.shipment_ids || '').split(',').forEach(function (id) {
          id = id.trim();
          if (id) sold[id] = true;
        });
      });
    }
  } catch (e) { Logger.log('getInventoryByBin: sales read failed — ' + e); }

  var custName = {};
  getCustomers().forEach(function (c) {
    if (c.customer_id) custName[c.customer_id] = String(c.name || '').trim() || String(c.email || '');
  });

  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var headers = shipSheet.getDataRange().getValues()[0];
  var binCol = _invBinColumn(headers);
  if (!binCol) return { success: false, error: 'no bin column found on the Shipments sheet' };

  var now = new Date();
  var bins = {};
  var summary = { owned_count: 0, owned_paid: 0, owned_appraised: 0,
                  unpurchased_count: 0, unpurchased_appraised: 0, ready: 0, hold: 0 };

  sheetToObjects(shipSheet).forEach(function (s) {
    var id = String(s.shipment_id || '');
    if (!id || sold[id]) return;
    var stage = String(s.stage || '').toLowerCase().trim();
    var purchased = INV_PURCHASED_STAGES.indexOf(stage) !== -1;
    var bin = _invBinKey(s[binCol]);
    // A bin means it's on the shelf, whatever the stage; no bin means it isn't
    // here any more.
    if (!bin) return;
    var key = bin;

    var arrived = _invDate(s.received_at);
    var paidDate = purchased ? (_invDate(s.purchased_at) || _invDate(s.paid_at)) : null;
    var holdClears = paidDate ? new Date(paidDate.getTime() + INV_HOLD_DAYS * 86400000) : null;
    var paid = purchased ? (parseFloat(s.purchase_price) || 0) : 0;
    var appraised = parseFloat(s.appraised_value) || 0;
    var ready = !!(purchased && holdClears && holdClears <= now);
    var holdDaysLeft = (purchased && holdClears) ? Math.max(0, Math.ceil((holdClears.getTime() - now.getTime()) / 86400000)) : null;

    (bins[key] = bins[key] || []).push({
      bin: key,
      shipment_id: id,
      customer: custName[s.customer_id] || String(s.customer_id || ''),
      item: _invItem(s.item),
      stage: stage,
      arrived_at: _invIso(arrived),
      days_since_arrival: _invDays(arrived, now),
      purchased: purchased,
      paid: paid,
      appraised: appraised,
      paid_at: _invIso(paidDate),
      hold_clears_on: _invIso(holdClears),
      hold_days_left: holdDaysLeft,
      ready: ready,
      listed_on: String(s.listed_on || '').trim(),
      listed_price: parseFloat(s.listed_price) || 0,
      listed_at: _invIso(_invDate(s.listed_at)),
      listed_url: String(s.listed_url || '').trim(),
    });

    if (purchased) {
      summary.owned_count++; summary.owned_paid += paid; summary.owned_appraised += appraised;
      if (ready) summary.ready++; else summary.hold++;
    } else {
      summary.unpurchased_count++; summary.unpurchased_appraised += appraised;
    }
  });

  var keys = Object.keys(bins).sort(_invBinSort);
  var out = keys.map(function (k) {
    var items = bins[k].sort(function (a, b) {
      if (!a.arrived_at) return 1;
      if (!b.arrived_at) return -1;
      return a.arrived_at < b.arrived_at ? -1 : a.arrived_at > b.arrived_at ? 1 : 0;
    });
    return { bin: k, items: items };
  });

  ['owned_paid', 'owned_appraised', 'unpurchased_appraised'].forEach(function (k) {
    summary[k] = Math.round(summary[k] * 100) / 100;
  });

  // Every shelf, not just the occupied ones — the frontend renders the empties
  // too, and any bin found in the data outside 1..N is appended.
  var count = _invBinCount();
  var universe = [];
  for (var n = 1; n <= count; n++) universe.push(String(n));
  keys.forEach(function (k) { if (universe.indexOf(k) === -1) universe.push(k); });

  return {
    success: true, generated_at: now.toISOString(), hold_days: INV_HOLD_DAYS,
    bin_column: binCol, bin_count: count, all_bins: universe,
    bins: out, summary: summary,
  };
}

function handleGetInventoryByBin(parsed) {
  try { return getInventoryByBin(); }
  catch (e) { return { success: false, error: String(e && e.message || e) }; }
}

// ── Editor check ──
function testInventoryByBin() {
  var r = getInventoryByBin();
  if (!r.success) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('═══ INVENTORY BY BIN (bin column: ' + r.bin_column + ') ═══');
  r.bins.forEach(function (b) {
    var owned = b.items.filter(function (x) { return x.purchased; }).length;
    Logger.log('─ bin ' + b.bin + ' · ' + b.items.length + ' item(s) · ' + owned + ' owned');
    b.items.forEach(function (x) {
      Logger.log('   ' + x.shipment_id + ' · ' + x.customer + ' · ' + x.item + ' · ' + x.stage +
        (x.purchased ? (' · paid $' + x.paid + (x.ready ? ' · READY' : ' · hold ' + x.hold_days_left + 'd')) : '') +
        ' · ' + (x.days_since_arrival === null ? 'no arrival date' : x.days_since_arrival + 'd since arrival'));
    });
  });
  var s = r.summary;
  Logger.log('');
  Logger.log('  owned: ' + s.owned_count + ' · paid $' + s.owned_paid + ' · appraised $' + s.owned_appraised);
  Logger.log('  not yet purchased: ' + s.unpurchased_count + ' · appraised $' + s.unpurchased_appraised);
  Logger.log('  ' + s.ready + ' ready · ' + s.hold + ' on hold');
}


// ═══════════════════════════════════════════════════════════════════════
//  LISTING — where an item is up for sale, at what price, since when.
//  Lives on the shipment row so the Inventory tab needs no second read; the
//  write goes through updateShipment, which maps by header name and mirrors to
//  Postgres. None of these four are in ACTIVITY_FIELDS, so listing something
//  doesn't reorder the Fulfill queue.
// ═══════════════════════════════════════════════════════════════════════
var INV_LISTING_COLS = ['listed_on', 'listed_price', 'listed_at', 'listed_url'];

// Same idempotent header add ensureAllColumns() does, narrowed to these four so
// the action works on a sheet that predates them without a separate migration.
function _invEnsureListingColumns() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.SHIPMENTS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var added = [];
  INV_LISTING_COLS.forEach(function (col) {
    if (headers.indexOf(col) >= 0) return;
    var next = sheet.getLastColumn() + 1;
    sheet.getRange(1, next).setValue(col).setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    added.push(col);
  });
  if (added.length) Logger.log('setListing: added column(s) ' + added.join(', ') + ' to ' + TAB.SHIPMENTS);
  return added;
}

function setListing(parsed) {
  parsed = parsed || {};
  var id = String(parsed.shipment_id || '').trim();
  if (!id) return { success: false, error: 'shipment_id required' };
  _invEnsureListingColumns();

  var where = String(parsed.listed_on || '').trim();
  var updates;
  if (!where) {
    // Unlisting clears all four — a stale price or URL on an unlisted item is
    // worse than none.
    updates = { listed_on: '', listed_price: '', listed_at: '', listed_url: '' };
  } else {
    var price = parseFloat(parsed.listed_price);
    updates = {
      listed_on: where.slice(0, 40),
      listed_price: isNaN(price) ? '' : String(Math.round(price * 100) / 100),
      listed_at: new Date().toISOString(),
      listed_url: String(parsed.listed_url || '').trim().slice(0, 500),
    };
  }
  var ok = updateShipment(id, updates);
  if (ok === false) return { success: false, error: 'shipment ' + id + ' not found' };
  Logger.log('setListing ' + id + ' → ' + (where ? (where + ' $' + updates.listed_price) : 'unlisted'));
  return { success: true, shipment_id: id, listed: !!where, listing: updates };
}

function handleSetListing(parsed) {
  try { return setListing(parsed); }
  catch (e) { return { success: false, error: String(e && e.message || e) }; }
}
