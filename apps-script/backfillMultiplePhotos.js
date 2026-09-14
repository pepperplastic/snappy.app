// ═══════════════════════════════════════════════
// backfillMultiplePhotos — run once
// Fixes backfill to capture ALL photo URLs per
// shipment, not just the last one per session
// ═══════════════════════════════════════════════

function backfillMultiplePhotos() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var leadsSheet  = ss.getSheetByName('Lead Intake');
  var custSheet   = ss.getSheetByName('Customers');
  var shipSheet   = ss.getSheetByName('Shipments');
  var photosSheet = ss.getSheetByName('Photos');

  // Build email → customer_id map
  var custData    = custSheet.getDataRange().getValues();
  var custHeaders = custData[0];
  var custEmailCol = custHeaders.indexOf('email');
  var custIdCol    = custHeaders.indexOf('customer_id');
  var emailToCustId = {};
  for (var i = 1; i < custData.length; i++) {
    var email = String(custData[i][custEmailCol] || '').toLowerCase().trim();
    if (email) emailToCustId[email] = custData[i][custIdCol];
  }

  // Build customer_id → shipment_id(s) map
  var shipData    = shipSheet.getDataRange().getValues();
  var shipHeaders = shipData[0];
  var shipIdCol   = shipHeaders.indexOf('shipment_id');
  var shipCustCol = shipHeaders.indexOf('customer_id');
  var custIdToShipIds = {};
  for (var i = 1; i < shipData.length; i++) {
    var cid = String(shipData[i][shipCustCol] || '').trim();
    var sid = String(shipData[i][shipIdCol] || '').trim();
    if (!cid || !sid) continue;
    if (!custIdToShipIds[cid]) custIdToShipIds[cid] = [];
    custIdToShipIds[cid].push(sid);
  }

  // Get existing photo URLs to avoid dupes
  var existingPhotos = photosSheet.getDataRange().getValues();
  var existingUrls = {};
  for (var i = 1; i < existingPhotos.length; i++) {
    var url = String(existingPhotos[i][2] || '').trim();
    if (url) existingUrls[url] = true;
  }

  // Get next photo ID
  var lastPhotoRow = photosSheet.getLastRow();
  var existingIds = lastPhotoRow > 1
    ? photosSheet.getRange(2, 1, lastPhotoRow - 1, 1).getValues().flat()
        .map(function(v) { return parseInt(String(v).replace('PHO-', ''), 10) || 0; })
    : [0];
  var maxId = Math.max.apply(null, existingIds);

  // Read all Lead Intake rows
  var leadsData = leadsSheet.getDataRange().getValues();
  var EMAIL_COL = 3;  // D
  var PHOTO_COL = 22; // W
  var TS_COL    = 0;  // A

  var added = 0, skipped = 0;
  var rows = [];

  for (var i = 1; i < leadsData.length; i++) {
    var photoUrl = String(leadsData[i][PHOTO_COL] || '').trim();
    if (!photoUrl || photoUrl.indexOf('drive.google.com') === -1) { skipped++; continue; }
    if (existingUrls[photoUrl]) { skipped++; continue; }

    var email  = String(leadsData[i][EMAIL_COL] || '').toLowerCase().trim();
    var custId = emailToCustId[email];
    if (!custId) { skipped++; continue; }

    var shipIds = custIdToShipIds[custId];
    if (!shipIds || shipIds.length === 0) { skipped++; continue; }

    // Use most recent shipment for this customer
    var shipId = shipIds[shipIds.length - 1];

    var ts = leadsData[i][TS_COL];
    var tsStr = ts instanceof Date ? ts.toISOString() : (ts ? new Date(ts).toISOString() : new Date().toISOString());

    maxId++;
    rows.push([
      'PHO-' + String(maxId).padStart(3, '0'),
      shipId,
      photoUrl,
      tsStr,
      'lead_intake'
    ]);
    existingUrls[photoUrl] = true;
    added++;
  }

  if (rows.length > 0) {
    photosSheet.getRange(lastPhotoRow + 1, 1, rows.length, 5).setValues(rows);
  }

  Logger.log('=== BACKFILL COMPLETE ===');
  Logger.log('Added: ' + added + ' | Skipped: ' + skipped);
}
