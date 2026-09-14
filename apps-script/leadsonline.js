// ═══════════════════════════════════════════════════════════════════════
//  LEADSONLINE API INTEGRATION (SOAP)
//  Submits Florida Statute 538 compliance tickets to LeadsOnline.
//
//  Endpoints:
//    Sandbox:    https://w3apisandbox.leadsonline.com/ticketWS.asmx
//    Production: https://w3api.leadsonline.com/ticketWS.asmx
//
//  Switch via LO_USE_SANDBOX flag below.
//
//  May 19 update: added handlePushToLeadsOnline for one-click CRM submission.
//  Jun 3 update: pipeline redesign — stage gate is now 'pending_leadsonline'
//                (was 'purchased'); a confirmed push advances stage to 'complete'.
// ═══════════════════════════════════════════════════════════════════════

// ─── CONFIG ─────────────────────────────────────────────────────────────

var LO_USE_SANDBOX = false;   // FLIP TO false WHEN GOING LIVE

var LO_SANDBOX = {
  url:      'https://w3apisandbox.leadsonline.com/ticketWS.asmx',
  storeId:  '55365',
  username: 'snapgtest01',
  password: 'test01snapg',
};

var LO_PRODUCTION = {
  url:      'https://w3api.leadsonline.com/ticketWS.asmx',
  storeId:  '97921',
  username: 'snappygold01',
  password: '01snappygold',
};

function _loCfg() {
  return LO_USE_SANDBOX ? LO_SANDBOX : LO_PRODUCTION;
}

// ─── SOAP ENVELOPE & TRANSPORT ──────────────────────────────────────────

function _loEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _loEnvelope(methodName, innerXml) {
  // Note: xsi namespace is declared at envelope level so xsi:nil works on ApiVersion
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n' +
    '  <soap:Body>\n' +
    '    <' + methodName + ' xmlns="http://www.leadsonline.com/">\n' +
    innerXml +
    '    </' + methodName + '>\n' +
    '  </soap:Body>\n' +
    '</soap:Envelope>';
}

function _loLoginXml() {
  var c = _loCfg();
  return '      <login>\n' +
    '        <storeId>' + _loEscape(c.storeId) + '</storeId>\n' +
    '        <userName>' + _loEscape(c.username) + '</userName>\n' +
    '        <password>' + _loEscape(c.password) + '</password>\n' +
    '      </login>\n';
}

// Per the WSDL, every method's parameter element requires ApiVersion (nillable int)
// followed by optional IpAddress, then the method-specific params.
// We send ApiVersion as nil and skip IpAddress.
function _loApiVersionXml() {
  return '      <ApiVersion xsi:nil="true"/>\n';
}

function _loCallApi(methodName, innerXml) {
  var cfg = _loCfg();
  var soapBody = _loEnvelope(methodName, innerXml);
  var soapAction = 'http://www.leadsonline.com/' + methodName;

  Logger.log('LO API call: ' + methodName + ' to ' + cfg.url);

  var response = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'text/xml; charset=utf-8',
    headers: { 'SOAPAction': '"' + soapAction + '"' },
    payload: soapBody,
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var text = response.getContentText();
  Logger.log('LO HTTP ' + code);

  if (code < 200 || code >= 300) {
    Logger.log('LO error response: ' + text.substring(0, 1500));
    return { success: false, httpCode: code, raw: text };
  }

  // Parse SOAP response — extract errorCode and errorResponse
  var parsed = _loParseResponse(text, methodName);
  parsed.raw = text;
  parsed.httpCode = code;
  return parsed;
}

function _loParseResponse(xmlText, methodName) {
  // Extract <errorCode>N</errorCode> and <errorResponse>...</errorResponse>
  var ecMatch = xmlText.match(/<errorCode>(-?\d+)<\/errorCode>/);
  var erMatch = xmlText.match(/<errorResponse>([\s\S]*?)<\/errorResponse>/);
  var errorCode = ecMatch ? parseInt(ecMatch[1], 10) : null;
  var errorResponse = erMatch ? erMatch[1] : '';

  return {
    success: errorCode === 0,
    errorCode: errorCode,
    errorResponse: errorResponse,
  };
}

// ─── METHOD: CheckLogin ─────────────────────────────────────────────────

function loCheckLogin() {
  var inner = _loApiVersionXml() + _loLoginXml();
  var result = _loCallApi('CheckLogin', inner);
  Logger.log('CheckLogin result: ' + JSON.stringify({
    success: result.success,
    errorCode: result.errorCode,
    errorResponse: result.errorResponse,
    httpCode: result.httpCode,
  }));
  return result;
}

// ─── HELPERS: data shaping ──────────────────────────────────────────────

function _loFormatTicketDate(d) {
  // LeadsOnline accepts MM/DD/YYYY HH:MM in local time (no TZ conversion)
  if (!d) return '';
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  var mm = String(dt.getMonth() + 1).padStart(2, '0');
  var dd = String(dt.getDate()).padStart(2, '0');
  var yyyy = dt.getFullYear();
  var hh = String(dt.getHours()).padStart(2, '0');
  var mins = String(dt.getMinutes()).padStart(2, '0');
  return mm + '/' + dd + '/' + yyyy + ' ' + hh + ':' + mins;
}

