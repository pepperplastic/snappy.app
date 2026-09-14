// ═══════════════════════════════════════════════
//  SHIPPO USPS PAY-ON-USE RETURN LABEL
//  Generates scan-based USPS return label,
//  emails PDF to customer via Postmark
// ═══════════════════════════════════════════════

// SHIPPO_API_KEY is defined once, in Code.gs (Script Property SHIPPO_API_TOKEN).
var SHIPPO_API_URL = 'https://api.goshippo.com/shipments/';

// ── Local constants (fallback if Code.gs vars not in scope) ──
var SHIPPO_POSTMARK_TOKEN = PropertiesService.getScriptProperties().getProperty('POSTMARK_API_TOKEN') || '';
var SHIPPO_POSTMARK_URL   = 'https://api.postmarkapp.com/email';
var SHIPPO_FROM_EMAIL     = 'hello@snappy.gold';
var SHIPPO_FROM_NAME      = 'Snappy Gold';

// NOTE: the CRM Fulfill path does NOT use this file's generateShippoLabel — it
// goes generateAndSendLabel → _buyShippoLabel in Code.gs. This one is for
// batchUSPSLabels and the test functions below.
function generateShippoLabel(custId, shipmentId, shippingType, address, customerName, customerEmail, customerPhone, item) {
  // shippingType: 'usps' or 'fedex' (legacy 'label' is read as fedex)
  var isFedex = normalizeShipType(shippingType) === 'fedex';
  try {
    Logger.log('generateShippoUSPSLabel: ' + shipmentId);

    // ── Parse address ──
    var parts = String(address || '').split(',').map(function(p) { return p.trim(); });
    var street1 = parts[0] || '';
    var city    = parts[1] || '';
    var state   = '';
    var zip     = '';
    if (parts.length >= 4) {
      state = parts[2].trim();
      zip   = parts[3].trim();
    } else if (parts.length === 3) {
      var sv = parts[2].trim().split(/\s+/);
      state  = sv[0] || '';
      zip    = sv[1] || '';
    }

    if (!street1 || !city || !state || !zip) {
      Logger.log('generateShippoUSPSLabel: incomplete address for ' + shipmentId);
      return { success: false, error: 'Incomplete address' };
    }

    // ── Step 1: Create Shippo shipment ──
    // is_return: true swaps addresses so customer ships TO us
    var payload = {
      address_from: {
        name:    'Snappy Gold',
        street1: '1686 S Federal Hwy #318',
        city:    'Delray Beach',
        state:   'FL',
        zip:     '33483',
        country: 'US',
        phone:   '8666130704',
        email:   'hello@snappy.gold',
      },
      address_to: {
        name:    customerName || 'Valued Customer',
        street1: street1,
        city:    city,
        state:   state,
        zip:     zip,
        country: 'US',
        phone:   (String(customerPhone || '').replace(/\D/g, '').length >= 8 ? String(customerPhone).replace(/\D/g, '') : '8666130704'),
        email:   customerEmail || '',
      },
      parcels: [{
        length:        '9',
        width:         '6',
        height:        '2',
        distance_unit: 'in',
        weight:        '1',
        mass_unit:     'lb',
      }],
      extra: {
        is_return: true,  // pay-on-use scan-based return label
      },
      async: false,
    };

    var options = {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    var res  = UrlFetchApp.fetch(SHIPPO_API_URL, options);
    var data = JSON.parse(res.getContentText());

    if (!data.object_id) {
      Logger.log('Shippo shipment error: ' + JSON.stringify(data));
      return { success: false, error: 'Shippo shipment creation failed: ' + JSON.stringify(data) };
    }

    Logger.log('Shippo shipment created: ' + data.object_id);

    // ── Step 2: Get rates and select USPS Ground Advantage ──
    var rates = data.rates || [];
    Logger.log('Rates available: ' + rates.length);

    // Log all rates for debugging
    rates.forEach(function(r) {
      Logger.log('Rate: ' + r.provider + ' name=' + (r.servicelevel ? r.servicelevel.name : r.servicelevel_name) + ' token=' + (r.servicelevel ? r.servicelevel.token : r.servicelevel_token) + ' $' + r.amount);
    });

    // Select rate based on carrier preference
    var rate;
    if (isFedex) {
      // FedEx — same rule as _buyShippoLabel in Code.gs: FedEx Ground (fedex_ground),
      // else the cheapest FedEx rate. Never another carrier.
      rate = rates.find(function(r) {
        var tok = r.servicelevel ? r.servicelevel.token : r.servicelevel_token;
        return String(r.provider || '').toLowerCase() === 'fedex' && tok === 'fedex_ground';
      });
      if (!rate) {
        var fedexRates = rates.filter(function(r) { return String(r.provider || '').toLowerCase() === 'fedex'; });
        fedexRates.sort(function(a, b) { return parseFloat(a.amount) - parseFloat(b.amount); });
        rate = fedexRates[0] || null;
      }
      if (!rate) return { success: false, error: 'No FedEx rate available from Shippo' };
    } else {
      // USPS — prefer Ground Advantage
      rate = rates.find(function(r) {
        var tok3 = r.servicelevel ? r.servicelevel.token : r.servicelevel_token;
        return r.provider === 'USPS' && tok3 === 'usps_ground_advantage';
      });
      if (!rate) rate = rates.find(function(r) { return r.provider === 'USPS'; });
      if (!rate) {
        rate = rates[0]; // fallback to cheapest available
      }
    }
    if (!rate) {
      return { success: false, error: 'No rates available from Shippo' };
    }

    Logger.log('Selected rate: ' + rate.provider + ' ' + rate.servicelevel_name + ' $' + rate.amount);

    // ── Step 3: Purchase the label ──
    var txPayload = {
      rate:         rate.object_id,
      label_file_type: 'PDF',
      async:        false,
    };

    var txOptions = {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
      payload:            JSON.stringify(txPayload),
      muteHttpExceptions: true,
    };

    var txRes  = UrlFetchApp.fetch('https://api.goshippo.com/transactions/', txOptions);
    var txData = JSON.parse(txRes.getContentText());

    Logger.log('Transaction status: ' + txData.status);

    if (txData.status !== 'SUCCESS' || !txData.label_url) {
      Logger.log('Shippo transaction error: ' + JSON.stringify(txData));
      // Extract clean error message from Shippo messages array
      var cleanError = 'Label purchase failed';
      if (txData.messages && txData.messages.length > 0) {
        var msg = txData.messages[0].text || '';
        if (msg.indexOf('Address not found') !== -1 || msg.indexOf('address') !== -1) {
          cleanError = "Invalid address - please verify the customer address and try again.";
        } else if (msg.indexOf('phone') !== -1) {
          cleanError = "Invalid phone number - please update the customer phone and try again.";
        } else {
          cleanError = msg || cleanError;
        }
      }
      return { success: false, error: cleanError };
    }

    var trackingNumber = txData.tracking_number || '';
    var labelUrl       = txData.label_url;

    Logger.log('Label URL: ' + labelUrl);
    Logger.log('Tracking: ' + trackingNumber);

    // ── Step 4: Update shipment in CRM ──
    updateShipment(shipmentId, {
      return_tracking: trackingNumber,
      stage:           'outbound_complete',
    });

    // ── Step 5: Fetch label PDF ──
    var labelRes    = UrlFetchApp.fetch(labelUrl, { muteHttpExceptions: true });
    var labelBytes  = labelRes.getContent();
    var labelBase64 = Utilities.base64Encode(labelBytes);

    // ── Step 6: Email label to customer ──
    var firstName = (customerName || '').trim().split(' ')[0] || 'there';
    var itemText  = item ? 'your ' + item : 'your item(s)';

    var emailPayload = {
      From:          SHIPPO_FROM_NAME + ' <' + SHIPPO_FROM_EMAIL + '>',
      To:            customerEmail,
      Subject:       'Your prepaid ' + (isFedex ? 'FedEx' : 'USPS') + ' shipping label is attached, ' + firstName,
      HtmlBody:      buildShippoEmail(firstName,
        'Your prepaid ' + (isFedex ? 'FedEx' : 'USPS') + ' return label is attached to this email.' +
        '\n\nJust print it, pack ' + itemText + ' in any box or padded envelope, attach the label, and ' + (isFedex ? 'drop it at any FedEx location.' : 'hand it to your postman or drop it at any post office.') +
        '\n\nFree shipping, no commitment - if my offer isn\'t good enough I\'ll send everything back at no charge.' +
        '\n\nTracking number: ' + trackingNumber +
        '\n\nAny questions, just reply here or call/text 866-613-0704.' +
        '\n\nDavid\nSnappy Gold'
      ),
      Attachments: [{
        Name:        'snappy_gold_' + (isFedex ? 'fedex' : 'usps') + '_label_' + shipmentId + '.pdf',
        Content:     labelBase64,
        ContentType: 'application/pdf',
      }],
      MessageStream: 'outbound',
    };

    var emailOptions = {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'X-Postmark-Server-Token': SHIPPO_POSTMARK_TOKEN },
      payload:            JSON.stringify(emailPayload),
      muteHttpExceptions: true,
    };

    var emailRes  = UrlFetchApp.fetch(SHIPPO_POSTMARK_URL, emailOptions);
    var emailData = JSON.parse(emailRes.getContentText());
    Logger.log('USPS label email sent: ' + (emailData.MessageID || JSON.stringify(emailData)));

    Logger.log('generateShippoUSPSLabel complete: ' + shipmentId + ' tracking=' + trackingNumber);
    return { success: true, tracking: trackingNumber, labelUrl: labelUrl };

  } catch(err) {
    Logger.log('generateShippoUSPSLabel error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}

// ── Local email builder (self-contained, no dependency on Code.gs) ──
function buildShippoEmail(firstName, body) {
  var greeting = firstName ? 'Hi ' + firstName + ',\n\n' : '';
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="padding:32px 24px;max-width:560px;">' +
    '<p style="font-size:13px;color:#888;margin:0 0 24px;">Snappy Gold · hello@snappy.gold · 866-613-0704</p>' +
    '<div style="font-size:15px;color:#222;line-height:1.8;white-space:pre-line;">' + greeting + body + '</div>' +
    '<p style="font-size:11px;color:#aaa;margin:32px 0 0;border-top:1px solid #eee;padding-top:16px;">' +
    'DW5 LLC d/b/a Snappy Gold · 1686 S Federal Hwy #318, Delray Beach, FL 33483<br>' +
    '<a href="https://snappy.gold/privacy" style="color:#aaa;">Unsubscribe</a></p>' +
    '</td></tr></table></body></html>';
}

// ── Backward-compatible wrapper for USPS ──
function generateShippoUSPSLabel(custId, shipmentId, address, customerName, customerEmail, customerPhone, item) {
  return generateShippoLabel(custId, shipmentId, 'usps', address, customerName, customerEmail, customerPhone, item);
}

// ── Test function - run this to test with your address ──
function testShippoUSPSLabel() {
  var result = generateShippoUSPSLabel(
    'CUST-TEST',
    'SHP-TEST',
    '966 Evergreen Dr, Delray Beach, FL, 33483',
    'David Weiss',
    'davidisaacweiss@yahoo.com',
    '5617026269',
    '14K Gold Test Item'
  );
  Logger.log('Result: ' + JSON.stringify(result));
}

function testShippoFedExLabel() {
  var result = generateShippoLabel(
    'CUST-TEST',
    'SHP-TEST',
    'fedex',
    '966 Evergreen Dr, Delray Beach, FL, 33483',
    'David Weiss',
    'davidisaacweiss@yahoo.com',
    '5617026269',
    '14K Gold Test Item'
  );
  Logger.log('Result: ' + JSON.stringify(result));
}
