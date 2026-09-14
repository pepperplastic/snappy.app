// ═══════════════════════════════════════════════
//  BATCH USPS LABEL RUNNER
//  Processes all ready_to_fulfill USPS shipments
//  Generates pay-on-use return labels via Shippo
//  and emails each customer their label PDF
// ═══════════════════════════════════════════════

function batchUSPSLabels() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var shipSheet = ss.getSheetByName('Shipments');
  var custSheet = ss.getSheetByName('Customers');

  var shipData = sheetToObjects(shipSheet);
  var custData = sheetToObjects(custSheet);

  // Build customer lookup by ID
  var custById = {};
  custData.forEach(function(c) { custById[c.customer_id] = c; });

  // Find all ready_to_fulfill USPS shipments
  var pending = shipData.filter(function(s) {
    return s.stage === 'ready_to_fulfill' &&
           normalizeShipType(s.shipping_type) === 'usps';
  });

  Logger.log('=== BATCH USPS LABELS ===');
  Logger.log('Found ' + pending.length + ' USPS shipments to process');
  Logger.log('');

  var success = 0, failed = 0, skipped = 0;

  pending.forEach(function(s, i) {
    var c = custById[s.customer_id] || {};

    // Skip if no address
    if (!c.address || !c.email) {
      Logger.log('[' + (i+1) + '] SKIP ' + s.shipment_id + ' — missing address or email (' + (c.email||'no email') + ')');
      skipped++;
      return;
    }

    // Skip if already has outbound tracking
    if (s.outbound_tracking && String(s.outbound_tracking).trim()) {
      Logger.log('[' + (i+1) + '] SKIP ' + s.shipment_id + ' — already has tracking: ' + s.outbound_tracking);
      skipped++;
      return;
    }

    Logger.log('[' + (i+1) + '] Processing ' + s.shipment_id + ' — ' + (c.name||'unknown') + ' <' + c.email + '>');

    try {
      var result = generateShippoUSPSLabel(
        s.customer_id,
        s.shipment_id,
        c.address,
        c.name || '',
        c.email,
        c.phone || '',
        s.item || ''
      );

      if (result.success) {
        Logger.log('    ✓ Label sent — tracking: ' + result.tracking);
        success++;
      } else {
        Logger.log('    ✗ FAILED — ' + result.error);
        failed++;
      }
    } catch(e) {
      Logger.log('    ✗ ERROR — ' + e.toString());
      failed++;
    }

    // Throttle — wait 2 seconds between labels to avoid rate limits
    if (i < pending.length - 1) Utilities.sleep(2000);
  });

  Logger.log('');
  Logger.log('=== DONE ===');
  Logger.log('Success: ' + success);
  Logger.log('Failed:  ' + failed);
  Logger.log('Skipped: ' + skipped);
  Logger.log('Total:   ' + pending.length);
}

// ── Dry run — shows what would be processed without sending anything ──
function batchUSPSLabelsDryRun() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var shipSheet = ss.getSheetByName('Shipments');
  var custSheet = ss.getSheetByName('Customers');

  var shipData = sheetToObjects(shipSheet);
  var custData = sheetToObjects(custSheet);

  var custById = {};
  custData.forEach(function(c) { custById[c.customer_id] = c; });

  var pending = shipData.filter(function(s) {
    return s.stage === 'ready_to_fulfill' &&
           normalizeShipType(s.shipping_type) === 'usps';
  });

  Logger.log('=== DRY RUN — USPS BATCH ===');
  Logger.log('Found ' + pending.length + ' USPS shipments');
  Logger.log('');

  pending.forEach(function(s, i) {
    var c = custById[s.customer_id] || {};
    var hasAddress = !!(c.address && c.email);
    var hasTracking = !!(s.outbound_tracking && String(s.outbound_tracking).trim());
    var status = hasTracking ? 'SKIP (has tracking)' : !hasAddress ? 'SKIP (no address/email)' : 'WOULD SEND';
    Logger.log((i+1) + '. [' + status + '] ' + s.shipment_id + ' | ' + (c.name||'unknown') + ' | ' + (c.email||'no email') + ' | ' + (s.item||'no item'));
    if (hasAddress && !hasTracking) {
      Logger.log('   Address: ' + c.address);
    }
  });
}