function _loFormatDob(s) {
  if (!s) return '';
  // JUN 1 PATCH v2: handle Date objects directly (cells typed as Date)
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return '';
    var yyyy = s.getFullYear();
    var mm = String(s.getMonth() + 1).padStart(2, '0');
    var dd = String(s.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }
  var str = String(s).trim();
  // ISO YYYY-MM-DD with optional time — extract date literally
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  // MM/DD/YYYY
  var us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    var mm2 = us[1].length === 1 ? '0' + us[1] : us[1];
    var dd2 = us[2].length === 1 ? '0' + us[2] : us[2];
    return mm2 + '/' + dd2 + '/' + us[3];
  }
  // JS Date.toString() format: "Sat Jul 03 1971 00:00:00 GMT-0400 (...)"
  var dateMonthsLO = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
                       Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  var jsDateMatch = str.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (jsDateMatch && dateMonthsLO[jsDateMatch[1]]) {
    var dpart = jsDateMatch[2].length === 1 ? '0' + jsDateMatch[2] : jsDateMatch[2];
    return jsDateMatch[3] + '-' + dateMonthsLO[jsDateMatch[1]] + '-' + dpart;
  }
  return str; // pass through, let LO complain
}

function _loParseAddress(addr) {
  // Best-effort parse of "123 Main St, City, State, Zip" or "123 Main St, City, State Zip"
  if (!addr) return { address1:'', city:'', state:'', postalCode:'' };
  var parts = String(addr).split(',').map(function(p) { return p.trim(); });
  var address1 = parts[0] || '';
  var city = parts[1] || '';
  var state = '';
  var postalCode = '';
  if (parts.length >= 4) {
    state = parts[2];
    postalCode = parts[3];
  } else if (parts.length === 3) {
    var sz = parts[2].split(/\s+/);
    state = sz[0] || '';
    postalCode = sz.slice(1).join(' ') || '';
  }
  return {
    address1: address1,
    city: city,
    state: (state || '').toUpperCase().substring(0, 2),
    postalCode: postalCode,
  };
}

function _loSplitName(fullName) {
  if (!fullName) return { fname: '', lname: '' };
  var parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return { fname: parts[0], lname: '' };
  return { fname: parts[0], lname: parts.slice(1).join(' ') };
}

function _loIdTypeMap(internal) {
  // Map our internal id_type values to LeadsOnline's expected codes
  // Their docs show "DL" generic, or state-prefixed like "TXDL", "FLDL"
  var map = {
    driver_license: 'DL',
    state_id:       'StateID',
    passport:       'Passport',
    military_id:    'MIL',
    other:          'Other',
  };
  return map[internal] || internal || '';
}

function _loItemCategory(itemDesc) {
  // Bucket item description into LeadsOnline's ItemType enum.
  // Their enum is: Other, Jewelry, Firearm
  var lower = String(itemDesc || '').toLowerCase();
  if (/ring|chain|necklace|bracelet|earring|pendant|brooch|gold|silver|platinum|diamond|jewel/.test(lower)) {
    return 'Jewelry';
  }
  return 'Other';
}

function _loFmtTicketNumber(shipmentId) {
  // SHP-10 → SG-0010
  var num = String(shipmentId || '').replace(/^SHP-/, '');
  return 'SG-' + num.padStart(4, '0');
}

// ─── METHOD: SubmitTransaction & UpdateTransaction ──────────────────────

/**
 * Builds the ticket XML payload from a shipmentId. Used by both
 * loSubmitBuyTicket and loUpdateBuyTicket.
 * Returns { ok: true, ticketXml, ticketNumber, ticketDate, customerName }
 * or     { ok: false, error }.
 */
