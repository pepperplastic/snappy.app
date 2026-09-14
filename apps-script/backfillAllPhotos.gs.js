// ═══════════════════════════════════════════════
//  BACKFILL: Write all Lead Intake photos to
//  Photos tab, linked to correct shipment_id
//  Run backfillAllPhotos() once then delete
// ═══════════════════════════════════════════════

function backfillAllPhotos() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadsSheet    = ss.getSheetByName(TAB.LEADS);
  var photosSheet   = ss.getSheetByName(TAB.PHOTOS);
  var custSheet     = ss.getSheetByName(TAB.CUSTOMERS);
  var shipSheet     = ss.getSheetByName(TAB.SHIPMENTS);

  Logger.log('Loading data...');

  var leadsData  = leadsSheet.getDataRange().getValues();
  var custData   = custSheet.getDataRange().getValues();
  var shipData   = shipSheet.getDataRange().getValues();
  var photosData = photosSheet.getDataRange().getValues();

  // ── Build lookup: email → customer_id ──
  var custHeaders = custData[0];
  var custEmailIdx = custHeaders.indexOf('email');
  var custIdIdx    = custHeaders.indexOf('customer_id');
  var emailToCustId = {};
  for (var i = 1; i < custData.length; i++) {
    var em = String(custData[i][custEmailIdx] || '').toLowerCase().trim();
    if (em) emailToCustId[em] = String(custData[i][custIdIdx] || '').trim();
  }
  Logger.log('Customers loaded: ' + Object.keys(emailToCustId).length);

  // ── Build lookup: customer_id → most recent pre-received shipment_id ──
  // Priority: ready_to_fulfill > outbound_complete > outbound_pending > received > others
  var shipHeaders  = shipData[0];
  var shipIdIdx    = shipHeaders.indexOf('shipment_id');
  var shipCustIdx  = shipHeaders.indexOf('customer_id');
  var shipStageIdx = shipHeaders.indexOf('stage');
  var shipCreatedIdx = shipHeaders.indexOf('created_at');

  var STAGE_PRIORITY = {
    'ready_to_fulfill': 10,
    'outbound_pending': 9,
    'outbound_complete': 8,
    'received': 7,
    'inspected': 6,
    'offer_made': 5,
    'purchased': 4,
    'returned': 3,
    'rejected': 2,
    'dead': 1,
    'estimate_only': 0,
  };

  var custIdToShipment = {}; // customer_id → { shipment_id, priority, created_at }
  for (var j = 1; j < shipData.length; j++) {
    var cid   = String(shipData[j][shipCustIdx] || '').trim();
    var sid   = String(shipData[j][shipIdIdx]   || '').trim();
    var stage = String(shipData[j][shipStageIdx]|| '').trim();
    var created = shipData[j][shipCreatedIdx];
    if (!cid || !sid) continue;

    var priority = STAGE_PRIORITY[stage] !== undefined ? STAGE_PRIORITY[stage] : 0;
    var existing = custIdToShipment[cid];
    if (!existing || priority > existing.priority ||
        (priority === existing.priority && created > existing.created_at)) {
      custIdToShipment[cid] = { shipment_id: sid, priority: priority, created_at: created };
    }
  }
  Logger.log('Shipments indexed: ' + Object.keys(custIdToShipment).length);

  // ── Build set of existing photo URLs to avoid duplicates ──
  var photosHeaders = photosData[0] || [];
  var photoUrlIdx   = photosHeaders.indexOf('drive_url');
  var photoShipIdx  = photosHeaders.indexOf('shipment_id');
  var existingPhotos = {}; // "shipment_id|url" → true
  for (var k = 1; k < photosData.length; k++) {
    var purl = String(photosData[k][photoUrlIdx] || '').trim();
    var psid = String(photosData[k][photoShipIdx] || '').trim();
    if (purl && psid) existingPhotos[psid + '|' + purl] = true;
  }
  Logger.log('Existing photo records: ' + Object.keys(existingPhotos).length);

  // ── Get next photo ID ──
  var photoIdIdx = photosHeaders.indexOf('photo_id');
  var maxPhotoNum = 0;
  for (var m = 1; m < photosData.length; m++) {
    var pid = String(photosData[m][photoIdIdx] || '');
    var num = parseInt(pid.replace('PHO-', ''), 10) || 0;
    if (num > maxPhotoNum) maxPhotoNum = num;
  }

  // ── Scan Lead Intake for Drive photo URLs ──
  var newRows = [];
  var skipped = 0, noCustomer = 0, noShipment = 0, alreadyExists = 0;

  for (var r = 1; r < leadsData.length; r++) {
    var photoUrl = String(leadsData[r][COL.PHOTO] || '').trim();
    if (!photoUrl || photoUrl.indexOf('drive.google.com') === -1) { skipped++; continue; }

    var email = String(leadsData[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!email || email.indexOf('@') === -1) {
      // Anonymous row — no email, can't link to a shipment
      skipped++;
      continue;
    }

    var custId = emailToCustId[email];
    if (!custId) { noCustomer++; continue; }

    var shipEntry = custIdToShipment[custId];
    if (!shipEntry) { noShipment++; continue; }

    var shipmentId = shipEntry.shipment_id;
    var key = shipmentId + '|' + photoUrl;
    if (existingPhotos[key]) { alreadyExists++; continue; }

    // New photo to add
    maxPhotoNum++;
    var photoId = 'PHO-' + String(maxPhotoNum).padStart(3, '0');
    var ts = new Date().toISOString();
    newRows.push([photoId, shipmentId, photoUrl, ts, 'backfill']);
    existingPhotos[key] = true; // prevent dupes within this run
  }

  Logger.log('New photos to write: ' + newRows.length);
  Logger.log('Skipped (no photo/anon): ' + skipped);
  Logger.log('No customer found: ' + noCustomer);
  Logger.log('No shipment found: ' + noShipment);
  Logger.log('Already existed: ' + alreadyExists);

  // ── Write in batches of 100 ──
  if (newRows.length > 0) {
    var BATCH = 100;
    for (var b = 0; b < newRows.length; b += BATCH) {
      var batch = newRows.slice(b, b + BATCH);
      photosSheet.getRange(
        photosSheet.getLastRow() + 1, 1, batch.length, batch[0].length
      ).setValues(batch);
      Logger.log('Written batch: rows ' + b + ' to ' + (b + batch.length));
      Utilities.sleep(200);
    }
    Logger.log('Backfill complete. Total added: ' + newRows.length);
  } else {
    Logger.log('Nothing to add — all photos already linked.');
  }
}