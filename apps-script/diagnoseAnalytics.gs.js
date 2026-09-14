function diagnoseAnalytics() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var leadsSheet = ss.getSheetByName('Lead Intake');
  var shipSheet  = ss.getSheetByName('Shipments');
  var custSheet  = ss.getSheetByName('Customers');

  var leadsData = leadsSheet.getDataRange().getValues();
  var shipData  = shipSheet.getDataRange().getValues();
  var custData  = custSheet.getDataRange().getValues();

  var shipHeaders = shipData[0];
  var stageIdx    = shipHeaders.indexOf('stage');
  var shipTypeIdx = shipHeaders.indexOf('shipping_type');
  var custIdIdx   = shipHeaders.indexOf('customer_id');
  var purchaseIdx = shipHeaders.indexOf('purchase_price');
  var estimateIdx = shipHeaders.indexOf('estimate');

  var custHeaders     = custData[0];
  var custIdColIdx    = custHeaders.indexOf('customer_id');
  var custSourceIdx   = custHeaders.indexOf('source');
  var custEmailIdx    = custHeaders.indexOf('email');

  // Build customer_id → source lookup
  var custSource = {};
  var custEmail  = {};
  for (var i = 1; i < custData.length; i++) {
    var cid = String(custData[i][custIdColIdx] || '').trim();
    var src = String(custData[i][custSourceIdx] || '').trim().toLowerCase();
    var em  = String(custData[i][custEmailIdx]  || '').trim().toLowerCase();
    if (cid) { custSource[cid] = src; custEmail[cid] = em; }
  }

  // Build email → variant lookup from Lead Intake
  var emailVariant = {};
  var COL_EMAIL   = 3;  // D
  var COL_VARIANT = 10; // K
  var COL_SOURCE  = 13; // N utm_source
  for (var r = 1; r < leadsData.length; r++) {
    var em  = String(leadsData[r][COL_EMAIL]   || '').trim().toLowerCase();
    var v   = String(leadsData[r][COL_VARIANT] || '').trim().toUpperCase();
    if (em && v && !emailVariant[em]) emailVariant[em] = v;
  }

  // ── Bucket definitions ──
  function srcBucket(src) {
    return src.indexOf('facebook') !== -1 || src === 'fb' || src === 'photo_flow' || src === 'limit_gate' || src === 'variant_b_gate' ? 'facebook'
         : src.indexOf('google')   !== -1 ? 'google'
         : src === '(direct)' || src === 'direct_quote' ? 'direct'
         : src === '(blank)' || src === '' ? 'unknown'
         : 'other';
  }

  var OUTBOUND = ['outbound_complete','received','inspected','offer_made','purchased','returned','dead'];

  // Initialize buckets
  function newBucket() {
    return { sent:0, purchased:0, returned:0, totalPaid:0, estimateSum:0, estimateCount:0 };
  }

  var bySource   = { facebook: newBucket(), google: newBucket(), direct: newBucket(), unknown: newBucket() };
  var byType     = { kit: newBucket(), label: newBucket(), usps: newBucket() };
  var byVariant  = { A: newBucket(), B: newBucket(), C: newBucket(), unknown: newBucket() };

  for (var j = 1; j < shipData.length; j++) {
    var stage    = String(shipData[j][stageIdx]    || '').trim();
    var shipType = String(shipData[j][shipTypeIdx] || '').trim().toLowerCase();
    var cid      = String(shipData[j][custIdIdx]   || '').trim();
    var purchase = parseFloat(String(shipData[j][purchaseIdx] || '0').replace(/[^0-9.]/g,'')) || 0;
    var estimate = String(shipData[j][estimateIdx] || '').trim();

    var src     = custSource[cid] || '';
    var em      = custEmail[cid]  || '';
    var srcKey  = srcBucket(src);
    var typeKey = shipType === 'kit' ? 'kit' : shipType === 'label' ? 'label' : shipType === 'usps' ? 'usps' : null;
    var varKey  = emailVariant[em] || 'unknown';
    if (!['A','B','C'].includes(varKey)) varKey = 'unknown';

    if (OUTBOUND.indexOf(stage) === -1) continue; // only count outbound+

    // Parse estimate range for avg
    var estLow = 0, estHigh = 0;
    var estMatch = estimate.match(/\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/);
    if (estMatch) {
      estLow  = parseInt(estMatch[1].replace(/,/g,'')) || 0;
      estHigh = parseInt(estMatch[2].replace(/,/g,'')) || 0;
    }
    var estMid = estLow && estHigh ? (estLow + estHigh) / 2 : 0;

    function addTo(bucket) {
      bucket.sent++;
      if (stage === 'purchased')  { bucket.purchased++; bucket.totalPaid += purchase; }
      if (stage === 'returned')   { bucket.returned++; }
      if (estMid > 0) { bucket.estimateSum += estMid; bucket.estimateCount++; }
    }

    addTo(bySource[srcKey]);
    if (typeKey) addTo(byType[typeKey]);
    addTo(byVariant[varKey]);
  }

  // ── Ad spend (hardcoded from your data) ──
  var adSpend = { facebook: 1520, google: 958, direct: 0, unknown: 0 };

  function report(label, buckets, spend) {
    Logger.log('');
    Logger.log('=== ' + label + ' ===');
    Object.keys(buckets).forEach(function(k) {
      var b = buckets[k];
      if (b.sent === 0) return;
      var sendBack  = b.sent > 0 ? Math.round((b.purchased + b.returned) / b.sent * 100) : 0;
      var closeRate = b.sent > 0 ? Math.round(b.purchased / b.sent * 100) : 0;
      var cac       = spend && spend[k] && b.purchased > 0 ? Math.round(spend[k] / b.purchased) : null;
      var avgEst    = b.estimateCount > 0 ? Math.round(b.estimateSum / b.estimateCount) : 0;
      Logger.log(
        k.toUpperCase() + ': ' +
        b.sent + ' sent | ' +
        b.purchased + ' purchased (' + closeRate + '%) | ' +
        b.returned + ' returned | ' +
        'send-back: ' + sendBack + '% | ' +
        'paid out: $' + b.totalPaid +
        (avgEst ? ' | avg estimate: $' + avgEst : '') +
        (cac !== null ? ' | CAC: $' + cac : '')
      );
    });
  }

  report('BY AD SOURCE', bySource, adSpend);
  report('BY SHIPPING TYPE', byType, null);
  report('BY LANDING PAGE VARIANT', byVariant, null);

  // ── Overall summary ──
  Logger.log('');
  Logger.log('=== OVERALL SUMMARY ===');
  var totalSpend = 1520 + 958;
  var totalPurchased = 0, totalPaid = 0, totalSent = 0;
  Object.keys(bySource).forEach(function(k) {
    totalSent      += bySource[k].sent;
    totalPurchased += bySource[k].purchased;
    totalPaid      += bySource[k].totalPaid;
  });
  Logger.log('Total ad spend: $' + totalSpend);
  Logger.log('Total sent: ' + totalSent);
  Logger.log('Total purchased: ' + totalPurchased);
  Logger.log('Total paid out: $' + totalPaid);
  Logger.log('Blended CAC: $' + (totalPurchased > 0 ? Math.round(totalSpend / totalPurchased) : 'N/A'));
  Logger.log('Prospyr estimated value: $3,316');
  Logger.log('Gross margin (value - paid): $' + (3316 - totalPaid));
  Logger.log('Net margin (value - paid - ad spend): $' + (3316 - totalPaid - totalSpend));
}