function _loBuildTicketXml(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);

  var ships = shipSheet.getDataRange().getValues();
  var custs = custSheet.getDataRange().getValues();
  var shipHeaders = ships[0];
  var custHeaders = custs[0];

  var shipIdIdx = shipHeaders.indexOf('shipment_id');
  var shipRow = null;
  for (var r = 1; r < ships.length; r++) {
    if (ships[r][shipIdIdx] === shipmentId) {
      shipRow = {};
      shipHeaders.forEach(function(h, i) { shipRow[h] = ships[r][i]; });
      break;
    }
  }
  if (!shipRow) return { ok: false, error: 'Shipment not found: ' + shipmentId };

  var custIdIdx = custHeaders.indexOf('customer_id');
  var custRow = null;
  for (var r = 1; r < custs.length; r++) {
    if (custs[r][custIdIdx] === shipRow.customer_id) {
      custRow = {};
      custHeaders.forEach(function(h, i) { custRow[h] = custs[r][i]; });
      break;
    }
  }
  if (!custRow) return { ok: false, error: 'Customer not found: ' + shipRow.customer_id };

  var ticketNumber = _loFmtTicketNumber(shipmentId);
  var ticketDate = _loFormatTicketDate(shipRow.received_at || shipRow.sent_at || shipRow.created_at);

  var addr = _loParseAddress(custRow.address);
  var nameParts = _loSplitName(custRow.name);
  var idType = _loIdTypeMap(shipRow.id_type || custRow.id_type);
  var idNumber = shipRow.id_number || custRow.id_number || '';
  var idState = shipRow.id_state || custRow.id_state || '';
  if (idType === 'DL' && idState) {
    idType = idState.toUpperCase() + 'DL';
  }
  var dob = _loFormatDob(shipRow.date_birth || custRow.date_birth);

  var purchasePrice = parseFloat(shipRow.purchase_price) || 0;
  var appraisedValue = parseFloat(shipRow.appraised_value) || 0;
  var itemDesc = String(shipRow.item || 'Jewelry/precious metal item');
  var itemType = _loItemCategory(itemDesc);

  var extraCustomerProps = [];
  if (custRow.email) {
    extraCustomerProps.push(
      '            <PropertyValue>\n' +
      '              <Name>CUSTOMER_EMAIL</Name>\n' +
      '              <Value>' + _loEscape(custRow.email) + '</Value>\n' +
      '            </PropertyValue>\n'
    );
  }
  extraCustomerProps.push(
    '            <PropertyValue>\n' +
    '              <Name>CUSTOMER_EMPLOYER</Name>\n' +
    '              <Value>Not collected (mail-in transaction)</Value>\n' +
    '            </PropertyValue>\n'
  );
  var extraCustomer = '';
  if (extraCustomerProps.length) {
    extraCustomer = '          <extraCustomer>\n' + extraCustomerProps.join('') + '          </extraCustomer>\n';
  }

  var extraItem = '';
  if (appraisedValue > 0) {
    extraItem = '            <extraItem>\n' +
      '              <PropertyValue>\n' +
      '                <Name>ITEM_LOAN_AMOUNT</Name>\n' +
      '                <Value>' + appraisedValue.toFixed(2) + '</Value>\n' +
      '              </PropertyValue>\n' +
      '            </extraItem>\n';
  }

  var ticketXml = _loApiVersionXml() + _loLoginXml() +
    '      <ticket>\n' +
    '        <key>\n' +
    '          <ticketType>Buy</ticketType>\n' +
    '          <ticketnumber>' + _loEscape(ticketNumber) + '</ticketnumber>\n' +
    '          <ticketDateTime>' + _loEscape(ticketDate) + '</ticketDateTime>\n' +
    '        </key>\n' +
    '        <customer>\n' +
    '          <name>' + _loEscape(custRow.name || '') + '</name>\n' +
    '          <fname>' + _loEscape(nameParts.fname) + '</fname>\n' +
    '          <lname>' + _loEscape(nameParts.lname) + '</lname>\n' +
    '          <address1>' + _loEscape(addr.address1) + '</address1>\n' +
    '          <city>' + _loEscape(addr.city) + '</city>\n' +
    '          <state>' + _loEscape(addr.state) + '</state>\n' +
    '          <postalCode>' + _loEscape(addr.postalCode) + '</postalCode>\n' +
    '          <phone>' + _loEscape(custRow.phone || '') + '</phone>\n' +
    '          <idType>' + _loEscape(idType) + '</idType>\n' +
    '          <idNumber>' + _loEscape(idNumber) + '</idNumber>\n' +
    '          <dob>' + _loEscape(dob) + '</dob>\n' +
    extraCustomer +
    '        </customer>\n' +
    '        <items>\n' +
    '          <Item>\n' +
    '            <description>' + _loEscape(itemDesc) + '</description>\n' +
    '            <amount>' + purchasePrice.toFixed(2) + '</amount>\n' +
    '            <itemType>' + itemType + '</itemType>\n' +
    '            <itemStatus>Buy</itemStatus>\n' +
    '            <isVoid>false</isVoid>\n' +
    '            <employee>David</employee>\n' +
    extraItem +
    '          </Item>\n' +
    '        </items>\n' +
    '        <isVoid>false</isVoid>\n' +
    '      </ticket>\n';

  return {
    ok: true,
    ticketXml: ticketXml,
    ticketNumber: ticketNumber,
    ticketDate: ticketDate,
    customerName: custRow.name || '?'
  };
}

/**
 * Submit a NEW Buy transaction. Will fail with errorCode 13 if the
 * (ticketNumber, ticketDate) pair already exists. Use loUpdateBuyTicket
 * to amend.
 */
function loSubmitBuyTicket(shipmentId) {
  var built = _loBuildTicketXml(shipmentId);
  if (!built.ok) return { success: false, error: built.error };

  Logger.log('Submitting ticket ' + built.ticketNumber + ' for ' + built.customerName);
  var result = _loCallApi('SubmitTransaction', built.ticketXml);
  result.ticketNumber = built.ticketNumber;
  result.ticketDate = built.ticketDate;
  Logger.log('Submit result: ' + JSON.stringify({
    success: result.success,
    errorCode: result.errorCode,
    errorResponse: result.errorResponse,
  }));
  return result;
}

/**
 * Update (amend) a previously-submitted Buy transaction.
 * Per the LeadsOnline WSDL, UpdateTransaction requires BOTH:
 *   <oldTicket>   = TicketKey identifying the existing record
 *   <ticket>      = full new data (same shape as Submit)
 * SubmitTransaction only needs <ticket>.
 */
