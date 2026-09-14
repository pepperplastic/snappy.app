function checkSources() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var custSheet = ss.getSheetByName('Customers');
  var custData  = custSheet.getDataRange().getValues();
  var headers   = custData[0];
  var sourceIdx = headers.indexOf('source');
 
  var counts = {};
  for (var i = 1; i < custData.length; i++) {
    var src = String(custData[i][sourceIdx] || '(blank)').trim();
    counts[src] = (counts[src] || 0) + 1;
  }
 
  Logger.log('=== ALL SOURCE VALUES IN CUSTOMERS TAB ===');
  Object.keys(counts).sort().forEach(function(s) {
    Logger.log('"' + s + '": ' + counts[s]);
  });
}
 