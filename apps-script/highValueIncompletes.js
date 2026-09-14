function highValueIncompletes() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var leadsSheet = ss.getSheetByName('Lead Intake');
  var shipSheet  = ss.getSheetByName('Shipments');
  var custSheet  = ss.getSheetByName('Customers');

  var leadsData = leadsSheet.getDataRange().getValues();
  var shipData  = shipSheet.getDataRange().getValues();
  var custData  = custSheet.getDataRange().getValues();

  var shipHeaders  = shipData[0];
  var stageIdx     = shipHeaders.indexOf('stage');
  var shipCustIdx  = shipHeaders.indexOf('customer_id');
  var OUTBOUND_STAGES = ['outbound_complete','received','inspected','offer_made','purchased','returned','dead','ready_to_fulfill','outbound_pending'];

  var custHeaders  = custData[0];
  var custIdColIdx = custHeaders.indexOf('customer_id');
  var custEmailIdx = custHeaders.indexOf('email');

  var custIdToEmail = {};
  var emailToCustId = {};
  for (var i = 1; i < custData.length; i++) {
    var cid = String(custData[i][custIdColIdx] || '').trim();
    var em  = String(custData[i][custEmailIdx]  || '').trim().toLowerCase();
    if (cid && em) { custIdToEmail[cid] = em; emailToCustId[em] = cid; }
  }

  var activeEmails = {};
  for (var j = 1; j < shipData.length; j++) {
    var stage = String(shipData[j][stageIdx]    || '').trim();
    var cid   = String(shipData[j][shipCustIdx] || '').trim();
    if (OUTBOUND_STAGES.indexOf(stage) !== -1) {
      var em = custIdToEmail[cid];
      if (em) activeEmails[em] = true;
    }
  }

  var COL_EMAIL    = 3;
  var COL_NAME     = 2;
  var COL_ESTIMATE = 7;
  var COL_ITEM     = 5;
  var COL_SHIPPING = 20;
  var COL_ADDRESS  = 21;
  var COL_PHOTO    = 22;
  var COL_AUTO_REPLY = 24;
  var COL_TIMESTAMP  = 0;

  var byEmail = {};

  for (var r = 1; r < leadsData.length; r++) {
    var email    = String(leadsData[r][COL_EMAIL]    || '').trim().toLowerCase();
    var name     = String(leadsData[r][COL_NAME]     || '').trim();
    var estimate = String(leadsData[r][COL_ESTIMATE] || '').trim();
    var item     = String(leadsData[r][COL_ITEM]     || '').trim();
    var shipping = String(leadsData[r][COL_SHIPPING] || '').trim();
    var address  = String(leadsData[r][COL_ADDRESS]  || '').trim();
    var photo    = String(leadsData[r][COL_PHOTO]    || '').trim();
    var autoReply = String(leadsData[r][COL_AUTO_REPLY] || '').trim();
    var ts       = leadsData[r][COL_TIMESTAMP];

    if (!email || email.indexOf('@') === -1) continue;
    if (!estimate) continue;
    if (shipping && address) continue;
    if (activeEmails[email]) continue;

    var estMid = 0;
    var match = estimate.match(/\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/);
    if (match) {
      var low  = parseInt(match[1].replace(/,/g,'')) || 0;
      var high = parseInt(match[2].replace(/,/g,'')) || 0;
      estMid = (low + high) / 2;
    }
    if (estMid < 200) continue;

    var tsDate = ts instanceof Date ? ts : new Date(ts);

    if (!byEmail[email] || estMid > byEmail[email].estMid) {
      byEmail[email] = {
        email, name, estimate, item, estMid, photo,
        autoReplySent: !!autoReply,
        timestamp: tsDate
      };
    }
  }

  var leads = Object.values(byEmail).sort(function(a,b) { return b.estMid - a.estMid; });

  Logger.log('=== HIGH VALUE INCOMPLETE LEADS (estimate $200+, no shipment) ===');
  Logger.log('Total found: ' + leads.length);
  Logger.log('');

  leads.forEach(function(l, i) {
    Logger.log(
      (i+1) + '. ' + (l.name || '(no name)') + ' <' + l.email + '>' +
      ' | ' + l.estimate +
      ' | ' + (l.item || 'no item') +
      ' | submitted: ' + l.timestamp.toLocaleDateString() +
      (l.autoReplySent ? ' | email sent' : ' | NO EMAIL SENT') +
      (l.photo && l.photo.indexOf('drive.google.com') !== -1 ? ' | has photo' : '')
    );
  });
}