function loUpdateBuyTicket(shipmentId) {
  var built = _loBuildTicketXml(shipmentId);
  if (!built.ok) return { success: false, error: built.error };

  // Prepend oldTicket block. The ticketKey must match the originally-submitted
  // ticket exactly (number + date + type), otherwise LeadsOnline returns
  // "Transaction does not exist".
  var oldTicketBlock =
    '      <oldTicket>\n' +
    '        <ticketType>Buy</ticketType>\n' +
    '        <ticketnumber>' + _loEscape(built.ticketNumber) + '</ticketnumber>\n' +
    '        <ticketDateTime>' + _loEscape(built.ticketDate) + '</ticketDateTime>\n' +
    '      </oldTicket>\n';

  // Insert oldTicket before <ticket> in the existing payload.
  // _loBuildTicketXml returns: <ApiVersion>...</ApiVersion><login>...</login><ticket>...</ticket>
  // We want:                    <ApiVersion>...</ApiVersion><login>...</login><oldTicket>...</oldTicket><ticket>...</ticket>
  var updateXml = built.ticketXml.replace(/(\s*<ticket>)/, '\n' + oldTicketBlock + '$1');

  Logger.log('Updating ticket ' + built.ticketNumber + ' for ' + built.customerName);
  var result = _loCallApi('UpdateTransaction', updateXml);
  result.ticketNumber = built.ticketNumber;
  result.ticketDate = built.ticketDate;
  Logger.log('Update result: ' + JSON.stringify({
    success: result.success,
    errorCode: result.errorCode,
    errorResponse: result.errorResponse,
  }));
  return result;
}

// ─── METHOD: UploadImage ────────────────────────────────────────────────

/**
 * Generalized photo uploader.
 * @param shipmentId  e.g. "SHP-398"
 * @param driveUrl    Google Drive viewer URL
 * @param category    'CustomerID' | 'Item' | 'Customer' | 'Thumbprint' | 'Signature' | 'Document'
 * @param itemIndex   Only used when category === 'Item'. 0-based index of item in ticket. Default -1.
 */
function loUploadImage(shipmentId, driveUrl, category, itemIndex) {
  if (!driveUrl) return { success: false, error: 'No driveUrl provided' };
  if (!category) category = 'CustomerID';
  if (typeof itemIndex !== 'number') itemIndex = -1;

  // Extract Drive file ID from URL
  var idMatch = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
  if (!idMatch) return { success: false, error: 'Could not parse Drive file ID from URL: ' + driveUrl };
  var fileId = idMatch[1];

  // Fetch file
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return { success: false, error: 'Cannot access Drive file ' + fileId + ': ' + e.toString() };
  }
  var blob = file.getBlob();
  var mime = blob.getContentType();
  var imageType = 'Jpeg';
  if (/png/i.test(mime)) imageType = 'Png';
  else if (/gif/i.test(mime)) imageType = 'Gif';
  else if (/pdf/i.test(mime)) imageType = 'Pdf';
  var base64 = Utilities.base64Encode(blob.getBytes());

  // Look up shipment date for ticketKey
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var ships = shipSheet.getDataRange().getValues();
  var headers = ships[0];
  var idIdx = headers.indexOf('shipment_id');
  var dateIdx = headers.indexOf('received_at');
  var sentIdx = headers.indexOf('sent_at');
  var createdIdx = headers.indexOf('created_at');
  var shipDate = '';
  for (var r = 1; r < ships.length; r++) {
    if (ships[r][idIdx] === shipmentId) {
      shipDate = ships[r][dateIdx] || ships[r][sentIdx] || ships[r][createdIdx];
      break;
    }
  }
  var ticketDate = _loFormatTicketDate(shipDate);
  var ticketNumber = _loFmtTicketNumber(shipmentId);

  // Per WSDL, UploadImage params are alphabetical: ApiVersion, IpAddress, img, itemIndex, login, ticketKey
  var inner = _loApiVersionXml() +
    '      <img>\n' +
    '        <imageCategory>' + category + '</imageCategory>\n' +
    '        <imageType>' + imageType + '</imageType>\n' +
    '        <imageData>' + base64 + '</imageData>\n' +
    '      </img>\n' +
    '      <itemIndex>' + itemIndex + '</itemIndex>\n' +
    _loLoginXml() +
    '      <ticketKey>\n' +
    '        <ticketType>Buy</ticketType>\n' +
    '        <ticketnumber>' + _loEscape(ticketNumber) + '</ticketnumber>\n' +
    '        <ticketDateTime>' + _loEscape(ticketDate) + '</ticketDateTime>\n' +
    '      </ticketKey>\n';

  Logger.log('Uploading ' + category + ' photo for ' + ticketNumber + ' (' + Math.round(base64.length/1024) + 'KB base64)');
  var result = _loCallApi('UploadImage', inner);
  Logger.log('UploadImage ' + category + ' result: ' + JSON.stringify({
    success: result.success,
    errorCode: result.errorCode,
    errorResponse: result.errorResponse ? result.errorResponse.substring(0, 100) : '',
  }));
  return result;
}

/**
 * Backward-compatible wrapper for ID photo upload.
 */
function loUploadIdPhoto(shipmentId, driveUrl) {
  return loUploadImage(shipmentId, driveUrl, 'CustomerID', -1);
}

