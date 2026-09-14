// ═══════════════════════════════════════════════════════════
// reconcileFulfillment - run once to update today's 13 shipments
// Appends tracking numbers and moves to outbound_complete
// ═══════════════════════════════════════════════════════════

function reconcileFulfillment() {
  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var custSheet = ss.getSheetByName('Customers');
  var shipSheet = ss.getSheetByName('Shipments');

  // Build email -> customer_id map
  var custData = custSheet.getDataRange().getValues();
  var custHeaders = custData[0];
  var custEmailCol = custHeaders.indexOf('email');
  var custIdCol = custHeaders.indexOf('customer_id');
  var custNameCol = custHeaders.indexOf('name');
  var emailToCustId = {};
  var custIdToName = {};
  for (var i = 1; i < custData.length; i++) {
    var email = String(custData[i][custEmailCol]).toLowerCase().trim();
    var custId = custData[i][custIdCol];
    var name = String(custData[i][custNameCol]).toLowerCase().trim().replace(/\s+/g,' ');
    if (email) emailToCustId[email] = custId;
    if (custId) custIdToName[custId] = name;
  }

  // Build name -> customer_id map
  var nameToCustId = {};
  for (var email in emailToCustId) {
    var cid = emailToCustId[email];
    var name = custIdToName[cid];
    if (name) nameToCustId[name] = cid;
  }

  // Outbound tracking by email (Pirateship)
  var OUTBOUND = {"billydeewilliams15@gmail.com": "9400136106196349017132", "a.s@du.htnet.hr": "9400136106196349017125", "kllchilders@gmail.com": "9400136106196349017101", "freemantony935@gmail.com": "9400136106196349017057", "peytondon826@gmail.com": "9400136106196349017088", "famtlb18@gmail.com": "9400136106196349017040", "lisablazek1071@yahoo.com": "9400136106196349017002", "cjsmother65@gmail.com": "9400136106196349017026", "crystallalor01@gmail.com": "9400136106196349016999", "tremellaustin8@gmail.com": "9400136106196349017019", "trosclairrobert@yahoo.com": "9400136106196349016982"};

  // Return tracking by name (FedEx)
  var RETURN_BY_NAME = {"lisa blazek": "792247951374", "william dancy": "792247951341", "kelly childers": "792247951293", "tony freeman": "792247951260", "antonio segedin": "792247954811", "monica alder": "792247951205", "crystal lalor": "792247951157", "teresa botta": "792247953528", "daryl peyton": "792247951087", "kathy horner": "792247950996", "bobbt austin": "792247950985", "robert trosclair": "792247950963", "robin simpson": "792247950974"};

  // Load shipments
  var shipData = shipSheet.getDataRange().getValues();
  var shipHeaders = shipData[0];
  var shipCustIdCol = shipHeaders.indexOf('customer_id');
  var shipOutboundCol = shipHeaders.indexOf('outbound_tracking');
  var shipReturnCol = shipHeaders.indexOf('return_tracking');
  var shipStageCol = shipHeaders.indexOf('stage');

  // Build customer_id -> most recent ready_to_fulfill row
  var custIdToRow = {};
  for (var i = 1; i < shipData.length; i++) {
    var cid = shipData[i][shipCustIdCol];
    var stage = String(shipData[i][shipStageCol]).trim();
    if (cid && stage === 'ready_to_fulfill') {
      custIdToRow[cid] = i;
    }
  }

  var updated = 0;
  var log = [];

  // Update outbound tracking by email
  for (var email in OUTBOUND) {
    var custId = emailToCustId[email];
    if (!custId) { log.push('NO CUSTOMER: ' + email); continue; }
    var rowIdx = custIdToRow[custId];
    if (rowIdx === undefined) { log.push('NO RTF SHIPMENT: ' + email); continue; }
    shipSheet.getRange(rowIdx + 1, shipOutboundCol + 1).setValue(OUTBOUND[email]);
    shipSheet.getRange(rowIdx + 1, shipStageCol + 1).setValue('outbound_complete');
    shipData[rowIdx][shipOutboundCol] = OUTBOUND[email];
    shipData[rowIdx][shipStageCol] = 'outbound_complete';
    updated++;
    log.push('OUTBOUND SET: ' + email + ' row ' + (rowIdx+1) + ' = ' + OUTBOUND[email]);
  }

  // Update return tracking by name
  for (var name in RETURN_BY_NAME) {
    var custId = nameToCustId[name];
    if (!custId) { log.push('NO CUSTOMER BY NAME: ' + name); continue; }
    var rowIdx = custIdToRow[custId];
    // If already moved to outbound_complete, find that row instead
    if (rowIdx === undefined) {
      for (var i = 1; i < shipData.length; i++) {
        if (shipData[i][shipCustIdCol] === custId &&
            String(shipData[i][shipStageCol]).trim() === 'outbound_complete') {
          rowIdx = i; break;
        }
      }
    }
    if (rowIdx === undefined) { log.push('NO SHIPMENT ROW: ' + name); continue; }
    var currentReturn = String(shipData[rowIdx][shipReturnCol]).trim();
    if (!currentReturn || currentReturn === '') {
      shipSheet.getRange(rowIdx + 1, shipReturnCol + 1).setValue(RETURN_BY_NAME[name]);
      shipData[rowIdx][shipReturnCol] = RETURN_BY_NAME[name];
      log.push('RETURN SET: ' + name + ' row ' + (rowIdx+1) + ' = ' + RETURN_BY_NAME[name]);
    } else {
      log.push('RETURN SKIP (already set): ' + name + ' = ' + currentReturn);
    }
  }

  Logger.log('=== RECONCILIATION COMPLETE ===');
  Logger.log('Shipments updated to outbound_complete: ' + updated);
  log.forEach(function(l) { Logger.log(l); });
}