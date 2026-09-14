function diagnoseROI2() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var shipSheet  = ss.getSheetByName('Shipments');
  var custSheet  = ss.getSheetByName('Customers');
  var shipData   = shipSheet.getDataRange().getValues();
  var custData   = custSheet.getDataRange().getValues();

  var shipHeaders = shipData[0];
  var stageIdx    = shipHeaders.indexOf('stage');
  var shipTypeIdx = shipHeaders.indexOf('shipping_type');
  var custIdIdx   = shipHeaders.indexOf('customer_id');
  var createdIdx  = shipHeaders.indexOf('created_at');

  var custHeaders  = custData[0];
  var custIdColIdx = custHeaders.indexOf('customer_id');
  var sourceIdx    = custHeaders.indexOf('source');

  // Build customer_id → source lookup
  var custSource = {};
  for (var i = 1; i < custData.length; i++) {
    var cid = String(custData[i][custIdColIdx] || '').trim();
    var src = String(custData[i][sourceIdx]    || '').trim().toLowerCase();
    if (cid) custSource[cid] = src;
  }

  // Buckets
  var results = {
    byShipType: {},
    bySource: {},
    bySourceAndStage: {},
    outboundByType: { kit: 0, label: 0, usps: 0, other: 0 },
    returnedByType:  { kit: 0, label: 0, usps: 0, other: 0 },
    purchasedByType: { kit: 0, label: 0, usps: 0, other: 0 },
    outboundBySrc:   { facebook: 0, google: 0, other: 0 },
    returnedBySrc:   { facebook: 0, google: 0, other: 0 },
    purchasedBySrc:  { facebook: 0, google: 0, other: 0 },
  };

  var OUTBOUND_STAGES  = ['outbound_complete','received','inspected','offer_made','purchased','returned','dead'];
  var RETURNED_STAGES  = ['returned'];
  var PURCHASED_STAGES = ['purchased'];

  for (var j = 1; j < shipData.length; j++) {
    var stage    = String(shipData[j][stageIdx]    || '').trim();
    var shipType = String(shipData[j][shipTypeIdx] || '').trim().toLowerCase() || 'other';
    var cid      = String(shipData[j][custIdIdx]   || '').trim();
    var source   = custSource[cid] || 'other';

    // Normalize source
    var srcBucket = source.indexOf('facebook') !== -1 || source === 'fb' ? 'facebook'
                  : source.indexOf('google')   !== -1 ? 'google'
                  : 'other';

    // Normalize ship type
    var typeBucket = shipType === 'kit' ? 'kit'
                   : shipType === 'label' ? 'label'
                   : shipType === 'usps' ? 'usps'
                   : 'other';

    if (OUTBOUND_STAGES.indexOf(stage) !== -1) {
      results.outboundByType[typeBucket]++;
      results.outboundBySrc[srcBucket]++;
    }
    if (RETURNED_STAGES.indexOf(stage) !== -1) {
      results.returnedByType[typeBucket]++;
      results.returnedBySrc[srcBucket]++;
    }
    if (PURCHASED_STAGES.indexOf(stage) !== -1) {
      results.purchasedByType[typeBucket]++;
      results.purchasedBySrc[srcBucket]++;
    }
  }

  Logger.log('=== OUTBOUND BY SHIPPING TYPE ===');
  Logger.log('Kit:   ' + results.outboundByType.kit   + ' sent | ' + results.purchasedByType.kit   + ' purchased | ' + results.returnedByType.kit   + ' returned');
  Logger.log('Label: ' + results.outboundByType.label + ' sent | ' + results.purchasedByType.label + ' purchased | ' + results.returnedByType.label + ' returned');
  Logger.log('USPS:  ' + results.outboundByType.usps  + ' sent | ' + results.purchasedByType.usps  + ' purchased | ' + results.returnedByType.usps  + ' returned');
  Logger.log('Other: ' + results.outboundByType.other + ' sent | ' + results.purchasedByType.other + ' purchased | ' + results.returnedByType.other + ' returned');

  Logger.log('');
  Logger.log('=== OUTBOUND BY AD SOURCE ===');
  Logger.log('Facebook: ' + results.outboundBySrc.facebook + ' sent | ' + results.purchasedBySrc.facebook + ' purchased | ' + results.returnedBySrc.facebook + ' returned');
  Logger.log('Google:   ' + results.outboundBySrc.google   + ' sent | ' + results.purchasedBySrc.google   + ' purchased | ' + results.returnedBySrc.google   + ' returned');
  Logger.log('Other:    ' + results.outboundBySrc.other    + ' sent | ' + results.purchasedBySrc.other    + ' purchased | ' + results.returnedBySrc.other    + ' returned');

  Logger.log('');
  Logger.log('=== SEND-BACK RATE (returned / outbound) ===');
  var types = ['kit','label','usps'];
  types.forEach(function(t) {
    var ob = results.outboundByType[t];
    var rb = results.returnedByType[t];
    var pb = results.purchasedByType[t];
    var sendBack = ob > 0 ? Math.round((rb+pb)/ob*100) : 0;
    Logger.log(t.toUpperCase() + ': ' + sendBack + '% items returned (' + (rb+pb) + ' of ' + ob + ')');
  });

  var srcs = ['facebook','google','other'];
  Logger.log('');
  srcs.forEach(function(s) {
    var ob = results.outboundBySrc[s];
    var rb = results.returnedBySrc[s];
    var pb = results.purchasedBySrc[s];
    var sendBack = ob > 0 ? Math.round((rb+pb)/ob*100) : 0;
    Logger.log(s.toUpperCase() + ': ' + sendBack + '% items returned (' + (rb+pb) + ' of ' + ob + ')');
  });
}