/**
 * Pulls all photos for a shipment from the Photos tab and uploads them as Item photos.
 * Also uploads the id_photo_url from the Shipments row as a CustomerID photo if present.
 *
 * @param shipmentId  e.g. "SHP-398"
 * @returns           summary { itemsUploaded, idUploaded, errors[] }
 */
function loUploadAllPhotosForShipment(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  // Photos tab may or may not be in TAB constant — fall back to literal name
  var photosTabName = (typeof TAB !== 'undefined' && TAB.PHOTOS) ? TAB.PHOTOS : 'Photos';
  var photoSheet = ss.getSheetByName(photosTabName);
  if (!photoSheet) return { success: false, error: 'Photos tab not found (looked for: ' + photosTabName + ')' };

  // Find shipment's id_photo_url
  var ships = shipSheet.getDataRange().getValues();
  var shipHeaders = ships[0];
  var shipIdIdx = shipHeaders.indexOf('shipment_id');
  var idPhotoIdx = shipHeaders.indexOf('id_photo_url');
  var idPhotoUrl = '';
  for (var r = 1; r < ships.length; r++) {
    if (ships[r][shipIdIdx] === shipmentId) {
      idPhotoUrl = idPhotoIdx >= 0 ? ships[r][idPhotoIdx] : '';
      break;
    }
  }

  // Find all INVENTORY photos for this shipment in Photos tab.
  // We deliberately exclude lead_intake photos (customer-provided, may not match
  // physical items) — only photos taken at receipt count as official transaction
  // photos per FL Statute 538.32(4).
  var photos = photoSheet.getDataRange().getValues();
  var photoHeaders = photos[0];
  var pShipIdx = photoHeaders.indexOf('shipment_id');
  var pUrlIdx = photoHeaders.indexOf('drive_url');
  var pSrcIdx = photoHeaders.indexOf('source');
  var pStatusIdx = photoHeaders.indexOf('purchase_status');
  var itemPhotos = [];
  var skippedNonInventory = 0;
  var skippedReturned = 0;
  for (var r = 1; r < photos.length; r++) {
    if (photos[r][pShipIdx] === shipmentId && photos[r][pUrlIdx]) {
      var src = pSrcIdx >= 0 ? String(photos[r][pSrcIdx] || '').toLowerCase().trim() : '';
      // Skip photos explicitly marked as RETURNED — we're not buying those,
      // so they must NOT be reported to LeadsOnline (report only what we bought).
      var pstatus = pStatusIdx >= 0 ? String(photos[r][pStatusIdx] || '').toLowerCase().trim() : '';
      if (pstatus === 'returned') { skippedReturned++; continue; }
      if (src === 'inventory') {
        itemPhotos.push(photos[r][pUrlIdx]);
      } else {
        skippedNonInventory++;
      }
    }
  }

  if (skippedReturned > 0) Logger.log('Skipped ' + skippedReturned + ' RETURNED item photo(s) — not reporting to LeadsOnline.');

  Logger.log('Found ' + itemPhotos.length + ' inventory photo(s) (' + skippedNonInventory + ' lead-intake skipped) and ' + (idPhotoUrl ? '1 ID photo' : '0 ID photo') + ' for ' + shipmentId);

  var summary = { shipmentId: shipmentId, itemsUploaded: 0, idUploaded: 0, errors: [] };

  // Upload ID photo first (if present)
  if (idPhotoUrl) {
    var idResult = loUploadImage(shipmentId, idPhotoUrl, 'CustomerID', -1);
    if (idResult.success) summary.idUploaded = 1;
    else summary.errors.push('ID photo: errorCode ' + idResult.errorCode + ' - ' + idResult.errorResponse);
  }

  // Upload each item photo. itemIndex=0 because we currently submit single-item tickets.
  for (var i = 0; i < itemPhotos.length; i++) {
    var itemResult = loUploadImage(shipmentId, itemPhotos[i], 'Item', 0);
    if (itemResult.success) summary.itemsUploaded++;
    else summary.errors.push('Item photo ' + (i+1) + ': errorCode ' + itemResult.errorCode + ' - ' + itemResult.errorResponse);
    // Brief sleep between uploads to avoid hammering the endpoint
    Utilities.sleep(300);
  }

  Logger.log('Photo upload summary for ' + shipmentId + ': ' + JSON.stringify(summary));
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
//  CRM PUSH HANDLER (May 19 — one-click submit from CRM)
//
//  Called via doPost when action === 'pushToLeadsOnline'.
//  Validates readiness → submits ticket → uploads photos → stamps timestamp
//  → advances stage to 'complete'.
//
//  IMPORTANT: requires this line in your Code.gs doPost router:
//    if (action === 'pushToLeadsOnline')  return jsonResponse(handlePushToLeadsOnline(parsed));
// ═══════════════════════════════════════════════════════════════════════

function handlePushToLeadsOnline(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };

    // ── 1. Pull the shipment + customer to run preflight checks ──
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
    var shipment = null;
    for (var i = 0; i < shipRows.length; i++) {
      if (shipRows[i].shipment_id === shipmentId) { shipment = shipRows[i]; break; }
    }
    if (!shipment) return { success: false, error: 'Shipment not found' };

    // Already submitted?
    if (shipment.leadsonline_submitted_at) {
      return {
        success: false,
        error: 'already_submitted',
        submitted_at: shipment.leadsonline_submitted_at,
        message: 'This shipment was already submitted to LeadsOnline on ' + shipment.leadsonline_submitted_at
      };
    }

    // Stage check — JUN 3 PIPELINE REDESIGN: the LO-report step is now the
    // 'pending_leadsonline' stage (paid, awaiting report), was 'purchased'.
    if (String(shipment.stage || '').toLowerCase() !== 'pending_leadsonline') {
      return { success: false, error: 'wrong_stage', message: 'Shipment must be at stage=pending_leadsonline. Current: ' + shipment.stage };
    }

    // Required fields
    var missing = [];
    if (!shipment.purchase_price)     missing.push('purchase_price');
    if (!shipment.id_type)            missing.push('id_type');
    if (!shipment.id_number)          missing.push('id_number');
    if (!shipment.date_birth)         missing.push('date_birth');
    if (!shipment.sworn_statement_at) missing.push('sworn_statement');
    if (missing.length) {
      return {
        success: false,
        error: 'missing_fields',
        missing: missing,
        message: 'Missing required fields: ' + missing.join(', ')
      };
    }

    // ── 2. Submit ticket ──
    Logger.log('handlePushToLeadsOnline: submitting ' + shipmentId);
    var submitResult = loSubmitBuyTicket(shipmentId);

    if (!submitResult.success) {
      Logger.log('LO submit failed: ' + JSON.stringify(submitResult));
      return {
        success: false,
        error: 'lo_submit_failed',
        lo_error_code: submitResult.errorCode,
        lo_error_response: submitResult.errorResponse,
        message: 'LeadsOnline rejected the ticket: ' + (submitResult.errorResponse || 'unknown error')
      };
    }

    var ticketNumber = submitResult.ticketNumber || '';
    Logger.log('LO submit ok: ' + ticketNumber);

    // ── 3. Stamp leadsonline_submitted_at AND advance stage to 'complete' ──
    // Do this IMMEDIATELY after the ticket submits (the compliance-critical part),
    // BEFORE photos. This way the success state is persisted in ~1s and we can
    // return fast — photos upload separately so a slow upload never makes the
    // CRM time out and show "couldn't confirm" on an actually-successful submit.
    var stamp = new Date().toISOString();
    updateShipment(shipmentId, { leadsonline_submitted_at: stamp, stage: 'complete' });

    // ── 4. Return success NOW. Photos upload via a separate call (see below). ──
    // The frontend, on success, fires action=uploadLeadsOnlinePhotos to push the
    // images without blocking this confirmation.
    return {
      success: true,
      ticket_number: ticketNumber,
      submitted_at: stamp,
      photos_pending: true,
      sandbox: LO_USE_SANDBOX,
      message: 'Submitted as ' + ticketNumber + ' · uploading photos…'
    };

  } catch (err) {
    Logger.log('handlePushToLeadsOnline error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}

// Separate, non-blocking photo upload. Called by the CRM right after a
// successful push. Safe to call multiple times (LeadsOnline overwrites images
// by category). Returns the photo summary but the ticket is already submitted
// regardless of how this goes.
function handleUploadLeadsOnlinePhotos(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };
    Logger.log('handleUploadLeadsOnlinePhotos: ' + shipmentId);
    var photoResult = loUploadAllPhotosForShipment(shipmentId);
    var parts = [];
    if (photoResult.idUploaded)    parts.push(photoResult.idUploaded + ' ID');
    if (photoResult.itemsUploaded) parts.push(photoResult.itemsUploaded + ' item');
    var msg = parts.length ? (parts.join(' + ') + ' photo(s) uploaded') : 'no photos found';
    if (photoResult.errors && photoResult.errors.length) msg += ' · ' + photoResult.errors.length + ' photo error(s)';
    return { success: true, photo_result: photoResult, message: msg };
  } catch (err) {
    Logger.log('handleUploadLeadsOnlinePhotos error: ' + err.toString());
    return { success: false, error: err.toString(), message: 'Photo upload failed (ticket already submitted): ' + err.toString() };
  }
}

