function diagnoseROI() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var sheet = ss.getSheetByName('Shipments');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var stageIdx    = headers.indexOf('stage');
  var purchaseIdx = headers.indexOf('purchase_price');
  var createdIdx  = headers.indexOf('created_at');
  var itemIdx     = headers.indexOf('item');

  var counts = {};
  var totalPaid = 0;
  var purchases = [];

  for (var i = 1; i < data.length; i++) {
    var stage    = String(data[i][stageIdx]    || '').trim();
    var purchase = parseFloat(String(data[i][purchaseIdx] || '0').replace(/[^0-9.]/g,'')) || 0;
    var created  = String(data[i][createdIdx]  || '');
    var item     = String(data[i][itemIdx]     || '');

    counts[stage] = (counts[stage] || 0) + 1;
    if (stage === 'purchased' && purchase > 0) {
      totalPaid += purchase;
      purchases.push(item + ' — $' + purchase + ' (' + created.substring(0,10) + ')');
    }
  }

  Logger.log('=== STAGE BREAKDOWN ===');
  Object.keys(counts).sort().forEach(function(s) {
    Logger.log(s + ': ' + counts[s]);
  });
  Logger.log('');
  Logger.log('=== PURCHASES ===');
  Logger.log('Total paid out: $' + totalPaid);
  purchases.forEach(function(p) { Logger.log(p); });
}