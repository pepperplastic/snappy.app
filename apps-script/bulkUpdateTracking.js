// ═══════════════════════════════════════════════════════════
// ONE-TIME FUNCTION: bulkUpdateTracking
// Run once from Apps Script editor to backfill all tracking numbers.
// Safe to run multiple times — only fills blank fields, never overwrites.
// ═══════════════════════════════════════════════════════════

function bulkUpdateTracking() {

  // ── Outbound tracking (Pirateship): email → [tracking numbers] ──
  var OUTBOUND = {
    "aldubimanal09@gmail.com": ["9400136106196341878182"],
    "alohabarbour07@gmail.com": ["9400136106196341878670"],
    "amandafrancis382@gmail.com": ["9400136106196341878687"],
    "aurora420a@gmail.com": ["9400136106196341879011"],
    "aw061188@gmail.com": ["9400136106196341879066"],
    "beautifulava0807@gmail.com": ["9400136106196341878342"],
    "billydeewilliams15@gmail.com": ["9400136106196341878946"],
    "bmcardona1983@gmail.com": ["9400136106196341878021"],
    "btmune88@gmail.com": ["9400136106196341878861"],
    "buckycassell@gmail.com": ["9400136106196341878588"],
    "buenolocs@gmail.com": ["9400136106196341878809"],
    "cagumbert@gmail.com": ["9400136106196341878274"],
    "cal47976@gmail.com": ["9400136106196341878281"],
    "capitasnow1999@gmail.com": ["9400136106196341879042"],
    "chadmadden1975@gmail.com": ["9400136106196341878984"],
    "corleyandrew73@gmail.com": ["9400136106196341878106"],
    "df20251980@gmail.com": ["9400136106196341878304"],
    "dkeys908@gmail.com": ["9400136106196341878878"],
    "dramos031kc@gmail.com": ["9400136106196347952787"],
    "durangomexico60@gmail.com": ["9400136106196341878465"],
    "eskipper111@gmail.com": ["9400136106196341878557"],
    "evergrnred@yahoo.com": ["9400136106196341878915"],
    "fowler.myrna@yahoo.com": ["9400136106196341878892"],
    "frenchy5065@gmail.com": ["9400136106196341878663"],
    "gloverd531@gmail.com": ["9400136106196341878939"],
    "henryjosuechavezdias448@gmail.com": ["9400136106196341878854"],
    "homeisthelou@gmail.com": ["9400136106196341878533"],
    "hornerkathy20@gmail.com": ["9400136106196341878335"],
    "j.sherry80@yahoo.com": ["9400136106196341878014"],
    "jamesjaschob@yahoo.com": ["9400136106196341878151"],
    "jnnzachary8@gmail.com": ["9400136106196347952749", "9400136106196345032092"],
    "johnowens6683@gmail.com": ["9400136106196341877994"],
    "joshdauria@gmail.com": ["9400136106196341878571"],
    "jrowland328@gmail.com": ["9400136106196341878472"],
    "jsscalzo@att.net": ["9400136106196341878205"],
    "juliedt1231@gmail.com": ["9400136106196341878656"],
    "kellysullivan2008@gmail.com": ["9400136106196341878090"],
    "krazy4dolfinzz@gmail.com": ["9400136106196341878458"],
    "kschwab89@hotmail.com": ["9400136106196341878786"],
    "lafollettekeith@gmail.com": ["9400136106196341878076"],
    "leebenr@gmail.com": ["9400136106196341878120"],
    "lhamondanny5@gmail.com": ["9400136106196341878762"],
    "lisablazek1071@yahoo.com": ["9400136106196341878816"],
    "lisap1467@gmail.com": ["9400136106196341878069"],
    "lovepizza1983@yahoo.com": ["9400136106196341878601"],
    "marvilasoto@yahoo.com": ["9400136106196341878731"],
    "mcintirenicole19@gmail.com": ["9400136106196341878380"],
    "mdspecht@earthlink.net": ["9400136106196341878922"],
    "michelleley45@gmail.com": ["9400136106196341878137"],
    "mlwiard5@gmail.com": ["9400136106196341878755"],
    "mrodm333@gmail.com": ["9400136106196341878960"],
    "mybabywillow24@gmail.com": ["9400136106196341878779"],
    "nicolesobell@gmail.com": ["9400136106196341878236"],
    "nikolol2323@gmail.com": ["9400136106196341878489"],
    "patriciamoseley769@gmail.com": ["9400136106196341877932"],
    "pquickley64@gmail.com": ["9400136106196341878311"],
    "reff003@yahoo.com": ["9400136106196347952763", "9400136106196345032108"],
    "reginahanning86@gmail.com": ["9400136106196341878991"],
    "reneepolk983@gmail.com": ["9400136106196341878724"],
    "rkurovsky@yahoo.com": ["9400136106196341878540"],
    "rplumlee917@gmail.com": ["9400136106196341878427"],
    "russellsylestine8@gmail.com": ["9400136106196341878717"],
    "scanlady2018@gmail.com": ["9400136106196341878007"],
    "sheltonchrisandra@gmail.com": ["9400136106196341878328"],
    "slumpbaby33@gmail.com": ["9400136106196341878823"],
    "starrking1715@gmail.com": ["9400136106196341878250"],
    "steelluis1@gmail.com": ["9400136106196341878397"],
    "stillscynthia6@gmail.com": ["9400136106196341878144"],
    "susancole47@hotmail.com": ["9400136106196341878229"],
    "susanhamilton791@gmail.com": ["9400136106196341878403"],
    "tambrahorses@aol.com": ["9400136106196341877949"],
    "terryanglin3699@gmail.com": ["9400136106196341878908"],
    "tiarlsmit@gmail.com": ["9400136106196341877963"],
    "tinaabaker71@yahoo.com": ["9400136106196341878885"],
    "tlcbasket@aol.com": ["9400136106196341878212"],
    "traceethompson5@gmail.com": ["9400136106196341878243"],
    "tricindy13@gmail.com": ["9400136106196341878045"],
    "twetyan@aol": ["9400136106196341878830"],
    "tyliebug99@gmail.com": ["9400136106196341878595"],
    "unfigmint@gmail.com": ["9400136106196341878267"],
    "vinusvora@gmail.com": ["9400136106196341878199"],
    "webe4x4@hotmail.com": ["9400136106196341878953"],
    "wgadkins_99@yahoo.com": ["9400136106196341879035"],
    "whiteallenshirley@gmail.com": ["9400136106196341878373"],
    "winston.elisse2023@gmail.com": ["9400136106196341878083"],
    "zacjay0137@gmail.com": ["9400136106196341877956"],
    "zurovecamanda654@gmail.com": ["9400136106196341878526"]
  };

  // ── Return tracking (FedEx): normalized name → [tracking numbers] ──
  var RETURN_BY_NAME = {
    "amanda payne": ["792241921822"],
    "amanda zurovec": ["792237548424"],
    "amy gomes": ["792220332192"],
    "amy hoffa": ["792242047011"],
    "andrea oliva": ["792246142018"],
    "andrew corley": ["792237547380"],
    "angie tackett": ["792237153146"],
    "anne groff": ["792240056951"],
    "anthony hennecke": ["792237153904"],
    "april smith": ["792246142213"],
    "aurora aldana": ["792240058222"],
    "ben lee": ["792240057340", "792236565431"],
    "brandon dale": ["792236511626"],
    "brandy cardona": ["792240058369"],
    "brandy fuller": ["792236539765"],
    "bryant williams": ["792237548766"],
    "bucky cassell": ["792240057720"],
    "calvin bullard": ["792240057432"],
    "carrie shropshire": ["792241924328"],
    "chad madden": ["792241918907"],
    "cheryl collison": ["792240058060"],
    "cheryl harris": ["792240057649"],
    "chrisandra shelton": ["792240057513"],
    "christal davis": ["792241921535"],
    "clayton kovacs": ["792240056756", "792222462308"],
    "cleo scott": ["792240056826"],
    "corwin thompkins": ["792236522807"],
    "cynthia gumbert": ["792237548159"],
    "cynthia stills": ["792240056403"],
    "daniel bueno": ["792241922884"],
    "danielle alarid": ["792240058266"],
    "danielle ramos": ["792246108480"],
    "danny lhamon": ["792237548663"],
    "david doro": ["792240056789"],
    "davy brown": ["792240056550"],
    "dedre tillman": ["792229932050"],
    "denise cihlar": ["792242047044"],
    "denver glover": ["792241919546"],
    "diana french": ["792240058612"],
    "dimitrios mavrikiotis": ["792240056675"],
    "dustin keys": ["792240058005", "792237153477"],
    "ed harley": ["792220410890"],
    "eileen corticchia": ["792237153250"],
    "george ficht": ["792236534237"],
    "henry chavez": ["792241923549"],
    "howard gerber": ["792230119786", "792227811516"],
    "james chadwick": ["792233120193"],
    "james jaschob": ["792237547483"],
    "james scalzo": ["792237548089"],
    "jarod johnson": ["792236484710"],
    "jennifer moore": ["792237153992"],
    "jeremy rowland": ["792237548365"],
    "jill borgerding": ["792236537214"],
    "jimmy harbison": ["792218399777"],
    "jo bell": ["792237547174"],
    "joann zachary": ["792246108365", "792242042719"],
    "john owens": ["792240056241"],
    "joshua dauria": ["792237548479"],
    "julie taylor": ["792240057763"],
    "julius tobar": ["792236501110"],
    "karen alaniz": ["792236535737"],
    "katelyn gash-hall": ["792237167212"],
    "kathy schwab": ["792240057888"],
    "katrinka patton": ["792246142485"],
    "katyy horner": ["792237548251"],
    "keith lafollette": ["792240057226"],
    "kelly cape": ["792240056907"],
    "kelly childers": ["792222337598"],
    "kelly sullivan": ["792240056333"],
    "kendall carter": ["792236548542"],
    "kimberly frasure": ["792236526890"],
    "linda hollan": ["792237548549"],
    "lisa blazek": ["792237548700"],
    "lisa paddock": ["792237547288"],
    "luis fierro": ["792240057590"],
    "luisa perez": ["792240057638"],
    "manal aldubi": ["792240056436"],
    "marvila moreno": ["792240056860"],
    "megen hennecke": ["792237153570"],
    "melody ward": ["792236504473"],
    "merinda winston-hurst": ["792240058472"],
    "michael ryland": ["792220370951"],
    "michael wiard": ["792241922185"],
    "michele specht": ["792240057075"],
    "michelle padilla": ["792240058509"],
    "monica adler": ["792231084122"],
    "myrle polk": ["792240057822"],
    "myrna fowler": ["792241919855"],
    "nicole fulton": ["792236546469"],
    "nicole mcintire": ["792241920540"],
    "nicole sobell": ["792237548126"],
    "pamela quickley": ["792240056609"],
    "patricia moseley": ["792240056149"],
    "patrick teasley": ["792236543827"],
    "rebecca jusu": ["792237547108"],
    "regina hanning": ["792240056138"],
    "rick little": ["792222298634"],
    "robert ortiz": ["792236497802"],
    "robert trosclair": ["792231147955", "792220533220"],
    "robin plumlee": ["792240056642"],
    "rodney moore": ["792240057123"],
    "rudolph yearby": ["792242047099"],
    "russell kurovsky": ["792241921237"],
    "russell sylestine": ["792237548608"],
    "sarah graham": ["792236280363"],
    "sean starr": ["792240058586"],
    "shawn morton": ["792236491506"],
    "sherrie schallack": ["792242046986"],
    "sherry jones": ["792241936527"],
    "shirley whiteallen": ["792241878770"],
    "slump cole": ["792240057947"],
    "stacey ledbetter": ["792236516650"],
    "stephanie hurst": ["792246142132"],
    "susan bright": ["792240056480"],
    "susan hamilton": ["792237548332"],
    "susan paez": ["792241920848"],
    "tambra epps": ["792240057145"],
    "tammy clossen": ["792232269293"],
    "teresa childers": ["792240057318"],
    "terry anglin": ["792237548803"],
    "thomas miller": ["792246108516", "792242042638"],
    "tiara smith": ["792240058314"],
    "tina baker": ["792240057053"],
    "tony freeman": ["792233070839", "792220039269"],
    "tracee fout": ["792240057384", "792237153363"],
    "tri nguyen": ["792236538872"],
    "tricia cooper": ["792240056263"],
    "vinas vora": ["792240058510"],
    "wes bellows": ["792240058141"],
    "william adkins": ["792241915665"],
    "william dancy": ["792237548891"]
  };

  var ss = SpreadsheetApp.openById('1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM');
  var custSheet = ss.getSheetByName('Customers');
  var shipSheet = ss.getSheetByName('Shipments');

  // Build email -> customer_id map from Customers tab
  var custData = custSheet.getDataRange().getValues();
  var custHeaders = custData[0];
  var custEmailCol = custHeaders.indexOf('email');
  var custIdCol = custHeaders.indexOf('customer_id');
  var emailToCustomerId = {};
  for (var i = 1; i < custData.length; i++) {
    var email = String(custData[i][custEmailCol]).toLowerCase().trim();
    var custId = custData[i][custIdCol];
    if (email && custId) emailToCustomerId[email] = custId;
  }

  // Build name -> customer_id map from Customers tab
  var custNameCol = custHeaders.indexOf('name');
  var nameToCustomerId = {};
  for (var i = 1; i < custData.length; i++) {
    var name = String(custData[i][custNameCol]).toLowerCase().trim().replace(/\s+/g,' ');
    var custId = custData[i][custIdCol];
    if (name && custId) nameToCustomerId[name] = custId;
  }

  // Load shipments
  var shipData = shipSheet.getDataRange().getValues();
  var shipHeaders = shipData[0];
  var shipCustIdCol = shipHeaders.indexOf('customer_id');
  var shipOutboundCol = shipHeaders.indexOf('outbound_tracking');
  var shipReturnCol = shipHeaders.indexOf('return_tracking');

  // Build customer_id -> array of shipment row indices
  var custIdToRows = {};
  for (var i = 1; i < shipData.length; i++) {
    var cid = shipData[i][shipCustIdCol];
    if (!cid) continue;
    if (!custIdToRows[cid]) custIdToRows[cid] = [];
    custIdToRows[cid].push(i);
  }

  var outboundUpdated = 0;
  var returnUpdated = 0;
  var log = [];

  // ── Update outbound tracking (by email) ──
  for (var email in OUTBOUND) {
    var custId = emailToCustomerId[email];
    if (!custId) {
      log.push('OUTBOUND: no customer found for email ' + email);
      continue;
    }
    var rows = custIdToRows[custId];
    if (!rows || rows.length === 0) {
      log.push('OUTBOUND: no shipments for ' + email + ' (' + custId + ')');
      continue;
    }
    var trackings = OUTBOUND[email];
    // Assign trackings to shipment rows in order (first tracking to first shipment, etc.)
    for (var t = 0; t < trackings.length; t++) {
      var rowIdx = rows[t] !== undefined ? rows[t] : rows[rows.length - 1];
      var currentVal = String(shipData[rowIdx][shipOutboundCol]).trim();
      if (!currentVal || currentVal === '' || currentVal === 'undefined') {
        shipSheet.getRange(rowIdx + 1, shipOutboundCol + 1).setValue(trackings[t]);
        shipData[rowIdx][shipOutboundCol] = trackings[t]; // update local copy
        outboundUpdated++;
        log.push('OUTBOUND SET: ' + email + ' row ' + (rowIdx+1) + ' = ' + trackings[t]);
      } else {
        log.push('OUTBOUND SKIP (already set): ' + email + ' row ' + (rowIdx+1) + ' = ' + currentVal);
      }
    }
  }

  // ── Update return tracking (by name) ──
  for (var normName in RETURN_BY_NAME) {
    var custId = nameToCustomerId[normName];
    if (!custId) {
      log.push('RETURN: no customer found for name "' + normName + '"');
      continue;
    }
    var rows = custIdToRows[custId];
    if (!rows || rows.length === 0) {
      log.push('RETURN: no shipments for ' + normName + ' (' + custId + ')');
      continue;
    }
    var trackings = RETURN_BY_NAME[normName];
    for (var t = 0; t < trackings.length; t++) {
      var rowIdx = rows[t] !== undefined ? rows[t] : rows[rows.length - 1];
      var currentVal = String(shipData[rowIdx][shipReturnCol]).trim();
      if (!currentVal || currentVal === '' || currentVal === 'undefined') {
        shipSheet.getRange(rowIdx + 1, shipReturnCol + 1).setValue(trackings[t]);
        shipData[rowIdx][shipReturnCol] = trackings[t];
        returnUpdated++;
        log.push('RETURN SET: ' + normName + ' row ' + (rowIdx+1) + ' = ' + trackings[t]);
      } else {
        log.push('RETURN SKIP (already set): ' + normName + ' row ' + (rowIdx+1) + ' = ' + currentVal);
      }
    }
  }

  // Print summary
  Logger.log('=== TRACKING UPDATE COMPLETE ===');
  Logger.log('Outbound updated: ' + outboundUpdated);
  Logger.log('Return updated: ' + returnUpdated);
  Logger.log('');
  Logger.log('=== DETAIL LOG ===');
  log.forEach(function(l) { Logger.log(l); });

  SpreadsheetApp.getUi().alert(
    'Done!\n\nOutbound tracking filled: ' + outboundUpdated + '\nReturn tracking filled: ' + returnUpdated +
    '\n\nCheck View > Logs for details.'
  );
}