// ─── TEST FUNCTIONS — run from Apps Script editor ───────────────────────

// Step 0: Check what mode we're in (sandbox vs production) and what creds are loaded
function testLoMode() {
  var c = _loCfg();
  var mode = LO_USE_SANDBOX ? 'SANDBOX' : '🚨 PRODUCTION 🚨';
  Logger.log('Current mode: ' + mode);
  Logger.log('  URL: ' + c.url);
  Logger.log('  Store ID: ' + c.storeId);
  Logger.log('  Username: ' + c.username);
  Logger.log('  Password: ' + (c.password ? c.password.substring(0,3) + '***' : '(empty)'));
  Logger.log('');
  Logger.log('To switch modes: edit LO_USE_SANDBOX at top of leadsonline.gs');
}

// Step 1: Verify credentials
function testLoCheckLogin() {
  var c = _loCfg();
  Logger.log('Mode: ' + (LO_USE_SANDBOX ? 'SANDBOX' : 'PRODUCTION'));
  var r = loCheckLogin();
  Logger.log(r.success ? '✓ Login OK' : '✗ Login failed: ' + r.errorCode + ' / ' + r.errorResponse);
}

// Step 2: Submit one purchased shipment
//   To run: change LO_TEST_SHIPMENT_ID below to a real pending_leadsonline SHP-XXX, then Run testLoSubmitOne
var LO_TEST_SHIPMENT_ID = 'SHP-150';  // April Rindfleisch — has full ID + inventory photo

