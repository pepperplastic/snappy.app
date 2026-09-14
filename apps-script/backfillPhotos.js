// ═══════════════════════════════════════════════════════════
// backfillPhotosToTab — run once
// Reads Drive URLs from Lead Intake col W, matches to
// shipments via email→customer_id, writes to Photos tab
// ═══════════════════════════════════════════════════════════

function backfillPhotosToTab() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var leadsSheet   = ss.getSheetByName('Lead Intake');
  var custSheet    = ss.getSheetByName('Customers');
  var shipSheet    = ss.getSheetByName('Shipments');
  var photosSheet  = ss.getSheetByName('Photos');

  // ── Build email → customer_id map ──
  var custData    = custSheet.getDataRange().getValues();
  var custHeaders = custData[0];
  var custEmailCol = custHeaders.indexOf('email');
  var custIdCol    = custHeaders.indexOf('customer_id');
  var emailToCustId = {};
  for (var i = 1; i < custData.length; i++) {
    var email = String(custData[i][custEmailCol] || '').toLowerCase().trim();
    if (email) emailToCustId[email] = custData[i][custIdCol];
  }

  // ── Build customer_id → most recent shipment_id ──
  var shipData    = shipSheet.getDataRange().getValues();
  var shipHeaders = shipData[0];
  var shipIdCol   = shipHeaders.indexOf('shipment_id');
  var shipCustCol = shipHeaders.indexOf('customer_id');
  var shipDateCol = shipHeaders.indexOf('created_at');
  var custIdToShipId = {};
  for (var i = 1; i < shipData.length; i++) {
    var cid   = shipData[i][shipCustCol];
    var sid   = shipData[i][shipIdCol];
    var stage = String(shipData[i][shipHeaders.indexOf('stage')] || '');
    if (!cid || !sid) continue;
    // Prefer non-estimate_only shipments, else take any
    if (!custIdToShipId[cid]) {
      custIdToShipId[cid] = sid;
    } else if (stage !== 'estimate_only') {
      custIdToShipId[cid] = sid;
    }
  }

  // ── Get existing photo URLs to avoid dupes ──
  var existingPhotos = photosSheet.getDataRange().getValues();
  var existingUrls   = new Set();
  for (var i = 1; i < existingPhotos.length; i++) {
    existingUrls.add(String(existingPhotos[i][2] || '').trim()); // drive_url is col index 2
  }

  // ── Read Lead Intake ──
  var leadsData = leadsSheet.getDataRange().getValues();
  // COL indices from Code.gs:
  var EMAIL_COL = 3;  // D
  var PHOTO_COL = 22; // W
  var TS_COL    = 0;  // A

  var added = 0, skipped = 0, noMatch = 0;
  var rows  = [];

  for (var i = 1; i < leadsData.length; i++) {
    var photoUrl = String(leadsData[i][PHOTO_COL] || '').trim();
    if (!photoUrl || photoUrl.indexOf('drive.google.com') === -1) { skipped++; continue; }
    if (existingUrls.has(photoUrl)) { skipped++; continue; }

    var email  = String(leadsData[i][EMAIL_COL] || '').toLowerCase().trim();
    var custId = emailToCustId[email];
    if (!custId) { noMatch++; Logger.log('NO CUSTOMER: ' + email); continue; }

    var shipId = custIdToShipId[custId];
    if (!shipId) { noMatch++; Logger.log('NO SHIPMENT: ' + email + ' (' + custId + ')'); continue; }

    var ts = leadsData[i][TS_COL];
    var tsStr = ts instanceof Date ? ts.toISOString() : (ts ? new Date(ts).toISOString() : new Date().toISOString());

    rows.push([
      '', // photo_id — will fill after
      shipId,
      photoUrl,
      tsStr,
      'lead_intake'
    ]);
    existingUrls.add(photoUrl);
    added++;
  }

  // ── Assign photo IDs and write to sheet ──
  if (rows.length > 0) {
    var lastPhotoRow = photosSheet.getLastRow();
    var existingIds  = lastPhotoRow > 1
      ? photosSheet.getRange(2, 1, lastPhotoRow - 1, 1).getValues().flat()
          .map(function(v) { return parseInt(String(v).replace('PHO-', ''), 10) || 0; })
      : [0];
    var maxId = Math.max.apply(null, existingIds);

    for (var i = 0; i < rows.length; i++) {
      maxId++;
      rows[i][0] = 'PHO-' + String(maxId).padStart(3, '0');
    }

    photosSheet.getRange(lastPhotoRow + 1, 1, rows.length, 5).setValues(rows);
  }

  Logger.log('=== BACKFILL COMPLETE ===');
  Logger.log('Added: ' + added + ' | Skipped: ' + skipped + ' | No match: ' + noMatch);
  SpreadsheetApp.getUi().alert('Done! Added: ' + added + ', Skipped: ' + skipped + ', No match: ' + noMatch);
}