function testLoSubmitOne() {
  var r = loSubmitBuyTicket(LO_TEST_SHIPMENT_ID);
  Logger.log('Result: ' + JSON.stringify(r, null, 2).substring(0, 1500));
}

// Step 3: Upload ALL photos for a shipment (ID + item photos)
//   This pulls id_photo_url from Shipments + all photos from Photos tab
//   and uploads them with the correct ImageCategory.
//   Run AFTER testLoSubmitOne for the same shipment.
function testLoUploadPhotos() {
  var r = loUploadAllPhotosForShipment(LO_TEST_SHIPMENT_ID);
  Logger.log('Result: ' + JSON.stringify(r, null, 2));
}

// Step 4: UPDATE an already-submitted ticket (after CRM data was edited).
//   Use this when you've corrected ID/DOB/payment fields after the initial
//   submission and need LeadsOnline to reflect the new data.
function testLoUpdateOne() {
  var r = loUpdateBuyTicket(LO_TEST_SHIPMENT_ID);
  Logger.log('Result: ' + JSON.stringify(r, null, 2).substring(0, 1500));
}

// Step 5: Simulate the CRM push button locally
//   Tests the full handlePushToLeadsOnline flow without needing to click in the UI.
function testHandlePush() {
  var r = handlePushToLeadsOnline({ shipment_id: LO_TEST_SHIPMENT_ID });
  Logger.log('Result: ' + JSON.stringify(r, null, 2));
}

// ─── PREFLIGHT CHECK ────────────────────────────────────────────────────
//
// Before submitting a shipment to LeadsOnline, run this to verify all
// required data is populated. Returns a report of any missing fields.
//
// Run BEFORE testLoSubmitOne to catch problems early.

function preflightCheck(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var photoSheet = ss.getSheetByName(TAB.PHOTOS);

  var ships = shipSheet.getDataRange().getValues();
  var custs = custSheet.getDataRange().getValues();
  var shipHeaders = ships[0];
  var custHeaders = custs[0];

  var shipRow = null;
  var sIdx = shipHeaders.indexOf('shipment_id');
  for (var r = 1; r < ships.length; r++) {
    if (ships[r][sIdx] === shipmentId) {
      shipRow = {};
      shipHeaders.forEach(function(h, i) { shipRow[h] = ships[r][i]; });
      break;
    }
  }
  if (!shipRow) {
    Logger.log('✗ Shipment not found: ' + shipmentId);
    return { ok: false, errors: ['Shipment not found'] };
  }

  var custRow = null;
  var cIdx = custHeaders.indexOf('customer_id');
  for (var r = 1; r < custs.length; r++) {
    if (custs[r][cIdx] === shipRow.customer_id) {
      custRow = {};
      custHeaders.forEach(function(h, i) { custRow[h] = custs[r][i]; });
      break;
    }
  }
  if (!custRow) {
    Logger.log('✗ Customer not found for shipment ' + shipmentId);
    return { ok: false, errors: ['Customer not found'] };
  }

  var errors = [];
  var warnings = [];

  // Required for SubmitTransaction
  if (!custRow.name) errors.push('customer.name is empty');
  if (!custRow.address) errors.push('customer.address is empty');
  if (!custRow.phone) warnings.push('customer.phone is empty');

  var idNumber = shipRow.id_number || custRow.id_number;
  var dob = shipRow.date_birth || custRow.date_birth;
  var idType = shipRow.id_type || custRow.id_type;
  if (!idNumber) errors.push('id_number is empty (will trigger LO warning)');
  if (!dob) errors.push('date_birth is empty (will trigger LO warning)');
  if (!idType) warnings.push('id_type is empty');

  // Item details
  if (!shipRow.item) warnings.push('item description is empty');
  if (!shipRow.purchase_price || parseFloat(shipRow.purchase_price) <= 0) {
    errors.push('purchase_price is missing or zero');
  }

  // Stage check — JUN 3: now expects pending_leadsonline
  if (shipRow.stage !== 'pending_leadsonline') {
    warnings.push('stage is "' + shipRow.stage + '" not "pending_leadsonline" — only pending_leadsonline shipments should normally be submitted');
  }

  // Photos
  var photos = photoSheet.getDataRange().getValues();
  var photoHeaders = photos[0];
  var pShipIdx = photoHeaders.indexOf('shipment_id');
  var pSrcIdx = photoHeaders.indexOf('source');
  var pStatusIdx = photoHeaders.indexOf('purchase_status');
  var inventoryCount = 0;
  for (var r = 1; r < photos.length; r++) {
    if (photos[r][pShipIdx] === shipmentId) {
      var src = pSrcIdx >= 0 ? String(photos[r][pSrcIdx] || '').toLowerCase().trim() : '';
      var pstatus = pStatusIdx >= 0 ? String(photos[r][pStatusIdx] || '').toLowerCase().trim() : '';
      if (src === 'inventory' && pstatus !== 'returned') inventoryCount++;
    }
  }
  if (inventoryCount === 0) errors.push('NO inventory photos being purchased — required for LO compliance under FL 538.32(4)');

  if (!shipRow.id_photo_url) warnings.push('id_photo_url is empty (no ID photo to upload)');

  // Sworn statement
  if (!shipRow.sworn_statement_at && !custRow.sworn_statement_at) {
    warnings.push('sworn statement was not collected (FL 538.32(2)(c))');
  }

  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('PREFLIGHT for ' + shipmentId + ' (' + (custRow.name || '?') + ')');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('Mode: ' + (LO_USE_SANDBOX ? 'SANDBOX' : '🚨 PRODUCTION'));
  Logger.log('');
  if (errors.length === 0) {
    Logger.log('✓ NO ERRORS — safe to submit');
  } else {
    Logger.log('✗ ' + errors.length + ' ERROR(S):');
    errors.forEach(function(e) { Logger.log('  ✗ ' + e); });
  }
  if (warnings.length > 0) {
    Logger.log('');
    Logger.log('⚠ ' + warnings.length + ' WARNING(S) (non-blocking):');
    warnings.forEach(function(w) { Logger.log('  ⚠ ' + w); });
  }
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

function testPreflight() {
  preflightCheck(LO_TEST_SHIPMENT_ID);
}

// MAY 27 DEBUG: hard-coded test for Julie Sanford SHP-699. Run from Apps Script
// editor to see exactly what's failing on her push.
function debugJulieSanford() {
  var shipmentId = 'SHP-699';
  Logger.log('━━━ DEBUG PUSH FOR ' + shipmentId + ' ━━━');
  Logger.log('Mode: ' + (LO_USE_SANDBOX ? 'SANDBOX' : 'PRODUCTION'));

  // Pull the shipment
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var shipment = null;
  for (var i = 0; i < shipRows.length; i++) {
    if (shipRows[i].shipment_id === shipmentId) { shipment = shipRows[i]; break; }
  }
  if (!shipment) { Logger.log('SHIPMENT NOT FOUND'); return; }

  Logger.log('--- Shipment fields ---');
  Logger.log('stage: ' + shipment.stage);
  Logger.log('purchase_price: ' + shipment.purchase_price);
  Logger.log('id_type: ' + shipment.id_type);
  Logger.log('id_number: ' + shipment.id_number);
  Logger.log('id_state: ' + shipment.id_state);
  Logger.log('date_birth: ' + shipment.date_birth);
  Logger.log('sworn_statement_at: ' + shipment.sworn_statement_at);
  Logger.log('leadsonline_submitted_at: ' + shipment.leadsonline_submitted_at);
  Logger.log('customer_id: ' + shipment.customer_id);

  // Call the real handler and see what comes back
  Logger.log('--- Calling handlePushToLeadsOnline ---');
  var result = handlePushToLeadsOnline({ shipment_id: shipmentId });
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
}

// JUN 1 DEBUG: replay the LeadsOnline push for Hobert Williams.
// Logs every field + the full SOAP response so we see exactly what's wrong.
function debugHobert() {
  // Find Hobert's shipment id
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var custRows = sheetToObjects(custSheet);
  var hobert = custRows.find(function(c) { return /hobert|hobie/i.test(String(c.name||'')); });
  if (!hobert) { Logger.log('No customer with name like Hobert/Hobie found'); return; }
  Logger.log('Found customer: ' + hobert.name + ' (' + hobert.customer_id + ')');

  var shipRows = sheetToObjects(shipSheet);
  var ships = shipRows.filter(function(s) { return s.customer_id === hobert.customer_id; });
  if (!ships.length) { Logger.log('No shipments for ' + hobert.customer_id); return; }
  // Use the most recent shipment by created_at
  ships.sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });
  var shipment = ships[0];
  Logger.log('Using shipment: ' + shipment.shipment_id);

  Logger.log('--- Field dump ---');
  Logger.log('stage: ' + shipment.stage);
  Logger.log('purchase_price: [' + shipment.purchase_price + ']');
  Logger.log('id_type: [' + shipment.id_type + ']');
  Logger.log('id_number: [' + shipment.id_number + ']');
  Logger.log('id_state: [' + shipment.id_state + ']');
  Logger.log('date_birth (raw): [' + shipment.date_birth + ']');
  Logger.log('date_birth (raw cust): [' + hobert.date_birth + ']');
  Logger.log('date_birth (after _loFormatDob): [' + _loFormatDob(shipment.date_birth || hobert.date_birth) + ']');
  Logger.log('payment_method: [' + shipment.payment_method + ']');
  Logger.log('payment_info: [' + shipment.payment_info + ']');
  Logger.log('sworn_statement_at: [' + shipment.sworn_statement_at + ']');
  Logger.log('leadsonline_submitted_at: [' + shipment.leadsonline_submitted_at + ']');
  Logger.log('Customer name: [' + hobert.name + ']');
  Logger.log('Customer phone: [' + hobert.phone + ']');
  Logger.log('Customer address: [' + hobert.address + ']');

  Logger.log('--- Calling handlePushToLeadsOnline ---');
  var result = handlePushToLeadsOnline({ shipment_id: shipment.shipment_id });
  Logger.log('--- Full result ---');
  Logger.log(JSON.stringify(result, null, 2));
}
