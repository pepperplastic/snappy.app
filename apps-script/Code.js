// ═══════════════════════════════════════════════
//  SNAPPY GOLD — Code.gs (complete, with May 14 2026 multi-item patch)
//  Sheet ID: 1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM
//
//  This version includes:
//   • All May 2026 patches (item auto-fill, timestamps, inventory photos,
//     sworn statement, new columns, recovery wave builder, audits)
//   • May 14 multi-item email patch: itemPhrase() helper + getTemplate
//     uses "your items" plural form when shipment has multiple items
// ═══════════════════════════════════════════════

var SHEET_ID = '1_QStkp9Gl6t3bqWLeZs2Ynrr-ATW_r07oFCKOp3EbDM';

// ══════════════════════════════════════════════════════════════════
//  ►► RUN THIS: Shippo diagnostic. Select "AAA_runShippoTest" in the
//  dropdown at the top of the editor and click Run. Check the log.
// ══════════════════════════════════════════════════════════════════
function AAA_runShippoTest() {
  return testShippoLabel();
}

// ── Tab name constants ───────────────────────────────────────
var TAB = {
  LEADS:              'Lead Intake',
  CUSTOMERS:          'Customers',
  SHIPMENTS:          'Shipments',
  CONTACT_LOG:        'Contact Log',
  PHOTOS:             'Photos',
  SELF_SERVE_TOKENS:  'SelfServeTokens',
  SALES:              'Sales'
};

// ── Column definitions for new tabs ─────────────────────────
var COLS = {
  CUSTOMERS: [
    'customer_id','email','name','phone','address',
    'source','created_at','notes',
    'id_type','id_number','id_state','date_birth','id_photo_url',
    'sworn_statement_at','sworn_statement_ip',
    'quo_contact_id','winback_b_sent_at','winback_c_sent_at'
  ],
  SHIPMENTS: [
    // JUN 5 FIX: This array now mirrors the LIVE sheet's real column order
    // exactly (52 cols), discovered via diagShipmentHeaders(). Previously the
    // schema had drifted (46 cols, different order) from the sheet. All reads
    // (sheetToObjects) and writes (createShipment/updateShipment) map BY HEADER
    // NAME, so the drift wasn't corrupting live data — but it meant the schema
    // lied about reality and any positional write would land in the wrong column.
    // Order below = actual sheet order; do not reorder without re-running the diag.
    'shipment_id','customer_id','stage','shipping_type','item',
    'estimate','ai_estimate_raw','user_edits','outbound_tracking','return_tracking',
    'received_at','purchase_price','appraised_value','payment_method','payment_info',
    'sent_at','created_at','notes','bin_number','is_urgent',
    'ai_rationale','customer_edits','customer_edits_text','customer_message','agent_notes',
    'id_type','id_number','id_state','date_birth','id_photo_url',
    'traffic_source','variant','gclid','fbclid','last_activity_at',
    'purchased_at','returned_at','sworn_statement_at','sworn_statement_ip','leadsonline_submitted_at',
    'shipping_cost','shipping_service','easypost_shipment_id','label_qr_url','self_serve_submitted_at',
    'offer_price','paid_at','shippo_transaction_id','ship_followups_sent','capi_shipped_sent',
            'capi_purchase_sent','label_refunded_at','offer_description','deferred_at','kit_tracking','inspection_json','reengage_sent_at','flex_click_id','flex_postback_sent','triage_flag','completed_at',
            'relabel_requested_at','winback_a_sent_at','winback_a_sms_at'
  ],
  CONTACT_LOG: [
    'log_id','customer_id','timestamp','type','notes','shipment_id','direction','source','kind'
  ],
  PHOTOS: [
    'photo_id','shipment_id','drive_url','uploaded_at','source','purchase_status'
  ],
  // JUN 2 PATCH: Sales tracking. One row per sale to dealer/buyer.
  // shipment_ids is comma-separated for bundle sales (multiple shipments
  // sold as one lot, like the Rick Little bundle to Barry's Pawn).
  // JUL 17 FIX: schema drift. The LIVE sheet's real column order is
  //   sale_id, shipment_ids, buyer_name, amount, sale_date, notes, created_at, payment_method
  // but this array previously said payment_method came 5th. Since addSale/updateSale
  // map BY HEADER NAME, the mismatch scrambled sale_date/notes/created_at/payment_method
  // on every write (dates landing in payment, "ach" landing in date, etc).
  // Verified against the live sheet via diagSales(). Do NOT reorder without re-running it.
  //
  // NOTE ON ADDING COLUMNS: _ensureSalesTab appends new columns to the END of the
  // sheet. So any new field MUST be appended to the END of this array too, or the
  // schema drifts again (which is exactly how payment_method got out of order).
  //   margin_assumption: for refiner/bulk sales with no linked shipment, the
  //   assumed margin % used to impute a cost. Blank = use the 20% default.
 SALES: [
    'sale_id','shipment_ids','buyer_name','amount','sale_date','notes','created_at','payment_method','margin_assumption','sale_type','manual_cost'
  ]
};

// ── Lead Intake column indices (0-based) ────────────────────
var COL = {
  TIMESTAMP:   0,  // A
  TYPE:        1,  // B
  NAME:        2,  // C
  EMAIL:       3,  // D
  PHONE:       4,  // E
  ITEM:        5,  // F
  ITEM_TYPE:   6,  // G
  ESTIMATE:    7,  // H
  CONFIDENCE:  8,  // I
  DESCRIPTION: 9,  // J
  VARIANT:    10,  // K
  FLOW_STEP:  11,  // L
  IP:         12,  // M
  TRAFFIC_SRC:13,  // N
  MEDIUM:     14,  // O
  CAMPAIGN:   15,  // P
  AD_CONTENT: 16,  // Q
  FBCLID:     17,  // R
  GCLID:      18,  // S
  NOTES:      19,  // T
  SHIPPING:   20,  // U
  ADDRESS:    21,  // V
  PHOTO:      22,  // W
  OFFER_NOTES:23,  // X
  AUTO_REPLY: 24,  // Y
  USER_EDITS: 25,  // Z
  SESSION_ID: 26,  // AA
  REF:        27,  // AB
};

// ── Digest recipient ─────────────────────────────────────────
var DIGEST_EMAIL = 'davidisaacweiss@yahoo.com';
var DIGEST_EMAIL_YAMIT = 'yamit92@gmail.com';


// ═══════════════════════════════════════════════
//  PATCH HELPERS (May 2026)
// ═══════════════════════════════════════════════

// Truncate a customer_message to a usable item description.
// Used by handleLeadIngestion when AI didn't produce an item name
// (direct_quote / limit_gate paths) and by backfillItemFromMessage.
function _itemFromMessage(message) {
  if (!message) return '';
  var s = String(message).trim();
  if (!s) return '';
  // Prefer first sentence/line break
  var firstBreak = s.search(/[.\n]/);
  if (firstBreak > 0 && firstBreak < 100) s = s.substring(0, firstBreak);
  // Cap at 80 chars
  if (s.length > 80) s = s.substring(0, 77).trim() + '...';
  return s;
}


// ═══════════════════════════════════════════════
//  PATCH HELPERS (May 14 — multi-item emails)
// ═══════════════════════════════════════════════

// Builds "your [item]" or "your items" based on whether shipment has multiple items.
// Used by getTemplate and generateAndSendLabel to avoid "your Sterling Silver Ring"
// when customer is actually shipping 3 items.
//
// Priority:
//   1. item_manifest array (JSON or parsed) with 2+ items → "your items"
//   2. item_manifest array with 1 named item → "your <name>"
//   3. shipment.item field with " + " separator (multi-item join) → "your items"
//   4. fall back to "your [item]"
function itemPhrase(shipment) {
  if (!shipment) return 'your items';

  // Parse item_manifest if it's a JSON string
  var manifest = shipment.item_manifest;
  if (typeof manifest === 'string') {
    try { manifest = JSON.parse(manifest); } catch(e) { manifest = null; }
  }

  // 1. Manifest with 2+ items → "your items"
  if (Array.isArray(manifest) && manifest.length >= 2) {
    return 'your items';
  }

  // 2. Manifest with 1 named item → use it
  if (Array.isArray(manifest) && manifest.length === 1 && manifest[0] && manifest[0].name) {
    return 'your ' + String(manifest[0].name).trim();
  }

  // 3. Fall back to item field; "+" indicates multi-item from append-mode
  var item = String(shipment.item || '').trim();
  if (!item) return 'your items';
  if (item.indexOf(' + ') !== -1) return 'your items';

  return 'your ' + item;
}


// ═══════════════════════════════════════════════
//  _shipmentItemPhrase (MAY 20 PATCH)
//  Multi-item-aware item phrase resolver that uses the FULL shipment row.
//
//  Why this exists: itemPhrase({item: 'Foo'}) only sees the `item` column
//  string. For older shipments created before the May 19 ingestion patch,
//  multi-item shipments have one item in `item` and the rest as
//  "+ Name ($X – $Y)" lines in `notes`. This helper fetches the row,
//  counts items across both sources, and returns the right phrase.
//
//  Used by generateAndSendLabel so customers with multiple items get
//  "your items" in the label email instead of just the first item's name.
// ═══════════════════════════════════════════════

function _shipmentItemPhrase(shipmentId, fallbackItem) {
  try {
    if (!shipmentId) return itemPhrase({ item: fallbackItem });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
    var shipment = null;
    for (var i = 0; i < shipRows.length; i++) {
      if (shipRows[i].shipment_id === shipmentId) { shipment = shipRows[i]; break; }
    }
    if (!shipment) return itemPhrase({ item: fallbackItem });

    // Count items: top-level `item` (split on +) + any "+ Name ($X – $Y)" lines in notes
    var topItemNames = String(shipment.item || '').split(/\s*\+\s*/).map(function(s){return s.trim();}).filter(Boolean);
    var notes = String(shipment.notes || '');
    var appendedCount = 0;
    notes.split(/\n+/).forEach(function(line) {
      // Match "+ Name ($X)" or "+ Name ($X – $Y)" patterns
      if (/^\+\s*.+\(\s*\$[\d,]+/.test(line.trim())) appendedCount++;
    });

    var totalCount = topItemNames.length + appendedCount;
    if (totalCount >= 2) return 'your items';
    if (totalCount === 1) return 'your ' + topItemNames[0];
    return 'your items';

  } catch (err) {
    Logger.log('_shipmentItemPhrase error (non-fatal): ' + err.toString());
    return itemPhrase({ item: fallbackItem });
  }
}


// ═══════════════════════════════════════════════
//  ROUTING — doPost
// ═══════════════════════════════════════════════

function doPost(e) {
  try {
    var parsed = JSON.parse(e.postData.contents);

    // ── OpenPhone inbound webhook (no 'action' field; has its own shape) ──
    // OpenPhone posts {type:"message.received", data:{object:{...}}} on inbound SMS.
    // Detect and route BEFORE the action checks, since action will be undefined.
        // SEP 3: Quo holds the connection until we answer. handleOpenPhoneInbound
    // reads the Customers tab, the Shipments tab, calls Claude, fetches
    // OpenPhone history and sends an email — far longer than Quo will wait, so
    // it retried, failed, and disabled the webhook. Queue it and answer now;
    // processQueue does the real work a minute later.
    if (parsed && (parsed.type || parsed.object === 'event') && !parsed.action) {
      _enqueue('sms_in', parsed);
      return jsonResponse({ success: true, queued: true });
    }

    var action = parsed.action || '';

    // ── CRM actions require the shared key (injected server-side by
    //    /api/crm-proxy). Lead ingestion from snappy.gold and the OpenPhone
    //    webhook are deliberately NOT in this list — they're public callers
    //    with no way to hold a secret.
    var CRM_WRITE_ACTIONS = [
      'upsertCustomer','createShipment','updateShipment','getShipment',
      'resendLabelEmail','addContactLog','updateContactLog','deleteContactLog',
      'addSale','updateSale','deleteSale','getSales',
      'createListing','updateListing','getListings','composeFromShipment',
      'getCsThreads','getCsThreadMessages','updateCsThread','getCsNeedsReplyCount',
      'addPhoto','addInventoryPhoto','setPhotoStatus',
      'generateUSPSLabel','generateReturnLabel',
      'capturePaymentId','generateSelfServeToken',
      'pushToLeadsOnline','uploadLeadsOnlinePhotos',
            'manualCustomerShipment','migrate','getAffiliates','addAffiliate','updateAffiliate','deleteAffiliate','getAffiliateStats',
      'getMarketingRoi','getAdSpend','addAdSpend','deleteAdSpend','syncMetaSpend','getSetting','setSetting',
      'getCommsDashboard','addDoNotContact','getLabelUrl','getRules','explainRegistration',
    ];
    if (CRM_WRITE_ACTIONS.indexOf(action) !== -1) {
      if (!CRM_SECRET_KEY || (parsed.key || '') !== CRM_SECRET_KEY) {
        return jsonResponse({ success: false, error: 'Unauthorized' });
      }
    }

    // ── CRM write actions ──
    if (action === 'migrate')         return handleMigration(parsed);
    if (action === 'upsertCustomer')  return jsonResponse(upsertCustomer(parsed.data));
    if (action === 'createShipment')  return jsonResponse(createShipment(parsed.data));
    if (action === 'updateShipment')  return jsonResponse(updateShipment(parsed.shipment_id, parsed.updates));
    if (action === 'resendLabelEmail') return jsonResponse(handleResendLabelEmail(parsed));
    if (action === 'getLabelUrl')     return jsonResponse(handleGetLabelUrl(parsed));
    // ── Rules tab (rules.gs, read-only) ──
    if (action === 'getRules')            return jsonResponse(handleGetRules(parsed));
    if (action === 'explainRegistration') return jsonResponse(handleExplainRegistration(parsed));
    if (action === 'addContactLog')   return jsonResponse(addContactLog(parsed.data));
    if (action === 'getSales')        return jsonResponse({ success: true, sales: getSales() });
    if (action === 'addSale')         return jsonResponse(addSale(parsed.data));
    if (action === 'updateSale')      return jsonResponse(updateSale(parsed.sale_id, parsed.updates));
    if (action === 'deleteSale')      return jsonResponse(deleteSale(parsed.sale_id));
    // ── Affiliates ──
    if (action === 'getAffiliates')     return jsonResponse({ success:true, affiliates: getAffiliates() });
    if (action === 'addAffiliate')      return jsonResponse(addAffiliate(parsed.data));
    if (action === 'updateAffiliate')   return jsonResponse(updateAffiliate(parsed.affiliate_id, parsed.updates));
    if (action === 'deleteAffiliate')   return jsonResponse(deleteAffiliate(parsed.affiliate_id));
    if (action === 'getAffiliateStats') return jsonResponse(getAffiliateStats(parsed));
        // ── ROI / Ad Spend ──
    if (action === 'getMarketingRoi') return jsonResponse(handleGetMarketingRoi(parsed));
    if (action === 'getAdSpend')      return jsonResponse({ success: true, rows: getAdSpend(parsed) });
    if (action === 'addAdSpend')      return jsonResponse(handleAddAdSpend(parsed));
    if (action === 'deleteAdSpend')   return jsonResponse(handleDeleteAdSpend(parsed));
    if (action === 'syncMetaSpend')   return jsonResponse(handleSyncMetaSpend(parsed));
    // ── Settings ──
    if (action === 'getSetting')      return jsonResponse(handleGetSetting(parsed));
    if (action === 'setSetting')      return jsonResponse(handleSetSetting(parsed));
    // ── Comms dashboard (comms-dashboard.gs) ──
    if (action === 'getCommsDashboard') return jsonResponse(handleGetCommsDashboard(parsed));
    if (action === 'addDoNotContact')   return jsonResponse(handleAddDoNotContact(parsed));
    // ── Listing module ──
    if (action === 'createListing')      return jsonResponse({ success: true, listing: createListing(parsed.data) });
    if (action === 'updateListing')      return jsonResponse(updateListing(parsed.listing_id, parsed.updates));
    if (action === 'getListings')        return jsonResponse({ success: true, listings: getListings(parsed.status) });
    if (action === 'composeFromShipment') return jsonResponse(composeFromShipment(parsed.shipment_id));
    // ── CS Inbox ──
    if (action === 'getCsThreads')        return jsonResponse({ success: true, threads: getCsThreads(parsed.status) });
    if (action === 'getCsThreadMessages') return jsonResponse({ success: true, messages: getCsThreadMessages(parsed.thread_id) });
    if (action === 'updateCsThread')      return jsonResponse(updateCsThread(parsed.thread_id, parsed.updates));
    if (action === 'getCsNeedsReplyCount') return jsonResponse({ success: true, count: getCsNeedsReplyCount() });
    if (action === 'addPhoto')        return jsonResponse(addPhoto(parsed.data));
    if (action === 'addInventoryPhoto') return jsonResponse(handleAddInventoryPhoto(parsed));
    if (action === 'generateUSPSLabel') return jsonResponse(handleGenerateUSPSLabel(parsed));
    if (action === 'updateContactLog')  return jsonResponse(updateContactLogEntry(parsed));
    if (action === 'deleteContactLog')  return jsonResponse(deleteContactLogEntry(parsed));
    if (action === 'capturePaymentId')   return jsonResponse(handleCapturePaymentId(parsed));
    if (action === 'generateSelfServeToken') return jsonResponse(handleGenerateSelfServeToken(parsed));
    // ── Public, token-gated win-back relabel (winback.gs) — no CRM key, same
    //    shape as the self-serve token actions below it. ──
    if (action === 'relabelValidate')       return jsonResponse(handleRelabelValidate(parsed));
    if (action === 'relabelRequest')        return jsonResponse(handleRelabelRequest(parsed));
    if (action === 'validateSelfServeToken') return jsonResponse(handleValidateSelfServeToken(parsed));
    if (action === 'submitSelfServe')        return jsonResponse(handleSubmitSelfServe(parsed));
    if (action === 'pushToLeadsOnline')      return jsonResponse(handlePushToLeadsOnline(parsed));
    if (action === 'uploadLeadsOnlinePhotos') return jsonResponse(handleUploadLeadsOnlinePhotos(parsed));
    if (action === 'setPhotoStatus')         return jsonResponse(handleSetPhotoStatus(parsed));
    if (action === 'manualCustomerShipment') return jsonResponse(handleManualCustomerShipment(parsed));
    if (action === 'generateReturnLabel')    return jsonResponse(handleGenerateReturnLabel(parsed));
    if (action === 'getShipment') {
      var _gsId = parsed.shipment_id;
      var _gsRows = sheetToObjects(SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.SHIPMENTS));
      var _gsHit = null;
      for (var _gi = 0; _gi < _gsRows.length; _gi++) { if (_gsRows[_gi].shipment_id === _gsId) { _gsHit = _gsRows[_gi]; break; } }
      return jsonResponse({ success: !!_gsHit, shipment: _gsHit });
    }
    // ── Default: lead ingestion ──
    return handleLeadIngestion(parsed);

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Lead ingestion ──────────────────────────────────────────
function handleLeadIngestion(data) {
  try {console.log('=== INGEST: email=' + data.email + ' | shipping=' + data.shippingMethod + ' | address=' + data.address + ' ===');
  try { SpreadsheetApp.openById(SHEET_ID).getSheetByName('DebugLog').appendRow([new Date(), 'INGEST', data.email||'', 'ship='+(data.shippingMethod||''), 'addr='+(data.address||''), 'item='+(data.item||''), 'photo='+(data.image?'yes':'no')]); } catch(e) {}
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
    var now = new Date();
    var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

    var name = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();

    var detailsStr = '';
    if (data.details && data.details.length) {
      detailsStr = data.details.map(function(d) { return d.label + ': ' + d.value; }).join('; ');
    }

    // Build structured edits string (for legacy user_edits column)
    var editsStr = '';
    if (data.userEdits && data.userEdits.length) {
      editsStr = data.userEdits.map(function(e) {
        return e.label + ': ' + e.original + ' -> ' + e.edited;
      }).join('; ');
    }
    if (data.customerEditsText) {
      editsStr = editsStr ? editsStr + ' | Free-text: ' + data.customerEditsText : 'Free-text: ' + data.customerEditsText;
    }

    // Structured edits only (no free-text) — populates Shipments.customer_edits
    var structuredEdits = '';
    if (data.userEdits && data.userEdits.length) {
      structuredEdits = data.userEdits.map(function(e) {
        return e.label + ': ' + e.original + ' -> ' + e.edited;
      }).join('; ');
    }

    var photoUrl = uploadImageToDrive(data.image, name || 'anonymous');

    var row = [
      timestamp,
      data.source || '',
      name,
      data.email || '',
      data.phone || '',
      data.item || '',
      data.itemType || '',
      data.offerRange || '',
      data.confidence || '',
      data.description || detailsStr,
      data.variant || '',
      '',
      data.ip || '',
      data.utm_source || '',
      data.utm_medium || '',
      data.utm_campaign || '',
      data.utm_content || '',
      data.fbclid || '',
      data.gclid || '',
      data.notes || '',
      data.shippingMethod || '',
      data.address || '',
      photoUrl,
      data.offerNotes || '',
      '',   // Y: Auto Reply
      editsStr,
      data.sessionId || '',
      data.ref || '',
    ];

    sheet.appendRow(row);

    // MAY 31 PATCH: reverse-direction orphan claim. When a photo_browse row
    // comes in (no email) but a limit_gate row with the same session_id
    // already exists, attach this photo to that customer's shipment.
    // Handles the case where the customer submits contact info FIRST and
    // then continues uploading photos (Toccara SHP-756 was this pattern).
    if (!data.email && data.sessionId && photoUrl && photoUrl.indexOf('drive.google.com') !== -1) {
      try {
        var leadAllR = sheet.getDataRange().getValues();
        var Hr = leadAllR[0];
        var iTypeR = Hr.indexOf('Type');
        var iSessR = Hr.indexOf('Session ID');
        var iEmailR = Hr.indexOf('Email');
        var foundEmail = null;
        for (var rr = leadAllR.length - 2; rr >= 1; rr--) { // scan backwards
          if (leadAllR[rr][iTypeR] !== 'limit_gate') continue;
          if (String(leadAllR[rr][iSessR]) !== String(data.sessionId)) continue;
          if (!leadAllR[rr][iEmailR]) continue;
          foundEmail = String(leadAllR[rr][iEmailR]).toLowerCase().trim();
          break;
        }
        if (foundEmail) {
          var allCust = getCustomers();
          var matchCust = null;
          for (var ci = 0; ci < allCust.length; ci++) {
            if (String(allCust[ci].email).toLowerCase().trim() === foundEmail) { matchCust = allCust[ci]; break; }
          }
          if (matchCust) {
            var custShips = getShipments(matchCust.customer_id);
            // Pick the most recently created shipment (likely the one tied to this session)
            custShips.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
            if (custShips.length > 0) {
              addPhoto({ shipment_id: custShips[0].shipment_id, drive_url: photoUrl, source: 'lead_intake_deferred' });
              Logger.log('Deferred orphan claim: attached photo to ' + custShips[0].shipment_id + ' for ' + foundEmail);
            }
          }
        }
      } catch(de) { Logger.log('Deferred orphan claim error (non-fatal): ' + de.toString()); }
    }

    // ── Also upsert into Customers + Shipments tabs ──────────
    if (data.email) {
      try {
        var custId = upsertCustomer({
          email:   data.email,
          name:    name,
          phone:   data.phone   || '',
          address: data.address || '',
          source:  data.source  || data.utm_source || '',
          notes:   ''
        });

        // ── Shipment logic ──────────────────────────────────
        // PRE-RECEIVED stages: kit/label hasn't arrived at Snappy yet.
        // For these, we append photos/items to the existing shipment rather
        // than creating a new one — customer is adding more items to same send.
        // RECEIVED_OR_BEYOND: item is already in hand. New sessions = new shipment
        // (subject to the 7-day cooldown to prevent kit spam).

        var PRE_RECEIVED_FRESH = ['ready_to_fulfill', 'outbound_pending'];
        var STALE_DAYS = 14;
        var STALE_CUTOFF = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
        var existingShipments = getShipments(custId);

        var appendTarget = null;
        var mostRecentReceivedPlus = null;

        for (var si = 0; si < existingShipments.length; si++) {
          var ship = existingShipments[si];
          var stage = String(ship.stage || '').trim();
          var createdAt = ship.created_at ? new Date(ship.created_at) : null;

          // Append-eligible if pre-shipped (label/kit not yet sent), OR
          // outbound_complete but recent (label sent in last 14 days, item could still be in transit).
          // Older outbound_complete = treat as dead, customer is starting fresh.
          var isFreshPreReceived = PRE_RECEIVED_FRESH.indexOf(stage) !== -1;
          var isRecentOutboundComplete = (stage === 'outbound_complete') &&
            createdAt && createdAt > STALE_CUTOFF;

          if (isFreshPreReceived || isRecentOutboundComplete) {
            if (!appendTarget || (createdAt && createdAt > new Date(appendTarget.created_at))) {
              appendTarget = ship;
            }
          } else {
            if (!mostRecentReceivedPlus || (createdAt && createdAt > new Date(mostRecentReceivedPlus.created_at))) {
              mostRecentReceivedPlus = ship;
            }
          }
        }

        if (appendTarget) {
          // ── APPEND MODE: attach to existing pre-received shipment ──
          Logger.log('Append mode: attaching to ' + appendTarget.shipment_id + ' (' + appendTarget.stage + ')');

          // Write photo if present
          if (photoUrl && photoUrl.indexOf('drive.google.com') !== -1) {
            try {
              var existingPhotos = getPhotos(appendTarget.shipment_id);
              var photoExists = existingPhotos.some(function(p) {
                return String(p.drive_url).trim() === photoUrl.trim();
              });
              if (!photoExists) {
                addPhoto({ shipment_id: appendTarget.shipment_id, drive_url: photoUrl, source: 'lead_intake' });
                Logger.log('Photo appended to ' + appendTarget.shipment_id);
              }
            } catch(pe) { Logger.log('Photo append error (non-fatal): ' + pe.toString()); }
          }

          // Accumulate customer_message, customer_edits_text, customer_edits
          var appendUpdates = {};
          if (data.notes) {
            var existingMsg = String(appendTarget.customer_message || '');
            appendUpdates.customer_message = existingMsg
              ? existingMsg + '\n---\n' + data.notes
              : data.notes;
          }
          if (data.customerEditsText) {
            var existingEditText = String(appendTarget.customer_edits_text || '');
            appendUpdates.customer_edits_text = existingEditText
              ? existingEditText + '\n---\n' + data.customerEditsText
              : data.customerEditsText;
          }
          if (structuredEdits) {
            var existingStructured = String(appendTarget.customer_edits || '');
            appendUpdates.customer_edits = existingStructured
              ? existingStructured + '; ' + structuredEdits
              : structuredEdits;
          }
          if (Object.keys(appendUpdates).length) {
            updateShipment(appendTarget.shipment_id, appendUpdates);
            Logger.log('Accumulated customer fields on ' + appendTarget.shipment_id);
          }

          // Append item info to notes if it's new
          if (data.item || data.offerRange) {
            var newItemNote = '';
            if (data.item)       newItemNote += data.item;
            if (data.offerRange) newItemNote += ' (' + data.offerRange + ')';
            if (data.offerNotes) newItemNote += ' — ' + data.offerNotes;

            var currentNotes = String(appendTarget.notes || '');
            // MAY 21 PATCH: dedup against BOTH notes AND the top-level item column.
            // Previously only checked notes, so Lincoln's first lead (item col only,
            // no notes entry) wasn't seen as a match when the same item submitted again,
            // producing a duplicate row in the manifest.
            var newItemNorm = String(data.item || '').trim().toLowerCase();
            var existingItemNorm = String(appendTarget.item || '').trim().toLowerCase();
            var itemColTokens = existingItemNorm.split(/\s*\+\s*/).filter(Boolean);
            var dupInItemCol = !!newItemNorm && itemColTokens.indexOf(newItemNorm) !== -1;
            var dupInNotes = newItemNorm && currentNotes.toLowerCase().indexOf(newItemNorm) !== -1;
            if (newItemNote && !dupInItemCol && !dupInNotes) {
              var updatedNotes = currentNotes
                ? currentNotes + '\n+ ' + newItemNote
                : '+ ' + newItemNote;
              updateShipment(appendTarget.shipment_id, { notes: updatedNotes });
              Logger.log('Item appended to notes: ' + newItemNote);

              // MAY 19 PATCH: also accumulate item column with " + " separator
              // so the Fulfill queue and itemPhrase() see all items, not just
              // the first one (which may be empty for photo_flow leads).
              if (data.item) {
                var currentItem = String(appendTarget.item || '').trim();
                var newItem = String(data.item).trim();
                // Skip if this exact item name is already in the joined string
                var existingTokens = currentItem.split(/\s*\+\s*/).map(function(t){return t.trim().toLowerCase();}).filter(Boolean);
                if (existingTokens.indexOf(newItem.toLowerCase()) === -1) {
                  var updatedItem = currentItem
                    ? currentItem + ' + ' + newItem
                    : newItem;
                  updateShipment(appendTarget.shipment_id, { item: updatedItem });
                  Logger.log('Item column updated: ' + updatedItem);
                }
              }
            } else if ((dupInItemCol || dupInNotes) && (data.offerRange || data.offerNotes)) {
              // MAY 21 PATCH: enrichment path — second submission of the same item
              // brings data the original lacked (Lincoln's case: first lead had no
              // estimate, second had $600-$1,300). Don't append a duplicate row;
              // instead fill in the missing fields on the existing shipment.
              var enrichUpdates = {};
              if (data.offerRange && !appendTarget.estimate) enrichUpdates.estimate = data.offerRange;
              if (data.offerNotes && !appendTarget.ai_rationale) enrichUpdates.ai_rationale = data.offerNotes;
              if (Object.keys(enrichUpdates).length) {
                updateShipment(appendTarget.shipment_id, enrichUpdates);
                Logger.log('Enriched duplicate-item shipment with: ' + JSON.stringify(enrichUpdates));
              } else {
                Logger.log('Duplicate item dropped (no new data to enrich): ' + (data.item || ''));
              }
            }
          }

        } else if (data.shippingMethod && data.address) {console.log('PATH: creating new shipment');
        try { SpreadsheetApp.openById(SHEET_ID).getSheetByName('DebugLog').appendRow([new Date(), 'PATH_CREATE', data.email||'', '', '', '', '']); } catch(e) {}
          // ── CREATE MODE: no pre-received shipment exists ──
          var cooldownBlocked = false;
          if (mostRecentReceivedPlus && mostRecentReceivedPlus.created_at) {
            var daysSince = (now - new Date(mostRecentReceivedPlus.created_at)) / 86400000;
            if (daysSince < 7) {
              cooldownBlocked = true;
              Logger.log('New shipment blocked by 7-day cooldown (' + Math.round(daysSince) + ' days since last) for ' + data.email);
              if (photoUrl && photoUrl.indexOf('drive.google.com') !== -1) {
                try {
                  addPhoto({ shipment_id: mostRecentReceivedPlus.shipment_id, drive_url: photoUrl, source: 'lead_intake' });
                } catch(pe) { Logger.log('Photo write error (non-fatal): ' + pe.toString()); }
              }
            }
          }

          if (!cooldownBlocked) {
            // AI rationale now lives in its own column (ai_rationale),
            // so notes just stores photo URL for backward compatibility.
            var shipmentNotes = '';
            if (photoUrl && photoUrl.indexOf('drive.google.com') !== -1) {
              shipmentNotes = 'photo: ' + photoUrl;
            }
            var shipId = createShipment({
              customer_id:         custId,
              stage:               'ready_to_fulfill',
              shipping_type:       data.shippingMethod || '',
              // PATCH: Auto-fill item from customer_message when AI didn't produce
              // an item name (direct_quote / limit_gate paths).
              item:                data.item || _itemFromMessage(data.notes) || '',
              estimate:            data.offerRange     || '',
              ai_estimate_raw:     data.description    || detailsStr,
              user_edits:          editsStr,
              customer_edits:      structuredEdits,
              customer_edits_text: data.customerEditsText || '',
              customer_message:    data.notes || '',
              ai_rationale:        data.offerNotes || '',
              outbound_tracking:   '',
              return_tracking:     '',
              received_at:         '',
              purchase_price:      '',
              appraised_value:     '',
              payment_method:      '',
              payment_info:        '',
                           sent_at:             '',
              // FlexOffers hands us their click id as ?refid= on landing. Store
              // it now — by the time the package arrives, days or weeks later,
              // the browser session that carried it is long gone.
              flex_click_id:       data.flex_click_id || '',
              notes:               shipmentNotes
            });
            Logger.log('Shipment created for ' + data.email + ' (' + custId + ') → ' + shipId);

            if (photoUrl && photoUrl.indexOf('drive.google.com') !== -1) {
              try {
                addPhoto({ shipment_id: shipId, drive_url: photoUrl, source: 'lead_intake' });
              } catch(pe) { Logger.log('Photo write error (non-fatal): ' + pe.toString()); }
            }

            // MAY 31 PATCH: claim any orphan photo_browse rows from this same
            // session that didn't get attached yet. Fixes the limit_gate bug
            // where a customer uploads photos (session A), gets gated, then
            // submits contact info — without this, those earlier photos
            // remained orphaned and the shipment showed "No photos."
            // Safe because we only match by exact session_id.
            if (data.sessionId) {
              try {
                var ssRef = SpreadsheetApp.openById(SHEET_ID);
                var leadSheetRef = ssRef.getSheetByName(TAB.LEADS);
                var leadAll = leadSheetRef.getDataRange().getValues();
                var H = leadAll[0];
                var iSession = H.indexOf('Session ID');
                var iPhoto = H.indexOf('Photo');
                var iType = H.indexOf('Type');
                if (iSession >= 0 && iPhoto >= 0 && iType >= 0) {
                  var photosSheet = ssRef.getSheetByName(TAB.PHOTOS);
                  var photosCheck = sheetToObjects(photosSheet);
                  var alreadyLinked = {};
                  photosCheck.forEach(function(p) { if (p.drive_url) alreadyLinked[p.drive_url] = true; });
                  var claimed = 0;
                  for (var rrr = 1; rrr < leadAll.length; rrr++) {
                    if (leadAll[rrr][iType] !== 'photo_browse') continue;
                    if (String(leadAll[rrr][iSession]) !== String(data.sessionId)) continue;
                    var pUrl = leadAll[rrr][iPhoto];
                    if (!pUrl || String(pUrl).indexOf('drive.google.com') < 0) continue;
                    if (alreadyLinked[pUrl]) continue;
                    if (pUrl === photoUrl) continue; // already wrote the primary one
                    addPhoto({ shipment_id: shipId, drive_url: pUrl, source: 'lead_intake_sessionmatch' });
                    claimed++;
                  }
                  if (claimed > 0) Logger.log('Claimed ' + claimed + ' same-session orphan photos for ' + shipId);
                }
              } catch(ce) { Logger.log('Orphan photo claim error (non-fatal): ' + ce.toString()); }
            }

            // ── Auto-generate and send label ──
            // PAUSED: FedEx PDF format not yet resolved, re-enable after MFA setup
            // if (data.email && data.shippingMethod && (data.shippingMethod === 'label' || data.shippingMethod === 'usps')) {
            //   generateAndSendLabel(custId, shipId, data.shippingMethod, data.address, name, data.email, data.phone || '', data.item || '');
            // }
          }

        } else {
          Logger.log('No shipment created for ' + data.email + ': no shipping method (estimate-only lead)');
        }

      } catch(e) {
        Logger.log('CRM upsert error (non-fatal): ' + e.toString());
        try { SpreadsheetApp.openById(SHEET_ID).getSheetByName('DebugLog').appendRow([new Date(), 'ERROR', data.email||'', e.toString(), e.stack||'no stack', '', '']); } catch(e2) {}
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('handleLeadIngestion error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ═══════════════════════════════════════════════
//  ROUTING — doGet
// ═══════════════════════════════════════════════

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  var READ_ACTIONS = ['getCustomers','getShipments','getShipmentsLite',
    'getShipmentAttribution','getContactLog','getPhotos','getSales'];
  if (READ_ACTIONS.indexOf(action) !== -1) {
    var key = (e && e.parameter && e.parameter.key) || '';
    if (!CRM_SECRET_KEY || key !== CRM_SECRET_KEY) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }
  }

  if (action === 'recent')       return getRecentQuotes();
  if (action === 'crm_leads')    return getCRMLeads(e);
  if (action === 'getCustomers') return jsonResponse(getCustomers());
  if (action === 'getShipments') return jsonResponse(getShipments(e.parameter.customer_id || null));
  if (action === 'getShipmentsLite')       return jsonResponse(getShipmentsLite(e.parameter.customer_id || null));
  if (action === 'getShipmentAttribution') return jsonResponse(getShipmentAttribution(e.parameter.shipment_id || null));
  if (action === 'getContactLog')return jsonResponse(getContactLog(e.parameter.customer_id || null));
  if (action === 'getPhotos')    return jsonResponse(getPhotos(e.parameter.shipment_id || null));
  if (action === 'getSales')     return jsonResponse({ success: true, sales: getSales() });

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════
//  GET: Recent quotes for live ticker
// ═══════════════════════════════════════════════

function getRecentQuotes() {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
    var data = sheet.getDataRange().getValues();
    var quotes = [];
    for (var i = data.length - 1; i >= 1 && quotes.length < 10; i--) {
      var row = data[i];
      var item = (row[COL.ITEM] || '').toString().trim();
      var estimate = (row[COL.ESTIMATE] || '').toString().trim();
      var timestamp = row[COL.TIMESTAMP];
      if (item && estimate) {
        quotes.push({
          item: item,
          range: estimate,
          time: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
        });
      }
    }
    return ContentService
      .createTextOutput(JSON.stringify({ quotes: quotes }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ quotes: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ═══════════════════════════════════════════════
//  GET: CRM inbox sync (Lead Intake tab)
// ═══════════════════════════════════════════════

// Script Property CRM_SECRET_KEY — must match CRM_SECRET_KEY in Vercel. Missing → every
// keyed check below fails closed (an empty key never authorizes anything).
var CRM_SECRET_KEY = PropertiesService.getScriptProperties().getProperty('CRM_SECRET_KEY') || '';

function getCRMLeads(e) {
  var key = (e && e.parameter && e.parameter.key) || '';
  if (!CRM_SECRET_KEY || key !== CRM_SECRET_KEY) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
    var data = sheet.getDataRange().getValues();
    var seen = {};

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var email = (row[COL.EMAIL] || '').toString().trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) continue;

      var ts = row[COL.TIMESTAMP];
      var tsStr = ts instanceof Date ? ts.toISOString() : (ts ? new Date(ts).toISOString() : new Date().toISOString());

      var record = {
        email:     email,
        name:      (row[COL.NAME]        || '').toString().trim(),
        phone:     (row[COL.PHONE]       || '').toString().trim().replace(/[^0-9+]/g, ''),
        address:   (row[COL.ADDRESS]     || '').toString().trim(),
        shipping:  (row[COL.SHIPPING]    || '').toString().trim().toLowerCase(),
        estimate:  (row[COL.ESTIMATE]    || '').toString().trim(),
        item:      (row[COL.ITEM]        || '').toString().trim(),
        photo:     (row[COL.PHOTO]       || '').toString().trim(),
        userEdits: (row[COL.USER_EDITS]  || '').toString().trim(),
        source:    (row[COL.TRAFFIC_SRC] || '').toString().trim(),
        timestamp: tsStr,
      };

      if (!seen[email]) {
        seen[email] = record;
      } else {
        var ex = seen[email];
        if (record.name)     ex.name     = record.name;
        if (record.phone)    ex.phone    = record.phone;
        if (record.address)  ex.address  = record.address;
        if (record.shipping) ex.shipping = record.shipping;
        if (record.estimate) ex.estimate = record.estimate;
        if (record.item)     ex.item     = record.item;
        if (record.photo && record.photo.indexOf('drive.google.com') !== -1) ex.photo = record.photo;
        if (record.userEdits) ex.userEdits = record.userEdits;
        if (record.source)   ex.source   = record.source;
        if (new Date(record.timestamp) < new Date(ex.timestamp)) ex.timestamp = record.timestamp;
      }
    }

    var leads = [];
    var cutoff = new Date('2026-03-19T00:00:00Z');
    for (var em in seen) {
      if (new Date(seen[em].timestamp) >= cutoff) leads.push(seen[em]);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', leads: leads }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ═══════════════════════════════════════════════
//  CRM SETUP — Run once to write headers
// ═══════════════════════════════════════════════

function setupCRMTabs() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  Object.keys(COLS).forEach(function(tabKey) {
    var tabName = TAB[tabKey];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      Logger.log('Created tab: ' + tabName);
    }
    if (sheet.getLastRow() === 0) {
      var headers = COLS[tabKey];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#1A1816')
        .setFontColor('#C8953C');
      sheet.setFrozenRows(1);
      Logger.log('Headers written for: ' + tabName);
    }
  });

  Logger.log('setupCRMTabs complete.');
}

// ═══════════════════════════════════════════════
//  SETUP: Add new column headers to Customers + Shipments tabs
//  Run ONCE from the Apps Script editor after deploying this file.
//  Idempotent — safe to run multiple times.
// ═══════════════════════════════════════════════

function setupCrmTabsForPatch() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var added = [];

  // ── Shipments tab: add purchased_at, returned_at, sworn_statement_at, sworn_statement_ip ──
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var shipHeaders = shipSheet.getRange(1, 1, 1, shipSheet.getLastColumn()).getValues()[0];
  var newShipCols = ['purchased_at', 'returned_at', 'sworn_statement_at', 'sworn_statement_ip'];
  newShipCols.forEach(function(col) {
    if (shipHeaders.indexOf(col) < 0) {
      var nextCol = shipSheet.getLastColumn() + 1;
      shipSheet.getRange(1, nextCol).setValue(col);
      shipSheet.getRange(1, nextCol)
        .setFontWeight('bold')
        .setBackground('#1A1816')
        .setFontColor('#C8953C');
      added.push('Shipments.' + col);
      shipHeaders = shipSheet.getRange(1, 1, 1, shipSheet.getLastColumn()).getValues()[0];
    }
  });

  // ── Customers tab: add sworn_statement_at, sworn_statement_ip ──
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var custHeaders = custSheet.getRange(1, 1, 1, custSheet.getLastColumn()).getValues()[0];
  var newCustCols = ['sworn_statement_at', 'sworn_statement_ip'];
  newCustCols.forEach(function(col) {
    if (custHeaders.indexOf(col) < 0) {
      var nextCol = custSheet.getLastColumn() + 1;
      custSheet.getRange(1, nextCol).setValue(col);
      custSheet.getRange(1, nextCol)
        .setFontWeight('bold')
        .setBackground('#1A1816')
        .setFontColor('#C8953C');
      added.push('Customers.' + col);
      custHeaders = custSheet.getRange(1, 1, 1, custSheet.getLastColumn()).getValues()[0];
    }
  });

  if (added.length === 0) {
    Logger.log('setupCrmTabsForPatch: all columns already exist, nothing to add');
  } else {
    Logger.log('setupCrmTabsForPatch: added ' + added.length + ' columns: ' + added.join(', '));
  }
  return added;
}

// ═══════════════════════════════════════════════
//  GENERAL COLUMN FIXER
//  Ensures every column declared in COLS exists in the actual sheet.
//  Run this any time you add a new column to a COLS array.
//  Idempotent — safe to run multiple times.
// ═══════════════════════════════════════════════

function ensureAllColumns() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var added = [];

  Object.keys(COLS).forEach(function(tabKey) {
    var tabName = TAB[tabKey];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log('ensureAllColumns: tab ' + tabName + ' does not exist, skipping');
      return;
    }
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    COLS[tabKey].forEach(function(col) {
      if (headers.indexOf(col) < 0) {
        var nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol).setValue(col);
        sheet.getRange(1, nextCol)
          .setFontWeight('bold')
          .setBackground('#1A1816')
          .setFontColor('#C8953C');
        added.push(tabName + '.' + col);
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      }
    });
  });

  if (added.length === 0) {
    Logger.log('ensureAllColumns: all columns already exist');
  } else {
    Logger.log('ensureAllColumns: added ' + added.length + ' columns: ' + added.join(', '));
  }
  return added;
}


// ═══════════════════════════════════════════════
//  PIPELINE MIGRATION (Jun 3 redesign) — ONE-TIME, idempotent
//
//  Remaps old stages to the new pipeline:
//    offer_made  → pending_response
//    purchased   → split by what's already happened:
//                    - leadsonline_submitted_at set  → complete
//                    - else paid (paid_at OR payment_info present) → pending_leadsonline
//                    - else → pending_payment
//  Leaves all other stages untouched (estimate_only, ready_to_fulfill,
//  outbound_complete, received, inspected, returned, dead).
//
//  DRY RUN FIRST: run migratePipelineStages(true) to see what WOULD change
//  without writing. Then migratePipelineStages(false) to apply.
// ═══════════════════════════════════════════════

function migratePipelineStages(dryRun) {
  if (dryRun === undefined) dryRun = true;  // default to safe preview
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var stageIdx   = headers.indexOf('stage');
  var loIdx      = headers.indexOf('leadsonline_submitted_at');
  var paidIdx    = headers.indexOf('paid_at');
  var payInfoIdx = headers.indexOf('payment_info');
  var idIdx      = headers.indexOf('shipment_id');

  if (stageIdx < 0) { Logger.log('✗ no stage column — aborting'); return; }

  var changes = [];
  for (var r = 1; r < data.length; r++) {
    var stage = String(data[r][stageIdx] || '').trim();
    var newStage = null;

    if (stage === 'offer_made') {
      newStage = 'pending_response';
    } else if (stage === 'purchased') {
      var loDone  = loIdx >= 0   && String(data[r][loIdx] || '').trim() !== '';
      var paid    = (paidIdx >= 0 && String(data[r][paidIdx] || '').trim() !== '') ||
                    (payInfoIdx >= 0 && String(data[r][payInfoIdx] || '').trim() !== '');
      if (loDone)      newStage = 'complete';
      else if (paid)   newStage = 'pending_leadsonline';
      else             newStage = 'pending_payment';
    }

    if (newStage && newStage !== stage) {
      changes.push({ row: r + 1, id: data[r][idIdx], from: stage, to: newStage });
      if (!dryRun) sheet.getRange(r + 1, stageIdx + 1).setValue(newStage);
    }
  }

  Logger.log('━━━ Pipeline migration ' + (dryRun ? '(DRY RUN — no writes)' : '(APPLIED)') + ' ━━━');
  Logger.log(changes.length + ' shipment(s) ' + (dryRun ? 'would be' : 'were') + ' remapped:');
  changes.forEach(function(c) {
    Logger.log('  ' + c.id + ': ' + c.from + ' → ' + c.to);
  });
  if (dryRun && changes.length) Logger.log('\nRe-run as migratePipelineStages(false) to apply.');
  return changes;
}


// ═══════════════════════════════════════════════
//  CRM HELPERS
// ═══════════════════════════════════════════════

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function nextId(sheet, prefix, colIndex) {
  var last = sheet.getLastRow();
  if (last < 2) return prefix + '001';
  var existing = sheet.getRange(2, colIndex + 1, last - 1, 1).getValues()
    .flat()
    .filter(function(v) { return String(v).startsWith(prefix); })
    .map(function(v) { return parseInt(v.replace(prefix, ''), 10) || 0; });
  var max = existing.length ? Math.max.apply(null, existing) : 0;
  return prefix + String(max + 1).padStart(3, '0');
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════
//  CUSTOMERS
// ═══════════════════════════════════════════════

function getCustomers() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
}

function getCustomerByEmail(email) {
  return getCustomers().find(function(c) {
    return String(c.email).toLowerCase() === String(email).toLowerCase();
  }) || null;
}

function upsertCustomer(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.CUSTOMERS);
  var existing = getCustomerByEmail(data.email);

  if (existing) {
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var emailIdx = headers.indexOf('email');
    for (var r = 1; r < allRows.length; r++) {
      if (String(allRows[r][emailIdx]).toLowerCase() === String(data.email).toLowerCase()) {
        Object.keys(data).forEach(function(key) {
          var col = headers.indexOf(key);
          if (col >= 0 && data[key] !== undefined && data[key] !== '') {
            sheet.getRange(r + 1, col + 1).setValue(data[key]);
          }
        });
        break;
      }
    }
    try { pgMirrorCustomer(existing.customer_id); } catch (e) { Logger.log('pg mirror (non-fatal): ' + e); }
    return existing.customer_id;
  } else {
    var custId = nextId(sheet, 'CUST-', 0);
    var row = COLS.CUSTOMERS.map(function(col) {
      if (col === 'customer_id') return custId;
      if (col === 'created_at')  return new Date().toISOString();
      return data[col] !== undefined ? data[col] : '';
    });
    sheet.appendRow(row);
    try { pgMirrorCustomer(custId); } catch (e) { Logger.log('pg mirror (non-fatal): ' + e); }
    return custId;
  }
}


// ═══════════════════════════════════════════════
//  SHIPMENTS
// ═══════════════════════════════════════════════

// ── Shipping type (Sep 14) ────────────────────────────────
// The site's three choices: 'fedex' = emailed FedEx label (stored as 'label'
// before Sep 14), 'usps' = emailed USPS label, 'kit' = FedEx kit. Lower-cases,
// trims, and reads legacy 'label' as 'fedex'. Blank stays '' and anything else
// comes back as-is, so callers refuse it instead of guessing a carrier.
// Existing rows are not rewritten. src/crm.jsx has the same helper.
function normalizeShipType(v) {
  var t = String(v == null ? '' : v).trim().toLowerCase();
  return t === 'label' ? 'fedex' : t;
}

function createShipment(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var shipId = nextId(sheet, 'SHP-', 0);
  var row = COLS.SHIPMENTS.map(function(col) {
    if (col === 'shipment_id') return shipId;
    if (col === 'created_at')  return new Date().toISOString();
    if (col === 'shipping_type' && data[col] !== undefined) return normalizeShipType(data[col]);
    return data[col] !== undefined ? data[col] : '';
  });
  sheet.appendRow(row);
  try { pgMirrorShipment(shipId); } catch (e) { Logger.log('pg mirror (non-fatal): ' + e); }
  return shipId;
}

// ═══════════════════════════════════════════════
//  REPLACEMENT — getShipments + attribution lookup
//  Pre-builds email→attribution map ONCE per call.
// ═══════════════════════════════════════════════

function getShipments(customerId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  if (customerId) {
    rows = rows.filter(function(s) { return s.customer_id === customerId; });
  }

  // ── Build attribution map ONCE for all shipments in this batch ──
  // Strategy: walk Lead Intake once, keep earliest attribution-bearing row
  // per email. Then walk Customers once to build customer_id → email.
  // Finally, for each shipment, look up customer's email → attribution.

  // Step 1: Collect the customer_ids we actually need attribution for
  var neededCustIds = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].customer_id) neededCustIds[rows[i].customer_id] = true;
  }

  // Step 2: Build customer_id → email map (one pass through Customers)
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var custData = custSheet.getDataRange().getValues();
  var custHeaders = custData[0];
  var custIdIdx = custHeaders.indexOf('customer_id');
  var custEmailIdx = custHeaders.indexOf('email');
  var custIdToEmail = {};
  for (var r = 1; r < custData.length; r++) {
    var cid = custData[r][custIdIdx];
    if (cid && neededCustIds[cid]) {
      custIdToEmail[cid] = String(custData[r][custEmailIdx] || '').toLowerCase().trim();
    }
  }

  // Step 3: Build email → earliest-attribution map (one pass through Lead Intake)
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var leadData = leadSheet.getDataRange().getValues();
  var emailToAttr = {};

  // Collect the set of emails we care about — anything not in this set, skip.
  var neededEmails = {};
  Object.keys(custIdToEmail).forEach(function(cid) {
    if (custIdToEmail[cid]) neededEmails[custIdToEmail[cid]] = true;
  });

  for (var r = 1; r < leadData.length; r++) {
    var em = String(leadData[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em || !neededEmails[em]) continue;

    // Check if this row has attribution data
    var hasAttr = !!(
      leadData[r][COL.TRAFFIC_SRC] ||
      leadData[r][COL.MEDIUM] ||
      leadData[r][COL.CAMPAIGN] ||
      leadData[r][COL.AD_CONTENT] ||
      leadData[r][COL.FBCLID] ||
      leadData[r][COL.GCLID] ||
      leadData[r][COL.VARIANT] ||
      leadData[r][COL.TYPE]
    );
    if (!hasAttr) continue;

    var ts = leadData[r][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;

    var existing = emailToAttr[em];
    if (existing && existing._ts <= tsDate) continue;  // keep earliest

    emailToAttr[em] = {
      _ts:           tsDate,
      utm_source:    String(leadData[r][COL.TRAFFIC_SRC] || '').trim(),
      utm_medium:    String(leadData[r][COL.MEDIUM]      || '').trim(),
      utm_campaign:  String(leadData[r][COL.CAMPAIGN]    || '').trim(),
      utm_content:   String(leadData[r][COL.AD_CONTENT]  || '').trim(),
      fbclid:        String(leadData[r][COL.FBCLID]      || '').trim(),
      gclid:         String(leadData[r][COL.GCLID]       || '').trim(),
      variant:       String(leadData[r][COL.VARIANT]     || '').trim().toUpperCase(),
      lead_source:   String(leadData[r][COL.TYPE]        || '').trim(),
      session_id:    String(leadData[r][COL.SESSION_ID]  || '').trim(),
      first_visit:   tsDate.toISOString()
    };
  }

  // Strip the private _ts field before serializing
  Object.keys(emailToAttr).forEach(function(em) { delete emailToAttr[em]._ts; });

  // Step 4: Attach attribution to each shipment via customer_id → email → attr
  for (var i = 0; i < rows.length; i++) {
    var cid = rows[i].customer_id;
    if (!cid) continue;
    var em = custIdToEmail[cid];
    rows[i].attribution = em && emailToAttr[em] ? emailToAttr[em] : null;
  }

  return rows;
}

// ═══════════════════════════════════════════════
//  PERF PATCH (May 19) — Lite endpoints
//  getShipments() does an O(N×M) attribution join that scans the full
//  Lead Intake tab (~5000 rows). That's ~5-6s on initial load even though
//  attribution is ONLY shown in the shipment detail view, not in any
//  list/queue view.
//
//  Strategy:
//   - getShipmentsLite(): same as getShipments but skips the attribution join.
//     Used by the CRM on initial load. Cuts load from ~5s → ~1s.
//   - getShipmentAttribution(shipmentId): fetches attribution for a SINGLE
//     shipment, lazy-loaded by the detail view when opened.
//
//  Original getShipments() is preserved for any caller that needs the joined
//  data in one go (analytics scripts, etc).
// ═══════════════════════════════════════════════

function getShipmentsLite(customerId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  if (customerId) {
    rows = rows.filter(function(s) { return s.customer_id === customerId; });
  }
  // No attribution join — that's the whole point. attribution=null on each
  // row so the frontend can distinguish "not loaded yet" from "no attribution".
  for (var i = 0; i < rows.length; i++) rows[i].attribution = null;
  return rows;
}

function getShipmentAttribution(shipmentId) {
  if (!shipmentId) return null;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var shipment = null;
  for (var i = 0; i < shipRows.length; i++) {
    if (shipRows[i].shipment_id === shipmentId) { shipment = shipRows[i]; break; }
  }
  if (!shipment) return null;
  // Reuse the existing single-customer attribution lookup
  return getAttributionForCustomer(shipment.customer_id) || null;
}


// Kept for backwards compatibility — anything else that calls
// getAttributionForCustomer directly will still work, just slowly.
// Don't call this in a loop; use the pre-built map inside getShipments instead.
function getAttributionForCustomer(customerId) {
  if (!customerId) return null;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var customer = null;
  for (var i = 0; i < custRows.length; i++) {
    if (custRows[i].customer_id === customerId) { customer = custRows[i]; break; }
  }
  if (!customer || !customer.email) return null;
  var targetEmail = String(customer.email).toLowerCase().trim();

  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var data = leadSheet.getDataRange().getValues();
  var bestRow = null;
  var bestTs = null;

  for (var r = 1; r < data.length; r++) {
    var em = (data[r][COL.EMAIL] || '').toString().toLowerCase().trim();
    if (em !== targetEmail) continue;
    var ts = data[r][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    var hasAttr = !!(
      data[r][COL.TRAFFIC_SRC] || data[r][COL.MEDIUM] || data[r][COL.CAMPAIGN] ||
      data[r][COL.AD_CONTENT]  || data[r][COL.FBCLID] || data[r][COL.GCLID] ||
      data[r][COL.VARIANT]     || data[r][COL.TYPE]
    );
    if (!hasAttr) continue;
    if (!bestTs || tsDate < bestTs) { bestTs = tsDate; bestRow = data[r]; }
  }
  if (!bestRow) return null;
  return {
    utm_source:    String(bestRow[COL.TRAFFIC_SRC] || '').trim(),
    utm_medium:    String(bestRow[COL.MEDIUM]      || '').trim(),
    utm_campaign:  String(bestRow[COL.CAMPAIGN]    || '').trim(),
    utm_content:   String(bestRow[COL.AD_CONTENT]  || '').trim(),
    fbclid:        String(bestRow[COL.FBCLID]      || '').trim(),
    gclid:         String(bestRow[COL.GCLID]       || '').trim(),
    variant:       String(bestRow[COL.VARIANT]     || '').trim().toUpperCase(),
    lead_source:   String(bestRow[COL.TYPE]        || '').trim(),
    session_id:    String(bestRow[COL.SESSION_ID]  || '').trim(),
    first_visit:   bestTs.toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  META CONVERSIONS API (CAPI) — server-side conversion events (Jun 3)
//
//  WHY: ads optimize for CompleteRegistration (form-fillers), but ~90% never
//  ship. By sending the DEEP, OFFLINE conversions back to Meta — "this lead
//  actually shipped" and "this lead became a paid sale worth $X" — Meta's
//  algorithm recalibrates to find people who resemble real SELLERS, not
//  form-fillers. This is the fix for "leads don't convert."
//
//  Fires to the SAME pixel the ads use: KIT Pixel 1040162166644550.
//
//  Events:
//    - "Shipped"  (custom)  when shipment hits 'received'  — mid-funnel signal
//    - "Purchase" (standard) when shipment hits 'complete'  — with deal value
//
//  Match data: hashed email (SHA-256, lowercased/trimmed per Meta spec) +
//  fbc (built from the stored fbclid). The fbc is what ties the offline
//  conversion to the original ad click.
//
//  SETUP (one-time, you do this): in Apps Script → Project Settings →
//  Script Properties, add:  META_CAPI_TOKEN = <your Conversions API token>
//  (pixel ID is not secret, hardcoded below.) Until the token is present,
//  these functions no-op safely (log + skip) so nothing breaks.
// ═══════════════════════════════════════════════════════════════════════

var META_PIXEL_ID = '1040162166644550';  // KIT Pixel (matches the live ads)

function _capiToken() {
  try { return PropertiesService.getScriptProperties().getProperty('META_CAPI_TOKEN') || ''; }
  catch (e) { return ''; }
}

function _sha256Hex(input) {
  if (!input) return '';
  var norm = String(input).trim().toLowerCase();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, norm, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    if (b.length === 1) b = '0' + b;
    hex += b;
  }
  return hex;
}

// Build Meta's fbc parameter from a stored fbclid.
// Format: fb.1.<timestamp_ms>.<fbclid>
function _buildFbc(fbclid, tsMs) {
  if (!fbclid) return '';
  return 'fb.1.' + (tsMs || Date.now()) + '.' + fbclid;
}

/**
 * Send one server-side event to Meta CAPI.
 * @param eventName  'Purchase' | 'Shipped' | etc.
 * @param opts       { email, fbclid, value, currency, eventId, eventTimeSec }
 * @returns          { success, status, body } or { success:false, skipped:true }
 */
function sendMetaCapiEvent(eventName, opts) {
  var token = _capiToken();
  if (!token) {
    Logger.log('CAPI skip (' + eventName + '): no META_CAPI_TOKEN in Script Properties');
    return { success: false, skipped: true, reason: 'no_token' };
  }
  opts = opts || {};

  var userData = {};
  if (opts.email)  userData.em  = [ _sha256Hex(opts.email) ];
  var fbc = _buildFbc(opts.fbclid, opts.eventTimeSec ? opts.eventTimeSec * 1000 : Date.now());
  if (fbc) userData.fbc = fbc;

  // Meta requires at least one user_data identifier. If we have neither email
  // nor fbclid, skip — sending an unmatched event is useless.
  if (!userData.em && !userData.fbc) {
    Logger.log('CAPI skip (' + eventName + '): no email or fbclid to match on');
    return { success: false, skipped: true, reason: 'no_match_data' };
  }

  var eventData = {
    event_name: eventName,
    event_time: opts.eventTimeSec || Math.floor(Date.now() / 1000),
    action_source: 'system_generated',  // offline/CRM-originated conversion
    user_data: userData,
  };
  if (opts.eventId) eventData.event_id = opts.eventId;  // dedup key
  if (typeof opts.value === 'number' && opts.value > 0) {
    eventData.custom_data = { value: opts.value, currency: opts.currency || 'USD' };
  }

  var payload = { data: [ eventData ] };
  var url = 'https://graph.facebook.com/v19.0/' + META_PIXEL_ID + '/events?access_token=' + encodeURIComponent(token);

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code >= 200 && code < 300) {
      Logger.log('CAPI ' + eventName + ' OK (' + code + '): ' + body.substring(0, 200));
      return { success: true, status: code, body: body };
    }
    Logger.log('CAPI ' + eventName + ' FAILED (' + code + '): ' + body.substring(0, 400));
    return { success: false, status: code, body: body };
  } catch (err) {
    Logger.log('CAPI ' + eventName + ' threw: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}

/**
 * Fire the appropriate CAPI event for a shipment that just changed stage.
 * Idempotent via capi_shipped_sent / capi_purchase_sent columns.
 * Called from updateShipment after a stage write.
 */
function _fireCapiForShipment(shipmentId, newStage) {
  try {
    if (!_capiToken()) return; // no-op cleanly if not configured yet

    var stage = String(newStage || '').toLowerCase();
    var fireShipped  = (stage === 'received');
    var firePurchase = (stage === 'complete');
    if (!fireShipped && !firePurchase) return;

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.SHIPMENTS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx       = headers.indexOf('shipment_id');
    var custIdx     = headers.indexOf('customer_id');
    var priceIdx    = headers.indexOf('purchase_price');
    var shippedIdx  = headers.indexOf('capi_shipped_sent');
    var purchIdx    = headers.indexOf('capi_purchase_sent');

    var rowNum = -1, row = null;
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === shipmentId) { rowNum = r; row = data[r]; break; }
    }
    if (!row) return;

    // Idempotency
    if (fireShipped  && shippedIdx >= 0 && String(row[shippedIdx] || '').trim()) return;
    if (firePurchase && purchIdx   >= 0 && String(row[purchIdx]   || '').trim()) return;

    // Resolve customer email + attribution (fbclid)
    var customerId = row[custIdx];
    var cust = null;
    try { cust = getCustomers().find(function(c){ return c.customer_id === customerId; }) || null; } catch (e) {}
    var email = cust ? cust.email : '';
    var attr = null;
    try { attr = getAttributionForCustomer(customerId); } catch (e) {}
    var fbclid = attr ? attr.fbclid : '';

    var nowSec = Math.floor(Date.now() / 1000);

    if (fireShipped) {
      sendMetaCapiEvent('Shipped', {
        email: email, fbclid: fbclid,
        eventId: 'shipped_' + shipmentId, eventTimeSec: nowSec,
      });
      if (shippedIdx >= 0) sheet.getRange(rowNum + 1, shippedIdx + 1).setValue(new Date().toISOString());
    }

    if (firePurchase) {
      var value = parseFloat(row[priceIdx]) || 0;
      sendMetaCapiEvent('Purchase', {
        email: email, fbclid: fbclid,
        value: value, currency: 'USD',
        eventId: 'purchase_' + shipmentId, eventTimeSec: nowSec,
      });
      if (purchIdx >= 0) sheet.getRange(rowNum + 1, purchIdx + 1).setValue(new Date().toISOString());
    }
  } catch (err) {
    Logger.log('_fireCapiForShipment error (non-fatal): ' + err.toString());
  }
}

// Test helper — run from editor after setting META_CAPI_TOKEN to verify the pipe.
// Uses Meta's test_event_code if you pass one (see Events Manager → Test events).
function testCapiEvent() {
  var r = sendMetaCapiEvent('Purchase', {
    email: 'test@example.com',
    fbclid: 'TEST_fbclid_123',
    value: 180, currency: 'USD',
    eventId: 'test_' + Date.now(),
  });
  Logger.log('testCapiEvent result: ' + JSON.stringify(r));
}


// PATCH: Auto-stamp received_at / purchased_at / returned_at when stage transitions.
// Only sets if the column is empty so we never overwrite a manually-set timestamp.
function updateShipment(shipmentId, updates) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var allRows = sheet.getDataRange().getValues();
  var headers = allRows[0];
  var idIdx = headers.indexOf('shipment_id');

  for (var r = 1; r < allRows.length; r++) {
    if (allRows[r][idIdx] === shipmentId) {
      // Auto-stamp timestamps when stage transitions
      if (updates.stage) {
        var nowIso = new Date().toISOString();
        var stage = String(updates.stage).toLowerCase();
       var stampMap = {
          'outbound_complete': 'sent_at',
          'received':  'received_at',
          // AUG 3: 'purchased' was retired by the Jun 3 pipeline migration, so
          // purchased_at stopped being stamped. pending_payment is the moment
          // the offer is accepted and we own the item — that's the purchase
          // date the FL 538 30-day hold runs from. Old key kept as a no-op in
          // case any stray row still uses it.
          'pending_payment': 'purchased_at',
          'purchased': 'purchased_at',
          'returned':  'returned_at'
        };
        var stampCol = stampMap[stage];
        if (stampCol && updates[stampCol] === undefined) {
          var stampIdx = headers.indexOf(stampCol);
          if (stampIdx >= 0) {
            var existing = allRows[r][stampIdx];
            if (!existing || String(existing).trim() === '') {
              updates[stampCol] = nowIso;
            }
          }
        }
      }
      // JUN 3 PATCH: date_birth must not be auto-coerced by Sheets into a Date
      // serial (which reads back as "YYYY-MM-DDT05:00:00.000Z" and breaks
      // LeadsOnline). Normalize it AND force the cell to plain-text format so
      // Sheets stores the literal string. updateShipment is the CRM edit path;
      // it previously bypassed _normalizeDob (only handleCapturePaymentId had it).
      if (updates.date_birth !== undefined) {
        updates.date_birth = _normalizeDob(updates.date_birth);
      }
      // JUN 5 GUARD: bin_number must be a short locker id, never a timestamp.
      // Ten consecutive recent shipments (SHP-784..793) got an ISO timestamp
      // written here during a column-churn window. Root condition (schema drift)
      // is fixed, but this makes the corruption impossible + self-reporting:
      // if anything ever tries to write a timestamp-looking value to bin_number,
      // drop it and log loudly with the shipment id so we catch the caller.
      if (updates.bin_number !== undefined &&
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(updates.bin_number))) {
        Logger.log('⚠ BLOCKED timestamp write to bin_number on ' + shipmentId +
                   ' value="' + updates.bin_number + '" — dropping it. Investigate caller.');
        delete updates.bin_number;
      }
            // SEP 3 PERF: batch the write. This used to do one setValue() per changed
      // field — a separate round trip each. Build the full row in memory and
      // write it once.
      var rowVals = allRows[r].slice();
      var wroteAny = false;
      var dobCol = -1;
      Object.keys(updates).forEach(function(key) {
        var col = headers.indexOf(key);
        if (col >= 0) {
          rowVals[col] = updates[key];
          wroteAny = true;
          if (key === 'date_birth') dobCol = col;
        }
      });
      if (wroteAny) {
        // date_birth must be plain text or Sheets coerces it to a date serial,
        // which reads back as an ISO timestamp and breaks LeadsOnline.
        if (dobCol >= 0) sheet.getRange(r + 1, dobCol + 1).setNumberFormat('@');
        sheet.getRange(r + 1, 1, 1, rowVals.length).setValues([rowVals]);
      }
            if (updates.stage) {
        var _newStage = String(updates.stage).toLowerCase();
        try { _enqueue('capi', { shipment_id: shipmentId, stage: _newStage }); }
        catch (capiErr) { Logger.log('CAPI enqueue error (non-fatal): ' + capiErr); }
        // Report the FlexOffers conversion when the package actually ARRIVES,
        // not at registration.
        try { if (_newStage === FLEX_FIRE_STAGE) _enqueue('flex', { shipment_id: shipmentId }); }
        catch (flexErr) { Logger.log('Flex enqueue error (non-fatal): ' + flexErr); }
      }      
      try { pgMirrorShipment(shipmentId); } catch (e) { Logger.log('pg mirror (non-fatal): ' + e); }
      return true;
    }
  }
  return false;
}


// ═══════════════════════════════════════════════
//  CONTACT LOG
// ═══════════════════════════════════════════════

function getContactLog(customerId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.CONTACT_LOG));
  if (customerId) {
    return rows.filter(function(l) { return l.customer_id === customerId; });
  }
  return rows;
}

function addContactLog(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.CONTACT_LOG);
  var logId = nextId(sheet, 'LOG-', 0);
  // Sep 14: map by the live header row, so columns appended later
  // (direction/source/kind) can never shift values into the wrong column.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(col) {
    if (col === 'log_id')    return logId;
    if (col === 'timestamp') return new Date().toISOString();
    return data[col] !== undefined ? data[col] : '';
  });
  sheet.appendRow(row);
  return logId;
}

function updateContactLogEntry(parsed) {
  try {
    var logId = parsed.log_id;
    var updates = parsed.updates || {};
    if (!logId) return { success: false, error: 'log_id required' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.CONTACT_LOG);
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var idIdx = headers.indexOf('log_id');

    for (var r = 1; r < allRows.length; r++) {
      if (allRows[r][idIdx] === logId) {
        Object.keys(updates).forEach(function(key) {
          var col = headers.indexOf(key);
          if (col >= 0) sheet.getRange(r + 1, col + 1).setValue(updates[key]);
        });
        return { success: true };
      }
    }
    return { success: false, error: 'log not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deleteContactLogEntry(parsed) {
  try {
    var logId = parsed.log_id;
    if (!logId) return { success: false, error: 'log_id required' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.CONTACT_LOG);
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var idIdx = headers.indexOf('log_id');

    for (var r = 1; r < allRows.length; r++) {
      if (allRows[r][idIdx] === logId) {
        sheet.deleteRow(r + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'log not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════
//  PHOTOS
// ═══════════════════════════════════════════════

function getPhotos(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.PHOTOS));
  if (shipmentId) {
    return rows.filter(function(p) { return p.shipment_id === shipmentId; });
  }
  return rows;
}

// Mark an inventory photo as purchased or returned (Tambra-style partial buys).
// Returned photos are excluded from the LeadsOnline upload + preflight count.
// parsed: { photo_id, purchase_status: 'purchased' | 'returned' | '' }
// Manually create a customer + shipment in one call (for off-platform entries:
// high-value mail-ins, phone deals, FB leads handled by hand, etc.). Uses
// upsertCustomer (dedupes by email) so it won't create duplicate customers.
// parsed: { customer:{name,email,phone,address}, shipment:{stage,shipping_type,
//           item,estimate,outbound_tracking,notes} }
function handleManualCustomerShipment(parsed) {
  try {
    var c = parsed.customer || {};
    var s = parsed.shipment || {};
    if (!c.name && !c.email) return { success: false, error: 'Customer name or email required' };

    // Upsert customer (creates CUST- if new, dedupes by email if existing)
    var customerId = upsertCustomer({
      name: c.name || '', email: c.email || '', phone: c.phone || '',
      address: c.address || '', source: c.source || 'manual_entry',
    });

    // Create the shipment at the requested stage with tracking
    var shipData = {
      customer_id: customerId,
      stage: s.stage || 'ready_to_fulfill',
      shipping_type: s.shipping_type || 'usps',
      item: s.item || '',
      estimate: s.estimate || '',
      outbound_tracking: s.outbound_tracking || '',
      return_tracking: '', received_at: '', purchase_price: '', appraised_value: '',
      payment_method: '', payment_info: '', sent_at: s.outbound_tracking ? new Date().toISOString() : '',
      notes: s.notes || '',
    };
    var shipmentId = createShipment(shipData);

    try { addContactLog({ customer_id: customerId, shipment_id: shipmentId, type: 'note',
      notes: 'Manually entered into CRM' + (s.outbound_tracking ? (' with outbound tracking ' + s.outbound_tracking + ' (label created outside normal flow)') : '') + '.' }); } catch(e){}

    return { success: true, customer_id: customerId, shipment_id: shipmentId,
      message: 'Created ' + shipmentId + ' for ' + (c.name || c.email) + ' at stage ' + shipData.stage };
  } catch (err) {
    Logger.log('handleManualCustomerShipment error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}

function handleSetPhotoStatus(parsed) {
  try {
    var photoId = parsed.photo_id;
    var status = String(parsed.purchase_status || '').toLowerCase().trim();
    if (!photoId) return { success: false, error: 'photo_id required' };
    if (status && status !== 'purchased' && status !== 'returned') {
      return { success: false, error: "purchase_status must be 'purchased', 'returned', or empty" };
    }
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.PHOTOS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('photo_id');
    var statusIdx = headers.indexOf('purchase_status');
    if (statusIdx < 0) return { success: false, error: 'purchase_status column missing — run ensureAllColumns()' };
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === photoId) {
        sheet.getRange(r + 1, statusIdx + 1).setValue(status);
        return { success: true, photo_id: photoId, purchase_status: status };
      }
    }
    return { success: false, error: 'photo not found: ' + photoId };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function addPhoto(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.PHOTOS);
  var photoId = nextId(sheet, 'PHO-', 0);
  var row = COLS.PHOTOS.map(function(col) {
    if (col === 'photo_id')    return photoId;
    if (col === 'uploaded_at') return new Date().toISOString();
    return data[col] !== undefined ? data[col] : '';
  });
  sheet.appendRow(row);
  return photoId;
}

// PATCH: Inventory photo handler — called from CRM Inventory Photos panel.
// Receives shipment_id + base64 image, uploads to Drive, writes a Photos
// tab row with source='inventory' so LeadsOnline upload can filter.
function handleAddInventoryPhoto(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    var imageData = parsed.image;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };
    if (!imageData)  return { success: false, error: 'image required' };
    if (!String(imageData).startsWith('data:image')) {
      return { success: false, error: 'image must be a data:image base64 URL' };
    }

    var label = shipmentId + '_inventory';
    var driveUrl = uploadImageToDrive(imageData, label);
    if (!driveUrl || driveUrl.indexOf('drive.google.com') === -1) {
      return { success: false, error: 'Drive upload failed: ' + driveUrl };
    }

    var photoId = addPhoto({
      shipment_id: shipmentId,
      drive_url:   driveUrl,
      source:      'inventory'
    });

    Logger.log('Inventory photo added: ' + shipmentId + ' → ' + photoId);
    return { success: true, photo_id: photoId, drive_url: driveUrl };

  } catch (err) {
    Logger.log('handleAddInventoryPhoto error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════
//  DAILY PHOTO DIGEST
//  Runs at 8am ET via time-based trigger
// ═══════════════════════════════════════════════

function sendDailyPhotoDigest() {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
    var data  = sheet.getDataRange().getValues();
    var now   = new Date();
    var cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    var namedMap   = {};
    var anonMap    = {};

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var ts = row[COL.TIMESTAMP];
      var tsDate = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(tsDate.getTime()) || tsDate < cutoff) continue;

      var photoUrl = (row[COL.PHOTO] || '').toString().trim();
      if (!photoUrl || photoUrl.indexOf('drive.google.com') === -1) continue;

      var email    = (row[COL.EMAIL]    || '').toString().trim().toLowerCase();
      var name     = (row[COL.NAME]     || '').toString().trim();
      var ip       = (row[COL.IP]       || '').toString().trim();
      var item     = (row[COL.ITEM]     || '').toString().trim();
      var estimate = (row[COL.ESTIMATE] || '').toString().trim();
      var desc     = (row[COL.DESCRIPTION] || '').toString().trim();
      var source   = (row[COL.TYPE]     || '').toString().trim();

      var fileIdMatch = photoUrl.match(/\/d\/([a-zA-Z0-9_-]+)\//);
      var thumbUrl = fileIdMatch
        ? 'https://drive.google.com/thumbnail?id=' + fileIdMatch[1] + '&sz=w400'
        : photoUrl;
      var fileId = fileIdMatch ? fileIdMatch[1] : photoUrl;

      var itemEntry = {
        item:     item     || '(no item name)',
        estimate: estimate || '',
        desc:     desc     || '',
        source:   source   || '',
        photoUrl: photoUrl,
        thumbUrl: thumbUrl,
        fileId:   fileId,
        ts:       tsDate.toISOString(),
      };

      if (email && email.indexOf('@') !== -1) {
        if (source === 'photo_browse') continue;
        if (!namedMap[email]) {
          namedMap[email] = { name: name, email: email, ip: ip, items: [], seenFileIds: {}, hasShipment: false };
        }
        if (name && !namedMap[email].name) namedMap[email].name = name;
        var dedupKey = item + '|' + estimate;
        if (!namedMap[email].seenFileIds[dedupKey]) {
          namedMap[email].seenFileIds[dedupKey] = true;
          namedMap[email].items.push(itemEntry);
        }
      } else {
        if (source !== 'photo_browse') continue;
        var ipKey = ip || 'unknown';
        if (!anonMap[ipKey]) {
          anonMap[ipKey] = { ip: ipKey, items: [], seenFileIds: {} };
        }
        var dedupKey2 = item + '|' + estimate;
        if (!anonMap[ipKey].seenFileIds[dedupKey2]) {
          anonMap[ipKey].seenFileIds[dedupKey2] = true;
          anonMap[ipKey].items.push(itemEntry);
        }
      }
    }

    var namedCount = 0, anonCount = 0;
    for (var e in namedMap) namedCount += namedMap[e].items.length;
    for (var ip2 in anonMap) anonCount  += anonMap[ip2].items.length;
    var totalCount = namedCount + anonCount;

    if (totalCount === 0) {
      Logger.log('sendDailyPhotoDigest: no photos in last 24h, skipping email');
      return;
    }

    var dateStr = Utilities.formatDate(now, 'America/New_York', 'EEEE, MMMM d');
    var html = '';
    html += '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
    html += '<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">';
    html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">';
    html += '<tr><td align="center" style="padding:24px 16px;">';
    html += '<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">';

    html += '<tr><td style="background:#1A1816;padding:20px 28px;border-bottom:3px solid #C8953C;">';
    html += '<span style="font-size:22px;font-weight:bold;color:#C8953C;">Snappy</span>';
    html += '<span style="font-size:22px;color:#FAF6F0;">.Gold</span>';
    html += '<span style="font-size:13px;color:#888;margin-left:16px;">Daily Photo Digest · ' + dateStr + '</span>';
    html += '</td></tr>';

    html += '<tr><td style="padding:16px 28px;background:#FAF6F0;border-bottom:1px solid #e8e0d4;">';
    html += '<span style="font-size:14px;color:#555;">';
    html += '<strong style="color:#1A1816;">' + totalCount + ' photo' + (totalCount !== 1 ? 's' : '') + '</strong> captured in the last 24 hours';
    if (namedCount > 0) html += ' · <strong>' + namedCount + '</strong> from named customers';
    if (anonCount > 0)  html += ' · <strong>' + anonCount + '</strong> anonymous';
    html += '</span></td></tr>';

    var namedEmails = Object.keys(namedMap);
    if (namedEmails.length > 0) {
      html += '<tr><td style="padding:20px 28px 8px;">';
      html += '<h2 style="margin:0 0 16px;font-size:15px;color:#C8953C;text-transform:uppercase;letter-spacing:1px;">Named Customers (' + namedEmails.length + ')</h2>';
      html += '</td></tr>';

      namedEmails.forEach(function(em) {
        var c = namedMap[em];
        html += '<tr><td style="padding:0 28px 20px;">';
        html += '<div style="border:1px solid #e0d8cc;border-radius:6px;overflow:hidden;">';
        html += '<div style="background:#FAF6F0;padding:12px 16px;border-bottom:1px solid #e0d8cc;">';
        html += '<strong style="font-size:14px;color:#1A1816;">' + (c.name || '(no name)') + '</strong>';
        html += '<span style="font-size:12px;color:#888;margin-left:8px;">' + em + '</span>';
        html += '</div>';
        html += '<div style="padding:12px 16px;">';
        c.items.forEach(function(item, idx) {
          if (idx > 0) html += '<hr style="border:none;border-top:1px solid #f0ebe3;margin:12px 0;">';
          html += '<table cellpadding="0" cellspacing="0" width="100%"><tr>';
          html += '<td width="120" style="vertical-align:top;padding-right:12px;">';
          html += '<a href="' + item.photoUrl + '" target="_blank">';
          html += '<img src="' + item.thumbUrl + '" width="110" style="border-radius:4px;border:1px solid #ddd;display:block;" alt="photo">';
          html += '</a></td>';
          html += '<td style="vertical-align:top;">';
          html += '<div style="font-size:14px;font-weight:bold;color:#1A1816;margin-bottom:4px;">' + item.item + '</div>';
          if (item.estimate) html += '<div style="font-size:13px;color:#C8953C;font-weight:bold;margin-bottom:4px;">' + item.estimate + '</div>';
          if (item.desc) html += '<div style="font-size:12px;color:#666;line-height:1.5;margin-bottom:4px;">' + item.desc.substring(0, 200) + (item.desc.length > 200 ? '…' : '') + '</div>';
          html += '<div style="font-size:11px;color:#aaa;">' + item.source + ' · ' + new Date(item.ts).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}) + ' ET</div>';
          html += '</td></tr></table>';
        });
        html += '</div></div></td></tr>';
      });
    }

    var anonIps = Object.keys(anonMap);
    if (anonIps.length > 0) {
      html += '<tr><td style="padding:20px 28px 8px;border-top:2px solid #f0ebe3;">';
      html += '<h2 style="margin:0 0 4px;font-size:15px;color:#888;text-transform:uppercase;letter-spacing:1px;">Anonymous Visitors (' + anonIps.length + ')</h2>';
      html += '<p style="margin:0 0 16px;font-size:12px;color:#aaa;">No contact info — grouped by IP address</p>';
      html += '</td></tr>';

      anonIps.forEach(function(ipx) {
        var c = anonMap[ipx];
        html += '<tr><td style="padding:0 28px 20px;">';
        html += '<div style="border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;">';
        html += '<div style="background:#f9f9f9;padding:12px 16px;border-bottom:1px solid #e8e8e8;">';
        html += '<strong style="font-size:13px;color:#666;">Anonymous · IP: ' + ipx + '</strong>';
        html += '</div>';
        html += '<div style="padding:12px 16px;">';
        c.items.forEach(function(item, idx) {
          if (idx > 0) html += '<hr style="border:none;border-top:1px solid #f5f5f5;margin:12px 0;">';
          html += '<table cellpadding="0" cellspacing="0" width="100%"><tr>';
          html += '<td width="120" style="vertical-align:top;padding-right:12px;">';
          html += '<a href="' + item.photoUrl + '" target="_blank">';
          html += '<img src="' + item.thumbUrl + '" width="110" style="border-radius:4px;border:1px solid #ddd;display:block;" alt="photo">';
          html += '</a></td>';
          html += '<td style="vertical-align:top;">';
          html += '<div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:4px;">' + item.item + '</div>';
          if (item.estimate) html += '<div style="font-size:13px;color:#C8953C;font-weight:bold;margin-bottom:4px;">' + item.estimate + '</div>';
          if (item.desc) html += '<div style="font-size:12px;color:#666;line-height:1.5;margin-bottom:4px;">' + item.desc.substring(0, 200) + (item.desc.length > 200 ? '…' : '') + '</div>';
          html += '<div style="font-size:11px;color:#aaa;">' + item.source + ' · ' + new Date(item.ts).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}) + ' ET</div>';
          html += '</td></tr></table>';
        });
        html += '</div></div></td></tr>';
      });
    }

    html += '<tr><td style="padding:16px 28px;border-top:1px solid #eee;text-align:center;">';
    html += '<p style="margin:0;font-size:11px;color:#aaa;">Snappy Gold · DW5 LLC · 1686 S Federal Hwy #318, Delray Beach, FL 33483</p>';
    html += '</td></tr>';

    html += '</table></td></tr></table></body></html>';

    var subject = 'Snappy Gold · ' + totalCount + ' photo' + (totalCount !== 1 ? 's' : '') + ' · ' + dateStr;
    var result = sendViaPostmark(DIGEST_EMAIL, subject, html);
    Logger.log('sendDailyPhotoDigest: ' + (result.success ? 'sent (' + totalCount + ' photos)' : 'error: ' + result.error));

    var htmlYamit = buildRedactedDigest(namedMap, anonMap, totalCount, dateStr);
    sendViaPostmark(DIGEST_EMAIL_YAMIT, subject, htmlYamit);

  } catch(err) {
    Logger.log('sendDailyPhotoDigest error: ' + err.toString());
  }
}

function buildRedactedDigest(namedMap, anonMap, totalCount, dateStr) {
  var html = '';
  html += '<!DOCTYPE html><html><head><meta charset="utf-8"></head>';
  html += '<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">';
  html += '<tr><td align="center" style="padding:24px 16px;">';
  html += '<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">';
  html += '<tr><td style="background:#1A1816;padding:20px 28px;border-bottom:3px solid #C8953C;">';
  html += '<span style="font-size:22px;font-weight:bold;color:#C8953C;">Snappy</span>';
  html += '<span style="font-size:22px;color:#FAF6F0;">.Gold</span>';
  html += '<span style="font-size:13px;color:#888;margin-left:16px;">Photo Review · ' + dateStr + '</span>';
  html += '</td></tr>';
  html += '<tr><td style="padding:16px 28px;background:#FAF6F0;border-bottom:1px solid #e8e0d4;">';
  html += '<span style="font-size:14px;color:#555;"><strong style="color:#1A1816;">' + totalCount + ' photo' + (totalCount !== 1 ? 's' : '') + '</strong> for review</span>';
  html += '</td></tr>';

  var allItems = [];
  for (var e in namedMap) namedMap[e].items.forEach(function(item) { allItems.push(item); });
  for (var ip in anonMap) anonMap[ip].items.forEach(function(item) { allItems.push(item); });
  allItems.sort(function(a, b) { return new Date(a.ts) - new Date(b.ts); });

  allItems.forEach(function(item, idx) {
    html += '<tr><td style="padding:' + (idx === 0 ? '20' : '0') + 'px 28px 20px;">';
    html += '<table cellpadding="0" cellspacing="0" width="100%"><tr>';
    html += '<td width="120" style="vertical-align:top;padding-right:12px;">';
    html += '<a href="' + item.photoUrl + '" target="_blank">';
    html += '<img src="' + item.thumbUrl + '" width="110" style="border-radius:4px;border:1px solid #ddd;display:block;" alt="photo">';
    html += '</a></td>';
    html += '<td style="vertical-align:top;">';
    html += '<div style="font-size:14px;font-weight:bold;color:#1A1816;margin-bottom:4px;">' + item.item + '</div>';
    if (item.estimate) html += '<div style="font-size:13px;color:#C8953C;font-weight:bold;margin-bottom:4px;">' + item.estimate + '</div>';
    if (item.desc) html += '<div style="font-size:12px;color:#666;line-height:1.5;margin-bottom:4px;">' + item.desc.substring(0, 200) + (item.desc.length > 200 ? '…' : '') + '</div>';
    html += '</td></tr></table>';
    html += '</td></tr>';
  });

  html += '<tr><td style="padding:16px 28px;border-top:1px solid #eee;text-align:center;">';
  html += '<p style="margin:0;font-size:11px;color:#aaa;">Snappy Gold · Internal use only</p>';
  html += '</td></tr>';
  html += '</table></td></tr></table></body></html>';
  return html;
}

function createDigestTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'sendDailyPhotoDigest') {
      ScriptApp.deleteTrigger(triggers[t]);
    }
  }
  ScriptApp.newTrigger('sendDailyPhotoDigest')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('America/New_York')
    .create();
  Logger.log('Digest trigger created: sendDailyPhotoDigest at 8am ET daily');
}


// ═══════════════════════════════════════════════
//  MIGRATION — one-time
// ═══════════════════════════════════════════════

function handleMigration(payload) {
  try {
    var results = { customers_written: 0, shipments_written: 0, contact_logs_written: 0, errors: [] };
    var emailToCustId = {};

    (payload.customers || []).forEach(function(c) {
      try {
        var custId = upsertCustomer(c);
        emailToCustId[String(c.email).toLowerCase()] = custId;
        results.customers_written++;
      } catch(e) { results.errors.push('Customer ' + c.email + ': ' + e.message); }
    });

    (payload.shipments || []).forEach(function(s) {
      try {
        if (!s.customer_id && s.customer_email) {
          s.customer_id = emailToCustId[String(s.customer_email).toLowerCase()] || '';
        }
        createShipment(s);
        results.shipments_written++;
      } catch(e) { results.errors.push('Shipment for ' + s.customer_email + ': ' + e.message); }
    });

    (payload.contact_logs || []).forEach(function(l) {
      try {
        if (!l.customer_id && l.customer_email) {
          l.customer_id = emailToCustId[String(l.customer_email).toLowerCase()] || '';
        }
        addContactLog(l);
        results.contact_logs_written++;
      } catch(e) { results.errors.push('Log for ' + l.customer_email + ': ' + e.message); }
    });

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, results: results }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(e) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ═══════════════════════════════════════════════
//  EMAIL CONSTANTS
// ═══════════════════════════════════════════════

var POSTMARK_API_TOKEN  = PropertiesService.getScriptProperties().getProperty('POSTMARK_API_TOKEN') || '';
var POSTMARK_API_URL    = 'https://api.postmarkapp.com/email';
var FROM_EMAIL          = 'hello@snappy.gold';
var FROM_NAME           = 'Snappy Gold';
var THROTTLE_MS         = 2000;

var WINDOW_MIN          = 45;
var WINDOW_MAX          = 55;
var COOLDOWN_HOURS      = 4;
var FOLLOWUP_1_HOURS    = 24;
var FOLLOWUP_2_HOURS    = 72;


// ═══════════════════════════════════════════════
//  EMAIL TRIGGER — sendFollowUpEmails (legacy, kept as backup)
// ═══════════════════════════════════════════════

function sendFollowUpEmails() {
  // (kept for backup — sendFollowUpEmails_v2 below is preferred)
  sendFollowUpEmails_v2();
}


// ═══════════════════════════════════════════════
//  BUILD LEAD RECORDS — merge by session ID
// ═══════════════════════════════════════════════

function buildLeadRecords(data) {
  var sessionMap = {};
  var standalone = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var sid = (row[COL.SESSION_ID] || '').toString().trim();
    if (!sid) { standalone.push(i); continue; }
    if (!sessionMap[sid]) sessionMap[sid] = [];
    sessionMap[sid].push(i);
  }

  var leads = [];

  for (var sid in sessionMap) {
    var indices = sessionMap[sid];
    var m = { email:'', name:'', estimate:'', shipping:'', item:'', address:'',
              phone:'', photo:'', type:'', anySent:false,
              rowIndices: indices, timestamp: null };

    for (var k = 0; k < indices.length; k++) {
      var r   = data[indices[k]];
      var val;

      val = (r[COL.EMAIL]    || '').toString().trim().toLowerCase();
      if (val && val.indexOf('@') !== -1) m.email = val;

      val = (r[COL.NAME]     || '').toString().trim();
      if (val) m.name = val;

      val = (r[COL.ESTIMATE] || '').toString().trim();
      if (val) m.estimate = val;

      val = (r[COL.SHIPPING] || '').toString().trim().toLowerCase();
      if (val) m.shipping = val;

      val = (r[COL.ITEM]     || '').toString().trim();
      if (val) m.item = val;

      val = (r[COL.ADDRESS]  || '').toString().trim();
      if (val) m.address = val;

      val = (r[COL.PHONE]    || '').toString().trim();
      if (val) m.phone = val;

      val = (r[COL.TYPE]     || '').toString().trim().toLowerCase();
      if (val) m.type = val;

      val = (r[COL.AUTO_REPLY] || '').toString().trim();
      if (val) m.anySent = true;

      var ts = r[COL.TIMESTAMP];
      var tsDate = ts instanceof Date ? ts : new Date(ts);
      if (!m.timestamp || tsDate < new Date(m.timestamp)) {
        m.timestamp = tsDate.toISOString();
      }
    }
    leads.push(m);
  }

  for (var s = 0; s < standalone.length; s++) {
    var idx = standalone[s];
    var r2  = data[idx];
    var ts2 = r2[COL.TIMESTAMP];
    var tsDate2 = ts2 instanceof Date ? ts2 : new Date(ts2);
    leads.push({
      email:      (r2[COL.EMAIL]    || '').toString().trim().toLowerCase(),
      name:       (r2[COL.NAME]     || '').toString().trim(),
      estimate:   (r2[COL.ESTIMATE] || '').toString().trim(),
      shipping:   (r2[COL.SHIPPING] || '').toString().trim().toLowerCase(),
      item:       (r2[COL.ITEM]     || '').toString().trim(),
      address:    (r2[COL.ADDRESS]  || '').toString().trim(),
      phone:      (r2[COL.PHONE]    || '').toString().trim(),
      type:       (r2[COL.TYPE]     || '').toString().trim().toLowerCase(),
      anySent:    !!((r2[COL.AUTO_REPLY] || '').toString().trim()),
      rowIndices: [idx],
      timestamp:  tsDate2.toISOString(),
    });
  }

  return leads;
}


// ═══════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════

function buildReturnUrl(step, firstName, item, estimate) {
  var base   = 'https://snappy.gold';
  var params = ['return=' + encodeURIComponent(step)];
  if (firstName) params.push('firstName=' + encodeURIComponent(firstName));
  if (item)      params.push('item='      + encodeURIComponent(item));
  if (estimate)  params.push('estimate='  + encodeURIComponent(estimate));
  return base + '?' + params.join('&');
}

// ═══════════════════════════════════════════════
//  getTemplate — MAY 14 MULTI-ITEM PATCH
//  Now accepts optional `shipment` parameter. When provided, uses
//  itemPhrase(shipment) to choose between "your X" and "your items"
//  so multi-item shipments get pluralized correctly.
// ═══════════════════════════════════════════════

function getTemplate(type, firstName, item, estimate, shipping, shipment) {
  var shippingUrl = buildReturnUrl('shipping', firstName, item, estimate);
  var captureUrl  = buildReturnUrl('capture',  firstName, '',   '');

  // Compute the "your X" phrase used throughout the templates.
  // If shipment object is passed → use itemPhrase() (multi-item aware).
  // Otherwise fall back to legacy "your " + item logic.
  var phrase = shipment ? itemPhrase(shipment) : (item ? 'your ' + item : 'your items');

  // Subject-line suffix:
  //   - " - 14K Gold Ring" for singular known items
  //   - " (multiple items)" when phrase is "your items"
  //   - "" when no item info
  var subjectSuffix;
  if (phrase === 'your items') {
    subjectSuffix = ' (multiple items)';
  } else if (item) {
    subjectSuffix = ' - ' + item;
  } else {
    subjectSuffix = '';
  }

  switch (type) {
    case 'COMPLETE_KIT':
      return {
        subject: 'Got your request' + subjectSuffix + (firstName ? ', ' + firstName : ''),
        html: buildPlainEmail(firstName,
          'Just wanted to let you know I received your request for ' + phrase + ' and I\'m getting your shipping kit ready.' +
          '\n\nIt\'ll include a prepaid FedEx return label, a bubble mailer, and a short info card. Once it arrives, just pack ' + phrase + ' inside and drop it at any FedEx location - no cost to you.' +
          '\n\nFree shipping, no commitment — if my offer isn\'t good enough I\'ll send everything back at no charge.' +
          '\n\nAny questions at all, just reply here or call/text me at 866-613-0704.' +
          '\n\nDavid\nSnappy Gold'
        ),
      };
    case 'COMPLETE_LABEL':
      return {
        subject: 'Got your request' + subjectSuffix + ', ' + firstName,
        html: buildPlainEmail(firstName,
          'Just wanted to let you know I received your request for ' + phrase + ' and I\'m getting your prepaid FedEx label ready.' +
          '\n\nYou\'ll get it in a separate email shortly. Just print it, pack ' + phrase + ' in any box or padded envelope, attach the label, and drop it at any FedEx location.' +
          '\n\nFree shipping, no commitment — if my offer isn\'t good enough I\'ll send everything back at no charge.' +
          '\n\nReply here or call/text 866-613-0704 anytime.' +
          '\n\nDavid\nSnappy Gold'
        ),
      };
    case 'COMPLETE_USPS':
      return {
        subject: 'Got your request' + subjectSuffix + (firstName ? ', ' + firstName : ''),
        html: buildPlainEmail(firstName,
          'Just wanted to let you know I received your request for ' + phrase + ' and I\'m getting your prepaid USPS label ready.' +
          '\n\nYou\'ll get it in a separate email shortly. Just print it, pack ' + phrase + ' in any box or padded envelope, attach the label, and hand it to your postman or drop it at any post office.' +
          '\n\nFree shipping, no commitment — if my offer isn\'t good enough I\'ll send everything back at no charge.' +
          '\n\nReply here or call/text 866-613-0704 anytime.' +
          '\n\nDavid\nSnappy Gold'
        ),
      };
    case 'INCOMPLETE_1':
      return {
        subject: firstName ? 'Did something come up, ' + firstName + '?' : 'Did something come up?',
        html: buildPlainEmail(firstName,
          'You were almost there' + (phrase !== 'your items' ? ' on ' + phrase : '') + ' - just got pulled away before finishing, I\'m guessing.' +
          '\n\nAll that\'s left is your shipping address and whether you\'d like a label emailed to you or a kit mailed to your door. Takes about 60 seconds.' +
          (estimate ? '\n\nYour estimate of ' + estimate + ' is still on the table.' : '') +
          '\n\nFree shipping both ways, no commitment - if my offer isn\'t right for you I send everything back at no charge.' +
          '\n\nDavid\nSnappy Gold\n866-613-0704',
          shippingUrl, 'Click here to finish your request'
        ),
      };
    case 'INCOMPLETE_2':
      return {
        subject: firstName ? firstName + ', still thinking it over?' : 'Still thinking it over?',
        html: buildPlainEmail(firstName,
          'Just a quick follow-up on ' + (phrase !== 'your items' ? phrase : 'your Snappy Gold request') + ' from yesterday.' +
          '\n\nNo pressure at all - just want to make sure you have everything you need to decide.' +
          (estimate ? '\n\nYour estimate came in at ' + estimate + ' and is still valid.' : '') +
          '\n\nA couple things worth knowing: there\'s zero commitment involved - if you don\'t like my final offer I ship everything back free. And gold is genuinely near record highs right now, so the timing is good.' +
          '\n\nOr just reply here and I\'m happy to answer anything.' +
          '\n\nDavid\nSnappy Gold\n866-613-0704',
          shippingUrl, 'Finish your request here'
        ),
      };
    case 'INCOMPLETE_3':
      return {
        subject: 'Last one from me' + (firstName ? ', ' + firstName : '') + '.',
        html: buildPlainEmail(firstName,
          'I\'ll keep this short - last follow-up on ' + (phrase !== 'your items' ? phrase : 'your Snappy Gold request') + '.' +
          '\n\nIf the timing isn\'t right, totally fine - come back whenever.' +
          (estimate ? '\n\nIf you\'ve been on the fence: your estimate was ' + estimate + ', gold is near all-time highs, and there\'s no risk involved. Might be worth five minutes.' : '\n\nWhenever you\'re ready:') +
          '\n\nEither way, feel free to reach out anytime.' +
          '\n\nDavid\nSnappy Gold\n866-613-0704',
          shippingUrl, 'Claim your estimate'
        ),
      };
    default:
      return null;
  }
}


// ═══════════════════════════════════════════════
//  POSTMARK SEND
// ═══════════════════════════════════════════════

// ── Automated-send logging (Sep 14) ──────────────────────────
// Automated senders set COMMS_KIND (e.g. 'drip:INCOMPLETE_2') right before a
// send and clear it after. sendSms / sendViaPostmark then append an "auto"
// Contact Log row for the matching customer; senders that call Postmark
// directly call logAutoSend themselves. Sends with no COMMS_KIND (label
// emails, CRM-triggered offers, alerts to DW) are not logged here.
var COMMS_KIND = '';
var _commsCustIdx = null;   // per execution: normalised email / phone → customer_id

function _commsCustomerId(to) {
  if (!_commsCustIdx) {
    _commsCustIdx = { emails: {}, phones: {} };
    getCustomers().forEach(function(c) {
      if (!c.customer_id) return;
      var e = _dncNormEmail(c.email), fx = isPlausibleEmail(c.email), p = _dncNormPhone(c.phone);
      if (e && !_commsCustIdx.emails[e]) _commsCustIdx.emails[e] = c.customer_id;
      if (fx && !_commsCustIdx.emails[fx]) _commsCustIdx.emails[fx] = c.customer_id;   // typo-fixed sends still match
      if (p && !_commsCustIdx.phones[p]) _commsCustIdx.phones[p] = c.customer_id;
    });
  }
  var em = _dncNormEmail(to);
  if (em) return _commsCustIdx.emails[em] || '';
  var ph = _dncNormPhone(to);
  return (ph && _commsCustIdx.phones[ph]) || '';
}

var _contactLogColsChecked = false;
function _ensureContactLogColumns(sheet) {
  if (_contactLogColsChecked) return;
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var needed = ['direction', 'source', 'kind'];
  var toAdd = needed.filter(function(h) { return headerRow.indexOf(h) < 0; });
  var startCol = sheet.getLastColumn() + 1;
  for (var i = 0; i < toAdd.length; i++) {
    sheet.getRange(1, startCol + i).setValue(toAdd[i])
        .setFontWeight('bold')
        .setBackground('#1A1816')
        .setFontColor('#C8953C');
  }
  if (toAdd.length) Logger.log('_ensureContactLogColumns: added ' + toAdd.join(', '));
  _contactLogColsChecked = true;
}

// channel: 'sms' | 'email'; summary: the email subject or the SMS text (first 80 chars kept)
function logAutoSend(to, channel, summary) {
  if (!COMMS_KIND) return;
  try {
    var customerId = _commsCustomerId(to);
    if (!customerId) return;
    _ensureContactLogColumns(SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.CONTACT_LOG));
    addContactLog({ customer_id: customerId, type: channel, direction: 'out', source: 'auto', kind: COMMS_KIND,
                    notes: String(summary || '').slice(0, 80) });
  } catch (e) { Logger.log('logAutoSend ' + COMMS_KIND + ' → ' + to + ': ' + e); }
}

function sendViaPostmark(to, subject, htmlBody) {
  // Sep 14: Do-Not-Contact guard (dnc.gs) — every email in the system passes here
  if (typeof isDoNotContact === 'function' && isDoNotContact(to)) { Logger.log('sendViaPostmark: suppressed (do not contact) ' + to); return { success: false, error: 'suppressed (do not contact)' }; }
  var payload = {
    From:          FROM_NAME + ' <' + FROM_EMAIL + '>',
    To:            to,
    Subject:       subject,
    HtmlBody:      htmlBody,
    MessageStream: 'outbound',
  };
  var options = {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'X-Postmark-Server-Token': POSTMARK_API_TOKEN },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  try {
    var response = UrlFetchApp.fetch(POSTMARK_API_URL, options);
    var code     = response.getResponseCode();
    var body     = JSON.parse(response.getContentText());
    if (code === 200 && body.ErrorCode === 0) {
      logAutoSend(to, 'email', subject);
      return { success: true, messageId: body.MessageID };
    } else {
      return { success: false, error: code + ': ' + (body.Message || 'Unknown') };
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


// ═══════════════════════════════════════════════
//  HTML EMAIL BUILDERS
// ═══════════════════════════════════════════════

function buildEmail(firstName, headline, body) {
  return '<!DOCTYPE html>' +
'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
'<body style="margin:0;padding:0;background-color:#1A1816;font-family:Georgia,\'Times New Roman\',serif;">' +
'<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1A1816;">' +
'<tr><td align="center" style="padding:40px 20px;">' +
'<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
  '<tr><td style="padding:24px 32px;border-bottom:2px solid #C8953C;">' +
  '<span style="font-size:24px;font-weight:bold;color:#C8953C;">Snappy</span>' +
  '<span style="font-size:24px;color:#FAF6F0;">.Gold</span></td></tr>' +
  '<tr><td style="padding:32px;background-color:#222019;border-radius:0 0 8px 8px;">' +
  '<p style="font-size:18px;color:#FAF6F0;margin:0 0 16px;line-height:1.4;">Hi ' + firstName + ',</p>' +
  '<p style="font-size:16px;color:#FAF6F0;margin:0 0 20px;line-height:1.6;">' + headline + '</p>' +
  '<p style="font-size:15px;color:rgba(250,246,240,0.85);margin:0 0 24px;line-height:1.7;">' + body + '</p>' +
  '</td></tr>' +
  '<tr><td style="padding:24px 32px;text-align:center;">' +
  '<p style="font-size:12px;color:#666;margin:0 0 4px;">DW5 LLC d/b/a Snappy Gold · 1686 S Federal Hwy #318, Delray Beach, FL 33483</p>' +
  '<p style="font-size:12px;color:#666;margin:0 0 4px;">' +
  '<a href="mailto:hello@snappy.gold" style="color:#C8953C;text-decoration:none;">hello@snappy.gold</a> · ' +
  '<a href="tel:+18666130704" style="color:#C8953C;text-decoration:none;">866-613-0704</a></p>' +
  '<p style="font-size:11px;color:#555;margin:8px 0 0;">' +
  '<a href="https://snappy.gold/terms" style="color:#555;text-decoration:none;">Terms</a> · ' +
  '<a href="https://snappy.gold/privacy" style="color:#555;text-decoration:none;">Privacy</a></p>' +
  '</td></tr>' +
'</table></td></tr></table></body></html>';
}

function buildPlainEmail(firstName, body, ctaUrl, ctaText) {
  var greeting = firstName ? 'Hi ' + firstName + ',\n\n' : '';
  var cta = ctaUrl
    ? '<p style="margin:20px 0;"><a href="' + ctaUrl + '" style="color:#C8953C;font-size:15px;">' + (ctaText || 'Click here to finish your request') + '</a></p>'
    : '';
  return '<!DOCTYPE html>' +
'<html><head><meta charset="utf-8"></head>' +
'<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">' +
'<table width="100%" cellpadding="0" cellspacing="0">' +
'<tr><td style="padding:32px 24px;max-width:560px;">' +
'<p style="font-size:13px;color:#888;margin:0 0 24px;">Snappy Gold · hello@snappy.gold · 866-613-0704</p>' +
'<div style="font-size:15px;color:#222;line-height:1.8;white-space:pre-line;">' + greeting + body + '</div>' +
cta +
'<p style="font-size:11px;color:#aaa;margin:32px 0 0;border-top:1px solid #eee;padding-top:16px;">' +
'DW5 LLC d/b/a Snappy Gold · 1686 S Federal Hwy #318, Delray Beach, FL 33483<br>' +
'<a href="https://snappy.gold/privacy" style="color:#aaa;">Unsubscribe</a></p>' +
'</td></tr></table></body></html>';
}


// ═══════════════════════════════════════════════
//  TEST / DRY RUN
// ═══════════════════════════════════════════════

function testSend() {
  var result = sendViaPostmark(
    'hello@snappy.gold',
    'Snappy.Gold - Email System Test',
    buildEmail('David',
      'This is a test of the new email system.',
      'If you\'re reading this, the 10-minute trigger and new templates are working correctly.'
    )
  );
  Logger.log(JSON.stringify(result));
}

function testDigest() { sendDailyPhotoDigest(); }


// ═══════════════════════════════════════════════
//  USPS LABEL HANDLER (called from CRM)
// ═══════════════════════════════════════════════

function handleGenerateUSPSLabel(data) {
  try {
    // Sep 14: no blank → usps default any more; generateAndSendLabel refuses anything but usps / fedex.
    var shippingType = normalizeShipType(data.shipping_type);
    Logger.log('handleGenerateUSPSLabel: shipping_type=[' + (data.shipping_type || '') + ' → ' + shippingType + '] id=' + data.shipment_id);
    return generateAndSendLabel(
      data.customer_id, data.shipment_id, shippingType,
      data.address, data.name || '', data.email,
      data.phone || '', data.item || ''
    );
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}


// ═══════════════════════════════════════════════
//  LABEL AUTOMATION (EasyPost)
// ═══════════════════════════════════════════════


// MAY 31 PATCH: Shippo migration for scan-based / pay-on-use return labels.
// Every label is created with extra.is_return = true, so we only get billed
// when the customer actually drops the package — solves the ~90%-unused
// EasyPost waste. Set LABEL_PROVIDER='easypost' to revert if needed.

var _SP = PropertiesService.getScriptProperties();
var EASYPOST_API_KEY = _SP.getProperty('EASYPOST_API_KEY') || '';
var SHIPPO_API_KEY   = _SP.getProperty('SHIPPO_API_TOKEN') || '';   // the only definition — shippoUSPS.gs uses this too
var QUO_API_KEY      = _SP.getProperty('QUO_API_KEY') || '';
var LABEL_PROVIDER = 'shippo';  // 'shippo' or 'easypost'
// Sep 23: set true around a generateAndSendLabel call that must NEVER produce a
// pay-on-creation label. Shippo labels are scan-based (extra.is_return), EasyPost
// bills the moment the label is created — the win-back relabel link is public, so
// it runs Shippo-only and fails loudly rather than falling back.
var LABEL_SHIPPO_ONLY = false;
var QUO_FROM_NUMBER  = '8666130704';
var SHIP_FROM = {
  name: 'Snappy Gold', street1: '1686 S Federal Hwy #318',
  city: 'Delray Beach', state: 'FL', zip: '33483', country: 'US', phone: '8666130704',
  email: 'hello@snappy.gold',
};

// MAY 31 PATCH: Shippo label provider. Returns a normalized result object on
// success, or throws on failure. Caller decides whether to fall back to
// EasyPost.
//
// Per Shippo support: for pay-on-use returns, address_from is the CUSTOMER
// (who will mail the package) and address_to is SNAPPY GOLD. The extra
// is_return: true flag is what tells Shippo to bill on scan, not on creation.
//
// Returns: {
//   trackingNumber, labelUrl, labelBytes, labelExt, labelMime,
//   shipping_cost, shipping_service, shippo_transaction_id, qr_url, raw
// }
function _parseUsAddress(address) {
  // Parse from the END: zip is always last, state second-to-last, city
  // third-to-last, everything before = street (handles apt/suite segments).
  // Also handles the case where state+zip share one comma segment ("CA 92879").
  var parts = String(address || '').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length; });
  var street1 = '', city = '', state = '', zip = '';
  if (parts.length === 0) return { street1: '', city: '', state: '', zip: '' };

  // Check if the last segment is "STATE ZIP" combined (e.g. "CA 92879")
  var last = parts[parts.length - 1];
  var lastTokens = last.split(/\s+/);
  if (lastTokens.length === 2 && /^[A-Za-z]{2}$/.test(lastTokens[0]) && /^\d{5}(-\d{4})?$/.test(lastTokens[1])) {
    // "...city, CA 92879" → state+zip in final segment
    state = lastTokens[0].toUpperCase();
    zip   = lastTokens[1];
    city  = parts[parts.length - 2] || '';
    street1 = parts.slice(0, parts.length - 2).join(', ');
  } else if (/^\d{5}(-\d{4})?$/.test(last) && parts.length >= 2 && /^[A-Za-z]{2}$/.test((parts[parts.length - 2] || '').trim())) {
    // "...city, CA, 92879" → state and zip are separate segments (state is a clean 2-letter)
    zip   = last;
    state = (parts[parts.length - 2] || '').toUpperCase();
    city  = parts[parts.length - 3] || '';
    street1 = parts.slice(0, parts.length - 3).join(', ');
  } else {
    // STATE IS MISSING or malformed (very common: "City, ZIP" with no state,
    // seen often with FL addresses). The last segment is the zip; derive the
    // state FROM the zip, and treat the prior segment as the city.
    zip   = last;
    city  = parts[parts.length - 2] || '';
    street1 = parts.slice(0, parts.length - 2).join(', ');
    state = ''; // filled by zip fallback below
  }

  // ── ZIP → state fallback: if state is missing or not a valid 2-letter code,
  //    derive it from the ZIP. US ZIP prefixes map deterministically to states. ──
  if (!/^[A-Z]{2}$/.test(state) || !_isValidUsState(state)) {
    var derived = _stateFromZip(zip);
    if (derived) state = derived;
  }

  return { street1: street1, city: city, state: state, zip: zip };
}

// Valid 2-letter US state/territory codes
function _isValidUsState(s) {
  return /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AS|MP)$/.test(String(s || '').toUpperCase());
}

// Derive US state from a ZIP code via first-3-digit ranges (ZCTA assignments).
function _stateFromZip(zip) {
  var z = parseInt(String(zip || '').slice(0, 5), 10);
  if (!z && z !== 0) return '';
  // [min, max, state] by 5-digit zip range
  var R = [
    [35000,36999,'AL'],[99500,99999,'AK'],[85000,86999,'AZ'],[71600,72999,'AR'],[75500,75500,'AR'],
    [90000,96199,'CA'],[80000,81999,'CO'],[6000,6999,'CT'],[19700,19999,'DE'],
    [32000,34999,'FL'],[30000,31999,'GA'],[39800,39999,'GA'],[96700,96899,'HI'],[83200,83899,'ID'],
    [60000,62999,'IL'],[46000,47999,'IN'],[50000,52999,'IA'],[66000,67999,'KS'],[40000,42799,'KY'],
    [45275,45275,'KY'],[70000,71599,'LA'],[3900,4999,'ME'],[20600,21999,'MD'],[1000,2799,'MA'],
    [48000,49999,'MI'],[55000,56799,'MN'],[38600,39799,'MS'],[63000,65899,'MO'],[59000,59999,'MT'],
    [68000,69399,'NE'],[88900,89899,'NV'],[3000,3899,'NH'],[7000,8999,'NJ'],[87000,88499,'NM'],
    [10000,14999,'NY'],[6390,6390,'NY'],[500,599,'NY'],[27000,28999,'NC'],[58000,58899,'ND'],
    [43000,45999,'OH'],[73000,74999,'OK'],[97000,97999,'OR'],[15000,19699,'PA'],[2800,2999,'RI'],
    [29000,29999,'SC'],[57000,57799,'SD'],[37000,38599,'TN'],[72395,72395,'TN'],
    [75000,79999,'TX'],[73301,73344,'TX'],[88500,88599,'TX'],[84000,84799,'UT'],[5000,5999,'VT'],
    [20100,20199,'VA'],[22000,24699,'VA'],[98000,99499,'WA'],[24700,26899,'WV'],[53000,54999,'WI'],
    [82000,83199,'WY'],[20000,20099,'DC'],[20200,20599,'DC'],[600,799,'PR'],[800,899,'VI'],[967,969,'GU']
  ];
  for (var i = 0; i < R.length; i++) { if (z >= R[i][0] && z <= R[i][1]) return R[i][2]; }
  return '';
}

// ═══════════════════════════════════════════════════════════════════════
//  OUTBOUND RETURN-TO-CUSTOMER LABEL (Jun 8)
//  For sending a customer's items BACK to them (declined offers, etc.).
//  This is the OPPOSITE of our normal labels: a regular outbound label
//  (us → customer), billed on creation (we pay postage), NO is_return flag.
//  USPS Ground Advantage by default. Prints FROM: us / TO: customer, which
//  is the correct orientation for an outbound package.
// ═══════════════════════════════════════════════════════════════════════
function _buyOutboundLabel(address, customerName, customerPhone, shipmentId, customerEmail, shippingType, dims) {
  shippingType = normalizeShipType(shippingType) || 'usps';
  dims = dims || {};
  // Package size/weight vary for returns (whatever the customer originally sent),
  // so these are passed in per-label. Fall back to a small default if missing.
  var L = parseFloat(dims.length) || 9;
  var W = parseFloat(dims.width)  || 6;
  var H = parseFloat(dims.height) || 2;
  var lbs = parseFloat(dims.weight_lbs) || 0;
  var oz  = parseFloat(dims.weight_oz)  || 0;
  var totalOz = (lbs * 16) + oz;
  if (totalOz <= 0) totalOz = 8;  // default 8oz if nothing provided
  var addr = _parseUsAddress(address);
  if (!addr.street1 || !addr.city || !addr.state || !addr.zip) {
    throw new Error('Incomplete address for outbound label: ' + JSON.stringify(addr));
  }
  var carrierToken = shippingType === 'usps' ? 'usps' : 'fedex';
  var preferredService = shippingType === 'usps' ? 'usps_ground_advantage' : 'fedex_ground';

  var customerAddress = {
    name: customerName || 'Valued Customer',
    street1: addr.street1, city: addr.city, state: addr.state, zip: addr.zip, country: 'US',
    phone: String(customerPhone || '').replace(/\D/g, '') || SHIP_FROM.phone,
    email: customerEmail || SHIP_FROM.email,
  };
  // OUTBOUND: us = sender, customer = recipient, NO is_return (normal label).
  var shipPayload = {
    address_from: SHIP_FROM,
    address_to: customerAddress,
    parcels: [{ length: L, width: W, height: H, distance_unit: 'in', weight: totalOz, mass_unit: 'oz' }],
    extra: { reference_1: shipmentId + '-RETURN' },
    async: false,
  };

  var shipRes = UrlFetchApp.fetch('https://api.goshippo.com/shipments/', {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
    payload: JSON.stringify(shipPayload), muteHttpExceptions: true,
  });
  var shipCode = shipRes.getResponseCode();
  var shipData = JSON.parse(shipRes.getContentText());
  if (shipCode < 200 || shipCode >= 300 || !shipData.object_id) {
    throw new Error('Shippo outbound shipment failed HTTP ' + shipCode + ': ' + shipRes.getContentText().substring(0, 300));
  }

  var rates = shipData.rates || [];
  var rate = null;
  for (var i = 0; i < rates.length; i++) {
    if (rates[i].servicelevel && rates[i].servicelevel.token === preferredService) { rate = rates[i]; break; }
  }
  if (!rate) {
    var sameCarrier = rates.filter(function(r) { return r.provider && r.provider.toLowerCase() === carrierToken; });
    sameCarrier.sort(function(a, b) { return parseFloat(a.amount) - parseFloat(b.amount); });
    rate = sameCarrier[0] || null;  // never fall back to another carrier (UPS not registered)
  }
  if (!rate) throw new Error('Shippo: no ' + carrierToken + ' outbound rate available');

  var txRes = UrlFetchApp.fetch('https://api.goshippo.com/transactions/', {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
    payload: JSON.stringify({ rate: rate.object_id, label_file_type: 'PDF_4x6', async: false }), muteHttpExceptions: true,
  });
  var txData = JSON.parse(txRes.getContentText());
  if (txData.status !== 'SUCCESS') {
    var messages = (txData.messages || []).map(function(m) { return m.text || JSON.stringify(m); }).join('; ');
    throw new Error('Shippo outbound transaction failed status=' + txData.status + ' messages=' + messages);
  }

  return {
    tracking_number: txData.tracking_number || '',
    label_url: txData.label_url || '',
    rate: rate.amount,
    carrier: rate.provider,
    service: rate.servicelevel && rate.servicelevel.name,
  };
}

// CRM handler: generate an outbound return-to-customer label, store it on the
// shipment, email the label to David (to print) AND the tracking to the customer.
// parsed: { shipment_id }
function handleGenerateReturnLabel(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var ship = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).find(function(s){ return s.shipment_id === shipmentId; });
    if (!ship) return { success: false, error: 'Shipment not found' };
    var cust = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).find(function(c){ return c.customer_id === ship.customer_id; });
    if (!cust) return { success: false, error: 'Customer not found' };
    if (!cust.address) return { success: false, error: 'Customer has no address on file' };

    var dims = {
      length: parsed.length, width: parsed.width, height: parsed.height,
      weight_lbs: parsed.weight_lbs, weight_oz: parsed.weight_oz,
    };
    var label = _buyOutboundLabel(cust.address, cust.name, cust.phone, shipmentId, cust.email, 'usps', dims);

    // Store on shipment (return_tracking column + stamp)
    updateShipment(shipmentId, { return_tracking: label.tracking_number });

    // Email the label to David to print
    try {
      GmailApp.sendEmail('davidisaacweiss@yahoo.com',
        'Return label for ' + (cust.name || shipmentId) + ' (' + shipmentId + ')',
        'Return-to-customer label for ' + (cust.name || '') + '\n' +
        'Tracking: ' + label.tracking_number + '\n' +
        label.carrier + ' ' + label.service + ' · $' + label.rate + '\n\n' +
        'Label PDF: ' + label.label_url,
        { from: 'hello@snappy.gold', name: 'Snappy Gold' });
    } catch(eMail) { Logger.log('David label email failed: ' + eMail); }

    // Email tracking to the customer
    var custEmailed = false;
    if (cust.email) {
      try {
        var firstName = cust.name ? cust.name.split(' ')[0] : 'there';
        GmailApp.sendEmail(cust.email,
          'Your items are on the way back — Snappy Gold',
          '',
          { from: 'hello@snappy.gold', name: 'Snappy Gold',
            htmlBody: '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1A1816;">' +
              '<p>Hi ' + _loEscape(firstName) + ',</p>' +
              '<p>Your items are on their way back to you. Here are the tracking details:</p>' +
              '<p style="font-size:16px;"><strong>Tracking #:</strong> ' + _loEscape(label.tracking_number) + '<br>' +
              '<strong>Carrier:</strong> USPS Ground Advantage</p>' +
              '<p>You can track it on <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(label.tracking_number) + '">USPS.com</a>.</p>' +
              '<p>Thanks for giving Snappy Gold a look — we hope to work with you again.</p>' +
              '<p>David<br>Snappy Gold · (866) 613-0704</p></div>' });
        custEmailed = true;
      } catch(eCust) { Logger.log('Customer tracking email failed: ' + eCust); }
    }

    try { addContactLog({ customer_id: cust.customer_id, shipment_id: shipmentId, type: 'note',
      notes: 'Return label generated (USPS Ground Advantage, ' + label.tracking_number + ', $' + label.rate + '). Tracking emailed to customer.' }); } catch(e){}

    return {
      success: true,
      tracking_number: label.tracking_number,
      label_url: label.label_url,
      rate: label.rate,
      customer_emailed: custEmailed,
      message: 'Return label created (' + label.tracking_number + ', $' + label.rate + ')' + (custEmailed ? ' · tracking emailed to customer' : ' · no customer email on file')
    };
  } catch (err) {
    Logger.log('handleGenerateReturnLabel error: ' + err.toString());
    return { success: false, error: err.toString(), message: 'Return label failed: ' + err.toString() };
  }
}

function _buyShippoLabel(shippingType, address, customerName, customerPhone, shipmentId, customerEmail) {
  var addr = _parseUsAddress(address);
  var street1 = addr.street1, city = addr.city, state = addr.state, zip = addr.zip;
  if (!street1 || !city || !state || !zip) throw new Error('Incomplete address for Shippo: ' + JSON.stringify(addr));

  shippingType = normalizeShipType(shippingType);
  var carrierToken = shippingType === 'usps' ? 'usps' : 'fedex';
  // USPS GroundAdvantage = "usps_ground_advantage", FedEx Ground = "fedex_ground"
  var preferredService = shippingType === 'usps' ? 'usps_ground_advantage' : 'fedex_ground';

  // JUN 8 FIX (per Shippo Product Support eng. Prince): with is_return:true,
  // Shippo AUTO-SWAPS address_from/address_to during return-label creation.
  // We were already placing the customer as address_from, so it double-swapped
  // and printed OUR address as sender (the CS-headache layout). The fix is to
  // set addresses the "natural" way here — address_from = US, address_to =
  // CUSTOMER — and let Shippo's return-swap flip them into the correct printed
  // orientation (customer as sender, us as destination). VERIFY with a test
  // label after deploy: customer should print top-left, and it must still
  // route to us + bill on scan.
  var customerAddress = {
    name: customerName || 'Valued Customer',
    street1: street1, city: city, state: state, zip: zip, country: 'US',
    phone: String(customerPhone || '').replace(/\D/g, '') || SHIP_FROM.phone,
    email: customerEmail || SHIP_FROM.email,
  };
  // NOTE: do NOT request qr_code here. Shippo does NOT support QR codes for
  // is_return USPS Ground Advantage labels — adding qr_code_requested causes
  // Shippo to DROP all USPS rates from the response, forcing a fallback to
  // EasyPost (billed on creation). EasyPost supplies the QR instead. See the
  // Shippo message: "QR code requests are not supported with (is_return) for
  // Ground Advantage, Priority Mail, Priority Mail Express."
  var labelExtra = { is_return: true, reference_1: shipmentId };
  var shipPayload = {
    address_from: SHIP_FROM,
    address_to: customerAddress,
    parcels: [{ length: 9, width: 6, height: 2, distance_unit: 'in', weight: 8, mass_unit: 'oz' }],
    extra: labelExtra,
    async: false,
  };

  var shipOptions = {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
    payload: JSON.stringify(shipPayload), muteHttpExceptions: true,
  };

  var shipRes = UrlFetchApp.fetch('https://api.goshippo.com/shipments/', shipOptions);
  var shipCode = shipRes.getResponseCode();
  var shipData = JSON.parse(shipRes.getContentText());
  if (shipCode < 200 || shipCode >= 300 || !shipData.object_id) {
    throw new Error('Shippo shipment failed HTTP ' + shipCode + ': ' + shipRes.getContentText().substring(0, 300));
  }

  // Pick a rate. STRICT: only ever select a rate from the intended carrier.
  // Previously fell back to rates[0] which could be ANY carrier — Shippo started
  // returning UPS rates, which aren't registered on the account, so the
  // transaction errored and every label fell back to EasyPost (billing us on
  // creation instead of pay-on-scan). Never cross carriers.
  var rates = shipData.rates || [];
  var rate = null;
  // 1) exact preferred service (usps_ground_advantage / fedex_ground)
  for (var i = 0; i < rates.length; i++) {
    if (rates[i].servicelevel && rates[i].servicelevel.token === preferredService) { rate = rates[i]; break; }
  }
  // 2) cheapest rate from the requested carrier
  if (!rate) {
    var sameCarrier = rates.filter(function(r) { return r.provider && r.provider.toLowerCase() === carrierToken; });
    sameCarrier.sort(function(a, b) { return parseFloat(a.amount) - parseFloat(b.amount); });
    rate = sameCarrier[0] || null;
    if (rate) Logger.log('Shippo rate (requested carrier): ' + rate.provider + ' $' + rate.amount);
  }
  // 3) If the requested carrier isn't available, accept the other MAJOR carrier
  //    (USPS or FedEx only) rather than failing to EasyPost. This keeps Shippo
  //    working (pay-on-scan) even when it only returns one carrier for an
  //    address. We still avoid unregistered carriers like UPS.
  //    Sep 14: USPS requests only. A FedEx request never becomes a USPS label —
  //    with no FedEx rate it throws below (and has no EasyPost fallback).
  if (!rate && carrierToken === 'usps') {
    var okCarriers = ['usps', 'fedex'];
    var usable = rates.filter(function(r) { return r.provider && okCarriers.indexOf(r.provider.toLowerCase()) !== -1; });
    usable.sort(function(a, b) { return parseFloat(a.amount) - parseFloat(b.amount); });
    rate = usable[0] || null;
    if (rate) Logger.log('Shippo: requested ' + carrierToken + ' unavailable, using ' + rate.provider + ' $' + rate.amount);
  }
  if (!rate) {
    var avail = rates.map(function(r){ return r.provider + '/' + (r.servicelevel && r.servicelevel.token); }).join(', ');
    throw new Error('Shippo: no usable ' + (carrierToken === 'fedex' ? 'FedEx' : 'USPS/FedEx') + ' rate (got: ' + avail + ')');
  }

  // Purchase the label via Transactions endpoint
  var txPayload = { rate: rate.object_id, label_file_type: 'PDF', async: false };
  var txOptions = {
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
    payload: JSON.stringify(txPayload), muteHttpExceptions: true,
  };
  var txRes = UrlFetchApp.fetch('https://api.goshippo.com/transactions/', txOptions);
  var txCode = txRes.getResponseCode();
  var txData = JSON.parse(txRes.getContentText());
  if (txCode < 200 || txCode >= 300 || txData.status !== 'SUCCESS') {
    var messages = (txData.messages || []).map(function(m) { return m.text || JSON.stringify(m); }).join('; ');
    throw new Error('Shippo transaction failed HTTP ' + txCode + ' status=' + txData.status + ' messages=' + messages);
  }

  var trackingNumber = txData.tracking_number || '';
  var labelUrl = txData.label_url || '';
  if (!labelUrl) throw new Error('Shippo: no label_url returned');

  // Fetch label bytes
  var labelRes = UrlFetchApp.fetch(labelUrl, { muteHttpExceptions: true });
  var labelBytes = labelRes.getContent();
  var labelMime = labelRes.getHeaders()['Content-Type'] || labelRes.getHeaders()['content-type'] || 'application/pdf';
  var labelExt = String(labelMime).indexOf('png') !== -1 ? 'png' : 'pdf';

  // Shippo does not provide QR for is_return USPS Ground Advantage labels
  // (incompatible — see note above). qr_url stays empty here; if a QR is
  // needed for a printer-less customer, that's handled via EasyPost.
  var qrUrl = '';

  return {
    trackingNumber: trackingNumber,
    labelUrl: labelUrl,
    labelBytes: labelBytes,
    labelBase64: Utilities.base64Encode(labelBytes),
    labelExt: labelExt,
    labelMime: labelMime,
    shipping_cost: rate.amount,
    shipping_service: rate.provider + ' ' + (rate.servicelevel ? rate.servicelevel.name : ''),
    shippo_transaction_id: txData.object_id,
    qr_url: qrUrl,
  };
}

function generateAndSendLabel(custId, shipmentId, shippingType, address, customerName, customerEmail, customerPhone, item) {
  try {
    var rawShippingType = shippingType;
    shippingType = normalizeShipType(shippingType);
    Logger.log('generateAndSendLabel: ' + shipmentId + ' type=' + rawShippingType + ' → ' + shippingType + ' provider=' + LABEL_PROVIDER);
    // Sep 14: only usps and fedex get labels. Never guess USPS for anything else.
    if (shippingType !== 'usps' && shippingType !== 'fedex') {
      return { success: false, error: 'Unrecognized shipping type "' + (rawShippingType || '') + '" — set it to USPS or FedEx before generating a label.' };
    }

    // MAY 31 PATCH: try Shippo first (pay-on-use billing). If anything goes
    // wrong, fall back to EasyPost so we never fail to send a label.
    var labelData = null; // { trackingNumber, labelUrl, labelBase64, labelExt, labelMime, shipping_cost, shipping_service, shippo_transaction_id, qr_url, provider }
    if (LABEL_PROVIDER === 'shippo') {
      try {
        var sr = _buyShippoLabel(shippingType, address, customerName, customerPhone, shipmentId, customerEmail);
        labelData = {
          trackingNumber: sr.trackingNumber,
          labelUrl: sr.labelUrl,
          labelBase64: sr.labelBase64,
          labelExt: sr.labelExt,
          labelMime: sr.labelMime,
          shipping_cost: sr.shipping_cost,
          shipping_service: sr.shipping_service,
          shippo_transaction_id: sr.shippo_transaction_id,
          easypost_shipment_id: '',
          qr_url: sr.qr_url,
          provider: 'shippo',
        };
        Logger.log('Shippo label success: ' + sr.trackingNumber + ' ($' + sr.shipping_cost + ')');
      } catch (shippoErr) {
        // Sep 14: FedEx has no EasyPost fallback — it's Shippo FedEx Ground
        // pay-on-use or an error the CRM shows. Only USPS falls through below.
        if (shippingType === 'fedex') {
          Logger.log('✗ Shippo FedEx failed for ' + shipmentId + ': ' + shippoErr.toString());
          return { success: false, error: 'FedEx label failed (Shippo): ' + shippoErr.toString() };
        }
        Logger.log('⚠ SHIPPO FAILED for ' + shipmentId + ', falling back to EasyPost (BILLED ON CREATION): ' + shippoErr.toString());
        // ALERT: every EasyPost fallback is a label charged on creation — the
        // exact cost leak Shippo is meant to eliminate. Email so it's never silent.
        try {
          MailApp.sendEmail('hello@snappy.gold',
            'Snappy Gold: EasyPost fallback used (' + shipmentId + ')',
            'Shippo failed and the label fell back to EasyPost, which bills on creation.\n\n' +
            'Shipment: ' + shipmentId + '\nError: ' + shippoErr.toString() + '\n\n' +
            'Run testShippoLabel() to diagnose.');
        } catch (mailErr) { Logger.log('Fallback alert email failed: ' + mailErr); }
        // labelData stays null → EasyPost block below runs
      }
    }

    // EasyPost path: runs if (a) LABEL_PROVIDER is 'easypost', OR
    // (b) Shippo failed above for a USPS label (FedEx returned an error instead).
    // LABEL_SHIPPO_ONLY callers never get here — EasyPost bills on creation.
    if (!labelData && LABEL_SHIPPO_ONLY) {
      Logger.log('Shippo-only request for ' + shipmentId + ': refusing the EasyPost fallback');
      return { success: false, error: 'Could not create a scan-based label right now. Nothing was charged — reply to this email and I will sort it out.' };
    }
    if (!labelData) {
    var epAddr = _parseUsAddress(address);
    var street1 = epAddr.street1, city = epAddr.city, state = epAddr.state, zip = epAddr.zip;

    if (!street1 || !city || !state || !zip) {
      return { success: false, error: 'Incomplete address' };
    }

    var carrier = shippingType === 'usps' ? 'USPS'   : 'FedExDefault';
    // MAY 20 PATCH: USPS deprecated First Class in 2023. GroundAdvantage is the
    // modern equivalent (~$8.75 for our 16oz parcel vs Express at $48.77).
    // If GroundAdvantage isn't available for some reason, the fallback below
    // picks the CHEAPEST USPS rate available — never Express by accident.
    var service = shippingType === 'usps' ? 'GroundAdvantage'  : 'FEDEX_GROUND';

    var epPayload = {
      shipment: {
        label_format: 'PDF',
        to_address: {
          name: customerName || 'Valued Customer',
          street1: street1, city: city, state: state, zip: zip, country: 'US',
          phone: String(customerPhone || '').replace(/\D/g, '') || SHIP_FROM.phone,
        },
        from_address: SHIP_FROM,
        // MAY 20 PATCH: Lower from 16oz → 8oz. Most jewelry is well under 1lb.
        // 16oz forces the 1lb USPS rate tier. 8oz stays in the cheaper sub-1lb
        // tier. If actual weight exceeds declared, USPS bills the difference
        // rather than rejecting the package.
        parcel: { weight: 8, length: 9, width: 6, height: 2 },
        carrier_accounts: shippingType === 'usps' ? [] : ['ca_b5683cbbafac4c8dbc6777148296718f'],
        is_return: true,
        reference: shipmentId + '|' + custId,
      }
    };

    var epOptions = {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') },
      payload: JSON.stringify(epPayload), muteHttpExceptions: true,
    };

    var epRes = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments', epOptions);
    var epData = JSON.parse(epRes.getContentText());

    if (!epData.id) {
      return { success: false, error: 'EasyPost shipment creation failed' };
    }

    var rates = epData.rates || [];
    // USPS return labels sometimes come back under a carrier name like
    // 'USPSReturns' rather than exactly 'USPS' — treat any USPS* as USPS.
    function _isCarrier(r, want) {
      var c = String(r.carrier || '');
      if (want === 'USPS') return c.indexOf('USPS') !== -1;
      if (want === 'FedExDefault') return c.indexOf('FedEx') !== -1 || c.indexOf('FEDEX') !== -1;
      return c === want;
    }
    var rate = rates.find(function(r) { return _isCarrier(r, carrier) && r.service === service; });
    // Fallback: cheapest rate from the SAME carrier family — NEVER cross carriers.
    // Previously `|| rates[0]` could turn a USPS request into a FedEx label
    // (Micheline got FedEx despite USPS being selected).
    if (!rate) {
      var carrierRates = rates.filter(function(r) { return _isCarrier(r, carrier); });
      carrierRates.sort(function(a, b) { return parseFloat(a.rate) - parseFloat(b.rate); });
      rate = carrierRates[0] || null;
      if (rate) Logger.log('Fallback rate (same carrier): ' + rate.carrier + ' ' + rate.service + ' $' + rate.rate);
    }
    if (!rate) {
      var got = rates.map(function(r){ return r.carrier + '/' + r.service; }).join(', ');
      return { success: false, error: 'No ' + carrier + ' rate available (got: ' + got + ')' };
    }

    var buyOptions = {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') },
      payload: JSON.stringify({ rate: { id: rate.id } }), muteHttpExceptions: true,
    };
    var buyRes = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments/' + epData.id + '/buy', buyOptions);
    var buyData = JSON.parse(buyRes.getContentText());

    var trackingNumber = buyData.tracking_code || '';
    var labelUrl = buyData.postage_label && buyData.postage_label.label_url ? buyData.postage_label.label_url : '';
    if (!labelUrl) return { success: false, error: 'No label URL' };

    // MAY 21 PATCH: Generate USPS Label Broker QR code for printerless customers.
    // Auto-generated for every USPS label. QR PNG URL gets embedded in the email
    // and SMS so customers who don't have a printer can show their phone at any
    // post office and have the clerk scan + print. No extra cost from USPS.
    // FedEx skipped — different system (FedEx Office). Future enhancement.
    var qrUrl = '';
    if (shippingType === 'usps' && epData.id) {
      try {
        var qrRes = UrlFetchApp.fetch(
          'https://api.easypost.com/v2/shipments/' + epData.id + '/forms',
          {
            method: 'post',
            headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') },
            payload: { 'form[type]': 'label_qr_code' },
            muteHttpExceptions: true
          }
        );
        if (qrRes.getResponseCode() === 200 || qrRes.getResponseCode() === 201) {
          var qrData = JSON.parse(qrRes.getContentText());
          var qrForms = qrData.shipment ? qrData.shipment.forms : qrData.forms;
          if (qrForms && qrForms.length) {
            qrUrl = qrForms[qrForms.length - 1].form_url || '';
            Logger.log('QR code generated: ' + qrUrl);
          }
        } else {
          Logger.log('QR generation failed (non-fatal): HTTP ' + qrRes.getResponseCode() + ' ' + qrRes.getContentText());
        }
      } catch (qrErr) {
        Logger.log('QR generation error (non-fatal): ' + qrErr.toString());
      }
    }

    updateShipment(shipmentId, {
      outbound_tracking: trackingNumber,
      stage: 'outbound_complete',
      shipping_cost: rate ? rate.rate : '',
      shipping_service: rate ? (rate.carrier + ' ' + rate.service) : '',
      easypost_shipment_id: epData.id || '',
      label_qr_url: qrUrl
    });

    var labelRes = UrlFetchApp.fetch(labelUrl, { muteHttpExceptions: true });
    var labelBytes = labelRes.getContent();
    var labelBase64 = Utilities.base64Encode(labelBytes);
    var labelMime = (labelRes.getHeaders()['Content-Type'] || labelRes.getHeaders()['content-type'] || 'application/pdf');
    var labelExt = labelMime.indexOf('png') !== -1 ? 'png' : 'pdf';
    var labelMimeType = labelMime.indexOf('png') !== -1 ? 'image/png' : 'application/pdf';

    // Populate labelData from EasyPost results for shared downstream code
    labelData = {
      trackingNumber: trackingNumber,
      labelUrl: labelUrl,
      labelBase64: labelBase64,
      labelExt: labelExt,
      labelMime: labelMime,
      labelMimeType: labelMimeType,
      shipping_cost: rate ? rate.rate : '',
      shipping_service: rate ? (rate.carrier + ' ' + rate.service) : '',
      easypost_shipment_id: epData.id || '',
      shippo_transaction_id: '',
      qr_url: qrUrl,
      provider: 'easypost',
    };
    } // end EasyPost branch (if (!labelData))

    // Shared downstream: if Shippo was used, we still need to write the
    // shipment update + derive labelMimeType for the email attachment.
    if (labelData.provider === 'shippo') {
      labelData.labelMimeType = labelData.labelMime.indexOf('png') !== -1 ? 'image/png' : 'application/pdf';
      updateShipment(shipmentId, {
        outbound_tracking: labelData.trackingNumber,
        stage: 'outbound_complete',
        shipping_cost: labelData.shipping_cost,
        shipping_service: labelData.shipping_service,
        shippo_transaction_id: labelData.shippo_transaction_id || '',
        label_qr_url: labelData.qr_url || '',
      });
    }

    // From here down, all references should use labelData.* for portability.
    // For Shippo path, these vars don't exist yet; for EasyPost they were
    // declared in the branch above. Reassign uniformly from labelData so the
    // rest of the function (email/SMS) reads consistent values regardless of
    // provider.
    trackingNumber = labelData.trackingNumber;
    labelBase64 = labelData.labelBase64;
    labelExt = labelData.labelExt;
    labelMimeType = labelData.labelMimeType;
    qrUrl = labelData.qr_url;

    var firstName = (customerName || '').trim().split(' ')[0] || 'there';
    // MAY 20 PATCH: itemPhrase needs the full shipment row to detect appended
    // items in `notes` (Tina-style shipments where `item` column has only the
    // first item but `notes` has additional ones like "+ Foo ($X – $Y)").
    // _shipmentItemPhrase fetches the row, counts items across item + notes,
    // and returns "your items" if 2+ exist, otherwise "your <single item>".
    var itemText = _shipmentItemPhrase(shipmentId, item);
    // CARRIER NAME — derive from the ACTUAL generated label, not shippingType.
    // shippingType can disagree with what was actually produced (Shippo migration,
    // fallback logic, USPS-as-default), which caused emails to say "FedEx" while a
    // USPS label was attached (Laurie Plumley bug). Source of truth = labelData.
    var actualSvc = String((labelData && labelData.shipping_service) || '').toLowerCase();
    var isUspsLabel;
    // Sep 14: FedEx is checked first — "FedEx Priority Overnight" would otherwise
    // match 'priority' below and get USPS copy.
    if (actualSvc.indexOf('fedex') !== -1) {
      isUspsLabel = false;
    } else if (actualSvc.indexOf('usps') !== -1 || actualSvc.indexOf('ground advantage') !== -1 || actualSvc.indexOf('groundadvantage') !== -1 || actualSvc.indexOf('priority') !== -1 || actualSvc.indexOf('first class') !== -1 || actualSvc.indexOf('firstclass') !== -1) {
      isUspsLabel = true;
    } else {
      // Unknown/blank service string → fall back to the requested shippingType.
      isUspsLabel = (shippingType === 'usps');
    }
    var carrierName = isUspsLabel ? 'USPS' : 'FedEx';
    var dropText = isUspsLabel
      ? 'hand it to your postman or drop it at any post office'
      : 'drop it at any FedEx location';

    // MAY 21 PATCH: encourage including more pieces.
    // Single-item shipments → "other pieces lying around"
    // Multi-item shipments → "other gold jewelry lying around" (more specific
    // since they've already sent multiple items — narrows the ask to gold).
    var extraItemsLine = (itemText === 'your items')
      ? '\n\nAnd if you have other gold jewelry lying around you can throw that in too — I\'ll evaluate everything together.'
      : '\n\nAnd if you have other pieces lying around, throw them in too — I\'ll evaluate everything together.';

    // MAY 21 PATCH: build the "no printer?" section.
    // USPS → Label Broker QR code (clerk scans it)
    // FedEx → instructions to take the PDF on phone to a FedEx Office location
    var qrSection = '';
    if (qrUrl) {
      qrSection = '\n\n──────────────\n\nNo printer? No problem.\n\nBring the QR code below to any post office. The clerk will scan it and print the label for you on the spot — free of charge.\n\n<img src="' + qrUrl + '" alt="USPS Label Broker QR Code" style="max-width:200px;height:auto;border:1px solid #eee;padding:8px;margin:8px 0;background:#fff;">\n\nQR code link (in case the image doesn\'t display): ' + qrUrl;
    } else if (!isUspsLabel) {
      // FedEx label, no QR — PDF can be printed at any FedEx Office location.
      qrSection = '\n\n──────────────\n\nNo printer? No problem.\n\nBring this email up on your phone at any FedEx Office location and show them the attached label. The staff there can print it for you on the spot.';
    }

    var emailPayload = {
      From: FROM_NAME + ' <' + FROM_EMAIL + '>', To: customerEmail,
      Bcc: 'davidisaacweiss@yahoo.com',
      Subject: 'Your prepaid ' + carrierName + ' label is attached, ' + firstName,
      HtmlBody: buildPlainEmail(firstName,
        'Your prepaid ' + carrierName + ' return label is attached to this email.' +
        '\n\nJust print it, pack ' + itemText + ' in any box or padded envelope, attach the label, and ' + dropText + '.' +
        extraItemsLine +
        '\n\n<strong>Free shipping, no commitment</strong> — if my offer isn\'t good enough I\'ll send everything back at no charge.' +
        qrSection +
        '\n\nTracking number: ' + trackingNumber +
        '\n\nAny questions, just reply here or call/text 866-613-0704.' +
        '\n\nDavid\nSnappy Gold'
      ),
      Attachments: [{
        Name: 'snappy_gold_label_' + shipmentId + '.' + labelExt,
        Content: labelBase64, ContentType: labelMimeType,
      }],
      MessageStream: 'outbound',
    };

    UrlFetchApp.fetch(POSTMARK_API_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'X-Postmark-Server-Token': POSTMARK_API_TOKEN },
      payload: JSON.stringify(emailPayload), muteHttpExceptions: true,
    });

    // MAY 21 PATCH: append no-printer line to SMS.
    // USPS → QR code URL (post office clerk scans it)
    // FedEx → tell them they can bring phone to FedEx Office to print
    var smsBase = 'Hi ' + firstName + '! Your prepaid ' + carrierName + ' shipping label is in your inbox. ' +
      'Print it, pack ' + itemText + ', and ' + dropText + '. Tracking: ' + trackingNumber;
    var smsTail = '';
    if (qrUrl) {
      smsTail = '\n\nNo printer? Show this QR at any post office: ' + qrUrl;
    } else if (!isUspsLabel) {
      smsTail = '\n\nNo printer? Just pull up the label on your phone and bring it to any FedEx Office — they\'ll print it for you.';
    }
    sendSms(customerPhone, customerName,
      smsBase + smsTail + ' — David @ Snappy Gold'
    );

    return { success: true, tracking: trackingNumber };

  } catch(err) {
    Logger.log('generateAndSendLabel error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}


function sendSms(toPhone, name, message) {
  try {
    // Sep 14: Do-Not-Contact guard (dnc.gs) — every SMS in the system passes here
    if (typeof isDoNotContact === 'function' && isDoNotContact(toPhone)) { Logger.log('sendSms: suppressed (do not contact) ' + toPhone); return { success: false, error: 'suppressed (do not contact)' }; }
    var phone = String(toPhone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      Logger.log('sendSms: invalid phone for ' + (name||'?') + ' — ' + toPhone);
      return { success: false, error: 'Invalid phone' };
    }
    if (phone.length === 10) phone = '1' + phone;

    var payload = {
      content: message, from: '+18666130704',
      to: ['+' + phone], phoneNumberId: 'PNLV8nQUqK',
    };
    var options = {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': QUO_API_KEY },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    };
    var res = UrlFetchApp.fetch('https://api.openphone.com/v1/messages', options);
    var code = res.getResponseCode();
    var body = res.getContentText();
    // 200 or 202 = success. Anything else means the SMS did NOT send.
    if (code === 200 || code === 202) {
      Logger.log('sendSms OK → ' + (name||'?') + ' (+' + phone + ')');
      logAutoSend(toPhone, 'sms', String(message || '').slice(0, 80));
      return { success: true };
    }
    // Common failure modes:
    //   402 = insufficient API credits (Quo requires prepaid credits)
    //   401 = bad auth / expired key
    //   429 = rate limited
    Logger.log('sendSms FAILED → ' + (name||'?') + ' (+' + phone + ') HTTP ' + code + ': ' + body.substring(0, 200));
    return { success: false, error: 'HTTP ' + code + ': ' + body.substring(0, 200) };
  } catch(err) {
    Logger.log('sendSms threw: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════
//  STAGE MIGRATION (one-time, legacy)
// ═══════════════════════════════════════════════

function migrateStages() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var stageCol = headers.indexOf('stage');
  if (stageCol < 0) { Logger.log('stage column not found'); return; }

  var map = {
    'purchase_complete': 'purchased', 'return_complete': 'returned',
    'rejected': 'returned', 'inspected': 'received',
    'accepted': 'purchased', 'outbound_pending': 'outbound_complete',
    'outbound_fulfilled': 'outbound_complete',
  };

  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var stage = String(data[i][stageCol] || '').trim();
    if (map[stage]) {
      sheet.getRange(i + 1, stageCol + 1).setValue(map[stage]);
      updated++;
    }
  }
  Logger.log('Migration complete. Updated: ' + updated);
}


// ═══════════════════════════════════════════════
//  GOOGLE DRIVE: Photo Upload
// ═══════════════════════════════════════════════

var PHOTO_FOLDER_NAME = 'Snappy.Gold Photos';

function getOrCreatePhotoFolder() {
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function uploadImageToDrive(base64DataUrl, label) {
  if (!base64DataUrl || !base64DataUrl.toString().startsWith('data:image')) {
    return base64DataUrl || '';
  }
  try {
    var parts = base64DataUrl.split(',');
    if (parts.length < 2) return '';
    var mimeMatch = parts[0].match(/data:(image\/\w+);base64/);
    var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    var ext = mimeType.split('/')[1] || 'jpg';
    var decoded = Utilities.base64Decode(parts[1]);
    var blob = Utilities.newBlob(decoded, mimeType,
      label.replace(/[^a-zA-Z0-9]/g, '_') + '_' + new Date().getTime() + '.' + ext);
    var folder = getOrCreatePhotoFolder();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=drivesdk';
  } catch (err) {
    Logger.log('Drive upload error: ' + err.toString());
    return '(upload failed: ' + err.message + ')';
  }
}


// ═══════════════════════════════════════════════
//  V2 FOLLOWUPS — MAY 14 MULTI-ITEM PATCH
//  Now fetches the customer's most-recent shipment and passes it to
//  getTemplate so multi-item emails get pluralized correctly.
// ═══════════════════════════════════════════════

function sendFollowUpEmails_v2() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
  var data  = sheet.getDataRange().getValues();
  var now   = new Date();
  var sent  = 0, skipped = 0, errors = 0;

  var THRESHOLD_1_MIN = 45;
  var THRESHOLD_2_MIN = 24 * 60;
  var THRESHOLD_3_MIN = 72 * 60;
  var MAX_AGE_MIN     = 14 * 24 * 60;

  var leads = buildLeadRecords(data);
  var yRange = sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).getValues();
  var yChanged = false;

  var stagesSent = {};
  for (var i = 1; i < data.length; i++) {
    var em = (data[i][COL.EMAIL] || '').toString().trim().toLowerCase();
    if (!em) continue;
    var y = (data[i][COL.AUTO_REPLY] || '').toString();
    if (!y) continue;
    if (!stagesSent[em]) stagesSent[em] = {};
    var m = y.match(/\|\s*([A-Z_0-9]+)\s*\|/);
    if (m) stagesSent[em][m[1]] = true;
    if (y.indexOf('COMPLETE_') !== -1) stagesSent[em]._anyComplete = true;
  }

  for (var j = 0; j < leads.length; j++) {
    var lead = leads[j];
    if (!lead.email || lead.email.indexOf('@') === -1) { skipped++; continue; }

    var minutesAgo = (now - new Date(lead.timestamp)) / 60000;
    if (minutesAgo > MAX_AGE_MIN || minutesAgo < THRESHOLD_1_MIN) { skipped++; continue; }

    var stagesForEmail = stagesSent[lead.email] || {};
    var isComplete = !!(lead.address && lead.shipping);
    var emailType = null;

    if (isComplete) {
      if (stagesForEmail._anyComplete) { skipped++; continue; }
      if (lead.shipping === 'kit') emailType = 'COMPLETE_KIT';
      else if (lead.shipping === 'usps') emailType = 'COMPLETE_USPS';
      else emailType = 'COMPLETE_LABEL';
    } else {
      if (minutesAgo >= THRESHOLD_3_MIN && !stagesForEmail.INCOMPLETE_3) emailType = 'INCOMPLETE_3';
      else if (minutesAgo >= THRESHOLD_2_MIN && !stagesForEmail.INCOMPLETE_2) emailType = 'INCOMPLETE_2';
      else if (minutesAgo >= THRESHOLD_1_MIN && !stagesForEmail.INCOMPLETE_1) emailType = 'INCOMPLETE_1';
    }

    if (!emailType) { skipped++; continue; }

    var rawName = (lead.name || '').replace('(anonymous)', '').trim().split(' ')[0] || '';
    var firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : '';

    // MAY 14 PATCH: Fetch most recent shipment for this email so getTemplate
    // can pluralize correctly for multi-item shipments.
    var currentShipment = null;
    if (lead.email) {
      try {
        var customer = getCustomerByEmail(lead.email);
        if (customer) {
          var customerShipments = getShipments(customer.customer_id);
          for (var sci = 0; sci < customerShipments.length; sci++) {
            if (!currentShipment || new Date(customerShipments[sci].created_at) > new Date(currentShipment.created_at)) {
              currentShipment = customerShipments[sci];
            }
          }
        }
      } catch(shipFetchErr) {
        Logger.log('Multi-item lookup error (non-fatal): ' + shipFetchErr.toString());
      }
    }

    var template = getTemplate(emailType, firstName, lead.item, lead.estimate, lead.shipping, currentShipment);
    if (!template) { skipped++; continue; }

    var result = sendViaPostmark(lead.email, template.subject, template.html);
    var tsStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var statusMsg = result.success
      ? tsStr + ' | ' + emailType + ' | ' + result.messageId
      : tsStr + ' | ERROR_' + emailType + ': ' + result.error;

    if (result.success) {
      sent++;
      if (!stagesSent[lead.email]) stagesSent[lead.email] = {};
      stagesSent[lead.email][emailType] = true;
      if (emailType.indexOf('COMPLETE_') === 0) stagesSent[lead.email]._anyComplete = true;
    } else { errors++; }

    for (var ri = 0; ri < lead.rowIndices.length; ri++) {
      var rowIdx = lead.rowIndices[ri];
      var prev = yRange[rowIdx][0] || '';
      yRange[rowIdx][0] = prev ? (prev + ' || ' + statusMsg) : statusMsg;
    }
    yChanged = true;

    Utilities.sleep(THROTTLE_MS);
  }

  if (yChanged) sheet.getRange(1, COL.AUTO_REPLY + 1, data.length, 1).setValues(yRange);
  Logger.log('sendFollowUpEmails_v2: sent=' + sent + ' skipped=' + skipped + ' errors=' + errors);
}

function createTriggerV2() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    var fn = triggers[t].getHandlerFunction();
    if (fn === 'sendFollowUpEmails' || fn === 'sendFollowUpEmails_v2') {
      ScriptApp.deleteTrigger(triggers[t]);
    }
  }
  ScriptApp.newTrigger('sendFollowUpEmails_v2').timeBased().everyMinutes(10).create();
  Logger.log('Trigger created: sendFollowUpEmails_v2 every 10 minutes');
}


// ═══════════════════════════════════════════════════════════════════════
//  POST-LABEL FOLLOW-UP SEQUENCE (Jun 3)
//
//  Targets the biggest leak in the funnel: customers who completed
//  registration AND received a prepaid label, but never shipped (~90% ghost
//  at this step; drip recovery historically 0% because no sequence existed
//  for them — the INCOMPLETE_ drip only chases people who never registered).
//
//  Fires 4 touches over ~12 days, alternating SMS/email, while a shipment is
//  label-sent but not yet received. Auto-stops the moment the item arrives
//  (received_at set) or the shipment leaves outbound_complete.
//
//  Touches (days since label sent_at):
//    Day 2  — SMS   (reduce friction: tape on box, drop at USPS, postage covered)
//    Day 4  — Email (no-printer/QR option, zero cost, zero commitment, 5 min)
//    Day 7  — SMS   (gold urgency: prices strong, good time to send in)
//    Day 12 — Email (gold + soft last check-in)
//
//  Send-tracking: Shipments.ship_followups_sent holds a comma list of fired
//  touch keys (e.g. "POST_LABEL_1,POST_LABEL_2") so each fires once.
//
//  Run createPostLabelTrigger() ONCE to schedule it (every 6 hours).
// ═══════════════════════════════════════════════════════════════════════

var POST_LABEL_TOUCHES = [
  { key: 'POST_LABEL_1', day: 2,  channel: 'sms' },
  { key: 'POST_LABEL_2', day: 4,  channel: 'email' },
  { key: 'POST_LABEL_3', day: 7,  channel: 'sms' },
  { key: 'POST_LABEL_4', day: 12, channel: 'email' },
];

function _postLabelContent(touchKey, firstName, itemText) {
  var name = firstName || 'there';
  var item = itemText || 'your items';
  switch (touchKey) {
    case 'POST_LABEL_1':
      return { channel: 'sms',
        sms: 'Hi ' + name + ', your prepaid Snappy Gold label is ready to go — just tape it on any box and drop it at USPS. Postage is already covered. Questions? Just reply. — David' };
    case 'POST_LABEL_2':
      return { channel: 'email',
        subject: 'Quick tip for sending in ' + item + ', ' + name,
        body: 'Just checking in — your prepaid Snappy Gold label is still ready whenever you are.' +
          '\n\n<strong>No printer? No problem.</strong> Bring the QR code from your label email to any post office and the clerk will print it for you, free. Or print at home, tape it to any box or padded envelope, and drop it off. The whole thing takes about 5 minutes.' +
          '\n\n<strong>Free shipping, no commitment</strong> — if my offer isn\'t good enough, I send everything back at no charge.' +
          '\n\nAny questions, just reply here or call/text 866-613-0704.' };
    case 'POST_LABEL_3':
      return { channel: 'sms',
        sms: 'Hi ' + name + ' — gold prices are strong right now, so it\'s a great time to send ' + item + ' in and lock in today\'s value. Your prepaid label is still good. Want me to resend it? — David @ Snappy Gold' };
    case 'POST_LABEL_4':
      return { channel: 'email',
        subject: 'Gold\'s running high — still happy to buy ' + item + ', ' + name,
        body: 'Wanted to check in one more time before I close this out.' +
          '\n\nGold prices have been strong lately, so if you\'ve been meaning to send ' + item + ' in, now\'s a good time to lock in today\'s value. Your prepaid label is still active — just tape it to any box and drop it at USPS, postage covered.' +
          '\n\nNo pressure at all, and no commitment — I\'ll send everything back free if my offer isn\'t right for you. If you\'d like me to resend the label or answer anything, just reply.' +
          '\n\nDavid\nSnappy Gold' };
    default:
      return null;
  }
}

function sendPostLabelFollowups() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = shipSheet.getDataRange().getValues();
  var headers = data[0];

  var idIdx       = headers.indexOf('shipment_id');
  var custIdx     = headers.indexOf('customer_id');
  var stageIdx    = headers.indexOf('stage');
  var sentIdx     = headers.indexOf('sent_at');
  var recvIdx     = headers.indexOf('received_at');
  var itemIdx     = headers.indexOf('item');
  var followIdx   = headers.indexOf('ship_followups_sent');

  if (followIdx < 0) { Logger.log('✗ ship_followups_sent column missing — run ensureAllColumns()'); return; }

  var now = new Date();
  var sent = 0, skipped = 0, errors = 0;
  var followCol = []; // batched write of the tracking column
  for (var r = 0; r < data.length; r++) followCol.push([data[r][followIdx]]);

  // Build customer lookup once (avoid re-reading the sheet per row)
  var custMap = {};
  try {
    getCustomers().forEach(function(c){ custMap[c.customer_id] = c; });
  } catch (e) { Logger.log('PostLabel: getCustomers failed: ' + e); }

  for (var r = 1; r < data.length; r++) {
    var stage = String(data[r][stageIdx] || '').toLowerCase();
    var received = String(data[r][recvIdx] || '').trim();
    var sentAt = data[r][sentIdx];

    // Only chase: outbound_complete, not yet received, has a sent_at timestamp
    if (stage !== 'outbound_complete') { continue; }
    if (received) { continue; }            // arrived → stop
    if (!sentAt) { continue; }             // no label-sent timestamp → skip

    var sentDate = (sentAt instanceof Date) ? sentAt : new Date(sentAt);
    if (isNaN(sentDate.getTime())) { continue; }
    var daysSince = (now - sentDate) / (1000 * 60 * 60 * 24);

    var already = String(data[r][followIdx] || '');
    var alreadySet = {};
    already.split(',').forEach(function(k){ k = k.trim(); if (k) alreadySet[k] = true; });

    // Find the latest-eligible untriggered touch (don't fire stale earlier ones
    // if we somehow missed them — fire the most recent due, mark earlier as moot).
    var due = null;
    for (var ti = 0; ti < POST_LABEL_TOUCHES.length; ti++) {
      var t = POST_LABEL_TOUCHES[ti];
      if (daysSince >= t.day && !alreadySet[t.key]) due = t; // keep last matching
    }
    if (!due) { continue; }

    // Resolve customer name + phone + email
    var customerId = data[r][custIdx];
    var cust = custMap[customerId] || null;
    if (!cust) { skipped++; continue; }
    var firstName = String(cust.name || '').trim().split(/\s+/)[0] || '';
    if (firstName) firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    var itemText = data[r][itemIdx] ? String(data[r][itemIdx]) : 'your items';

    var content = _postLabelContent(due.key, firstName, itemText);
    if (!content) { continue; }

    var ok = false;
    try {
      if (content.channel === 'sms') {
        if (cust.phone) {
          var smsRes = sendSms(cust.phone, cust.name, content.sms);
          ok = !!(smsRes && smsRes.success);
        } else {
          Logger.log('PostLabel ' + due.key + ' ' + data[r][idIdx] + ': no phone, skipping SMS');
        }
      } else {
        if (cust.email) {
          var emRes = sendViaPostmark(cust.email, content.subject, buildPlainEmail(firstName, content.body));
          ok = !!(emRes && emRes.success);
        } else {
          Logger.log('PostLabel ' + due.key + ' ' + data[r][idIdx] + ': no email, skipping');
        }
      }
    } catch (sendErr) {
      Logger.log('PostLabel send error ' + data[r][idIdx] + ' ' + due.key + ': ' + sendErr.toString());
    }

    if (ok) {
      sent++;
      var newVal = already ? (already + ',' + due.key) : due.key;
      followCol[r][0] = newVal;
      Logger.log('PostLabel ' + due.key + ' (' + content.channel + ') → ' + data[r][idIdx] + ' (' + firstName + ', day ' + Math.round(daysSince) + ')');
      Utilities.sleep(300);
    } else {
      errors++;
    }
  }

  // Batch-write the tracking column
  if (sent > 0) {
    shipSheet.getRange(1, followIdx + 1, data.length, 1).setValues(followCol);
  }
  Logger.log('sendPostLabelFollowups: sent=' + sent + ' skipped=' + skipped + ' errors=' + errors);
  return { sent: sent, skipped: skipped, errors: errors };
}

function createPostLabelTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'sendPostLabelFollowups') {
      ScriptApp.deleteTrigger(triggers[t]);
    }
  }
  ScriptApp.newTrigger('sendPostLabelFollowups').timeBased().everyHours(6).create();
  Logger.log('Trigger created: sendPostLabelFollowups every 6 hours');
}

// Dry-run preview: who WOULD get which touch right now, without sending.
function previewPostLabelFollowups() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var data = ss.getSheetByName(TAB.SHIPMENTS).getDataRange().getValues();
  var h = data[0];
  var idIdx=h.indexOf('shipment_id'), stageIdx=h.indexOf('stage'), sentIdx=h.indexOf('sent_at'),
      recvIdx=h.indexOf('received_at'), followIdx=h.indexOf('ship_followups_sent');
  var now = new Date(), count = 0;
  Logger.log('━━━ Post-label follow-up PREVIEW (no sends) ━━━');
  for (var r=1;r<data.length;r++){
    if (String(data[r][stageIdx]||'').toLowerCase()!=='outbound_complete') continue;
    if (String(data[r][recvIdx]||'').trim()) continue;
    var sa=data[r][sentIdx]; if(!sa) continue;
    var sd=(sa instanceof Date)?sa:new Date(sa); if(isNaN(sd.getTime())) continue;
    var days=(now-sd)/(86400000);
    var already=String(data[r][followIdx]||''); var set={};
    already.split(',').forEach(function(k){k=k.trim();if(k)set[k]=true;});
    var due=null;
    for(var ti=0;ti<POST_LABEL_TOUCHES.length;ti++){var t=POST_LABEL_TOUCHES[ti];if(days>=t.day&&!set[t.key])due=t;}
    if(due){count++;Logger.log('  '+data[r][idIdx]+': day '+Math.round(days)+' → '+due.key+' ('+due.channel+')');}
  }
  Logger.log('Total that would receive a touch now: '+count);
}


// ═══════════════════════════════════════════════
//  DRIP CAMPAIGN RECOVERY ANALYSIS
//  Answers: of leads that received INCOMPLETE_1/2/3 emails,
//  how many later completed (got address+shipping)?
//  Of those, how many sent items back? How many became purchases?
// ═══════════════════════════════════════════════

function analyzeDripRecovery() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var leadData = leadSheet.getDataRange().getValues();
  var custData = custSheet.getDataRange().getValues();
  var shipData = shipSheet.getDataRange().getValues();

  // Build email -> {gotIncomplete, gotComplete, completedAfterIncomplete} map
  var emailMap = {}; // email -> { incompleteSends: [], completeSends: [], allRows: [] }

  for (var i = 1; i < leadData.length; i++) {
    var email = (leadData[i][COL.EMAIL] || '').toString().trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) continue;
    var ts = leadData[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    var autoReply = (leadData[i][COL.AUTO_REPLY] || '').toString();
    var address = (leadData[i][COL.ADDRESS] || '').toString().trim();
    var shipping = (leadData[i][COL.SHIPPING] || '').toString().trim();

    if (!emailMap[email]) {
      emailMap[email] = {
        email: email,
        incompleteSends: [],
        completeSends:   [],
        firstIncompleteTs: null,
        firstCompletionTs: null,
        rowCount: 0,
      };
    }
    emailMap[email].rowCount++;

    if (autoReply) {
      var parts = autoReply.split('||');
      for (var p = 0; p < parts.length; p++) {
        var part = parts[p].trim();
        var m = part.match(/^([\d\-: ]+)\s*\|\s*(INCOMPLETE_\d|COMPLETE_\w+)\s*\|/);
        if (m) {
          var sentTs = new Date(m[1].replace(' ', 'T') + 'Z');
          var stage = m[2];
          if (stage.indexOf('INCOMPLETE_') === 0) {
            emailMap[email].incompleteSends.push({stage: stage, ts: sentTs});
            if (!emailMap[email].firstIncompleteTs || sentTs < emailMap[email].firstIncompleteTs) {
              emailMap[email].firstIncompleteTs = sentTs;
            }
          } else if (stage.indexOf('COMPLETE_') === 0) {
            emailMap[email].completeSends.push({stage: stage, ts: sentTs});
          }
        }
      }
    }

    if (address && shipping) {
      if (!emailMap[email].firstCompletionTs || tsDate < emailMap[email].firstCompletionTs) {
        emailMap[email].firstCompletionTs = tsDate;
      }
    }
  }

  var custHeaders = custData[0];
  var custEmailIdx = custHeaders.indexOf('email');
  var custIdIdx = custHeaders.indexOf('customer_id');
  var emailToCustId = {};
  for (var r = 1; r < custData.length; r++) {
    var em = (custData[r][custEmailIdx] || '').toString().toLowerCase().trim();
    if (em) emailToCustId[em] = custData[r][custIdIdx];
  }

  var shipHeaders = shipData[0];
  var shipCustIdIdx = shipHeaders.indexOf('customer_id');
  var shipStageIdx = shipHeaders.indexOf('stage');
  var custShipments = {};
  for (var r = 1; r < shipData.length; r++) {
    var cid = shipData[r][shipCustIdIdx];
    if (!cid) continue;
    if (!custShipments[cid]) custShipments[cid] = [];
    custShipments[cid].push({stage: String(shipData[r][shipStageIdx] || '').toLowerCase().trim()});
  }

  var buckets = {
    organic_complete:    { count: 0, received: 0, purchased: 0 },
    recovered:           { count: 0, received: 0, purchased: 0 },
    abandoned:           { count: 0, received: 0, purchased: 0 },
    incomplete_no_drip:  { count: 0, received: 0, purchased: 0 },
    never_engaged:       { count: 0, received: 0, purchased: 0 },
  };

  var RECEIVED_OR_BEYOND = ['received','inspected','offer_made','purchased','returned'];

  Object.keys(emailMap).forEach(function(email) {
    var rec = emailMap[email];
    var bucket;
    if (rec.firstCompletionTs && rec.firstIncompleteTs) {
      if (rec.firstCompletionTs > rec.firstIncompleteTs) bucket = 'recovered';
      else bucket = 'organic_complete';
    } else if (rec.firstCompletionTs && !rec.firstIncompleteTs) bucket = 'organic_complete';
    else if (!rec.firstCompletionTs && rec.firstIncompleteTs) bucket = 'abandoned';
    else if (!rec.firstCompletionTs && !rec.firstIncompleteTs) bucket = 'never_engaged';
    else bucket = 'incomplete_no_drip';

    buckets[bucket].count++;
    var custId = emailToCustId[email];
    if (custId && custShipments[custId]) {
      var ships = custShipments[custId];
      if (ships.some(function(s) { return RECEIVED_OR_BEYOND.indexOf(s.stage) >= 0; })) buckets[bucket].received++;
      if (ships.some(function(s) { return s.stage === 'purchased'; })) buckets[bucket].purchased++;
    }
  });

  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('  DRIP CAMPAIGN RECOVERY ANALYSIS');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('Total unique emails analyzed: ' + Object.keys(emailMap).length);
  Logger.log('');

  function fmtPct(n, d) { return d > 0 ? (100 * n / d).toFixed(1) + '%' : '—'; }
  function pad(s, n) { s = String(s); while (s.length < n) s = s + ' '; return s; }
  function padR(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
  function row(label, b) {
    return pad(label, 23) + ' │ ' + padR(b.count, 5) + ' │ ' + padR(b.received, 4) +
      ' │ ' + padR(fmtPct(b.received, b.count), 5) +
      ' │ ' + padR(b.purchased, 5) + ' │ ' + padR(fmtPct(b.purchased, b.count), 5);
  }
  Logger.log('BUCKET                  │ Count │ Recv │ Recv% │ Purch │ Purch%');
  Logger.log(row('Organic complete',    buckets.organic_complete));
  Logger.log(row('Recovered (drip won)',buckets.recovered));
  Logger.log(row('Abandoned',           buckets.abandoned));
  Logger.log(row('Never engaged',       buckets.never_engaged));

  return buckets;
}


// ═══════════════════════════════════════════════
//  VARIANT A/B/C ANALYSIS
// ═══════════════════════════════════════════════

function analyzeVariants() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var leadData = leadSheet.getDataRange().getValues();
  var custData = custSheet.getDataRange().getValues();
  var shipData = shipSheet.getDataRange().getValues();

  var sessions = {};
  var rows = [];
  for (var i = 1; i < leadData.length; i++) {
    var ts = leadData[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    rows.push({ ts: tsDate, row: leadData[i] });
  }
  rows.sort(function(a, b) { return a.ts - b.ts; });

  for (var k = 0; k < rows.length; k++) {
    var row = rows[k].row;
    var sid = (row[COL.SESSION_ID] || '').toString().trim();
    if (!sid) continue;
    var variant = (row[COL.VARIANT] || '').toString().trim().toUpperCase();
    if (variant !== 'A' && variant !== 'B' && variant !== 'C') variant = '';
    var email = (row[COL.EMAIL] || '').toString().trim().toLowerCase();
    var address = (row[COL.ADDRESS] || '').toString().trim();
    var shipping = (row[COL.SHIPPING] || '').toString().trim();
    var estimateText = (row[COL.ESTIMATE] || '').toString().trim();

    if (!sessions[sid]) sessions[sid] = { variant: '', email: '', estimate: 0, hasAddress: false };
    if (!sessions[sid].variant && variant) sessions[sid].variant = variant;
    if (!sessions[sid].email && email && email.indexOf('@') !== -1) sessions[sid].email = email;
    if (address && shipping) sessions[sid].hasAddress = true;
    if (estimateText && !sessions[sid].estimate) {
      var nums = (estimateText.match(/\$([\d,]+)/g) || []).map(function(s) {
        return parseInt(s.replace(/[$,]/g, ''), 10) || 0;
      });
      if (nums.length === 1) sessions[sid].estimate = nums[0];
      else if (nums.length >= 2) sessions[sid].estimate = (nums[0] + nums[1]) / 2;
    }
  }

  var perEmail = {};
  var sessionsNoEmail = { A: 0, B: 0, C: 0, '': 0 };

  Object.keys(sessions).forEach(function(sid) {
    var s = sessions[sid];
    if (!s.email) {
      sessionsNoEmail[s.variant || '']++;
      return;
    }
    if (!perEmail[s.email]) {
      perEmail[s.email] = {
        variant: s.variant,
        hasAddress: s.hasAddress,
        estimateSum: s.estimate || 0,
        estimateCount: s.estimate ? 1 : 0,
      };
    } else {
      if (s.hasAddress) perEmail[s.email].hasAddress = true;
      if (s.estimate) {
        perEmail[s.email].estimateSum += s.estimate;
        perEmail[s.email].estimateCount++;
      }
    }
  });

  var custHeaders = custData[0];
  var custEmailIdx = custHeaders.indexOf('email');
  var custIdIdx = custHeaders.indexOf('customer_id');
  var emailToCustId = {};
  for (var r = 1; r < custData.length; r++) {
    var em = (custData[r][custEmailIdx] || '').toString().toLowerCase().trim();
    if (em) emailToCustId[em] = custData[r][custIdIdx];
  }

  var shipHeaders = shipData[0];
  var shipCustIdIdx = shipHeaders.indexOf('customer_id');
  var shipStageIdx = shipHeaders.indexOf('stage');
  var shipPurchPriceIdx = shipHeaders.indexOf('purchase_price');
  var custShipments = {};
  for (var r = 1; r < shipData.length; r++) {
    var cid = shipData[r][shipCustIdIdx];
    if (!cid) continue;
    if (!custShipments[cid]) custShipments[cid] = [];
    custShipments[cid].push({
      stage: String(shipData[r][shipStageIdx] || '').toLowerCase().trim(),
      price: parseFloat(shipData[r][shipPurchPriceIdx]) || 0
    });
  }

  var RECEIVED_OR_BEYOND = ['received','inspected','offer_made','purchased','returned'];

  var stats = {
    A: { emails: 0, addresses: 0, anyReceived: 0, anyPurchased: 0, totalEst: 0, estCount: 0, totalPaid: 0 },
    B: { emails: 0, addresses: 0, anyReceived: 0, anyPurchased: 0, totalEst: 0, estCount: 0, totalPaid: 0 },
    C: { emails: 0, addresses: 0, anyReceived: 0, anyPurchased: 0, totalEst: 0, estCount: 0, totalPaid: 0 },
  };

  Object.keys(perEmail).forEach(function(em) {
    var p = perEmail[em];
    if (!p.variant || !stats[p.variant]) return;
    var v = stats[p.variant];
    v.emails++;
    if (p.hasAddress) v.addresses++;
    if (p.estimateCount > 0) {
      v.totalEst += p.estimateSum / p.estimateCount;
      v.estCount++;
    }
    var cid = emailToCustId[em];
    if (cid && custShipments[cid]) {
      var ships = custShipments[cid];
      if (ships.some(function(s) { return RECEIVED_OR_BEYOND.indexOf(s.stage) >= 0; })) v.anyReceived++;
      var purchased = ships.filter(function(s) { return s.stage === 'purchased'; });
      if (purchased.length > 0) {
        v.anyPurchased++;
        v.totalPaid += purchased.reduce(function(sum, s) { return sum + s.price; }, 0);
      }
    }
  });

  function fmtPct(n, d) { return d > 0 ? (100 * n / d).toFixed(1) + '%' : '—'; }
  function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
  function padR(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  Logger.log('━━━ VARIANT A/B/C ANALYSIS (deduped by email) ━━━');
  Logger.log('VAR │ Emails │ AddrCap │ Em→Addr │ AvgEst │  Recv │ Purch │ TotalPaid');
  ['A','B','C'].forEach(function(v) {
    var s = stats[v];
    if (s.emails === 0) return;
    var avgEst = s.estCount > 0 ? s.totalEst / s.estCount : 0;
    Logger.log(' ' + v + '  │ ' + padR(s.emails, 6) + ' │ ' + padR(s.addresses, 7) +
      ' │ ' + padR(fmtPct(s.addresses, s.emails), 7) + ' │ ' + padR(fmt$(avgEst), 6) +
      ' │ ' + padR(s.anyReceived, 5) + ' │ ' + padR(s.anyPurchased, 5) +
      ' │ ' + padR(fmt$(s.totalPaid), 8));
  });
  Logger.log('No-email sessions: A: ' + sessionsNoEmail.A + '  B: ' + sessionsNoEmail.B + '  C: ' + sessionsNoEmail.C);

  return stats;
}


// ═══════════════════════════════════════════════
//  PAYMENT & ID CAPTURE HANDLER
// ═══════════════════════════════════════════════

// JUN 1 PATCH: normalize DOB to YYYY-MM-DD on storage. Strips ISO time
// portion. Critical: extract date literally from ISO strings (don't
// new Date() — Z time at 04:00 UTC reads as the prior day in EST/EDT).
function _normalizeDob(s) {
  if (!s) return '';
  // JUN 1 PATCH v2: handle JS Date objects directly. Some sheet cells are
  // typed as Date (not string), and arrive here as Date instances. Use
  // direct local getters to avoid timezone shifts.
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return '';
    var yyyy = s.getFullYear();
    var mm = String(s.getMonth() + 1).padStart(2, '0');
    var dd = String(s.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }
  var str = String(s).trim();
  // ISO YYYY-MM-DD with optional time: extract literal date portion
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  // MM/DD/YYYY → convert to YYYY-MM-DD
  var us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    var mm = us[1].length === 1 ? '0' + us[1] : us[1];
    var dd = us[2].length === 1 ? '0' + us[2] : us[2];
    return us[3] + '-' + mm + '-' + dd;
  }
  // JS Date toString format: "Sat Jul 03 1971 00:00:00 GMT-0400 (...)"
  // Match "MMM DD YYYY" portion specifically — don't use new Date() (timezone risk).
  var dateMonths = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
                     Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  var jsDateMatch = str.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (jsDateMatch && dateMonths[jsDateMatch[1]]) {
    var dayPart = jsDateMatch[2].length === 1 ? '0' + jsDateMatch[2] : jsDateMatch[2];
    return jsDateMatch[3] + '-' + dateMonths[jsDateMatch[1]] + '-' + dayPart;
  }
  return str; // unknown format — pass through
}

function handleCapturePaymentId(parsed) {
  try {
    var data = parsed.data || {};
    var shipmentId = parsed.shipment_id;
    var customerId = parsed.customer_id;

    if (!shipmentId) return { success: false, error: 'shipment_id required' };
    if (!customerId) return { success: false, error: 'customer_id required' };

    var photoUrl = '';
    if (data.id_photo && String(data.id_photo).startsWith('data:image')) {
      try {
        var customer = getCustomers().find(function(c) { return c.customer_id === customerId; });
        var label = (customer && customer.name ? customer.name : 'unknown') + '_ID';
        photoUrl = uploadImageToDrive(data.id_photo, label);
      } catch (e) {
        Logger.log('ID photo upload error (non-fatal): ' + e.toString());
      }
    }

    var idFields = {
      id_type:    data.id_type || '',
      id_number:  data.id_number || '',
      id_state:   data.id_state || '',
      date_birth: _normalizeDob(data.date_birth || ''),
    };
    if (photoUrl) idFields.id_photo_url = photoUrl;

    var swornFields = {};
    if (data.sworn_statement === true) {
      swornFields.sworn_statement_at = new Date().toISOString();
      swornFields.sworn_statement_ip = parsed.ip || data.ip || '';
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
    var custRows = custSheet.getDataRange().getValues();
    var custHeaders = custRows[0];
    var custIdIdx = custHeaders.indexOf('customer_id');
    for (var r = 1; r < custRows.length; r++) {
      if (custRows[r][custIdIdx] === customerId) {
        Object.keys(idFields).forEach(function(key) {
          var col = custHeaders.indexOf(key);
          if (col >= 0 && idFields[key]) {
            custSheet.getRange(r + 1, col + 1).setValue(idFields[key]);
          }
        });
        Object.keys(swornFields).forEach(function(key) {
          var col = custHeaders.indexOf(key);
          if (col >= 0) custSheet.getRange(r + 1, col + 1).setValue(swornFields[key]);
        });
        break;
      }
    }

    var shipmentUpdates = {};
    Object.keys(idFields).forEach(function(k) { shipmentUpdates[k] = idFields[k]; });
    Object.keys(swornFields).forEach(function(k) { shipmentUpdates[k] = swornFields[k]; });
    if (data.payment_method !== undefined) shipmentUpdates.payment_method = data.payment_method;
    if (data.payment_info !== undefined) shipmentUpdates.payment_info = data.payment_info;

    updateShipment(shipmentId, shipmentUpdates);

    Logger.log('Payment/ID captured for ' + shipmentId + ' (sworn=' + (data.sworn_statement === true) + ')');
    return {
      success: true,
      photo_url: photoUrl,
      sworn_statement_at: swornFields.sworn_statement_at || ''
    };

  } catch (err) {
    Logger.log('handleCapturePaymentId error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════
//  SELF-SERVE VERIFICATION TOKEN HANDLERS
// ═══════════════════════════════════════════════

var SELF_SERVE_TTL_DAYS = 30;
var SELF_SERVE_BASE_URL = 'https://snappy.gold/verify?token=';

// MAY 22 PATCH: fast single-row lookups, avoid full-tab parses.
function _findCustomerById(ss, customerId) {
  if (!customerId) return null;
  var sheet = ss.getSheetByName(TAB.CUSTOMERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idIdx = headers.indexOf('customer_id');
  if (idIdx < 0) return null;
  var ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (ids[r][0] === customerId) {
      var rowVals = sheet.getRange(r + 2, 1, 1, sheet.getLastColumn()).getValues()[0];
      // MAY 30 FIX: return ALL columns, not just name+email. Previous version
      // dropped phone, address, and others — which broke sendSms in resend
      // flow (Carla Cabezas SHP-761, Hazel Ross SHP-762 received no SMS).
      var out = { customer_id: customerId };
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) out[headers[c]] = rowVals[c];
      }
      return out;
    }
  }
  return null;
}

function _findShipmentById(ss, shipmentId) {
  if (!shipmentId) return null;
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idIdx = headers.indexOf('shipment_id');
  if (idIdx < 0) return null;
  var ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (ids[r][0] === shipmentId) {
      var rowVals = sheet.getRange(r + 2, 1, 1, sheet.getLastColumn()).getValues()[0];
      var out = { shipment_id: shipmentId };
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) out[headers[c]] = rowVals[c];
      }
      return out;
    }
  }
  return null;
}

// MAY 22 PATCH: idempotently add offer_amount + offer_description columns to
// the SelfServeTokens tab if they're missing. Earlier tokens have 7 cols;
// new tokens have 9.
function _ensureSelfServeColumns(sheet) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var needed = ['offer_amount', 'offer_description'];
  var toAdd = needed.filter(function(h) { return headerRow.indexOf(h) < 0; });
  if (toAdd.length === 0) return;
  var startCol = sheet.getLastColumn() + 1;
  for (var i = 0; i < toAdd.length; i++) {
    var cell = sheet.getRange(1, startCol + i);
    cell.setValue(toAdd[i])
        .setFontWeight('bold')
        .setBackground('#1A1816')
        .setFontColor('#C8953C');
  }
  Logger.log('_ensureSelfServeColumns: added ' + toAdd.join(', '));
}

function _randomToken(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < (len || 24); i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function handleGenerateSelfServeToken(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    var customerId = parsed.customer_id;
    if (!shipmentId || !customerId) return { success: false, error: 'shipment_id and customer_id required' };

    var customer = getCustomers().find(function(c) { return c.customer_id === customerId; });
    if (!customer) return { success: false, error: 'customer not found' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.SELF_SERVE_TOKENS);
    if (!sheet) return { success: false, error: 'SelfServeTokens tab not found' };

    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var shipIdx = headers.indexOf('shipment_id');
    var usedIdx = headers.indexOf('used_at');
    var expIdx = headers.indexOf('expires_at');
    var now = new Date();
    for (var r = 1; r < allRows.length; r++) {
      if (allRows[r][shipIdx] === shipmentId && !allRows[r][usedIdx]) {
        sheet.getRange(r + 1, expIdx + 1).setValue(now.toISOString());
      }
    }

    var token = _randomToken(24);
    var expiresAt = new Date(now.getTime() + SELF_SERVE_TTL_DAYS * 86400000);
    // MAY 22 PATCH: ensure offer_amount + offer_description columns exist,
    // then append row including those values. Older sheets only had 7 cols
    // (token, shipment_id, customer_id, created_at, expires_at, used_at, used_ip).
    _ensureSelfServeColumns(sheet);
    var offerAmount = parsed.offer_amount || '';
    var offerDescription = parsed.offer_description || '';
    sheet.appendRow([token, shipmentId, customerId, now.toISOString(), expiresAt.toISOString(), '', '', offerAmount, offerDescription]);

    var url = SELF_SERVE_BASE_URL + token;
    var emailSent = false;
    if (parsed.send_email !== false && customer.email) {
      try {
        _sendSelfServeEmail(customer, url, offerAmount, offerDescription);
        emailSent = true;
      } catch (e) { Logger.log('Self-serve email failed: ' + e.toString()); }
    }

    // Record the offer on the shipment + in the contact log (audit trail of what
    // was offered, for disputes / follow-ups / memory of the deal).
    try {
      var offerUpdates = {};
      if (offerAmount) offerUpdates.offer_price = offerAmount;
      if (offerDescription) offerUpdates.offer_description = offerDescription;
      if (Object.keys(offerUpdates).length) updateShipment(shipmentId, offerUpdates);
    } catch (e) { Logger.log('Offer field stamp failed: ' + e.toString()); }
    try {
      var fmtAmt = offerAmount ? ('$' + String(offerAmount).replace(/^\$/, '')) : '(no amount)';
      var noteText = 'Offer sent: ' + fmtAmt + (offerDescription ? (' — ' + offerDescription) : '') + (emailSent ? ' (emailed to customer)' : '');
      addContactLog({ customer_id: customerId, shipment_id: shipmentId, type: 'offer', notes: noteText });
    } catch (e) { Logger.log('Offer contact-log failed: ' + e.toString()); }

    return { success: true, token: token, url: url, expires_at: expiresAt.toISOString(), email_sent: emailSent };

  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function handleValidateSelfServeToken(parsed) {
  try {
    var token = parsed.token;
    if (!token) return { success: false, error: 'token required' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.SELF_SERVE_TOKENS);
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var tokenIdx = headers.indexOf('token');
    var shipIdx = headers.indexOf('shipment_id');
    var custIdx = headers.indexOf('customer_id');
    var expIdx = headers.indexOf('expires_at');
    var usedIdx = headers.indexOf('used_at');
    var amountIdx = headers.indexOf('offer_amount');
    var descIdx = headers.indexOf('offer_description');

    var row = null;
    for (var r = 1; r < allRows.length; r++) {
      if (allRows[r][tokenIdx] === token) { row = allRows[r]; break; }
    }
    if (!row) return { success: false, error: 'invalid_token' };
    if (row[usedIdx]) return { success: false, error: 'already_submitted', used_at: row[usedIdx] };

    var expiresAt = new Date(row[expIdx]);
    if (new Date() > expiresAt) return { success: false, error: 'expired', expires_at: row[expIdx] };

    // MAY 22 PATCH: skip getCustomers/getShipments (which load + parse entire
    // tabs). Read only the needed row from each via direct column scan.
    var customer = _findCustomerById(ss, row[custIdx]);
    var shipment = _findShipmentById(ss, row[shipIdx]);
    if (!customer || !shipment) return { success: false, error: 'record_not_found' };

    return {
      success: true,
      customer: { name: customer.name, email: customer.email },
      shipment: {
        shipment_id: shipment.shipment_id,
        item: shipment.item,
        estimate: shipment.estimate,
        purchase_price: shipment.purchase_price,
      },
      // MAY 22 PATCH: include the offer values stored at token-generation time
      // so the verify page can render them under the offer banner.
      offer_amount: amountIdx >= 0 ? (row[amountIdx] || '') : '',
      offer_description: descIdx >= 0 ? (row[descIdx] || '') : '',
    };

  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function handleSubmitSelfServe(parsed) {
  try {
    var token = parsed.token;
    if (!token) return { success: false, error: 'token required' };

    var validation = handleValidateSelfServeToken({ token: token });
    if (!validation.success) return validation;

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB.SELF_SERVE_TOKENS);
    var allRows = sheet.getDataRange().getValues();
    var headers = allRows[0];
    var tokenIdx = headers.indexOf('token');
    var shipIdx = headers.indexOf('shipment_id');
    var custIdx = headers.indexOf('customer_id');
    var usedIdx = headers.indexOf('used_at');
    var ipIdx = headers.indexOf('used_ip');

    var rowNum = -1, row = null;
    for (var r = 1; r < allRows.length; r++) {
      if (allRows[r][tokenIdx] === token) { rowNum = r + 1; row = allRows[r]; break; }
    }
    if (!row) return { success: false, error: 'invalid_token' };

    var captureResult = handleCapturePaymentId({
      shipment_id: row[shipIdx], customer_id: row[custIdx],
      data: parsed.data || {}, ip: parsed.ip || ''
    });
    if (!captureResult.success) return captureResult;

    sheet.getRange(rowNum, usedIdx + 1).setValue(new Date().toISOString());
    sheet.getRange(rowNum, ipIdx + 1).setValue(parsed.ip || '');

    // MAY 31 PATCH: notify David when a customer submits self-serve info.
    // Three channels:
    //   1) Email to davidisaacweiss@yahoo.com (most reliable, mobile push)
    //   2) Contact log entry so it surfaces in the customer's CRM timeline
    //   3) Shipment field `self_serve_submitted_at` so CRM can show a banner
    try {
      _notifySelfServeSubmission(row[shipIdx], row[custIdx], parsed.data || {}, validation);
    } catch (notifyErr) {
      Logger.log('Self-serve notification failed (non-fatal): ' + notifyErr.toString());
    }

    return { success: true, photo_url: captureResult.photo_url || '' };

  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// MAY 31 PATCH: helper to fire all three operator-notification channels.
// Called from handleSubmitSelfServe after capture succeeds.
function _notifySelfServeSubmission(shipmentId, customerId, submittedData, validation) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var customer = _findCustomerById(ss, customerId);
  var shipment = _findShipmentById(ss, shipmentId);
  var customerName = (customer && customer.name) || 'a customer';
  var customerEmail = (customer && customer.email) || '';
  var customerPhone = (customer && customer.phone) || '';
  var itemDesc = (shipment && shipment.item) || '(no item)';
  var offerAmount = (validation && validation.offer_amount) || '';
  var offerDescription = (validation && validation.offer_description) || '';
  var payMethod = submittedData.payment_method || '(not specified)';
  var payInfo = submittedData.payment_info || '(not specified)';
  var idType = submittedData.id_type || '';
  var dob = submittedData.date_birth || '';

  // (1) Stamp shipment + AUTO-ADVANCE the stage. When a customer accepts via
  // self-serve, they're no longer "pending response" (waiting on them) — the
  // ball is now in our court, so move them to pending_payment (the closing
  // queue: record payment+value, push LeadsOnline, pay, offer another label).
  // Only auto-advance FROM pending_response (don't yank a shipment backward if
  // it's already further along).
  try {
    var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
    var shipHeaders = shipSheet.getRange(1, 1, 1, shipSheet.getLastColumn()).getValues()[0];
    if (shipHeaders.indexOf('self_serve_submitted_at') < 0) {
      var newCol = shipSheet.getLastColumn() + 1;
      shipSheet.getRange(1, newCol).setValue('self_serve_submitted_at')
        .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    }
    var ssUpdates = { self_serve_submitted_at: new Date().toISOString() };
    // Read current stage to decide whether to advance
    var curStage = '';
    try {
      var sObj = sheetToObjects(shipSheet).find(function(s){ return s.shipment_id === shipmentId; });
      curStage = sObj ? String(sObj.stage || '') : '';
    } catch(eStage) {}
    if (curStage === 'pending_response' || curStage === 'inspected' || curStage === '') {
      ssUpdates.stage = 'pending_payment';
    }
    updateShipment(shipmentId, ssUpdates);
  } catch(e1) { Logger.log('Shipment stamp/advance error: ' + e1.toString()); }

  // (2) Contact log entry (correct schema: type + notes + shipment_id)
  try {
    addContactLog({
      customer_id: customerId, shipment_id: shipmentId, type: 'note',
      notes: '✅ Self-serve form submitted — payment + ID + statement on file. Auto-advanced to Pending Payment. Ready to push to LeadsOnline + send payment.'
    });
  } catch(e2) { Logger.log('Contact log error: ' + e2.toString()); }

  // (3) Email to David via Postmark (already configured for outbound mail)
  try {
    var subject = '🔔 ' + customerName + ' submitted self-serve verification (' + shipmentId + ')';
    var bodyLines = [
      'Heads up — ' + customerName + ' just completed their self-serve verification form.',
      '',
      'Shipment: ' + shipmentId,
      'Item: ' + itemDesc,
      (offerAmount ? 'Offer: ' + offerAmount + (offerDescription ? ' (' + offerDescription + ')' : '') : ''),
      '',
      'Customer:',
      '  ' + customerName,
      '  ' + customerEmail,
      '  ' + customerPhone,
      '',
      'Payment method: ' + payMethod,
      'Payment info: ' + payInfo,
      'ID type: ' + idType,
      'DOB: ' + dob,
      '',
      'Next steps:',
      '  1. Open CRM → find ' + shipmentId,
      '  2. Push to LeadsOnline (FL 538 compliance)',
      '  3. Send payment via ' + payMethod,
      '  4. Mark shipment as Purchased',
      '',
      'CRM: https://snappy.gold/crm'
    ].filter(function(l){return l !== undefined;}).join('\n');

    var payload = {
      From: FROM_NAME + ' <' + FROM_EMAIL + '>',
      To: 'davidisaacweiss@yahoo.com',
      Subject: subject,
      TextBody: bodyLines,
      MessageStream: 'outbound',
    };
    UrlFetchApp.fetch(POSTMARK_API_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'X-Postmark-Server-Token': POSTMARK_API_TOKEN },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    Logger.log('Self-serve notification email sent to davidisaacweiss@yahoo.com for ' + shipmentId);
  } catch(e3) { Logger.log('Notification email error: ' + e3.toString()); }
}

function _sendSelfServeEmail(customer, url, offerAmount, offerDescription) {
  var firstName = customer.name ? customer.name.split(' ')[0] : '';
  var greeting = firstName ? 'Hi ' + firstName + ',' : 'Hi,';
  var subject = firstName
    ? firstName + ', your Snappy Gold offer is ready' + (offerAmount ? ' (' + _fmtDollars(offerAmount) + ')' : '')
    : 'Your Snappy Gold offer is ready';

  // Prominent offer box (mirrors the verification page). Always shows a $.
  var offerBox = offerAmount
    ? [
        '  <div style="background: #fff; border: 2px solid #C8953C; border-radius: 8px; padding: 20px 24px; text-align: center; margin: 24px 0;">',
        '    <div style="font-size: 12px; color: #8a7a55; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px;">Your Offer</div>',
        '    <div style="font-size: 34px; font-weight: 600; color: #1A1816;">' + _fmtDollars(offerAmount) + '</div>',
        (offerDescription ? '    <div style="font-size: 13px; color: #666; margin-top: 8px;">' + offerDescription + '</div>' : ''),
        '  </div>',
      ].join('\n')
    : '';

  var intro = offerAmount
    ? '<p style="font-size: 16px; line-height: 1.6;">Good news — we\'ve reviewed your item and we\'re ready to pay you for it. Here\'s your offer:</p>'
    : '<p style="font-size: 16px; line-height: 1.6;">We\'ve reviewed your item and we\'re ready to finalize your transaction.</p>';

  var html = [
    '<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1A1816; background: #FAF6F0; padding: 32px 24px;">',
    '  <div style="text-align: center; margin-bottom: 28px;">',
    '    <h1 style="color: #C8953C; font-size: 28px; letter-spacing: 0.08em; margin: 0; font-weight: 500;">SNAPPY<span style="color: #1A1816;">.GOLD</span></h1>',
    '  </div>',
    '  <p style="font-size: 16px; line-height: 1.6;">' + greeting + '</p>',
    '  ' + intro,
    offerBox,
    '  <p style="font-size: 15px; line-height: 1.6;">To release your payment, we just need three quick things:</p>',
    '  <ul style="font-size: 15px; line-height: 1.7; padding-left: 20px; color: #333;">',
    '    <li>Date of birth</li>',
    '    <li>ID type &amp; number (driver\'s license, etc.)</li>',
    '    <li>How you\'d like to get paid</li>',
    '  </ul>',
    '  <p style="font-size: 15px; line-height: 1.6;">It takes about 30 seconds, and it\'s secure. Gold prices are strong right now, so it\'s a great time to lock in your offer.</p>',
    '  <div style="text-align: center; margin: 28px 0;">',
    '    <a href="' + url + '" style="display: inline-block; background: #C8953C; color: #fff; text-decoration: none; padding: 15px 36px; border-radius: 6px; font-weight: 600; font-family: Helvetica, Arial, sans-serif; font-size: 16px; letter-spacing: 0.04em;">Accept &amp; Get Paid →</a>',
    '  </div>',
    '  <p style="font-size: 13px; color: #666; line-height: 1.6;">This link is valid for 30 days. If the button doesn\'t work, copy and paste this into your browser:</p>',
    '  <p style="font-size: 12px; color: #999; word-break: break-all; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #eee;">' + url + '</p>',
    '  <hr style="border: none; border-top: 1px solid #e0d8c8; margin: 32px 0;">',
    '  <p style="font-size: 12px; color: #999; line-height: 1.5; text-align: center;">',
    '    Snappy Gold &middot; DW5 LLC &middot; 1686 S Federal Hwy #318, Delray Beach, FL 33483<br>',
    '    Questions? Just reply to this email or call <a href="tel:8666130704" style="color: #C8953C;">(866) 613-0704</a>',
    '  </p>',
    '</div>'
  ].join('\n');

  GmailApp.sendEmail(customer.email, subject, '', {
    htmlBody: html, from: 'hello@snappy.gold', name: 'Snappy Gold',
    bcc: 'davidisaacweiss@yahoo.com',  // confirmation copy of every offer sent
  });
}

// Normalize an offer amount to always display with a single leading $.
// Handles "150", "$150", "$150.00", 150 → "$150".
function _fmtDollars(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  s = s.replace(/^\$+/, '');           // strip any existing $(s)
  return '$' + s;
}


// ═══════════════════════════════════════════════
//  PATCH BACKFILL HELPERS (May 2026)
// ═══════════════════════════════════════════════

function backfillItemFromMessage() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var itemIdx = headers.indexOf('item');
  var msgIdx = headers.indexOf('customer_message');
  if (itemIdx < 0 || msgIdx < 0) {
    Logger.log('backfillItemFromMessage: required columns not found');
    return;
  }

  var updated = 0;
  for (var r = 1; r < data.length; r++) {
    var item = String(data[r][itemIdx] || '').trim();
    var msg = String(data[r][msgIdx] || '').trim();
    if (!item && msg) {
      var derived = _itemFromMessage(msg);
      if (derived) {
        sheet.getRange(r + 1, itemIdx + 1).setValue(derived);
        updated++;
      }
    }
  }
  Logger.log('backfillItemFromMessage: updated ' + updated + ' rows');
  return updated;
}

function backfillTimestampsFromStage() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var stageIdx = headers.indexOf('stage');
  var createdIdx = headers.indexOf('created_at');
  var receivedIdx = headers.indexOf('received_at');
  var purchasedIdx = headers.indexOf('purchased_at');
  var returnedIdx = headers.indexOf('returned_at');

  if (stageIdx < 0 || createdIdx < 0) {
    Logger.log('backfillTimestampsFromStage: required columns not found');
    return;
  }
  if (purchasedIdx < 0 || returnedIdx < 0 || receivedIdx < 0) {
    Logger.log('backfillTimestampsFromStage: run ensureAllColumns first to add columns');
    return;
  }

  var RECEIVED_OR_BEYOND = ['received','inspected','offer_made','purchased','returned'];

  var receivedFilled = 0, purchasedFilled = 0, returnedFilled = 0;
  for (var r = 1; r < data.length; r++) {
    var stage = String(data[r][stageIdx] || '').toLowerCase().trim();
    var createdAt = data[r][createdIdx];
    if (!createdAt) continue;

    if (RECEIVED_OR_BEYOND.indexOf(stage) >= 0) {
      var existingReceived = data[r][receivedIdx];
      if (!existingReceived || String(existingReceived).trim() === '') {
        sheet.getRange(r + 1, receivedIdx + 1).setValue(createdAt);
        receivedFilled++;
      }
    }
    if (stage === 'purchased') {
      var existingPurchased = data[r][purchasedIdx];
      if (!existingPurchased || String(existingPurchased).trim() === '') {
        sheet.getRange(r + 1, purchasedIdx + 1).setValue(createdAt);
        purchasedFilled++;
      }
    }
    if (stage === 'returned') {
      var existingReturned = data[r][returnedIdx];
      if (!existingReturned || String(existingReturned).trim() === '') {
        sheet.getRange(r + 1, returnedIdx + 1).setValue(createdAt);
        returnedFilled++;
      }
    }
  }

  var total = receivedFilled + purchasedFilled + returnedFilled;
  Logger.log('backfillTimestampsFromStage: updated ' + total + ' values total ' +
    '(received_at: ' + receivedFilled + ', purchased_at: ' + purchasedFilled + ', returned_at: ' + returnedFilled + ')');
  return total;
}


// ═══════════════════════════════════════════════
//  SMOKE TEST
// ═══════════════════════════════════════════════

function testPatchSmoke() {
  var test1 = _itemFromMessage('I have a 14k gold ring with a small diamond. Inherited from my grandmother.');
  Logger.log('Test 1 (item extraction): "' + test1 + '"');

  // Multi-item test
  Logger.log('Test 1b (itemPhrase single): "' + itemPhrase({item: '14K Gold Ring'}) + '"');
  Logger.log('Test 1c (itemPhrase multi+): "' + itemPhrase({item: 'Ring + Necklace'}) + '"');
  Logger.log('Test 1d (itemPhrase manifest 2): "' + itemPhrase({item_manifest: [{name:'Ring'},{name:'Watch'}]}) + '"');
  Logger.log('Test 1e (itemPhrase empty): "' + itemPhrase({}) + '"');

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var shipHeaders = shipSheet.getRange(1, 1, 1, shipSheet.getLastColumn()).getValues()[0];
  var custHeaders = custSheet.getRange(1, 1, 1, custSheet.getLastColumn()).getValues()[0];

  var required = {
    'Shipments.purchased_at':       shipHeaders.indexOf('purchased_at') >= 0,
    'Shipments.returned_at':        shipHeaders.indexOf('returned_at') >= 0,
    'Shipments.sworn_statement_at': shipHeaders.indexOf('sworn_statement_at') >= 0,
    'Shipments.sworn_statement_ip': shipHeaders.indexOf('sworn_statement_ip') >= 0,
    'Customers.sworn_statement_at': custHeaders.indexOf('sworn_statement_at') >= 0,
    'Customers.sworn_statement_ip': custHeaders.indexOf('sworn_statement_ip') >= 0,
  };

  Logger.log('Test 2 (schema check):');
  Object.keys(required).forEach(function(k) {
    Logger.log('  ' + (required[k] ? '✓' : '✗ MISSING') + ' ' + k);
  });

  Logger.log('Test 3 (function existence):');
  Logger.log('  ' + (typeof itemPhrase === 'function' ? '✓' : '✗') + ' itemPhrase (multi-item helper)');
  Logger.log('  ' + (typeof handleAddInventoryPhoto === 'function' ? '✓' : '✗') + ' handleAddInventoryPhoto');
  Logger.log('  ' + (typeof _itemFromMessage === 'function' ? '✓' : '✗') + ' _itemFromMessage');
  Logger.log('  ' + (typeof backfillItemFromMessage === 'function' ? '✓' : '✗') + ' backfillItemFromMessage');
  Logger.log('  ' + (typeof backfillTimestampsFromStage === 'function' ? '✓' : '✗') + ' backfillTimestampsFromStage');
  Logger.log('  ' + (typeof setupCrmTabsForPatch === 'function' ? '✓' : '✗') + ' setupCrmTabsForPatch');

  Logger.log('=== Patch smoke test complete ===');
}


function checkDripSendHistory() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.LEADS);
  var data = sheet.getDataRange().getValues();
  var sendsByMonth = {};
  var lastSendTs = null;
  var lastSendType = null;
  var parseFailures = 0;
  var totalSends = 0;

  for (var i = 1; i < data.length; i++) {
    var autoReply = (data[i][COL.AUTO_REPLY] || '').toString();
    if (!autoReply) continue;

    var parts = autoReply.split('||');
    parts.forEach(function(part) {
      var trimmed = part.trim();
      if (!trimmed) return;
      var m = trimmed.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\s*\|\s*([A-Z_0-9]+)/);
      if (!m) {
        parseFailures++;
        return;
      }
      var tsStr = m[1].replace('T', ' ');
      var stage = m[2];
      var ts;
      try {
        ts = new Date(tsStr.replace(' ', 'T'));
        if (isNaN(ts.getTime())) {
          parseFailures++;
          return;
        }
      } catch (e) {
        parseFailures++;
        return;
      }

      totalSends++;
      var monthKey = ts.toISOString().slice(0, 7);
      if (!sendsByMonth[monthKey]) sendsByMonth[monthKey] = { INCOMPLETE: 0, COMPLETE: 0, OTHER: 0 };
      if (stage.indexOf('INCOMPLETE_') === 0) sendsByMonth[monthKey].INCOMPLETE++;
      else if (stage.indexOf('COMPLETE_') === 0) sendsByMonth[monthKey].COMPLETE++;
      else sendsByMonth[monthKey].OTHER++;

      if (!lastSendTs || ts > lastSendTs) {
        lastSendTs = ts;
        lastSendType = stage;
      }
    });
  }

  Logger.log('━━━━━ DRIP SEND HISTORY ━━━━━');
  Logger.log('Total parseable sends: ' + totalSends);
  Logger.log('Parse failures: ' + parseFailures);
  Object.keys(sendsByMonth).sort().forEach(function(month) {
    var s = sendsByMonth[month];
    Logger.log(month + ': INCOMPLETE=' + s.INCOMPLETE + ', COMPLETE=' + s.COMPLETE + (s.OTHER ? ', OTHER=' + s.OTHER : ''));
  });
  Logger.log('Most recent send: ' + (lastSendTs ? lastSendTs.toISOString() + ' (' + lastSendType + ')' : 'NONE'));

  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('━━━━━ ACTIVE TRIGGERS ━━━━━');
  if (triggers.length === 0) Logger.log('NO TRIGGERS ACTIVE');
  triggers.forEach(function(t) {
    Logger.log('  ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  });
}


// ═══════════════════════════════════════════════
//  CR RECONCILIATION REPORT
//  Pulls all completed shipping-form submissions (CRs)
//  from May 7 onwards, deduped per email, with attribution.
// ═══════════════════════════════════════════════

function reconcileCRs() {
  var CUTOFF = new Date('2026-05-07T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var data = leadSheet.getDataRange().getValues();

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var ts = data[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    rows.push({ ts: tsDate, row: data[i] });
  }
  rows.sort(function(a, b) { return a.ts - b.ts; });

  var sessions = {};
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k].row;
    var ts = rows[k].ts;
    var sid = String(r[COL.SESSION_ID] || '').trim();
    var email = String(r[COL.EMAIL] || '').toLowerCase().trim();
    var key = sid || (email && email.indexOf('@') !== -1 ? 'EM:' + email : '');
    if (!key) continue;

    if (!sessions[key]) {
      sessions[key] = {
        first_ts: ts, latest_ts: ts, email: email, name: '', item: '',
        estimate: '', shipping: '', address: '', variant: '',
        utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '',
        fbclid: '', gclid: '', lead_source: '', session_id: sid,
      };
    }
    var s = sessions[key];
    if (ts < s.first_ts) s.first_ts = ts;
    if (ts > s.latest_ts) s.latest_ts = ts;
    if (email && email.indexOf('@') !== -1) s.email = email;
    var nm = String(r[COL.NAME] || '').trim();         if (nm) s.name = nm;
    var it = String(r[COL.ITEM] || '').trim();         if (it) s.item = it;
    var es = String(r[COL.ESTIMATE] || '').trim();     if (es) s.estimate = es;
    var sh = String(r[COL.SHIPPING] || '').trim();     if (sh) s.shipping = sh;
    var ad = String(r[COL.ADDRESS] || '').trim();      if (ad) s.address = ad;
    var v  = String(r[COL.VARIANT] || '').trim().toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C') s.variant = v;
    var us = String(r[COL.TRAFFIC_SRC] || '').trim();  if (us) s.utm_source = us;
    var um = String(r[COL.MEDIUM] || '').trim();       if (um) s.utm_medium = um;
    var uc = String(r[COL.CAMPAIGN] || '').trim();     if (uc) s.utm_campaign = uc;
    var uct = String(r[COL.AD_CONTENT] || '').trim();  if (uct) s.utm_content = uct;
    var fb = String(r[COL.FBCLID] || '').trim();       if (fb) s.fbclid = fb;
    var gc = String(r[COL.GCLID] || '').trim();        if (gc) s.gclid = gc;
    var ls = String(r[COL.TYPE] || '').trim();         if (ls) s.lead_source = ls;
  }

  var crs = [];
  Object.keys(sessions).forEach(function(key) {
    var s = sessions[key];
    if (!s.shipping || !s.address) return;
    if (s.latest_ts < CUTOFF) return;
    crs.push(s);
  });
  crs.sort(function(a, b) { return b.latest_ts - a.latest_ts; });

  var tabName = 'CR_Reconciliation';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'cr_timestamp', 'first_visit', 'name', 'email', 'item', 'estimate',
    'shipping_method', 'address', 'variant',
    'utm_source', 'utm_campaign', 'utm_content', 'fbclid', 'gclid',
    'lead_source', 'session_id'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);

  var outRows = crs.map(function(s) {
    return [
      Utilities.formatDate(s.latest_ts, 'America/New_York', 'yyyy-MM-dd HH:mm'),
      Utilities.formatDate(s.first_ts, 'America/New_York', 'yyyy-MM-dd HH:mm'),
      s.name, s.email, s.item, s.estimate,
      s.shipping, s.address, s.variant,
      s.utm_source, s.utm_campaign, s.utm_content,
      s.fbclid ? s.fbclid.slice(0, 30) + '…' : '',
      s.gclid ? s.gclid.slice(0, 30) + '…' : '',
      s.lead_source, s.session_id
    ];
  });
  if (outRows.length) {
    outSheet.getRange(2, 1, outRows.length, headers.length).setValues(outRows);
  }
  outSheet.autoResizeColumns(1, headers.length);

  var buckets = {};
  function bucketKey(s) {
    if (s.utm_campaign && s.utm_campaign.toLowerCase().indexOf('completeregistration') !== -1) {
      var sub = s.utm_content || ('variant_' + (s.variant || '?'));
      return 'CR-campaign / ' + sub + ' / forced_' + (s.variant || '?');
    }
    if (s.utm_campaign && s.utm_campaign.toLowerCase() === 'leads') {
      return 'Lead-campaign (old) / random / landed_' + (s.variant || '?');
    }
    if (s.utm_campaign) {
      return 'Other UTM: ' + s.utm_campaign + ' / variant_' + (s.variant || '?');
    }
    if (s.fbclid) return 'FB (no UTM) / variant_' + (s.variant || '?');
    if (s.gclid) return 'Google (no UTM) / variant_' + (s.variant || '?');
    return 'Direct / variant_' + (s.variant || '?');
  }
  crs.forEach(function(s) {
    var k = bucketKey(s);
    if (!buckets[k]) buckets[k] = 0;
    buckets[k]++;
  });

  var byVariant = { A: 0, B: 0, C: 0, '': 0 };
  crs.forEach(function(s) { byVariant[s.variant || ''] = (byVariant[s.variant || ''] || 0) + 1; });

  Logger.log('━━━ CR RECONCILIATION — May 7+ ━━━');
  Logger.log('Total CRs: ' + crs.length);
  Logger.log('BY VARIANT:  A: ' + byVariant.A + '  B: ' + byVariant.B + '  C: ' + byVariant.C + '  (none): ' + byVariant['']);
  Object.keys(buckets).sort(function(a, b) { return buckets[b] - buckets[a]; }).forEach(function(k) {
    Logger.log('  ' + buckets[k] + ' — ' + k);
  });
  Logger.log('Detail written to tab: ' + tabName);
}


// ═══════════════════════════════════════════════
//  CR FULFILLMENT AUDIT
// ═══════════════════════════════════════════════

function auditCRs() {
  var CUTOFF = new Date('2026-05-07T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));

  var emailToCustId = {};
  var custIdToEmail = {};
  custRows.forEach(function(c) {
    var em = String(c.email || '').toLowerCase().trim();
    if (em) {
      emailToCustId[em] = c.customer_id;
      custIdToEmail[c.customer_id] = em;
    }
  });

  var custIdToShipments = {};
  shipRows.forEach(function(s) {
    if (!s.customer_id) return;
    if (!custIdToShipments[s.customer_id]) custIdToShipments[s.customer_id] = [];
    custIdToShipments[s.customer_id].push(s);
  });
  Object.keys(custIdToShipments).forEach(function(cid) {
    custIdToShipments[cid].sort(function(a, b) {
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
  });

  var rows = [];
  for (var i = 1; i < leadData.length; i++) {
    var ts = leadData[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    rows.push({ ts: tsDate, row: leadData[i] });
  }
  rows.sort(function(a, b) { return a.ts - b.ts; });

  var sessions = {};
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k].row;
    var ts = rows[k].ts;
    var sid = String(r[COL.SESSION_ID] || '').trim();
    var email = String(r[COL.EMAIL] || '').toLowerCase().trim();
    var key = sid || (email && email.indexOf('@') !== -1 ? 'EM:' + email : '');
    if (!key) continue;

    if (!sessions[key]) {
      sessions[key] = {
        first_ts: ts, latest_ts: ts, email: email, name: '', item: '',
        estimate: '', shipping: '', address: '', variant: '',
        utm_campaign: '', session_id: sid, cr_ts: null,
      };
    }
    var s = sessions[key];
    if (ts < s.first_ts) s.first_ts = ts;
    if (ts > s.latest_ts) s.latest_ts = ts;
    if (email && email.indexOf('@') !== -1) s.email = email;
    var nm = String(r[COL.NAME] || '').trim();      if (nm) s.name = nm;
    var it = String(r[COL.ITEM] || '').trim();      if (it) s.item = it;
    var es = String(r[COL.ESTIMATE] || '').trim();  if (es) s.estimate = es;
    var v  = String(r[COL.VARIANT] || '').trim().toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C') s.variant = v;
    var uc = String(r[COL.CAMPAIGN] || '').trim(); if (uc) s.utm_campaign = uc;

    var sh = String(r[COL.SHIPPING] || '').trim();
    var ad = String(r[COL.ADDRESS] || '').trim();
    if (sh && ad) {
      s.shipping = sh;
      s.address = ad;
      if (!s.cr_ts || ts > s.cr_ts) s.cr_ts = ts;
    }
  }

  var crs = [];
  Object.keys(sessions).forEach(function(key) {
    var s = sessions[key];
    if (!s.cr_ts) return;
    if (s.cr_ts < CUTOFF) return;
    crs.push(s);
  });
  crs.sort(function(a, b) { return b.cr_ts - a.cr_ts; });

  var auditRows = [];
  var statusCounts = {};

  crs.forEach(function(s) {
    var custId = emailToCustId[s.email] || '';
    var shipments = custId ? (custIdToShipments[custId] || []) : [];

    var matchedShipment = null;
    var matchType = '';
    var oneHour = 60 * 60 * 1000;
    var fourteenDays = 14 * 24 * 60 * 60 * 1000;

    for (var i = 0; i < shipments.length; i++) {
      var ship = shipments[i];
      var sCreated = ship.created_at ? new Date(ship.created_at) : null;
      if (!sCreated) continue;
      if (Math.abs(sCreated - s.cr_ts) < oneHour) {
        matchedShipment = ship;
        matchType = 'new_shipment';
        break;
      }
    }

    if (!matchedShipment) {
      var PRE_RECEIVED = ['ready_to_fulfill', 'outbound_pending', 'outbound_complete'];
      var bestAppend = null;
      for (var i = 0; i < shipments.length; i++) {
        var ship = shipments[i];
        var stage = String(ship.stage || '').toLowerCase().trim();
        if (PRE_RECEIVED.indexOf(stage) < 0) continue;
        var sCreated = ship.created_at ? new Date(ship.created_at) : null;
        if (!sCreated) continue;
        if (sCreated > s.cr_ts) continue;
        if ((s.cr_ts - sCreated) > fourteenDays) continue;
        if (!bestAppend || sCreated > new Date(bestAppend.created_at)) bestAppend = ship;
      }
      if (bestAppend) {
        matchedShipment = bestAppend;
        matchType = 'appended_to_existing';
      }
    }

    if (!matchedShipment) {
      var RECEIVED_OR_BEYOND = ['received','inspected','offer_made','purchased','returned'];
      var sevenDays = 7 * 24 * 60 * 60 * 1000;
      for (var i = 0; i < shipments.length; i++) {
        var ship = shipments[i];
        var stage = String(ship.stage || '').toLowerCase().trim();
        if (RECEIVED_OR_BEYOND.indexOf(stage) < 0) continue;
        var sCreated = ship.created_at ? new Date(ship.created_at) : null;
        if (!sCreated) continue;
        if (sCreated > s.cr_ts) continue;
        if ((s.cr_ts - sCreated) > sevenDays) continue;
        matchedShipment = ship;
        matchType = 'cooldown_blocked';
        break;
      }
    }

    var statusFlag;
    if (!custId) statusFlag = '🔴 NO_CUSTOMER';
    else if (!matchedShipment) statusFlag = '🔴 NO_SHIPMENT';
    else {
      var stage = String(matchedShipment.stage || '').toLowerCase().trim();
      if (matchType === 'cooldown_blocked') statusFlag = '🟡 COOLDOWN_BLOCKED (' + stage + ')';
      else if (stage === 'ready_to_fulfill') statusFlag = '🟢 IN_FULFILL';
      else if (stage === 'outbound_pending' || stage === 'outbound_complete') statusFlag = '🟢 OUTBOUND';
      else if (stage === 'received' || stage === 'inspected' || stage === 'offer_made') statusFlag = '🟢 RECEIVED+';
      else if (stage === 'purchased') statusFlag = '🟢 PURCHASED';
      else if (stage === 'returned') statusFlag = '🟢 RETURNED';
      else if (!stage) statusFlag = '🟡 NO_STAGE';
      else statusFlag = '🟡 UNKNOWN_STAGE (' + stage + ')';
    }

    statusCounts[statusFlag] = (statusCounts[statusFlag] || 0) + 1;

    auditRows.push([
      Utilities.formatDate(s.cr_ts, 'America/New_York', 'MM/dd HH:mm'),
      s.name, s.email, s.item, s.estimate, s.shipping,
      s.variant, s.utm_campaign,
      custId, matchedShipment ? matchedShipment.shipment_id : '',
      matchedShipment ? matchedShipment.stage : '',
      matchType, statusFlag
    ]);
  });

  var tabName = 'CR_Audit';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'CR Time', 'Name', 'Email', 'Item', 'Estimate', 'Shipping',
    'Variant', 'UTM Campaign', 'Customer ID', 'Shipment ID', 'Stage', 'Match Type', 'Status'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);
  if (auditRows.length) {
    outSheet.getRange(2, 1, auditRows.length, headers.length).setValues(auditRows);
  }
  outSheet.autoResizeColumns(1, headers.length);

  Logger.log('━━━ CR FULFILLMENT AUDIT — May 7+ ━━━');
  Logger.log('Total CR sessions: ' + crs.length);
  Object.keys(statusCounts).sort().forEach(function(k) {
    Logger.log('  ' + statusCounts[k] + ' — ' + k);
  });
  Logger.log('Detail written to tab: ' + tabName);
}


// ═══════════════════════════════════════════════
//  VARIANT ANALYSIS — NEW CUSTOMERS ONLY
// ═══════════════════════════════════════════════

function analyzeVariantsNewCustomersOnly() {
  var CUTOFF = new Date('2026-05-07T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));

  var emailToCustomer = {};
  custRows.forEach(function(c) {
    var em = String(c.email || '').toLowerCase().trim();
    if (!em) return;
    var createdAt = c.created_at ? new Date(c.created_at) : null;
    emailToCustomer[em] = {
      custId: c.customer_id, created_at: createdAt,
      isNew: createdAt && createdAt >= CUTOFF
    };
  });

  var rows = [];
  for (var i = 1; i < leadData.length; i++) {
    var ts = leadData[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    rows.push({ ts: tsDate, row: leadData[i] });
  }
  rows.sort(function(a, b) { return a.ts - b.ts; });

  var sessions = {};
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k].row;
    var ts = rows[k].ts;
    var sid = String(r[COL.SESSION_ID] || '').trim();
    var email = String(r[COL.EMAIL] || '').toLowerCase().trim();
    var key = sid || (email && email.indexOf('@') !== -1 ? 'EM:' + email : '');
    if (!key) continue;

    if (!sessions[key]) {
      sessions[key] = {
        first_ts: ts, latest_ts: ts, email: email, name: '', item: '',
        variant: '', utm_campaign: '', utm_content: '', fbclid: '',
        shipping: '', address: '', cr_ts: null
      };
    }
    var s = sessions[key];
    if (ts < s.first_ts) s.first_ts = ts;
    if (ts > s.latest_ts) s.latest_ts = ts;
    if (email && email.indexOf('@') !== -1) s.email = email;
    var nm = String(r[COL.NAME] || '').trim();      if (nm) s.name = nm;
    var it = String(r[COL.ITEM] || '').trim();      if (it) s.item = it;
    var v  = String(r[COL.VARIANT] || '').trim().toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C') s.variant = v;
    var uc = String(r[COL.CAMPAIGN] || '').trim();  if (uc) s.utm_campaign = uc;
    var uct = String(r[COL.AD_CONTENT] || '').trim(); if (uct) s.utm_content = uct;
    var fb = String(r[COL.FBCLID] || '').trim();    if (fb) s.fbclid = fb;
    var sh = String(r[COL.SHIPPING] || '').trim();
    var ad = String(r[COL.ADDRESS] || '').trim();
    if (sh && ad) { s.shipping = sh; s.address = ad; if (!s.cr_ts || ts > s.cr_ts) s.cr_ts = ts; }
  }

  var allCRs = [];
  Object.keys(sessions).forEach(function(key) {
    var s = sessions[key];
    if (s.cr_ts && s.cr_ts >= CUTOFF) allCRs.push(s);
  });

  var seenNewCustomers = {};
  var newCustomerCRs = [];
  var repeatCustomerCRs = [];
  var noCustomerRecordCRs = [];

  allCRs.sort(function(a, b) { return a.cr_ts - b.cr_ts; });

  allCRs.forEach(function(s) {
    var cust = emailToCustomer[s.email];
    if (!cust) { noCustomerRecordCRs.push(s); return; }
    if (cust.isNew) {
      if (!seenNewCustomers[cust.custId]) {
        seenNewCustomers[cust.custId] = true;
        newCustomerCRs.push(s);
      } else {
        repeatCustomerCRs.push(s);
      }
    } else {
      repeatCustomerCRs.push(s);
    }
  });

  function sourceBucket(s) {
    var uc = String(s.utm_campaign || '').toLowerCase();
    var uct = String(s.utm_content || '').toLowerCase();
    if (uct.indexOf('convert_a_cr') !== -1 || uc.indexOf('convert_a_cr') !== -1) return 'convert_a_cr (forced A)';
    if (uct.indexOf('convert_b_cr') !== -1 || uc.indexOf('convert_b_cr') !== -1) return 'convert_b_cr (forced B)';
    if (uc.indexOf('completeregistration') !== -1) return 'CR-campaign (other)';
    if (uc === 'leads') return 'Lead-campaign (random)';
    if (uc) return 'Other UTM: ' + uc;
    if (s.fbclid) return 'FB (no UTM)';
    return 'Direct / organic';
  }

  var bySource = {};
  var byVariant = { A: 0, B: 0, C: 0, '': 0 };
  newCustomerCRs.forEach(function(s) {
    var sb = sourceBucket(s);
    if (!bySource[sb]) bySource[sb] = { count: 0, variantA: 0, variantB: 0, variantC: 0, variantNone: 0 };
    bySource[sb].count++;
    if (s.variant === 'A') bySource[sb].variantA++;
    else if (s.variant === 'B') bySource[sb].variantB++;
    else if (s.variant === 'C') bySource[sb].variantC++;
    else bySource[sb].variantNone++;
    byVariant[s.variant || ''] = (byVariant[s.variant || ''] || 0) + 1;
  });

  Logger.log('━━━ VARIANT — NEW CUSTOMERS ONLY (May 7+) ━━━');
  Logger.log('Total CRs: ' + allCRs.length);
  Logger.log('  New-customer first-CRs: ' + newCustomerCRs.length);
  Logger.log('  Repeat-customer CRs: ' + repeatCustomerCRs.length);
  Logger.log('  No customer record: ' + noCustomerRecordCRs.length);
  Logger.log('NEW-CUSTOMER VARIANT: A: ' + byVariant.A + '  B: ' + byVariant.B + '  C: ' + byVariant.C);

  Object.keys(bySource).sort(function(a, b) { return bySource[b].count - bySource[a].count; }).forEach(function(k) {
    var b = bySource[k];
    var vs = [];
    if (b.variantA) vs.push('A:' + b.variantA);
    if (b.variantB) vs.push('B:' + b.variantB);
    if (b.variantC) vs.push('C:' + b.variantC);
    if (b.variantNone) vs.push('none:' + b.variantNone);
    Logger.log('  ' + b.count + ' — ' + k + '  [' + vs.join(', ') + ']');
  });

  var SPEND_A_CR = 196.74, SPEND_B_CR = 196.91, SPEND_LEAD_TOTAL = 247.36;
  var crsACR = (bySource['convert_a_cr (forced A)'] || { count: 0 }).count;
  var crsBCR = (bySource['convert_b_cr (forced B)'] || { count: 0 }).count;
  var crsLead = (bySource['Lead-campaign (random)'] || { count: 0 }).count;
  function dollars(n) { return '$' + n.toFixed(2); }
  function dollarsOrDash(n, d) { return d > 0 ? dollars(n / d) : '—'; }

  Logger.log('━━━ TRUE COST PER NEW CUSTOMER (May 7-12) ━━━');
  Logger.log('convert A - CR   ' + dollars(SPEND_A_CR) + '   ' + crsACR + ' NewCust   ' + dollarsOrDash(SPEND_A_CR, crsACR));
  Logger.log('convert B - CR   ' + dollars(SPEND_B_CR) + '   ' + crsBCR + ' NewCust   ' + dollarsOrDash(SPEND_B_CR, crsBCR));
  Logger.log('convert + Copy   ' + dollars(SPEND_LEAD_TOTAL) + '   ' + crsLead + ' NewCust   ' + dollarsOrDash(SPEND_LEAD_TOTAL, crsLead));
}


// ═══════════════════════════════════════════════
//  RECOVERY WAVE BUILDER
// ═══════════════════════════════════════════════

function buildRecoveryWave() {
  var CUTOFF = new Date('2026-05-07T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();

  var custIdToShipments = {};
  shipRows.forEach(function(s) {
    if (!s.customer_id) return;
    if (!custIdToShipments[s.customer_id]) custIdToShipments[s.customer_id] = [];
    custIdToShipments[s.customer_id].push(s);
  });

  var candidates = [];
  custRows.forEach(function(c) {
    if (!c.created_at) return;
    var createdAt = new Date(c.created_at);
    if (createdAt < CUTOFF) return;
    candidates.push({
      customer_id: c.customer_id,
      email: String(c.email || '').toLowerCase().trim(),
      name: c.name || '', phone: c.phone || '', address: c.address || '',
      created_at: createdAt,
      shipments: custIdToShipments[c.customer_id] || []
    });
  });

  var emailToLeads = {};
  for (var i = 1; i < leadData.length; i++) {
    var r = leadData[i];
    var em = String(r[COL.EMAIL] || '').toLowerCase().trim();
    if (!em || em.indexOf('@') === -1) continue;
    var ts = r[COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    if (!emailToLeads[em]) emailToLeads[em] = [];
    emailToLeads[em].push({
      ts: tsDate,
      shipping: String(r[COL.SHIPPING] || '').trim(),
      address: String(r[COL.ADDRESS] || '').trim(),
      item: String(r[COL.ITEM] || '').trim(),
      estimate: String(r[COL.ESTIMATE] || '').trim(),
      name: String(r[COL.NAME] || '').trim(),
      phone: String(r[COL.PHONE] || '').trim(),
      ai_rationale: String(r[COL.OFFER_NOTES] || '').trim(),
      description: String(r[COL.DESCRIPTION] || '').trim(),
      photo: String(r[COL.PHOTO] || '').trim(),
      customer_message: String(r[COL.NOTES] || '').trim(),
      session_id: String(r[COL.SESSION_ID] || '').trim()
    });
  }

  var recoveryRows = [];
  candidates.forEach(function(c) {
    var leads = emailToLeads[c.email] || [];
    var crLead = null;
    leads.sort(function(a, b) { return b.ts - a.ts; });
    for (var i = 0; i < leads.length; i++) {
      if (leads[i].shipping && leads[i].address) { crLead = leads[i]; break; }
    }
    if (!crLead) return;

    var hasShipment = c.shipments.length > 0;
    var shipmentStages = c.shipments.map(function(s) { return s.stage || ''; }).join(', ');
    var shipmentIds = c.shipments.map(function(s) { return s.shipment_id || ''; }).join(', ');

    var status;
    if (!hasShipment) status = 'MISSING_SHIPMENT';
    else {
      var matchingShipment = c.shipments.find(function(s) {
        if (!s.created_at) return false;
        var diffMin = Math.abs(new Date(s.created_at) - crLead.ts) / 60000;
        return diffMin < 60;
      });
      status = matchingShipment ? 'HAS_SHIPMENT' : 'HAS_OTHER_SHIPMENT';
    }

    recoveryRows.push({
      status: status, customer_id: c.customer_id, email: c.email,
      name: crLead.name || c.name, phone: crLead.phone || c.phone,
      address: crLead.address || c.address, shipping_method: crLead.shipping,
      item: crLead.item, estimate: crLead.estimate,
      cr_timestamp: crLead.ts, customer_created: c.created_at,
      photo: crLead.photo, customer_message: crLead.customer_message,
      ai_rationale: crLead.ai_rationale,
      existing_shipments: shipmentIds || '(none)',
      existing_stages: shipmentStages || '(none)',
      session_id: crLead.session_id
    });
  });

  recoveryRows.sort(function(a, b) {
    if (a.status !== b.status) {
      if (a.status === 'MISSING_SHIPMENT') return -1;
      if (b.status === 'MISSING_SHIPMENT') return 1;
      if (a.status === 'HAS_OTHER_SHIPMENT') return -1;
      if (b.status === 'HAS_OTHER_SHIPMENT') return 1;
    }
    return a.cr_timestamp - b.cr_timestamp;
  });

  var tabName = 'Recovery_Wave';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'Status', 'Customer ID', 'CR Time (ET)', 'Days Waiting',
    'Name', 'Email', 'Phone', 'Address',
    'Shipping Method', 'Item', 'Estimate',
    'Photo URL', 'Customer Message', 'AI Rationale',
    'Existing Shipments', 'Existing Stages', 'Session ID'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);

  var now = new Date();
  var rows = recoveryRows.map(function(r) {
    var daysWaiting = Math.floor((now - r.cr_timestamp) / 86400000);
    return [
      r.status, r.customer_id,
      Utilities.formatDate(r.cr_timestamp, 'America/New_York', 'MM/dd HH:mm'),
      daysWaiting, r.name, r.email, r.phone, r.address,
      r.shipping_method, r.item, r.estimate,
      r.photo ? r.photo.substring(0, 60) + (r.photo.length > 60 ? '…' : '') : '',
      r.customer_message ? r.customer_message.substring(0, 100) + (r.customer_message.length > 100 ? '…' : '') : '',
      r.ai_rationale ? r.ai_rationale.substring(0, 100) + (r.ai_rationale.length > 100 ? '…' : '') : '',
      r.existing_shipments, r.existing_stages, r.session_id
    ];
  });

  if (rows.length) outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  outSheet.autoResizeColumns(1, headers.length);

  for (var i = 0; i < recoveryRows.length; i++) {
    var color = '#fff';
    if (recoveryRows[i].status === 'MISSING_SHIPMENT') color = '#fde7e9';
    else if (recoveryRows[i].status === 'HAS_OTHER_SHIPMENT') color = '#fff3e0';
    else color = '#e6f4ea';
    outSheet.getRange(i + 2, 1, 1, headers.length).setBackground(color);
  }

  var missingCount = recoveryRows.filter(function(r) { return r.status === 'MISSING_SHIPMENT'; }).length;
  var otherCount = recoveryRows.filter(function(r) { return r.status === 'HAS_OTHER_SHIPMENT'; }).length;
  var okCount = recoveryRows.filter(function(r) { return r.status === 'HAS_SHIPMENT'; }).length;

  Logger.log('━━━ RECOVERY WAVE — May 7+ ━━━');
  Logger.log('Total candidates: ' + recoveryRows.length);
  Logger.log('🔴 MISSING_SHIPMENT: ' + missingCount);
  Logger.log('🟡 HAS_OTHER_SHIPMENT: ' + otherCount);
  Logger.log('🟢 HAS_SHIPMENT: ' + okCount);
  Logger.log('Detail written to tab: ' + tabName);

  return { missing: missingCount, other: otherCount, ok: okCount };
}


// ═══════════════════════════════════════════════
//  MANUAL FULFILLMENT AUDIT (May 7-12)
// ═══════════════════════════════════════════════

function auditManualFulfillments() {
  var CUTOFF = new Date('2026-05-07T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();

  var emailToCust = {};
  var custIdToEmail = {};
  custRows.forEach(function(c) {
    var em = String(c.email || '').toLowerCase().trim();
    if (em) {
      emailToCust[em] = c;
      custIdToEmail[c.customer_id] = em;
    }
  });

  var custIdToCRTimestamps = {};
  for (var i = 1; i < leadData.length; i++) {
    var em = String(leadData[i][COL.EMAIL] || '').toLowerCase().trim();
    if (!em) continue;
    var cust = emailToCust[em];
    if (!cust) continue;
    var sh = String(leadData[i][COL.SHIPPING] || '').trim();
    var ad = String(leadData[i][COL.ADDRESS] || '').trim();
    if (!sh || !ad) continue;
    var ts = leadData[i][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;
    if (!custIdToCRTimestamps[cust.customer_id]) custIdToCRTimestamps[cust.customer_id] = [];
    custIdToCRTimestamps[cust.customer_id].push(tsDate);
  }

  var suspicious = [];
  var allRecent = [];

  shipRows.forEach(function(s) {
    if (!s.created_at) return;
    var createdAt = new Date(s.created_at);
    if (createdAt < CUTOFF) return;
    if (!s.customer_id) return;

    allRecent.push(s);
    var crTimestamps = custIdToCRTimestamps[s.customer_id] || [];
    var hasMatchingCR = crTimestamps.some(function(ts) {
      return Math.abs(ts - createdAt) < 60 * 60 * 1000;
    });

    var flags = [];
    if (!hasMatchingCR) flags.push('NO_MATCHING_CR');
    var stage = String(s.stage || '').toLowerCase().trim();
    var hasTracking = !!String(s.outbound_tracking || '').trim();
    if (stage === 'outbound_complete' && !hasTracking) flags.push('OUTBOUND_NO_TRACKING');
    if (!stage || stage === '__new__') flags.push('BAD_STAGE');
    if (!s.item) flags.push('NO_ITEM');
    if (!s.shipping_type) flags.push('NO_SHIPPING_TYPE');

    if (flags.length > 0) {
      suspicious.push({
        shipment: s, flags: flags,
        email: custIdToEmail[s.customer_id] || ''
      });
    }
  });

  var tabName = 'ManualFulfillment_Audit';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'Flags', 'Shipment ID', 'Customer ID', 'Email',
    'Created At', 'Stage', 'Shipping Type', 'Item', 'Estimate',
    'Outbound Tracking', 'Purchase Price'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);

  suspicious.sort(function(a, b) {
    if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
    return new Date(a.shipment.created_at) - new Date(b.shipment.created_at);
  });

  var rows = suspicious.map(function(s) {
    return [
      s.flags.join(', '), s.shipment.shipment_id || '',
      s.shipment.customer_id || '', s.email,
      s.shipment.created_at
        ? Utilities.formatDate(new Date(s.shipment.created_at), 'America/New_York', 'MM/dd HH:mm')
        : '',
      s.shipment.stage || '', s.shipment.shipping_type || '',
      s.shipment.item || '', s.shipment.estimate || '',
      s.shipment.outbound_tracking || '', s.shipment.purchase_price || ''
    ];
  });

  if (rows.length) outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  outSheet.autoResizeColumns(1, headers.length);

  for (var i = 0; i < suspicious.length; i++) {
    var flagStr = suspicious[i].flags.join(',');
    var color = '#fff3e0';
    if (flagStr.indexOf('OUTBOUND_NO_TRACKING') !== -1) color = '#fde7e9';
    if (flagStr.indexOf('BAD_STAGE') !== -1) color = '#fde7e9';
    outSheet.getRange(i + 2, 1, 1, headers.length).setBackground(color);
  }

  Logger.log('━━━ MANUAL FULFILLMENT AUDIT — May 7+ ━━━');
  Logger.log('Total shipments since May 7: ' + allRecent.length);
  Logger.log('Suspicious: ' + suspicious.length);

  var flagCounts = {};
  suspicious.forEach(function(s) {
    s.flags.forEach(function(f) { flagCounts[f] = (flagCounts[f] || 0) + 1; });
  });
  Object.keys(flagCounts).sort(function(a, b) { return flagCounts[b] - flagCounts[a]; }).forEach(function(f) {
    Logger.log('  ' + flagCounts[f] + ' — ' + f);
  });
  Logger.log('Detail written to tab: ' + tabName);
}


// ═══════════════════════════════════════════════
//  LABEL GENERATION AUDIT (May 7-11)
// ═══════════════════════════════════════════════

function auditLabelGeneration() {
  var WINDOW_END = new Date('2026-05-12T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));

  var custIdToEmail = {}, custIdToName = {}, custIdToPhone = {};
  custRows.forEach(function(c) {
    custIdToEmail[c.customer_id] = c.email || '';
    custIdToName[c.customer_id]  = c.name  || '';
    custIdToPhone[c.customer_id] = c.phone || '';
  });

  var suspicious = [];
  var ok = [];

  shipRows.forEach(function(s) {
    var createdAt = s.created_at ? new Date(s.created_at) : null;
    var stage = String(s.stage || '').toLowerCase().trim();
    var hasTracking = !!String(s.outbound_tracking || '').trim();

    if (createdAt && createdAt >= WINDOW_END) return;

    var OUTBOUND_OR_BEYOND = ['outbound_complete','received','inspected','offer_made','purchased','returned'];
    if (OUTBOUND_OR_BEYOND.indexOf(stage) < 0) return;

    var PAST_OUTBOUND = ['received','inspected','offer_made','purchased','returned'];
    if (PAST_OUTBOUND.indexOf(stage) >= 0) return;

    if (createdAt && (WINDOW_END - createdAt) > 14 * 86400000) return;

    if (!hasTracking) {
      suspicious.push({ shipment: s, reason: 'outbound_complete but no tracking number' });
    } else {
      ok.push(s);
    }
  });

  var tabName = 'LabelGen_Audit';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'Shipment ID', 'Customer ID', 'Name', 'Email', 'Phone',
    'Created At', 'Stage', 'Shipping Type', 'Item',
    'Outbound Tracking', 'Reason'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);

  suspicious.sort(function(a, b) {
    return new Date(a.shipment.created_at) - new Date(b.shipment.created_at);
  });

  var rows = suspicious.map(function(item) {
    var s = item.shipment;
    return [
      s.shipment_id || '', s.customer_id || '',
      custIdToName[s.customer_id] || '',
      custIdToEmail[s.customer_id] || '',
      custIdToPhone[s.customer_id] || '',
      s.created_at
        ? Utilities.formatDate(new Date(s.created_at), 'America/New_York', 'MM/dd HH:mm')
        : '',
      s.stage || '', s.shipping_type || '', s.item || '',
      s.outbound_tracking || '(empty)', item.reason
    ];
  });

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    outSheet.getRange(2, 1, rows.length, headers.length).setBackground('#fde7e9');
  }
  outSheet.autoResizeColumns(1, headers.length);

  Logger.log('━━━ LABEL GENERATION AUDIT — May 7-11 ━━━');
  Logger.log('🟢 Outbound complete WITH tracking: ' + ok.length);
  Logger.log('🔴 Outbound complete WITHOUT tracking: ' + suspicious.length);
  if (suspicious.length > 0) Logger.log('Detail in tab: ' + tabName);
}


// ═══════════════════════════════════════════════
//  LABEL GENERATION AUDIT v2 — checks BOTH tracking fields
// ═══════════════════════════════════════════════

function auditLabelGenerationV2() {
  var WINDOW_END = new Date('2026-05-12T00:00:00-04:00');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var shipRows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custRows = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));

  var custIdToEmail = {}, custIdToName = {}, custIdToPhone = {};
  custRows.forEach(function(c) {
    custIdToEmail[c.customer_id] = c.email || '';
    custIdToName[c.customer_id]  = c.name  || '';
    custIdToPhone[c.customer_id] = c.phone || '';
  });

  var suspicious = [];
  var ok = 0;

  shipRows.forEach(function(s) {
    var createdAt = s.created_at ? new Date(s.created_at) : null;
    var stage = String(s.stage || '').toLowerCase().trim();
    var outTrack = String(s.outbound_tracking || '').trim();
    var retTrack = String(s.return_tracking || '').trim();
    var hasAnyTracking = !!(outTrack || retTrack);

    if (createdAt && createdAt >= WINDOW_END) return;
    if (stage !== 'outbound_complete') return;
    if (createdAt && (WINDOW_END - createdAt) > 14 * 86400000) return;

    if (hasAnyTracking) ok++;
    else suspicious.push(s);
  });

  var tabName = 'LabelGen_Audit_v2';
  var outSheet = ss.getSheetByName(tabName);
  if (outSheet) outSheet.clear();
  else outSheet = ss.insertSheet(tabName);

  var headers = [
    'Shipment ID', 'Customer ID', 'Name', 'Email', 'Phone',
    'Created At', 'Stage', 'Shipping Type', 'Item',
    'Outbound Tracking', 'Return Tracking'
  ];
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  outSheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
  outSheet.setFrozenRows(1);

  suspicious.sort(function(a, b) {
    return new Date(a.created_at) - new Date(b.created_at);
  });

  var rows = suspicious.map(function(s) {
    return [
      s.shipment_id || '', s.customer_id || '',
      custIdToName[s.customer_id] || '',
      custIdToEmail[s.customer_id] || '',
      custIdToPhone[s.customer_id] || '',
      s.created_at
        ? Utilities.formatDate(new Date(s.created_at), 'America/New_York', 'MM/dd HH:mm')
        : '',
      s.stage || '', s.shipping_type || '', s.item || '',
      s.outbound_tracking || '(empty)', s.return_tracking || '(empty)'
    ];
  });

  if (rows.length) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    outSheet.getRange(2, 1, rows.length, headers.length).setBackground('#fde7e9');
  }
  outSheet.autoResizeColumns(1, headers.length);

  Logger.log('━━━ LABEL GEN AUDIT v2 — past 14 days ━━━');
  Logger.log('Outbound_complete WITH any tracking: ' + ok);
  Logger.log('Outbound_complete WITHOUT any tracking: ' + suspicious.length);
  if (suspicious.length > 0) Logger.log('Detail in tab: ' + tabName);
}


// ═══════════════════════════════════════════════
//  QUO (OpenPhone) CONTACT SYNC (May 22)
//
//  Pushes customers from the Customers tab into Quo so incoming calls and
//  texts display the customer's name instead of just a phone number.
//
//  Functions:
//   - quoUpsertContact(customer): push one customer
//   - quoBulkSyncAllCustomers(): one-time backfill of every customer
//   - quoSyncRecentCustomers(): daily-trigger function; only syncs customers
//     created/updated in the last 25 hours (idempotent — Quo dedups by phone)
//   - createQuoSyncTrigger(): one-time setup, installs the daily trigger
//
//  Sync key column: a new `quo_contact_id` column in the Customers tab.
//  After a contact is pushed, its Quo ID is stored so we know it's synced.
// ═══════════════════════════════════════════════

var QUO_CONTACTS_URL = 'https://api.openphone.com/v1/contacts';

// Push or update a single customer contact in Quo.
// Returns { success: true, contact_id: '...' } or { success: false, error: '...' }
function quoUpsertContact(customer) {
  try {
    if (!customer || !customer.phone) {
      return { success: false, error: 'no phone number' };
    }
    var phone = String(customer.phone).replace(/\D/g, '');
    if (phone.length < 10) return { success: false, error: 'invalid phone length' };
    if (phone.length === 10) phone = '1' + phone;
    phone = '+' + phone;

    // Parse first/last from full name
    var fullName = String(customer.name || '').trim();
    var nameParts = fullName.split(/\s+/);
    var firstName = nameParts[0] || '';
    var lastName = nameParts.slice(1).join(' ') || '';

    var payload = {
      defaultFields: {
        firstName: firstName,
        lastName: lastName,
        phoneNumbers: [{ name: 'Mobile', value: phone }]
      }
    };
    if (customer.email) {
      payload.defaultFields.emails = [{ name: 'Email', value: customer.email }];
    }

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': QUO_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var res = UrlFetchApp.fetch(QUO_CONTACTS_URL, options);
    var code = res.getResponseCode();
    var body = JSON.parse(res.getContentText());

    if (code === 200 || code === 201) {
      return { success: true, contact_id: (body.data && body.data.id) || body.id || '' };
    }

    // 409 = duplicate (already exists by phone). Treat as success with no contact_id update.
    if (code === 409) {
      return { success: true, contact_id: '', existed: true };
    }

    return { success: false, error: 'HTTP ' + code + ': ' + (body.message || res.getContentText().substring(0, 200)) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// One-time backfill: push every customer with a phone number into Quo.
// Skips customers that already have a quo_contact_id (idempotent).
// Run from the Apps Script editor when ready.
function quoBulkSyncAllCustomers() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Ensure the quo_contact_id column exists
  var quoIdIdx = headers.indexOf('quo_contact_id');
  if (quoIdIdx < 0) {
    quoIdIdx = sheet.getLastColumn();
    sheet.getRange(1, quoIdIdx + 1).setValue('quo_contact_id');
    sheet.getRange(1, quoIdIdx + 1).setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    headers.push('quo_contact_id');
    Logger.log('Added quo_contact_id column');
  }

  var phoneIdx = headers.indexOf('phone');
  var nameIdx = headers.indexOf('name');
  var emailIdx = headers.indexOf('email');

  var synced = 0, skipped = 0, errors = 0, alreadyExisted = 0;

  for (var r = 1; r < data.length; r++) {
    var phone = String(data[r][phoneIdx] || '').trim();
    var existingQuoId = String(data[r][quoIdIdx] || '').trim();

    if (!phone) { skipped++; continue; }
    if (existingQuoId) { skipped++; continue; }

    var customer = {
      name: data[r][nameIdx] || '',
      phone: phone,
      email: data[r][emailIdx] || ''
    };

    var result = quoUpsertContact(customer);
    if (result.success) {
      if (result.contact_id) {
        sheet.getRange(r + 1, quoIdIdx + 1).setValue(result.contact_id);
        synced++;
      } else if (result.existed) {
        sheet.getRange(r + 1, quoIdIdx + 1).setValue('EXISTED');
        alreadyExisted++;
      }
    } else {
      errors++;
      Logger.log('Error syncing ' + customer.name + ' (' + phone + '): ' + result.error);
    }

    // Quo rate limits aren't documented, but be polite: 200ms pause
    Utilities.sleep(200);
  }

  Logger.log('━━━━━ QUO BULK SYNC COMPLETE ━━━━━');
  Logger.log('Newly synced: ' + synced);
  Logger.log('Already existed in Quo: ' + alreadyExisted);
  Logger.log('Skipped (no phone, or already synced): ' + skipped);
  Logger.log('Errors: ' + errors);
}

// Daily trigger function: syncs customers created in the last 25 hours that
// haven't been pushed to Quo yet. Quo dedups by phone, so we can run this
// safely on a daily cadence without creating duplicates.
function quoSyncRecentCustomers() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var quoIdIdx = headers.indexOf('quo_contact_id');
  if (quoIdIdx < 0) {
    Logger.log('quoSyncRecentCustomers: run quoBulkSyncAllCustomers first to create column');
    return;
  }
  var phoneIdx = headers.indexOf('phone');
  var nameIdx = headers.indexOf('name');
  var emailIdx = headers.indexOf('email');
  var createdIdx = headers.indexOf('created_at');

  var cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
  var synced = 0;

  for (var r = 1; r < data.length; r++) {
    var phone = String(data[r][phoneIdx] || '').trim();
    var existingQuoId = String(data[r][quoIdIdx] || '').trim();
    var createdAt = data[r][createdIdx];

    if (!phone || existingQuoId) continue;
    if (!createdAt) continue;

    var created = new Date(createdAt);
    if (isNaN(created.getTime()) || created < cutoff) continue;

    var customer = {
      name: data[r][nameIdx] || '',
      phone: phone,
      email: data[r][emailIdx] || ''
    };

    var result = quoUpsertContact(customer);
    if (result.success) {
      if (result.contact_id) {
        sheet.getRange(r + 1, quoIdIdx + 1).setValue(result.contact_id);
      } else if (result.existed) {
        sheet.getRange(r + 1, quoIdIdx + 1).setValue('EXISTED');
      }
      synced++;
    }
    Utilities.sleep(200);
  }

  Logger.log('quoSyncRecentCustomers: synced ' + synced + ' new customers');
}

// One-time setup: install the daily Quo sync trigger.
// Run this once from the Apps Script editor.
function createQuoSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'quoSyncRecentCustomers') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('quoSyncRecentCustomers')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone('America/New_York')
    .create();
  Logger.log('Quo sync trigger created — runs daily at 3am ET');
}


// ═══════════════════════════════════════════════
//  LABEL URL LOOKUP (Sep 14) — shared by resendLabelEmail and getLabelUrl.
//  Resolves the label URL from whichever provider created it. Shippo is the
//  current primary (shippo_transaction_id); EasyPost is the legacy/fallback
//  (easypost_shipment_id). Earlier the resend was EasyPost-only, so Shippo
//  labels (all recent shipments) failed to resend. Read-only: nothing is
//  purchased or stored.
//  Returns { success:true, label_url } or { success:false, error, notFound }
//  — notFound means no label on record, as opposed to a provider fetch failure.
// ═══════════════════════════════════════════════
function _lookupLabelUrl(shipment) {
  var shippoTxId = String(shipment.shippo_transaction_id || '').trim();
  var epShipmentId = String(shipment.easypost_shipment_id || '').trim();

  if (shippoTxId) {
    // Shippo: fetch the transaction to get its label_url
    var shRes = UrlFetchApp.fetch('https://api.goshippo.com/transactions/' + shippoTxId, {
      method: 'get',
      headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
      muteHttpExceptions: true
    });
    if (shRes.getResponseCode() !== 200) {
      return { success: false, error: 'Shippo fetch failed (' + shRes.getResponseCode() + ')' };
    }
    var shData = JSON.parse(shRes.getContentText());
    if (!shData.label_url) return { success: false, notFound: true, error: 'no label_url on Shippo transaction' };
    return { success: true, label_url: shData.label_url };
  }
  if (epShipmentId) {
    // EasyPost (legacy): pull the shipment to get the postage label URL
    var epRes = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments/' + epShipmentId, {
      method: 'get',
      headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') },
      muteHttpExceptions: true
    });
    if (epRes.getResponseCode() !== 200) {
      return { success: false, error: 'EasyPost fetch failed (' + epRes.getResponseCode() + ')' };
    }
    var epData = JSON.parse(epRes.getContentText());
    var epUrl = epData.postage_label && epData.postage_label.label_url ? epData.postage_label.label_url : '';
    if (!epUrl) return { success: false, notFound: true, error: 'no label URL on EasyPost shipment' };
    return { success: true, label_url: epUrl };
  }
  return { success: false, notFound: true, error: 'no shippo_transaction_id or easypost_shipment_id stored — this label predates the resend feature. Generate a new label instead.' };
}

// CRM "Open label PDF": { success, label_url } — label_url '' when the shipment has no label on record.
function handleGetLabelUrl(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };
    var shipment = _findShipmentById(SpreadsheetApp.openById(SHEET_ID), shipmentId);
    if (!shipment) return { success: false, error: 'shipment not found' };
    var r = _lookupLabelUrl(shipment);
    if (r.success) return { success: true, label_url: r.label_url };
    return r.notFound ? { success: true, label_url: '' } : { success: false, error: r.error };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════
//  RESEND LABEL EMAIL (May 22)
//
//  When a customer says they lost or accidentally deleted the original label
//  email, this handler fetches the label PDF fresh from EasyPost using the
//  stored easypost_shipment_id, then emails + SMSes the same content as the
//  original send. NO new label is purchased — just retrieves the existing one.
// ═══════════════════════════════════════════════
function handleResendLabelEmail(parsed) {
  try {
    var shipmentId = parsed.shipment_id;
    if (!shipmentId) return { success: false, error: 'shipment_id required' };

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var shipment = _findShipmentById(ss, shipmentId);
    if (!shipment) return { success: false, error: 'shipment not found' };
    var customer = _findCustomerById(ss, shipment.customer_id);
    if (!customer) return { success: false, error: 'customer not found' };
    if (!customer.email) return { success: false, error: 'customer has no email' };

    var trackingNumber = String(shipment.outbound_tracking || '').trim();
    if (!trackingNumber) return { success: false, error: 'no outbound_tracking — label was never generated' };

    // Resolve the label URL from whichever provider created it (shared with getLabelUrl).
    var lookup = _lookupLabelUrl(shipment);
    if (!lookup.success) return { success: false, error: lookup.error };
    var labelUrl = lookup.label_url;

    // Download the PDF/PNG
    var labelRes = UrlFetchApp.fetch(labelUrl, { muteHttpExceptions: true });
    var labelBytes = labelRes.getBlob().getBytes();
    var labelBase64 = Utilities.base64Encode(labelBytes);
    var labelExt = labelUrl.toLowerCase().indexOf('.pdf') >= 0 ? 'pdf' : 'png';
    var labelMimeType = labelExt === 'pdf' ? 'application/pdf' : 'image/png';

    var shippingType = normalizeShipType(shipment.shipping_type) || 'usps';
    var carrierName = shippingType === 'usps' ? 'USPS' : 'FedEx';
    var dropText = shippingType === 'usps' ? 'hand it to your postman or drop it at any post office' : 'drop it at any FedEx location';
    var firstName = String(customer.name || '').split(/\s+/)[0] || 'there';
    var itemText = _shipmentItemPhrase(shipmentId, shipment.item) || 'your item';
    // Detect multi-item to choose the right "other pieces" line
    var isMulti = itemText === 'your items';
    var extraItemsLine = isMulti
      ? '\n\nAnd if you have other gold jewelry lying around you can throw that in too — I\'ll evaluate everything together.'
      : '\n\nAnd if you have other pieces lying around, throw them in too — I\'ll evaluate everything together.';

    // QR/no-printer section: identical logic to generateAndSendLabel
    var qrUrl = String(shipment.label_qr_url || '').trim();
    var qrSection = '';
    if (qrUrl) {
      qrSection = '\n\n──────────────\n\nNo printer? No problem.\n\nBring the QR code below to any post office. The clerk will scan it and print the label for you on the spot — free of charge.\n\n<img src="' + qrUrl + '" alt="USPS Label Broker QR Code" style="max-width:200px;height:auto;border:1px solid #eee;padding:8px;margin:8px 0;background:#fff;">\n\nQR code link (in case the image doesn\'t display): ' + qrUrl;
    } else if (shippingType !== 'usps') {
      qrSection = '\n\n──────────────\n\nNo printer? No problem.\n\nBring this email up on your phone at any FedEx Office location and show them the attached label. The staff there can print it for you on the spot.';
    }

    var emailPayload = {
      From: FROM_NAME + ' <' + FROM_EMAIL + '>',
      To: customer.email,
      Bcc: 'davidisaacweiss@yahoo.com',
      Subject: 'Re-sending your prepaid ' + carrierName + ' label, ' + firstName,
      HtmlBody: buildPlainEmail(firstName,
        'Re-sending your prepaid ' + carrierName + ' return label, attached to this email.' +
        '\n\nJust print it, pack ' + itemText + ' in any box or padded envelope, attach the label, and ' + dropText + '.' +
        extraItemsLine +
        '\n\n<strong>Free shipping, no commitment</strong> — if my offer isn\'t good enough I\'ll send everything back at no charge.' +
        qrSection +
        '\n\nTracking number: ' + trackingNumber +
        '\n\nAny questions, just reply here or call/text 866-613-0704.' +
        '\n\nDavid\nSnappy Gold'
      ),
      Attachments: [{
        Name: 'snappy_gold_label_' + shipmentId + '.' + labelExt,
        Content: labelBase64, ContentType: labelMimeType,
      }],
      MessageStream: 'outbound',
    };
    UrlFetchApp.fetch(POSTMARK_API_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'X-Postmark-Server-Token': POSTMARK_API_TOKEN },
      payload: JSON.stringify(emailPayload), muteHttpExceptions: true,
    });

    // Fresh resend SMS — verifying/interactive, NOT a re-pitch. They already
    // asked for the label; this confirms it's in their inbox and invites a reply.
    if (customer.phone) {
      var resendSms = 'Resending the email now — please check the inbox for ' + customer.email +
        '. Do you see the label attached? Let me know if you have any questions about how to use it. — David @ Snappy Gold';
      sendSms(customer.phone, customer.name, resendSms);
    }

    // Log to contact log
    addContactLog({
      customer_id: customer.customer_id,
      shipment_id: shipmentId,
      type: 'email',
      notes: 'Re-sent label (customer requested resend)'
    });

    return { success: true, message: 'Label email' + (customer.phone ? ' + text' : '') + ' resent to ' + customer.email };
  } catch (err) {
    Logger.log('handleResendLabelEmail error: ' + err.toString());
    return { success: false, error: err.toString() };
  }
}


// MAY 29 DEBUG: send a test SMS to verify Quo API + credits are working.
// Run from Apps Script editor: Function dropdown → testSendSms → Run
// Then check Execution log AND your Quo Sent folder.
function testSendSms() {
  var YOUR_PHONE = '5617026269';  // change to a number you can check
  Logger.log('--- testSendSms starting ---');
  var result = sendSms(YOUR_PHONE, 'Test', 'Test from Snappy Gold Apps Script — ' + new Date().toLocaleString());
  Logger.log('Result: ' + JSON.stringify(result));
}

// MAY 30 DEBUG: replay SMS for SHP-761 and SHP-762 to see exactly what happens.
function debugFulfillmentSms() {
  var shipmentIds = ['SHP-761', 'SHP-762'];
  var ss = SpreadsheetApp.openById(SHEET_ID);
  // Use the SAME path the live fulfillment uses: load all customers via
  // getCustomers (which the CRM does on every load), then find by id.
  var allCustomers = getCustomers();
  var allShipments = getShipments();
  shipmentIds.forEach(function(sid) {
    Logger.log('━━━ ' + sid + ' ━━━');
    var shipment = null;
    for (var i = 0; i < allShipments.length; i++) {
      if (allShipments[i].shipment_id === sid) { shipment = allShipments[i]; break; }
    }
    if (!shipment) { Logger.log('  shipment not found'); return; }
    var customer = null;
    for (var j = 0; j < allCustomers.length; j++) {
      if (allCustomers[j].customer_id === shipment.customer_id) { customer = allCustomers[j]; break; }
    }
    if (!customer) { Logger.log('  customer not found'); return; }
    Logger.log('  customer.name: ' + customer.name);
    Logger.log('  customer.phone (raw): [' + customer.phone + ']');
    Logger.log('  customer.phone typeof: ' + typeof customer.phone);
    Logger.log('  outbound_tracking: ' + shipment.outbound_tracking);
    var testMsg = 'TEST resend for ' + sid + ' at ' + new Date().toLocaleString();
    var result = sendSms(customer.phone, customer.name, testMsg);
    Logger.log('  sendSms result: ' + JSON.stringify(result));
  });
}


// ═══════════════════════════════════════════════════════════════════════════
//  MAY 31 — ORPHAN PHOTO BACKFILL (limit_gate path bug)
//
//  Bug: when a customer goes through photo_browse (uploads photos but no
//  contact info) and then later submits via limit_gate (contact + address
//  but no item/photos), the shipment is created without linking back to
//  the earlier photo rows. Result: limit_gate shipments show "No photos"
//  even though the customer uploaded plenty.
//
//  This backfill scans Lead Intake for orphan photos and attaches them to
//  the correct shipment by:
//    (a) EXACT session_id match — safe to auto-attach
//    (b) IP + time window match (≤90 min) — REPORT ONLY for review
//
//  Run dryRunFirst() to see what would be done; runBackfill() to commit.
// ═══════════════════════════════════════════════════════════════════════════

function _orphanPhotoBackfillCore(commit) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var photoSheet = ss.getSheetByName(TAB.PHOTOS);
  var data = leadSheet.getDataRange().getValues();
  var headers = data[0];
  var col = function(name) { return headers.indexOf(name); };
  // Lead Intake uses Title Case + spaces, not snake_case
  var I = {
    ts: col('Timestamp'), type: col('Type'), name: col('Name'), email: col('Email'),
    photo: col('Photo'), ip: col('IP'), session: col('Session ID'),
  };

  // Sanity
  if (I.ts < 0 || I.type < 0 || I.session < 0 || I.photo < 0) {
    Logger.log('Required column missing — ts=' + I.ts + ' type=' + I.type + ' session=' + I.session + ' photo=' + I.photo);
    Logger.log('ACTUAL Lead Intake headers: ' + JSON.stringify(headers));
    return;
  }

  // Index photos already in Photos tab by drive_url so we don't double-attach
  var existingPhotos = sheetToObjects(photoSheet);
  var alreadyAttached = {};
  existingPhotos.forEach(function(p) { if (p.drive_url) alreadyAttached[p.drive_url] = p.shipment_id; });

  // Find all limit_gate submissions that have contact info
  // Pair them with their session_id (the row with shippingMethod set is the "final" one)
  var limitGateSubs = []; // [{rowIdx, ts, email, name, session, ip, shipmentId}]
  for (var r = 1; r < data.length; r++) {
    if (data[r][I.type] !== 'limit_gate') continue;
    if (!data[r][I.email] || !data[r][I.session]) continue;
    limitGateSubs.push({
      rowIdx: r + 1, // 1-indexed for sheet
      ts: new Date(data[r][I.ts]),
      email: String(data[r][I.email]).toLowerCase().trim(),
      name: data[r][I.name],
      session: String(data[r][I.session]),
      ip: data[r][I.ip],
    });
  }
  Logger.log('Found ' + limitGateSubs.length + ' limit_gate submissions with contact info');

  // Look up each one's shipment_id via customer email
  var allCustomers = getCustomers();
  var allShipments = getShipments();
  var emailToCustId = {};
  allCustomers.forEach(function(c) {
    if (c.email) emailToCustId[String(c.email).toLowerCase().trim()] = c.customer_id;
  });
  var custToShipments = {};
  allShipments.forEach(function(s) {
    if (!custToShipments[s.customer_id]) custToShipments[s.customer_id] = [];
    custToShipments[s.customer_id].push(s);
  });

  // Find orphan photo_browse rows (rows with photo_url but no name/email — never directly linked)
  var orphanPhotos = []; // [{rowIdx, ts, ip, session, photoUrl}]
  for (var r2 = 1; r2 < data.length; r2++) {
    var typ = data[r2][I.type];
    if (typ !== 'photo_browse') continue;
    var purl = data[r2][I.photo];
    if (!purl || String(purl).indexOf('drive.google.com') < 0) continue;
    if (alreadyAttached[purl]) continue; // already attached somewhere
    orphanPhotos.push({
      rowIdx: r2 + 1,
      ts: new Date(data[r2][I.ts]),
      ip: data[r2][I.ip],
      session: String(data[r2][I.session] || ''),
      photoUrl: purl,
    });
  }
  Logger.log('Found ' + orphanPhotos.length + ' orphan photo_browse rows');

  // Match
  var sessionMatches = 0;
  var ipTimeMatches = 0;
  var ipTimeReport = [];
  var sessionReport = [];

  orphanPhotos.forEach(function(op) {
    // 1) Exact session_id match
    var matched = false;
    for (var i = 0; i < limitGateSubs.length; i++) {
      var lg = limitGateSubs[i];
      if (op.session && op.session === lg.session) {
        var custId = emailToCustId[lg.email];
        var ships = custToShipments[custId] || [];
        // Pick the shipment closest in time to the limit_gate submission
        var bestShip = ships.length === 1 ? ships[0] : ships.sort(function(a, b) {
          return Math.abs(new Date(a.created_at) - lg.ts) - Math.abs(new Date(b.created_at) - lg.ts);
        })[0];
        if (bestShip) {
          sessionReport.push({ photoRow: op.rowIdx, photoUrl: op.photoUrl, shipment_id: bestShip.shipment_id, email: lg.email, match: 'session' });
          if (commit) {
            addPhoto({ shipment_id: bestShip.shipment_id, drive_url: op.photoUrl, source: 'lead_intake_backfill' });
          }
          sessionMatches++;
        }
        matched = true;
        break;
      }
    }
    if (matched) return;

    // 2) IP + time window — REPORT ONLY, never auto-commit
    for (var j = 0; j < limitGateSubs.length; j++) {
      var lg2 = limitGateSubs[j];
      if (!op.ip || !lg2.ip || op.ip !== lg2.ip) continue;
      var dtMin = Math.abs(op.ts - lg2.ts) / 60000;
      if (dtMin > 90) continue;
      ipTimeReport.push({ photoRow: op.rowIdx, photoUrl: op.photoUrl, email: lg2.email, ip: op.ip, deltaMin: Math.round(dtMin), match: 'ip+time' });
      ipTimeMatches++;
      break;
    }
  });

  Logger.log('━━━ ATTACHMENT REPORT ━━━');
  Logger.log('Mode: ' + (commit ? 'COMMITTED' : 'DRY RUN'));
  Logger.log('Session-ID matches (auto-attach): ' + sessionMatches);
  Logger.log('IP+time matches (REPORT ONLY — review manually): ' + ipTimeMatches);
  Logger.log('');
  Logger.log('━━ SESSION MATCHES (' + sessionReport.length + ') ━━');
  sessionReport.forEach(function(s) {
    Logger.log('  ' + s.email + ' → ' + s.shipment_id + ' (row ' + s.photoRow + ')');
  });
  Logger.log('');
  Logger.log('━━ IP+TIME MATCHES (' + ipTimeReport.length + ') ━━');
  ipTimeReport.slice(0, 50).forEach(function(s) {
    Logger.log('  ' + s.email + ' [IP ' + s.ip + ', Δ' + s.deltaMin + 'min] → photo row ' + s.photoRow);
  });
  if (ipTimeReport.length > 50) Logger.log('  ... and ' + (ipTimeReport.length - 50) + ' more (truncated)');

  return { sessionReport: sessionReport, ipTimeReport: ipTimeReport };
}

function dryRunOrphanPhotos() { _orphanPhotoBackfillCore(false); }
function runOrphanPhotoBackfill() { _orphanPhotoBackfillCore(true); }

// MAY 31 DEBUG: test Shippo label creation end-to-end without sending anything
// to a real customer. Returns logs only — no email, no SMS, no sheet writes.
// Run from Apps Script editor: Function dropdown → testShippoLabel → Run
function testShippoLabel() {
  Logger.log('━━━ Shippo label test ━━━');
  Logger.log('Provider flag: ' + LABEL_PROVIDER);

  // First: dump ALL rates Shippo returns for a USPS shipment, so we can see
  // whether USPS Ground Advantage is even offered (root of the fallback issue).
  try {
    var shipPayload = {
      address_from: SHIP_FROM,
      address_to: { name: 'Test Customer', street1: '1600 Pennsylvania Ave NW', city: 'Washington', state: 'DC', zip: '20500', country: 'US', phone: '5617026269', email: 'test@example.com' },
      parcels: [{ length: 9, width: 6, height: 2, distance_unit: 'in', weight: 8, mass_unit: 'oz' }],
      extra: { is_return: true, reference_1: 'TEST' },
      async: false,
    };
    var r = UrlFetchApp.fetch('https://api.goshippo.com/shipments/', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
      payload: JSON.stringify(shipPayload), muteHttpExceptions: true,
    });
    var d = JSON.parse(r.getContentText());
    Logger.log('Shipment HTTP ' + r.getResponseCode() + ' · object_id=' + (d.object_id||'NONE'));
    var rates = d.rates || [];
    Logger.log('── ' + rates.length + ' rates returned ──');
    rates.forEach(function(rt){
      Logger.log('  ' + rt.provider + ' / ' + (rt.servicelevel && rt.servicelevel.token) + ' / ' + (rt.servicelevel && rt.servicelevel.name) + ' — $' + rt.amount);
    });
    if (d.messages && d.messages.length) {
      Logger.log('── shipment messages ──');
      d.messages.forEach(function(m){ Logger.log('  ' + (m.text || JSON.stringify(m))); });
    }
  } catch(e) { Logger.log('rate dump failed: ' + e); }

  Logger.log('── now attempting full label buy ──');
  try {
    var result = _buyShippoLabel(
      'usps',
      '1600 Pennsylvania Ave NW, Washington, DC, 20500',
      'Test Customer',
      '5617026269',
      'TEST-SHIPMENT',
      'test@example.com'
    );
    Logger.log('✓ Tracking: ' + result.trackingNumber);
    Logger.log('✓ Cost: $' + result.shipping_cost);
    Logger.log('✓ Service: ' + result.shipping_service);
    Logger.log('✓ QR url: ' + (result.qr_url || '(none)'));
    Logger.log('✓ Shippo transaction ID: ' + result.shippo_transaction_id);
    Logger.log('━━ Pay-on-use: you should NOT see a charge unless this label is scanned ━━');
  } catch (err) {
    Logger.log('✗ Failed: ' + err.toString());
  }
}

// MAY 31 ONE-OFF: backfill self_serve_submitted_at for shipments whose tokens
// were marked used (used_at populated) before today's notification patch.
// Run once from Apps Script editor.
function backfillSelfServeSubmittedAt() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tokenSheet = ss.getSheetByName(TAB.SELF_SERVE_TOKENS);
  var rows = tokenSheet.getDataRange().getValues();
  var headers = rows[0];
  var shipIdx = headers.indexOf('shipment_id');
  var usedIdx = headers.indexOf('used_at');
  var updated = 0, skipped = 0;
  for (var r = 1; r < rows.length; r++) {
    var shipId = rows[r][shipIdx];
    var usedAt = rows[r][usedIdx];
    if (!shipId || !usedAt) continue;
    try {
      updateShipment(shipId, { self_serve_submitted_at: usedAt });
      updated++;
    } catch(e) { skipped++; Logger.log('Skip ' + shipId + ': ' + e); }
  }
  Logger.log('Backfilled ' + updated + ' shipments, skipped ' + skipped);
}

// JUN 1 ONE-OFF: backfill clean DOB values for all customers + shipments.
// Strips ISO time from anything stored as a full timestamp. Run once.
function backfillCleanDobs() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var stats = { customers: 0, shipments: 0, unchanged: 0 };
  ['CUSTOMERS', 'SHIPMENTS'].forEach(function(tabKey) {
    var sheet = ss.getSheetByName(TAB[tabKey]);
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    var dobIdx = headers.indexOf('date_birth');
    if (dobIdx < 0) return;
    for (var r = 1; r < rows.length; r++) {
      var raw = rows[r][dobIdx];
      if (!raw) continue;
      var clean = _normalizeDob(raw);
      if (clean && clean !== String(raw).trim()) {
        sheet.getRange(r + 1, dobIdx + 1).setValue(clean);
        stats[tabKey.toLowerCase()]++;
      } else {
        stats.unchanged++;
      }
    }
  });
  Logger.log('DOB backfill: customers=' + stats.customers + ', shipments=' + stats.shipments + ', unchanged=' + stats.unchanged);
}

// JUN 1 DEBUG: trace what happened with SHP-775 (Barbara Parker) — label
// generated, customer got SMS/email, but not found in EasyPost or Shippo.
function debugBarbaraParker() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipment = _findShipmentById(ss, 'SHP-775');
  if (!shipment) { Logger.log('SHP-775 not found'); return; }
  Logger.log('━━━ SHP-775 (Barbara Parker) ━━━');
  Logger.log('Stage: ' + shipment.stage);
  Logger.log('Shipping type: ' + shipment.shipping_type);
  Logger.log('Outbound tracking: ' + shipment.outbound_tracking);
  Logger.log('Shipping cost: ' + shipment.shipping_cost);
  Logger.log('Shipping service: ' + shipment.shipping_service);
  Logger.log('EasyPost shipment ID: [' + (shipment.easypost_shipment_id || '(empty)') + ']');
  Logger.log('Shippo transaction ID: [' + (shipment.shippo_transaction_id || '(empty)') + ']');
  Logger.log('Label QR URL: [' + (shipment.label_qr_url || '(empty)') + ']');
  Logger.log('Created: ' + shipment.created_at);
  Logger.log('Sent: ' + shipment.sent_at);

  // If Shippo transaction id present, query Shippo API to verify it exists
  var txId = shipment.shippo_transaction_id;
  if (txId) {
    try {
      var res = UrlFetchApp.fetch('https://api.goshippo.com/transactions/' + txId, {
        method: 'get',
        headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
        muteHttpExceptions: true
      });
      Logger.log('Shippo lookup HTTP ' + res.getResponseCode());
      Logger.log('Shippo response: ' + res.getContentText().substring(0, 800));
    } catch (e) { Logger.log('Shippo API error: ' + e); }
  }

  // Same for EasyPost
  var epId = shipment.easypost_shipment_id;
  if (epId) {
    try {
      var res2 = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments/' + epId, {
        method: 'get',
        headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') },
        muteHttpExceptions: true
      });
      Logger.log('EasyPost lookup HTTP ' + res2.getResponseCode());
      Logger.log('EasyPost response: ' + res2.getContentText().substring(0, 500));
    } catch (e2) { Logger.log('EasyPost API error: ' + e2); }
  }

  if (!txId && !epId) {
    Logger.log('NEITHER provider ID is stored — label was generated but provenance is unknown.');
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  SALES TRACKING (Jun 2)
//
//  Records when DW sells inventory to dealers/buyers (e.g. Rick Little bundle
//  to Barry's Pawn for $535). One row per sale; shipment_ids comma-separated
//  for bundles. Sales tab auto-created if missing.
// ═══════════════════════════════════════════════════════════════════════════

function _ensureSalesTab() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SALES);
  if (!sheet) {
    sheet = ss.insertSheet(TAB.SALES);
    sheet.appendRow(COLS.SALES);
    var header = sheet.getRange(1, 1, 1, COLS.SALES.length);
    header.setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    sheet.setFrozenRows(1);
    Logger.log('Created Sales tab');
  } else {
    // Idempotent column add: pick up any new fields added since first creation
    var existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    COLS.SALES.forEach(function(col) {
      if (existingHeaders.indexOf(col) < 0) {
        var newColIdx = sheet.getLastColumn() + 1;
        sheet.getRange(1, newColIdx).setValue(col)
          .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
        Logger.log('Added missing column ' + col + ' to Sales tab');
      }
    });
  }
  return sheet;
}

function getSales() {
  var sheet = _ensureSalesTab();
  return sheetToObjects(sheet);
}

function addSale(data) {
  try {
    var sheet = _ensureSalesTab();
    var saleId = nextId(sheet, 'SALE-', 0);
    var row = COLS.SALES.map(function(col) {
      if (col === 'sale_id')    return saleId;
      if (col === 'created_at') return new Date().toISOString();
      // Normalize shipment_ids (accept array or comma-string)
      if (col === 'shipment_ids') {
        var v = data.shipment_ids;
        if (Array.isArray(v)) return v.join(',');
        return String(v || '').replace(/\s+/g, '');
      }
      return data[col] !== undefined ? data[col] : '';
    });
    sheet.appendRow(row);
    return { success: true, sale_id: saleId };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function updateSale(saleId, updates) {
  try {
    var sheet = _ensureSalesTab();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('sale_id');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === saleId) {
        Object.keys(updates).forEach(function(key) {
          var col = headers.indexOf(key);
          if (col >= 0) {
            var val = updates[key];
            if (key === 'shipment_ids' && Array.isArray(val)) val = val.join(',');
            sheet.getRange(r + 1, col + 1).setValue(val);
          }
        });
        return { success: true };
      }
    }
    return { success: false, error: 'sale not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deleteSale(saleId) {
  try {
    var sheet = _ensureSalesTab();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('sale_id');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === saleId) {
        sheet.deleteRow(r + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'sale not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}



// ═══════════════════════════════════════════════════════════════════════
//  EASYPOST UNUSED-LABEL DAILY REFUND + RE-ENGAGEMENT (Jun 4)
//
//  Before the Shippo migration, EasyPost labels were billed ON CREATION,
//  and ~90% were never used. USPS/FedEx allow refunds on unused labels
//  within ~30 days. This runs DAILY and, for EasyPost labels ~25 days old
//  that were never used and aren't in transit:
//    1. Refunds the EasyPost label (recovers the cost)
//    2. Stamps label_refunded_at (idempotent — fires once per shipment)
//    3. Notifies the customer by SMS + email: label expired, reply to
//       either and we'll send a fresh one. (Does NOT auto-generate a new
//       label — intent-gated; they raise their hand, then normal fulfillment
//       sends a fresh Shippo label.)
//
//  Day 25 is deliberate: late enough that the customer had the full window
//  (and the whole follow-up drip, which ends ~Day 12) to ship, early enough
//  to refund before the ~30-day carrier window closes.
//
//  Setup: run createRefundTrigger() ONCE to schedule the daily run.
//  Eligibility window: EASYPOST labels only (Shippo is pay-on-scan, nothing
//  to recover). Tunable via REFUND_AFTER_DAYS / REFUND_WINDOW_MAX_DAYS.
// ═══════════════════════════════════════════════════════════════════════

var REFUND_AFTER_DAYS = 25;       // fire on/after this many days since label sent
var REFUND_WINDOW_MAX_DAYS = 29;  // don't bother past the ~30-day carrier window
var EP_USED_STATUSES = ['in_transit','out_for_delivery','delivered','available_for_pickup','return_to_sender'];

function _epAuthHeader() {
  return { 'Authorization': 'Basic ' + Utilities.base64Encode(EASYPOST_API_KEY + ':') };
}

// Is this EasyPost label unused (never scanned into transit)?
// Returns { used:bool, status:string, refundStatus:string } or null on error.
function _epLabelUsage(epShipmentId) {
  try {
    var res = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments/' + epShipmentId, {
      method: 'get', headers: _epAuthHeader(), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var s = JSON.parse(res.getContentText());
    var trackStatus = (s.tracker && s.tracker.status) ? s.tracker.status : (s.status || '');
    var used = EP_USED_STATUSES.indexOf(trackStatus) >= 0;
    return { used: used, status: trackStatus || '(none)', refundStatus: s.refund_status || '' };
  } catch (e) {
    Logger.log('EP usage check error ' + epShipmentId + ': ' + e);
    return null;
  }
}

// Refund a single EasyPost label. Returns true on accepted request.
function _epRefund(epShipmentId) {
  try {
    var res = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments/' + epShipmentId + '/refund', {
      method: 'post', headers: _epAuthHeader(), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      var d = JSON.parse(res.getContentText());
      Logger.log('  refund ' + epShipmentId + ' → ' + (d.refund_status || 'requested'));
      return true;
    }
    Logger.log('  refund FAILED ' + epShipmentId + ' HTTP ' + code + ': ' + res.getContentText().substring(0,150));
    return false;
  } catch (e) {
    Logger.log('  refund error ' + epShipmentId + ': ' + e);
    return false;
  }
}

// DRY RUN — see what TODAY's daily run would refund + notify, without acting.
function previewDailyRefunds() { return _dailyRefundCore(true); }

// LIVE — the daily trigger calls this.
function processDailyRefunds() { return _dailyRefundCore(false); }

function _dailyRefundCore(dryRun) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var idIdx       = headers.indexOf('shipment_id');
  var custIdx     = headers.indexOf('customer_id');
  var stageIdx    = headers.indexOf('stage');
  var sentIdx     = headers.indexOf('sent_at');
  var recvIdx     = headers.indexOf('received_at');
  var itemIdx     = headers.indexOf('item');
  var epIdx       = headers.indexOf('easypost_shipment_id');
  var shippoIdx   = headers.indexOf('shippo_transaction_id');
  var refundedIdx = headers.indexOf('label_refunded_at');

  if (refundedIdx < 0) { Logger.log('✗ label_refunded_at column missing — run ensureAllColumns()'); return; }

  // Build customer lookup once
  var custMap = {};
  try { getCustomers().forEach(function(c){ custMap[c.customer_id] = c; }); } catch(e) {}

  var now = new Date();
  var refunded = 0, notified = 0, skipped = 0, scanned = 0, errors = 0;
  var refundedCol = [];
  for (var r = 0; r < data.length; r++) refundedCol.push([data[r][refundedIdx]]);

  Logger.log('━━━ ' + (dryRun ? 'PREVIEW' : 'DAILY') + ' EasyPost refund run ━━━');

  for (var r = 1; r < data.length; r++) {
    var epId = String(data[r][epIdx] || '').trim();
    if (!epId) continue;                                   // EasyPost labels only
    if (String(data[r][shippoIdx] || '').trim()) continue; // belt+suspenders: skip if also Shippo
    if (String(data[r][refundedIdx] || '').trim()) continue; // already refunded
    if (String(data[r][recvIdx] || '').trim()) continue;   // arrived → don't refund

    var sentAt = data[r][sentIdx];
    if (!sentAt) continue;
    var sentDate = (sentAt instanceof Date) ? sentAt : new Date(sentAt);
    if (isNaN(sentDate.getTime())) continue;
    var days = (now - sentDate) / 86400000;
    if (days < REFUND_AFTER_DAYS || days > REFUND_WINDOW_MAX_DAYS) continue;

    var shipmentId = data[r][idIdx];

    // Confirm with EasyPost it was never scanned
    var usage = _epLabelUsage(epId);
    if (!usage) { errors++; continue; }
    if (usage.used) { scanned++; continue; }               // in transit/delivered → leave it
    if (usage.refundStatus === 'submitted' || usage.refundStatus === 'refunded') {
      // already refunded on EasyPost side; just stamp locally so we stop checking
      if (!dryRun) { refundedCol[r][0] = new Date().toISOString(); }
      skipped++; continue;
    }

    var cust = custMap[data[r][custIdx]] || {};
    var firstName = String(cust.name || '').trim().split(/\s+/)[0] || 'there';
    firstName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : 'there';
    var itemText = data[r][itemIdx] ? String(data[r][itemIdx]) : 'your items';

    if (dryRun) {
      Logger.log('  WOULD refund+notify ' + shipmentId + ' (' + firstName + ', day ' + Math.round(days) + ', status=' + usage.status + ', ' + (cust.phone?'SMS':'no-phone') + '/' + (cust.email?'email':'no-email') + ')');
      refunded++;
      continue;
    }

    // 1. Refund the EasyPost label
    var ok = _epRefund(epId);
    if (!ok) { errors++; continue; }
    refunded++;
    refundedCol[r][0] = new Date().toISOString();

    // 2. Notify — SMS + email, reply to either to get a fresh label
    var smsMsg = 'Hi ' + firstName + ' — heads up, the prepaid label we sent for your ' + itemText +
      ' has expired. If you\'re still interested in selling, just reply and I\'ll send a fresh one right away. — David @ Snappy Gold';
    var emailSubj = 'Your Snappy Gold label expired — easy to send a new one';
    var emailBody = 'Hi ' + firstName + ', just a heads up that the prepaid shipping label we sent for your ' + itemText +
      ' has expired.\n\nNo problem at all — if you\'re still interested in getting paid for it, just reply to this email (or the text we sent) and I\'ll send you a fresh prepaid label right away. Gold prices are strong right now, so it\'s a good time.\n\nDavid\nSnappy Gold';

    var didNotify = false;
    try {
      if (cust.phone) { var sr = sendSms(cust.phone, cust.name, smsMsg); if (sr && sr.success) didNotify = true; }
    } catch (e) { Logger.log('  SMS error ' + shipmentId + ': ' + e); }
    try {
      if (cust.email) { var er = sendViaPostmark(cust.email, emailSubj, buildPlainEmail(firstName, emailBody)); if (er && er.success) didNotify = true; }
    } catch (e) { Logger.log('  email error ' + shipmentId + ': ' + e); }
    if (didNotify) notified++;

    // 3. Log it to the customer's contact log (tagged to this shipment)
    try {
      addContactLog({ customer_id: data[r][custIdx], shipment_id: shipmentId, type: 'note',
        notes: 'Label expired & refunded (day ' + Math.round(days) + '); sent re-engagement SMS+email' });
    } catch (e) {}

    Utilities.sleep(300);
  }

  if (!dryRun && refunded > 0) {
    sheet.getRange(1, refundedIdx + 1, data.length, 1).setValues(refundedCol);
  }
  Logger.log('───────────────────────────────────────────');
  Logger.log((dryRun ? 'WOULD refund+notify: ' : 'Refunded: ') + refunded +
    (dryRun ? '' : ' · notified: ' + notified) +
    ' · already-scanned(skipped): ' + scanned +
    ' · already-refunded: ' + skipped +
    ' · errors: ' + errors);
  return { refunded: refunded, notified: notified, scanned: scanned, errors: errors };
}

function createRefundTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === 'processDailyRefunds') ScriptApp.deleteTrigger(triggers[t]);
  }
  ScriptApp.newTrigger('processDailyRefunds').timeBased().everyDays(1).atHour(10).create();
  Logger.log('Trigger created: processDailyRefunds daily ~10am');
}


// ═══════════════════════════════════════════════════════════════════════
//  EASYPOST LABEL INVENTORY (read-only, Jun 4) — full list of labels < 30
//  days old, with age in days, cost, usage status, and refund status.
//  Refunds NOTHING. Pulls straight from the EasyPost API so it reflects the
//  true billing picture (every label on the account), not just CRM records.
//  Run from the editor: listEasyPostLabels()
// ═══════════════════════════════════════════════════════════════════════
function listEasyPostLabels() {
  var since = new Date(); since.setDate(since.getDate() - 30);
  Logger.log('━━━ EasyPost labels created since ' + since.toISOString().slice(0,10) + ' ━━━');

  var all = [];
  var beforeId = null, pages = 0;
  while (pages < 15) {
    var url = 'https://api.easypost.com/v2/shipments?page_size=100' + (beforeId ? '&before_id=' + beforeId : '');
    var res = UrlFetchApp.fetch(url, { method:'get', headers:_epAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) { Logger.log('List failed HTTP ' + res.getResponseCode() + ': ' + res.getContentText().substring(0,200)); break; }
    var ships = (JSON.parse(res.getContentText()).shipments) || [];
    if (!ships.length) break;
    var stop = false;
    for (var i=0;i<ships.length;i++){
      if (new Date(ships[i].created_at) < since) { stop = true; break; }
      all.push(ships[i]);
    }
    if (stop) break;
    beforeId = ships[ships.length-1].id; pages++;
  }

  var now = new Date();
  var rows = [], totalUnused = 0, unusedCount = 0, usedCount = 0, noLabelCount = 0, refundedCount = 0;
  for (var i=0;i<all.length;i++){
    var s = all[i];
    var hasLabel = s.postage_label && s.postage_label.label_url;
    var days = Math.floor((now - new Date(s.created_at)) / 86400000);
    var trackStatus = (s.tracker && s.tracker.status) ? s.tracker.status : (s.status || '(none)');
    var used = EP_USED_STATUSES.indexOf(trackStatus) >= 0;
    var refundStatus = s.refund_status || '';
    var cost = (s.selected_rate && s.selected_rate.rate) ? s.selected_rate.rate : '';
    var costNum = parseFloat(cost) || 0;
    var to = (s.to_address && s.to_address.name) ? s.to_address.name : '';
    var carrier = (s.selected_rate && s.selected_rate.carrier) ? s.selected_rate.carrier : '';

    if (!hasLabel) noLabelCount++;
    else if (refundStatus === 'submitted' || refundStatus === 'refunded') refundedCount++;
    else if (used) usedCount++;
    else { unusedCount++; totalUnused += costNum; }

    rows.push({ days:days, used:used, hasLabel:hasLabel, refundStatus:refundStatus,
      cost:cost, costNum:costNum, to:to, carrier:carrier, status:trackStatus,
      tracking:s.tracking_code||'', ref:s.reference||'', id:s.id });
  }

  // Sort by age descending (closest to the 30-day cliff first)
  rows.sort(function(a,b){ return b.days - a.days; });

  Logger.log('Total labels <30d: ' + all.length + '  |  UNUSED(refundable): ' + unusedCount +
    '  used: ' + usedCount + '  already-refunded: ' + refundedCount + '  no-label: ' + noLabelCount);
  Logger.log('POTENTIALLY RECOVERABLE (unused): $' + totalUnused.toFixed(2));
  Logger.log('─── day | $cost | carrier | status | name | tracking ───  (sorted oldest first = closest to expiry)');
  rows.forEach(function(r){
    var flag = (!r.hasLabel) ? 'NOLABEL' : (r.refundStatus ? 'REFUNDED' : (r.used ? 'used' : 'UNUSED↩'));
    Logger.log('  d' + r.days + ' | $' + r.cost + ' | ' + r.carrier + ' | ' + r.status + ' | ' + flag + ' | ' + r.to + ' | ' + r.tracking);
  });
  Logger.log('───────────────────────────────────────────');
  Logger.log('UNUSED↩ = refundable. Closest-to-30-days are at the TOP (refund those first before they age out).');
  return { total: all.length, unused: unusedCount, recoverable: totalUnused.toFixed(2) };
}


// ═══════════════════════════════════════════════════════════════════════
//  ONE-TIME REFUND SWEEP (Jun 4) — catch the backlog of older unused
//  EasyPost labels now, before they age past the ~30-day carrier window.
//  Same refund + SMS/email notify + contact-log as the daily system, but
//  with an adjustable minimum age (default 20 days) and an open top end
//  (still capped at 29 — past that the carrier won't refund anyway).
//
//  20+ days is safely past the follow-up drip (ends ~Day 12), so the
//  "label expired, want a new one?" notice never collides with an active
//  "your label's still good" drip touch.
//
//  PREVIEW first:  previewRefundSweep()      (or previewRefundSweep(20))
//  LIVE:           runRefundSweep()          (or runRefundSweep(20))
// ═══════════════════════════════════════════════════════════════════════
function previewRefundSweep(minDays) { return _refundSweepCore(minDays || 20, true); }
function runRefundSweep(minDays)     { return _refundSweepCore(minDays || 20, false); }

function _refundSweepCore(minDays, dryRun) {
  var maxDays = 29; // carrier refund window ceiling
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var idIdx       = headers.indexOf('shipment_id');
  var custIdx     = headers.indexOf('customer_id');
  var sentIdx     = headers.indexOf('sent_at');
  var recvIdx     = headers.indexOf('received_at');
  var itemIdx     = headers.indexOf('item');
  var epIdx       = headers.indexOf('easypost_shipment_id');
  var shippoIdx   = headers.indexOf('shippo_transaction_id');
  var refundedIdx = headers.indexOf('label_refunded_at');
  if (refundedIdx < 0) { Logger.log('✗ label_refunded_at column missing — run ensureAllColumns()'); return; }

  var custMap = {};
  try { getCustomers().forEach(function(c){ custMap[c.customer_id] = c; }); } catch(e) {}

  var now = new Date();
  var refunded = 0, notified = 0, scanned = 0, alreadyRef = 0, errors = 0, recovered = 0;
  var refundedCol = [];
  for (var r = 0; r < data.length; r++) refundedCol.push([data[r][refundedIdx]]);

  Logger.log('━━━ ' + (dryRun ? 'PREVIEW' : 'LIVE') + ' refund sweep (age ' + minDays + '–' + maxDays + ' days) ━━━');

  for (var r = 1; r < data.length; r++) {
    var epId = String(data[r][epIdx] || '').trim();
    if (!epId) continue;
    if (String(data[r][shippoIdx] || '').trim()) continue;
    if (String(data[r][refundedIdx] || '').trim()) continue;
    if (String(data[r][recvIdx] || '').trim()) continue;

    var sentAt = data[r][sentIdx];
    if (!sentAt) continue;
    var sentDate = (sentAt instanceof Date) ? sentAt : new Date(sentAt);
    if (isNaN(sentDate.getTime())) continue;
    var days = (now - sentDate) / 86400000;
    if (days < minDays || days > maxDays) continue;

    var shipmentId = data[r][idIdx];
    var usage = _epLabelUsage(epId);
    if (!usage) { errors++; continue; }
    if (usage.used) { scanned++; continue; }
    if (usage.refundStatus === 'submitted' || usage.refundStatus === 'refunded') {
      if (!dryRun) refundedCol[r][0] = new Date().toISOString();
      alreadyRef++; continue;
    }

    var cust = custMap[data[r][custIdx]] || {};
    var firstName = String(cust.name || '').trim().split(/\s+/)[0] || 'there';
    firstName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : 'there';
    var itemText = data[r][itemIdx] ? String(data[r][itemIdx]) : 'your items';

    if (dryRun) {
      Logger.log('  WOULD refund+notify ' + shipmentId + ' (' + firstName + ', day ' + Math.round(days) + ', ' + (cust.phone?'SMS':'no-phone') + '/' + (cust.email?'email':'no-email') + ')');
      refunded++; continue;
    }

    var ok = _epRefund(epId);
    if (!ok) { errors++; continue; }
    refunded++;
    refundedCol[r][0] = new Date().toISOString();

    var smsMsg = 'Hi ' + firstName + ' — heads up, the prepaid label we sent for your ' + itemText +
      ' has expired. If you\'re still interested in selling, just reply and I\'ll send a fresh one right away. — David @ Snappy Gold';
    var emailSubj = 'Your Snappy Gold label expired — easy to send a new one';
    var emailBody = 'Hi ' + firstName + ', just a heads up that the prepaid shipping label we sent for your ' + itemText +
      ' has expired.\n\nNo problem at all — if you\'re still interested in getting paid for it, just reply to this email (or the text we sent) and I\'ll send you a fresh prepaid label right away. Gold prices are strong right now, so it\'s a good time.\n\nDavid\nSnappy Gold';

    var didNotify = false;
    try { if (cust.phone) { var sr = sendSms(cust.phone, cust.name, smsMsg); if (sr && sr.success) didNotify = true; } } catch(e){ Logger.log('  SMS error ' + shipmentId + ': ' + e); }
    try { if (cust.email) { var er = sendViaPostmark(cust.email, emailSubj, buildPlainEmail(firstName, emailBody)); if (er && er.success) didNotify = true; } } catch(e){ Logger.log('  email error ' + shipmentId + ': ' + e); }
    if (didNotify) notified++;

    try { addContactLog({ customer_id: data[r][custIdx], shipment_id: shipmentId, type: 'note',
      notes: 'Label expired & refunded (sweep, day ' + Math.round(days) + '); sent re-engagement SMS+email' }); } catch(e){}

    Utilities.sleep(300);
  }

  if (!dryRun && refunded > 0) sheet.getRange(1, refundedIdx + 1, data.length, 1).setValues(refundedCol);
  Logger.log('───────────────────────────────────────────');
  Logger.log((dryRun ? 'WOULD refund+notify: ' : 'Refunded: ') + refunded +
    (dryRun ? '' : ' · notified: ' + notified) +
    ' · already-scanned: ' + scanned + ' · already-refunded: ' + alreadyRef + ' · errors: ' + errors);
  return { refunded: refunded, notified: notified, scanned: scanned, errors: errors };
}


// ═══════════════════════════════════════════════════════════════════════
//  API-DRIVEN REFUND SWEEP (Jun 4) — refund straight from the EasyPost
//  account (NOT the sheet), because older labels drifted out of sheet
//  alignment (sheet sent_at didn't match). Pulls labels from EasyPost like
//  listEasyPostLabels(), refunds every UNUSED one in the age window, and
//  best-effort notifies the customer by matching the EasyPost ID / tracking
//  number back to the Shipments sheet for phone/email.
//
//  Refunds happen regardless of match (recover the money first). Notify only
//  fires when we can resolve a customer with contact info.
//
//  PREVIEW:  previewApiRefundSweep()        // default 20–29 days
//  LIVE:     runApiRefundSweep()
//  Optional wider window: runApiRefundSweep(20, 29)
// ═══════════════════════════════════════════════════════════════════════
function previewApiRefundSweep(minDays, maxDays) { return _apiRefundSweepCore(minDays||20, maxDays||29, true); }
function runApiRefundSweep(minDays, maxDays)     { return _apiRefundSweepCore(minDays||20, maxDays||29, false); }

function _apiRefundSweepCore(minDays, maxDays, dryRun) {
  // 1. Build sheet lookup maps: EasyPost ID → row, tracking → row
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx       = headers.indexOf('shipment_id');
  var custIdx     = headers.indexOf('customer_id');
  var itemIdx     = headers.indexOf('item');
  var epIdx       = headers.indexOf('easypost_shipment_id');
  var trkIdx      = headers.indexOf('outbound_tracking');
  var refundedIdx = headers.indexOf('label_refunded_at');

  var byEpId = {}, byTracking = {};
  for (var r = 1; r < data.length; r++) {
    var ep = String(data[r][epIdx] || '').trim();
    var tk = String(data[r][trkIdx] || '').trim();
    if (ep) byEpId[ep] = r;
    if (tk) byTracking[tk] = r;
  }
  var custMap = {};
  try { getCustomers().forEach(function(c){ custMap[c.customer_id] = c; }); } catch(e) {}

  // 2. Pull EasyPost labels (same pagination as the inventory function)
  var since = new Date(); since.setDate(since.getDate() - (maxDays + 1));
  var all = [], beforeId = null, pages = 0;
  while (pages < 15) {
    var url = 'https://api.easypost.com/v2/shipments?page_size=100' + (beforeId ? '&before_id=' + beforeId : '');
    var res = UrlFetchApp.fetch(url, { method:'get', headers:_epAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) { Logger.log('List failed HTTP ' + res.getResponseCode()); break; }
    var ships = (JSON.parse(res.getContentText()).shipments) || [];
    if (!ships.length) break;
    var stop = false;
    for (var i=0;i<ships.length;i++){ if (new Date(ships[i].created_at) < since) { stop = true; break; } all.push(ships[i]); }
    if (stop) break;
    beforeId = ships[ships.length-1].id; pages++;
  }

  var now = new Date();
  var refunded = 0, notified = 0, noMatch = 0, scanned = 0, alreadyRef = 0, errors = 0, recovered = 0;
  var refundedCol = []; for (var r = 0; r < data.length; r++) refundedCol.push([data[r][refundedIdx]]);

  Logger.log('━━━ ' + (dryRun?'PREVIEW':'LIVE') + ' API refund sweep (age ' + minDays + '–' + maxDays + ' days) ━━━');
  Logger.log('Pulled ' + all.length + ' EasyPost labels to evaluate.');

  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    if (!(s.postage_label && s.postage_label.label_url)) continue;
    var days = (now - new Date(s.created_at)) / 86400000;
    if (days < minDays || days > maxDays) continue;

    var trackStatus = (s.tracker && s.tracker.status) ? s.tracker.status : (s.status || '');
    if (EP_USED_STATUSES.indexOf(trackStatus) >= 0) { scanned++; continue; }
    var rs = s.refund_status || '';
    if (rs === 'submitted' || rs === 'refunded') { alreadyRef++; continue; }

    var cost = (s.selected_rate && s.selected_rate.rate) ? parseFloat(s.selected_rate.rate) : 0;

    // Try to match back to the sheet for notification
    var rowIdx = byEpId[s.id];
    if (rowIdx === undefined && s.tracking_code) rowIdx = byTracking[String(s.tracking_code).trim()];
    var cust = null, itemText = 'your items', shipmentId = '';
    if (rowIdx !== undefined) {
      shipmentId = data[rowIdx][idIdx];
      itemText = data[rowIdx][itemIdx] ? String(data[rowIdx][itemIdx]) : 'your items';
      cust = custMap[data[rowIdx][custIdx]] || null;
    }
    var toName = (s.to_address && s.to_address.name) ? s.to_address.name : '(unknown)';

    if (dryRun) {
      Logger.log('  WOULD refund $' + cost.toFixed(2) + ' ' + toName + ' (d' + Math.round(days) + ') ' +
        (cust ? ('→ notify ' + (cust.phone?'SMS':'-') + '/' + (cust.email?'email':'-')) : '→ NO MATCH (refund only)'));
      refunded++; recovered += cost; if (!cust) noMatch++;
      continue;
    }

    // Refund regardless of match
    var ok = _epRefund(s.id);
    if (!ok) { errors++; continue; }
    refunded++; recovered += cost;
    if (rowIdx !== undefined) refundedCol[rowIdx][0] = new Date().toISOString();

    // Notify if we matched a customer with contact info
    if (cust && (cust.phone || cust.email)) {
      var firstName = String(cust.name || '').trim().split(/\s+/)[0] || 'there';
      firstName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : 'there';
      var smsMsg = 'Hi ' + firstName + ' — heads up, the prepaid label we sent for your ' + itemText +
        ' has expired. If you\'re still interested in selling, just reply and I\'ll send a fresh one right away. — David @ Snappy Gold';
      var emailSubj = 'Your Snappy Gold label expired — easy to send a new one';
      var emailBody = 'Hi ' + firstName + ', just a heads up that the prepaid shipping label we sent for your ' + itemText +
        ' has expired.\n\nNo problem at all — if you\'re still interested in getting paid for it, just reply to this email (or the text we sent) and I\'ll send you a fresh prepaid label right away. Gold prices are strong right now, so it\'s a good time.\n\nDavid\nSnappy Gold';
      var didNotify = false;
      try { if (cust.phone) { var srx = sendSms(cust.phone, cust.name, smsMsg); if (srx && srx.success) didNotify = true; } } catch(e){}
      try { if (cust.email) { var erx = sendViaPostmark(cust.email, emailSubj, buildPlainEmail(firstName, emailBody)); if (erx && erx.success) didNotify = true; } } catch(e){}
      if (didNotify) notified++;
      try { addContactLog({ customer_id: data[rowIdx][custIdx], shipment_id: shipmentId, type: 'note',
        notes: 'Label expired & refunded (API sweep, day ' + Math.round(days) + '); sent re-engagement SMS+email' }); } catch(e){}
    } else {
      noMatch++;
    }
    Utilities.sleep(300);
  }

  if (!dryRun && refunded > 0) sheet.getRange(1, refundedIdx + 1, data.length, 1).setValues(refundedCol);
  Logger.log('───────────────────────────────────────────');
  Logger.log((dryRun?'WOULD refund: ':'Refunded: ') + refunded + ' labels  ($' + recovered.toFixed(2) + ')');
  Logger.log((dryRun?'':'Notified: ' + notified + ' · ') + 'No customer match: ' + noMatch +
    ' · already-scanned: ' + scanned + ' · already-refunded: ' + alreadyRef + ' · errors: ' + errors);
  return { refunded: refunded, recovered: recovered.toFixed(2), notified: notified, noMatch: noMatch };
}


// DIAGNOSTIC (Jun 5) — compare the Shipments sheet's real header row against
// COLS.SHIPMENTS to find any order/name mismatch behind the bin_number bug.
// Run from editor: diagShipmentHeaders()
function diagShipmentHeaders() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('━━━ Shipments header check ━━━');
  Logger.log('Sheet columns: ' + headers.length + ' | Schema columns: ' + COLS.SHIPMENTS.length);
  var maxLen = Math.max(headers.length, COLS.SHIPMENTS.length);
  for (var i = 0; i < maxLen; i++) {
    var sheetCol = headers[i] !== undefined ? headers[i] : '(none)';
    var schemaCol = COLS.SHIPMENTS[i] !== undefined ? COLS.SHIPMENTS[i] : '(none)';
    var mark = (String(sheetCol) === String(schemaCol)) ? '' : '  ◀── MISMATCH';
    var colLetter = String.fromCharCode(65 + (i % 26));
    if (i >= 26) colLetter = 'A' + String.fromCharCode(65 + (i - 26));
    Logger.log('  col ' + colLetter + ' (' + i + '): sheet="' + sheetCol + '" schema="' + schemaCol + '"' + mark);
  }
  // Specifically check what column 'bin_number' actually sits at, and what S (index 18) holds
  Logger.log('───');
  Logger.log('Sheet index of "bin_number": ' + headers.indexOf('bin_number') + ' (col S = index 18)');
  Logger.log('Header at index 18 (col S): "' + headers[18] + '"');
}


// CLEANUP (Jun 5) — clear timestamps wrongly sitting in the bin_number column.
// A bin number is a short locker id (e.g. "7", "58"); an ISO timestamp there is
// bad data (historical mis-write). Blanks any bin_number that parses as a date /
// matches an ISO timestamp pattern. Real numeric bins are untouched.
//   previewCleanBinNumbers()  — dry run, lists what it'd clear
//   cleanBinNumbers()         — live, blanks them
function previewCleanBinNumbers() { return _cleanBinCore(true); }
function cleanBinNumbers()        { return _cleanBinCore(false); }

function _cleanBinCore(dryRun) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx  = headers.indexOf('shipment_id');
  var binIdx = headers.indexOf('bin_number');
  if (binIdx < 0) { Logger.log('bin_number column not found'); return; }

  var isoRe = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;  // ISO-ish timestamp
  var cleared = 0;
  Logger.log('━━━ ' + (dryRun ? 'PREVIEW' : 'LIVE') + ' clean bin_number ━━━');
  for (var r = 1; r < data.length; r++) {
    var val = data[r][binIdx];
    if (val === '' || val === null || val === undefined) continue;
    var str = String(val).trim();
    // Bad if it matches an ISO timestamp, or is otherwise a Date object
    var bad = isoRe.test(str) || (val instanceof Date);
    if (!bad) continue;
    cleared++;
    Logger.log('  ' + (dryRun ? 'WOULD clear' : 'cleared') + ' ' + data[r][idIdx] + ' bin_number="' + str + '"');
    if (!dryRun) sheet.getRange(r + 1, binIdx + 1).setValue('');
  }
  Logger.log('───');
  Logger.log((dryRun ? 'WOULD clear: ' : 'Cleared: ') + cleared + ' row(s)');
  return { cleared: cleared };
}


// ═══════════════════════════════════════════════════════════════════════
//  FEDEX MANUAL-REFUND LIST (Jun 5) — FedEx unused-label refunds fail via
//  API (known EasyPost FedEx bug); Jason refunds them manually if given the
//  tracking numbers. This pulls FedEx labels 20–29 days old, never scanned,
//  not already refunded — prints a clean tracking-number list for Jason AND
//  stashes the shipment matches so we can notify those customers after the
//  manual refund is confirmed (runFedexRefundNotifications()).
//  Run: listFedexForManualRefund()
// ═══════════════════════════════════════════════════════════════════════
function listFedexForManualRefund(minDays, maxDays) {
  minDays = minDays || 20; maxDays = maxDays || 29;
  var since = new Date(); since.setDate(since.getDate() - (maxDays + 1));

  // Pull EasyPost labels
  var all = [], beforeId = null, pages = 0;
  while (pages < 15) {
    var url = 'https://api.easypost.com/v2/shipments?page_size=100' + (beforeId ? '&before_id=' + beforeId : '');
    var res = UrlFetchApp.fetch(url, { method:'get', headers:_epAuthHeader(), muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) { Logger.log('List failed HTTP ' + res.getResponseCode()); break; }
    var ships = (JSON.parse(res.getContentText()).shipments) || [];
    if (!ships.length) break;
    var stop = false;
    for (var i=0;i<ships.length;i++){ if (new Date(ships[i].created_at) < since) { stop = true; break; } all.push(ships[i]); }
    if (stop) break;
    beforeId = ships[ships.length-1].id; pages++;
  }

  // Sheet lookup for matching → customer notification later
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx=headers.indexOf('shipment_id'), custIdx=headers.indexOf('customer_id'),
      itemIdx=headers.indexOf('item'), epIdx=headers.indexOf('easypost_shipment_id'),
      trkIdx=headers.indexOf('outbound_tracking');
  var byEp={}, byTrk={};
  for (var r=1;r<data.length;r++){ var e=String(data[r][epIdx]||'').trim(); var t=String(data[r][trkIdx]||'').trim(); if(e)byEp[e]=r; if(t)byTrk[t]=r; }

  var now = new Date();
  var rows = [], matchStash = [], total = 0;
  for (var i=0;i<all.length;i++){
    var s = all[i];
    if (!(s.postage_label && s.postage_label.label_url)) continue;
    var carrier = (s.selected_rate && s.selected_rate.carrier) ? s.selected_rate.carrier : '';
    if (!/fedex/i.test(carrier)) continue;                       // FedEx only
    var days = Math.floor((now - new Date(s.created_at))/86400000);
    if (days < minDays || days > maxDays) continue;
    var trackStatus = (s.tracker && s.tracker.status) ? s.tracker.status : (s.status || '');
    if (EP_USED_STATUSES.indexOf(trackStatus) >= 0) continue;    // skip scanned/used
    var rs = s.refund_status || '';
    if (rs === 'submitted' || rs === 'refunded') continue;       // skip already refunded

    var cost = (s.selected_rate && s.selected_rate.rate) ? parseFloat(s.selected_rate.rate) : 0;
    total += cost;
    var to = (s.to_address && s.to_address.name) ? s.to_address.name : '(unknown)';
    rows.push({ tracking:s.tracking_code||'', cost:cost.toFixed(2), to:to, days:days, status:trackStatus||'(none)' });

    var rowIdx = byEp[s.id]; if (rowIdx===undefined && s.tracking_code) rowIdx = byTrk[String(s.tracking_code).trim()];
    if (rowIdx!==undefined) {
      matchStash.push({ shipment_id:data[rowIdx][idIdx], customer_id:data[rowIdx][custIdx],
        item:data[rowIdx][itemIdx]||'', tracking:s.tracking_code||'' });
    }
  }

  Logger.log('━━━ FedEx unused labels 20–29d for MANUAL refund (give Jason) ━━━');
  Logger.log('Count: ' + rows.length + ' · total $' + total.toFixed(2));
  Logger.log('');
  Logger.log('─── TRACKING NUMBERS (paste to Jason) ───');
  Logger.log(rows.map(function(r){ return r.tracking; }).join('\n'));
  Logger.log('');
  Logger.log('─── detail ───');
  rows.forEach(function(r){ Logger.log('  ' + r.tracking + '  $' + r.cost + '  ' + r.to + '  (d' + r.days + ', ' + r.status + ')'); });
  Logger.log('');
  Logger.log('Matched to ' + matchStash.length + ' shipments for notification. Stashed.');
  Logger.log('After Jason confirms refunds, run runFedexRefundNotifications() to notify these customers.');

  PropertiesService.getScriptProperties().setProperty('FEDEX_REFUND_NOTIFY', JSON.stringify(matchStash));
  return { count: rows.length, total: total.toFixed(2), matched: matchStash.length };
}

// Run AFTER Jason confirms the manual FedEx refunds. Notifies the matched
// customers (SMS + email) that their label expired + stamps label_refunded_at.
//   previewFedexRefundNotifications()  — dry run
//   runFedexRefundNotifications()      — live
function previewFedexRefundNotifications() { return _fedexNotifyCore(true); }
function runFedexRefundNotifications()     { return _fedexNotifyCore(false); }

function _fedexNotifyCore(dryRun) {
  var raw = PropertiesService.getScriptProperties().getProperty('FEDEX_REFUND_NOTIFY');
  if (!raw) { Logger.log('No stashed FedEx list. Run listFedexForManualRefund() first.'); return; }
  var list = JSON.parse(raw);
  if (!list.length) { Logger.log('Stash empty.'); return; }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx=headers.indexOf('shipment_id'), refundedIdx=headers.indexOf('label_refunded_at');
  var rowById={}; for (var r=1;r<data.length;r++) rowById[data[r][idIdx]]=r;
  var refundedCol=[]; for (var r=0;r<data.length;r++) refundedCol.push([data[r][refundedIdx]]);

  var custMap={}; try{ getCustomers().forEach(function(c){ custMap[c.customer_id]=c; }); }catch(e){}
  var notified=0, skipped=0;

  Logger.log('━━━ ' + (dryRun?'PREVIEW':'LIVE') + ' FedEx refund notifications ━━━');
  for (var i=0;i<list.length;i++){
    var rec = list[i];
    var rIdx = rowById[rec.shipment_id];
    if (rIdx!==undefined && String(data[rIdx][refundedIdx]||'').trim()) { skipped++; continue; } // already done
    var cust = custMap[rec.customer_id] || {};
    var firstName = String(cust.name||'').trim().split(/\s+/)[0] || 'there';
    firstName = firstName ? firstName.charAt(0).toUpperCase()+firstName.slice(1).toLowerCase() : 'there';
    var itemText = rec.item || 'your items';

    if (dryRun) { Logger.log('  WOULD notify ' + rec.shipment_id + ' (' + firstName + ', ' + (cust.phone?'SMS':'-') + '/' + (cust.email?'email':'-') + ')'); notified++; continue; }

    var smsMsg = 'Hi ' + firstName + ' — heads up, the prepaid label we sent for your ' + itemText +
      ' has expired. If you\'re still interested in selling, just reply and I\'ll send a fresh one right away. — David @ Snappy Gold';
    var emailSubj = 'Your Snappy Gold label expired — easy to send a new one';
    var emailBody = 'Hi ' + firstName + ', just a heads up that the prepaid shipping label we sent for your ' + itemText +
      ' has expired.\n\nNo problem at all — if you\'re still interested in getting paid for it, just reply to this email (or the text we sent) and I\'ll send you a fresh prepaid label right away. Gold prices are strong right now, so it\'s a good time.\n\nDavid\nSnappy Gold';
    try { if (cust.phone) sendSms(cust.phone, cust.name, smsMsg); } catch(e){}
    try { if (cust.email) sendViaPostmark(cust.email, emailSubj, buildPlainEmail(firstName, emailBody)); } catch(e){}
    if (rIdx!==undefined) { refundedCol[rIdx][0]=new Date().toISOString();
      try{ addContactLog({customer_id:rec.customer_id, shipment_id:rec.shipment_id, type:'note', notes:'FedEx label expired & refunded (manual via EasyPost); sent re-engagement SMS+email'}); }catch(e){} }
    notified++;
    Utilities.sleep(300);
  }
  if (!dryRun) sheet.getRange(1, refundedIdx+1, data.length, 1).setValues(refundedCol);
  Logger.log('───');
  Logger.log((dryRun?'WOULD notify: ':'Notified: ') + notified + ' · already-done(skipped): ' + skipped);
  return { notified: notified, skipped: skipped };
}


// ═══════════════════════════════════════════════════════════════════════
//  ORPHAN LEAD-DATA SWEEP (Jun 12)
//  Fixes the multi-session photo/notes/address drop (Kaylea, Jaden, etc.).
//  A customer's submission can span MULTIPLE Lead Intake sessions (they browse
//  each item separately, get gated per-item). The original ingestion only
//  claimed photos from ONE session and only Type='photo_browse', so cross-
//  session photos + notes + address were silently dropped.
//
//  This sweep groups a shipment's Lead Intake rows BY EMAIL (the reliable key —
//  NOT IP, which can false-merge different people), follows every session that
//  email touched, and claims ALL photos (any Type) + notes + address that
//  didn't make it onto the shipment.
//
//  SAFE & IDEMPOTENT:
//   - Photos deduped by drive_url (never double-attach; safe to re-run)
//   - Notes/address only filled if the shipment field is EMPTY (never overwrites)
//   - Email-only matching (no IP false-merges); email-less rows reached via
//     their session_id linking back to an emailed row in the same session
//   - Bounded to recent shipments to protect execution quota
//
//  Trigger: sweepOrphanLeadData() every ~30 min (createOrphanSweepTrigger()).
//  Manual:  backfillAllOrphanPhotos() to fix existing affected shipments now.
// ═══════════════════════════════════════════════════════════════════════

function sweepOrphanLeadData() { return _orphanSweepCore(7, 0, true); }          // ONGOING: last 7 days, recent-first, no cursor — catches new orphans within 30 min
function backfillAllOrphanPhotos() { return _orphanSweepCore(3650, 40, false); } // all-time, RESUMABLE — run repeatedly until it says DONE
function resetBackfillProgress() {
  PropertiesService.getScriptProperties().deleteProperty('ORPHAN_SWEEP_CURSOR');
  Logger.log('Backfill cursor reset — next run starts from the beginning.');
}

function _orphanSweepCore(maxAgeDays, batchSize, recentFirst) {
  batchSize = batchSize || 40;
  var startTime = Date.now();
  var MAX_MS = 4.5 * 60 * 1000;  // self-stop at 4.5 min to never hit the 6-min kill

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var shipSheet = ss.getSheetByName(TAB.SHIPMENTS);
  var custSheet = ss.getSheetByName(TAB.CUSTOMERS);
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var photoSheet = ss.getSheetByName(TAB.PHOTOS);

  // ── Build email → {photos{}, notes[]} from Lead Intake (ONE read) ──
  var leadAll = leadSheet.getDataRange().getValues();
  var H = leadAll[0];
  var iEmail = H.indexOf('Email'), iSession = H.indexOf('Session ID'),
      iPhoto = H.indexOf('Photo'), iNotes = H.indexOf('Notes');
  if (iEmail < 0 || iSession < 0 || iPhoto < 0) { Logger.log('Sweep: columns missing'); return { error: 'columns missing' }; }

  var sessionToEmail = {};
  for (var r = 1; r < leadAll.length; r++) {
    var em0 = String(leadAll[r][iEmail] || '').trim().toLowerCase();
    var sid0 = String(leadAll[r][iSession] || '').trim();
    if (em0 && sid0) sessionToEmail[sid0] = em0;
  }
  var byEmail = {};
  for (var r = 1; r < leadAll.length; r++) {
    var em = String(leadAll[r][iEmail] || '').trim().toLowerCase();
    var sid = String(leadAll[r][iSession] || '').trim();
    var owner = em || (sid && sessionToEmail[sid]) || '';
    if (!owner) continue;
    if (!byEmail[owner]) byEmail[owner] = { photos: {}, notes: [] };
    var pUrl = String(leadAll[r][iPhoto] || '');
    if (pUrl.indexOf('drive.google.com') >= 0) byEmail[owner].photos[pUrl] = true;
    if (iNotes >= 0) { var nt = String(leadAll[r][iNotes] || '').trim(); if (nt) byEmail[owner].notes.push(nt); }
  }

  // ── Already-linked photos (ONE read) ──
  var photoData = photoSheet.getDataRange().getValues();
  var pH = photoData[0];
  var pUrlIdx = pH.indexOf('drive_url');
  var alreadyLinked = {};
  for (var r = 1; r < photoData.length; r++) { var u = photoData[r][pUrlIdx]; if (u) alreadyLinked[u] = true; }

  // ── Customer map (ONE read) ──
  var custRows = sheetToObjects(custSheet);
  var custEmail = {};
  custRows.forEach(function(c) { if (c.customer_id) custEmail[c.customer_id] = String(c.email || '').trim().toLowerCase(); });

  // ── Shipments (ONE read) ──
  var ships = sheetToObjects(shipSheet);
  var props = PropertiesService.getScriptProperties();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - maxAgeDays);

  // Accumulate new photo rows for ONE bulk append
  var newPhotoRows = [];
  var photoCols = COLS.PHOTOS;
  var photoIdStart = _nextPhotoNum(photoData, pH);  // numeric start, computed once
  var nowIso = new Date().toISOString();
  var noteUpdates = [];  // {shipment_id, notes}
  var photosClaimed = 0, notesFilled = 0, shipmentsTouched = 0, processed = 0;

  // ── Build the index range to walk ──
  // recentFirst (ongoing trigger): walk newest→oldest, NO cursor, stop after a
  //   run of consecutive out-of-window shipments. Recent shipments cluster at the
  //   end of the sheet, so this covers all recent orphans every run in one pass —
  //   a new submission is caught within one trigger interval (30 min), not hours.
  // cursor mode (backfill): resumable batches across ALL shipments.
  var indices = [];
  if (recentFirst) {
    var staleStreak = 0;
    for (var k = ships.length - 1; k >= 0; k--) {
      var c = ships[k].created_at ? new Date(ships[k].created_at) : null;
      if (c && c < cutoff) { staleStreak++; if (staleStreak > 50) break; continue; }  // tolerate some out-of-order rows
      staleStreak = 0;
      indices.push(k);
    }
  } else {
    var cursor = parseInt(props.getProperty('ORPHAN_SWEEP_CURSOR') || '0', 10);
    if (cursor >= ships.length) cursor = 0;
    for (var k = cursor; k < ships.length; k++) indices.push(k);
  }

  var lastIdx = recentFirst ? -1 : (indices.length ? indices[0] : 0);
  for (var ii = 0; ii < indices.length; ii++) {
    if (Date.now() - startTime > MAX_MS) break;
    if (!recentFirst && processed >= batchSize) break;
    processed++;
    var sh = ships[indices[ii]];
    lastIdx = indices[ii];
    var created = sh.created_at ? new Date(sh.created_at) : null;
    if (created && created < cutoff) continue;
    var email = custEmail[sh.customer_id];
    if (!email || !byEmail[email]) continue;
    var data = byEmail[email];
    var touched = false;

    var urls = Object.keys(data.photos);
    for (var u = 0; u < urls.length; u++) {
      if (alreadyLinked[urls[u]]) continue;
      var pid = 'PHO-' + (photoIdStart++);
      var row = photoCols.map(function(col) {
        if (col === 'photo_id') return pid;
        if (col === 'uploaded_at') return nowIso;
        if (col === 'shipment_id') return sh.shipment_id;
        if (col === 'drive_url') return urls[u];
        if (col === 'source') return 'lead_intake_sweep';
        return '';
      });
      newPhotoRows.push(row);
      alreadyLinked[urls[u]] = true;
      photosClaimed++; touched = true;
    }
    if ((!sh.notes || !String(sh.notes).trim()) && data.notes.length) {
      var uniq = data.notes.filter(function(v, idx, a){ return a.indexOf(v) === idx; }).join(' | ');
      noteUpdates.push({ id: sh.shipment_id, notes: uniq });
      notesFilled++; touched = true;
    }
    if (touched) shipmentsTouched++;
  }

  // ── BULK write photos (one append) ──
  if (newPhotoRows.length) {
    photoSheet.getRange(photoSheet.getLastRow() + 1, 1, newPhotoRows.length, newPhotoRows[0].length).setValues(newPhotoRows);
  }
  // ── Notes (small count; per-shipment is fine) ──
  noteUpdates.forEach(function(n) { try { updateShipment(n.id, { notes: n.notes }); } catch(e){} });

  // ── Save cursor (backfill mode only) ──
  var done = true;
  if (!recentFirst) {
    var nextCursor = lastIdx + 1;
    done = (nextCursor >= ships.length);
    props.setProperty('ORPHAN_SWEEP_CURSOR', done ? '0' : String(nextCursor));
  }

  var summary = { mode: recentFirst ? 'recent' : 'backfill', processed: processed, photosClaimed: photosClaimed,
    notesFilled: notesFilled, shipmentsTouched: shipmentsTouched, done: done };
  if (!recentFirst) summary.cursor = (lastIdx + 1) + '/' + ships.length;
  Logger.log('Orphan sweep: ' + JSON.stringify(summary) + (recentFirst ? '  (ongoing recent sweep)' : (done ? '  ✅ DONE (full pass complete)' : '  ↻ run again to continue')));
  return summary;
}

function _nextPhotoNum(photoData, headers) {
  var idIdx = headers.indexOf('photo_id');
  var max = 0;
  for (var r = 1; r < photoData.length; r++) {
    var m = String(photoData[r][idIdx] || '').match(/PHO-(\d+)/);
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max + 1;
}

function createOrphanSweepTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sweepOrphanLeadData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sweepOrphanLeadData').timeBased().everyMinutes(30).create();
  Logger.log('Created sweepOrphanLeadData trigger (every 30 min)');
}


// ═══════════════════════════════════════════════════════════════════════
//  PERFORMANCE DIAGNOSTIC (Jun 12) — find what's making the CRM load slow.
//  Times each of the three load calls the CRM fires on startup, plus reports
//  the row count of every tab. Run diagLoadPerformance() from the editor.
// ═══════════════════════════════════════════════════════════════════════
function diagLoadPerformance() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  Logger.log('━━━ LOAD PERFORMANCE DIAGNOSTIC ━━━');

  // Row counts per tab
  Logger.log('--- Tab sizes ---');
  [TAB.CUSTOMERS, TAB.SHIPMENTS, TAB.CONTACT_LOG, TAB.PHOTOS, TAB.LEADS].forEach(function(name) {
    try {
      var sh = ss.getSheetByName(name);
      Logger.log('  ' + name + ': ' + (sh.getLastRow() - 1) + ' rows × ' + sh.getLastColumn() + ' cols');
    } catch(e) { Logger.log('  ' + name + ': ERROR ' + e); }
  });

  // Time each load call the CRM makes on startup
  Logger.log('--- Load-call timing (what the CRM fires on every open) ---');
  var t;

  t = Date.now();
  var custs = getCustomers();
  Logger.log('  getCustomers(): ' + (Date.now()-t) + 'ms → ' + custs.length + ' rows');

  t = Date.now();
  var ships = getShipmentsLite(null);
  Logger.log('  getShipmentsLite(): ' + (Date.now()-t) + 'ms → ' + ships.length + ' rows');

  t = Date.now();
  var logs = getContactLog(null);
  Logger.log('  getContactLog(): ' + (Date.now()-t) + 'ms → ' + logs.length + ' rows  ◀ loads ENTIRE log every time');

  // For comparison: the heavy attribution join (if anything still calls it)
  t = Date.now();
  try { var shipsHeavy = getShipments(null); Logger.log('  getShipments() [heavy join]: ' + (Date.now()-t) + 'ms → ' + shipsHeavy.length + ' rows'); }
  catch(e) { Logger.log('  getShipments(): ERROR ' + e); }

  Logger.log('━━━ END ━━━');
}


// ═══════════════════════════════════════════════════════════════════════
//  REPORT: items purchased 30+ days ago, grouped by bin (Jun 16)
//  These have cleared the FL 538 30-day hold → eligible to melt/resell/move.
//  Run report30DayHold() from the editor; reads the log.
// ═══════════════════════════════════════════════════════════════════════
function report30DayHold() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var custName = {};
  custs.forEach(function(c){ if (c.customer_id) custName[c.customer_id] = c.name || ''; });

  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  var now = new Date();

  var hits = [];
  ships.forEach(function(s){
    // purchase date: prefer purchased_at, fall back to paid_at
    var dStr = s.purchased_at || s.paid_at || '';
    if (!dStr) return;
    var d = new Date(dStr);
    if (isNaN(d.getTime())) return;
    if (d >= cutoff) return;                 // newer than 30 days → still in hold
    if (!s.purchase_price && !s.paid_at && !s.purchased_at) return;  // not actually a purchase
    var ageDays = Math.floor((now - d) / 86400000);
    hits.push({
      bin: String(s.bin_number || '(no bin)').trim() || '(no bin)',
      shipment_id: s.shipment_id,
      item: s.item || '(no item)',
      price: s.purchase_price || '',
      customer: custName[s.customer_id] || s.customer_id || '',
      purchased: d.toISOString().slice(0,10),
      ageDays: ageDays,
    });
  });

  // Group by bin
  hits.sort(function(a,b){ return a.bin.localeCompare(b.bin) || (b.ageDays - a.ageDays); });
  var byBin = {};
  hits.forEach(function(h){ (byBin[h.bin] = byBin[h.bin] || []).push(h); });

  Logger.log('═══ ITEMS PAST 30-DAY HOLD (purchased before ' + cutoff.toISOString().slice(0,10) + ') ═══');
  Logger.log('Total: ' + hits.length + ' item(s) across ' + Object.keys(byBin).length + ' bin(s)');
  Logger.log('');
  Object.keys(byBin).sort().forEach(function(bin){
    var rows = byBin[bin];
    var binTotal = rows.reduce(function(sum,r){ return sum + (parseFloat(String(r.price).replace(/[^0-9.]/g,'')) || 0); }, 0);
    Logger.log('━━━ BIN ' + bin + '  (' + rows.length + ' item(s), $' + binTotal.toFixed(0) + ' cost) ━━━');
    rows.forEach(function(r){
      Logger.log('   ' + r.shipment_id + ' · ' + r.item +
        '  | $' + (r.price||'?') + ' | ' + r.customer + ' | bought ' + r.purchased + ' (' + r.ageDays + 'd ago)');
    });
    Logger.log('');
  });
  Logger.log('═══ END ═══');
  return { total: hits.length, bins: Object.keys(byBin).length };
}


// ═══════════════════════════════════════════════════════════════════════
//  REPORT: gate drop-off — how many give email but never finish (no address)
//  Answers: "are people entering email to see the offer, then not submitting?"
//  Run funnelDropoffReport() from the editor; reads the log.
//  Dedupes by email so one person browsing many items counts once.
// ═══════════════════════════════════════════════════════════════════════
function funnelDropoffReport(daysBack) {
  daysBack = daysBack || 30;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);

  // Collapse to one record per email: did this email EVER provide an address?
  // (people browse multiple items across sessions; we care about the person.)
  var byEmail = {};           // email -> { hasAddress, variant, firstSeen }
  var noEmailButAddress = 0;  // edge: address but no email (rare)
  var totalRows = 0;

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var ts = r[COL.TIMESTAMP] ? new Date(r[COL.TIMESTAMP]) : null;
    if (ts && ts < cutoff) continue;
    var email = String(r[COL.EMAIL] || '').toLowerCase().trim();
    var addr  = String(r[COL.ADDRESS] || '').trim();
    var variant = String(r[COL.VARIANT] || '').trim() || '(none)';
    totalRows++;

    if (!email) { if (addr) noEmailButAddress++; continue; }
    if (!byEmail[email]) byEmail[email] = { hasAddress: false, variant: variant };
    if (addr) byEmail[email].hasAddress = true;
  }

  var emails = Object.keys(byEmail);
  var gave = emails.length;                    // people who passed the email gate
  var completed = 0;                            // of those, gave an address
  var byVariantGave = {}, byVariantDone = {};
  emails.forEach(function(e){
    var v = byEmail[e].variant;
    byVariantGave[v] = (byVariantGave[v]||0) + 1;
    if (byEmail[e].hasAddress) {
      completed++;
      byVariantDone[v] = (byVariantDone[v]||0) + 1;
    }
  });
  var partial = gave - completed;
  var pct = gave ? Math.round((completed/gave)*1000)/10 : 0;

  Logger.log('═══ FUNNEL DROP-OFF (last ' + daysBack + ' days) ═══');
  Logger.log('Unique emails captured (passed gate): ' + gave);
  Logger.log('  → Completed (gave address):  ' + completed + '  (' + pct + '%)');
  Logger.log('  → Partial (email, NO address): ' + partial + '  (' + (100-pct).toFixed(1) + '%)  ← the leak');
  Logger.log('');
  Logger.log('By variant (completed / gave email):');
  Object.keys(byVariantGave).sort().forEach(function(v){
    var g = byVariantGave[v], d = byVariantDone[v]||0;
    Logger.log('   ' + v + ':  ' + d + ' / ' + g + '  (' + (g?Math.round(d/g*1000)/10:0) + '% complete)');
  });
  Logger.log('');
  Logger.log('(Edge: ' + noEmailButAddress + ' rows had address but no email; ' + totalRows + ' total rows scanned)');
  Logger.log('═══ END ═══');
  return { gaveEmail: gave, completed: completed, partial: partial, completionPct: pct };
}


// ═══════════════════════════════════════════════════════════════════════
//  RECOVERY EMAIL — re-engage email-only partials (gave email, no address)
//  Jun 16. Sends a prefilled "come back & finish" email to people who saw an
//  offer but never completed. Batched recent-first to protect deliverability.
//
//  Usage (run from editor):
//    recoveryEmailPreview(14)      → DRY RUN: who would get it in last 14 days
//    recoveryEmailSend(14, 40)     → send to partials from last 14 days, max 40
//  Tracking: stamps a 'recovery_sent_at' note in the lead's AUTO_REPLY col with
//  a "RECOV:" prefix so we never double-send (separate from normal auto-reply).
// ═══════════════════════════════════════════════════════════════════════

function recoveryEmailPreview(daysBack, minEst) { return _recoveryCore(daysBack || 14, 9999, true, minEst || 0); }
function recoveryEmailSend(daysBack, maxSend, minEst) { return _recoveryCore(daysBack || 14, maxSend || 40, false, minEst || 0); }

// Parse the LOW end of an estimate string like "$246 – $488" or "$1,420 – $2,180" → 246
function _estimateLow(estStr) {
  if (!estStr) return 0;
  var m = String(estStr).replace(/,/g, '').match(/\$?\s*(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

// Basic email sanity — must have user@domain.tld shape
function _validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
}

function _recoveryCore(daysBack, maxSend, dryRun, minEst) {
  minEst = minEst || 0;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.LEADS);
  var rows = sheet.getDataRange().getValues();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);

  // Build per-email picture: did they EVER give an address? what's their best
  // item+estimate? have we already sent recovery? most recent activity?
  var byEmail = {};  // email -> { hasAddress, item, estimate, firstName, rowIdx, ts, alreadyRecovered }
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var ts = r[COL.TIMESTAMP] ? new Date(r[COL.TIMESTAMP]) : null;
    var email = String(r[COL.EMAIL] || '').toLowerCase().trim();
    if (!email) continue;
    var addr = String(r[COL.ADDRESS] || '').trim();
    var recovFlag = String(r[COL.AUTO_REPLY] || '').indexOf('RECOV:') !== -1;

    if (!byEmail[email]) {
      byEmail[email] = { hasAddress: false, item: '', estimate: '', firstName: '',
        rowIdx: i, ts: ts, alreadyRecovered: false, inWindow: false };
    }
    var e = byEmail[email];
    if (addr) e.hasAddress = true;                        // completed at least once → not a partial
    if (recovFlag) e.alreadyRecovered = true;             // already got a recovery email
    if (ts && (!e.ts || ts > e.ts)) e.ts = ts;            // track most recent activity
    if (ts && ts >= cutoff) e.inWindow = true;            // had activity in the window
    // capture best item/estimate/name from any row for this email
    if (!e.item && r[COL.ITEM])      e.item = String(r[COL.ITEM]);
    if (!e.estimate && r[COL.ESTIMATE]) e.estimate = String(r[COL.ESTIMATE]);
    if (!e.firstName && r[COL.NAME]) e.firstName = String(r[COL.NAME]).split(' ')[0];
    e.rowIdx = i;  // last row for this email (where we'll stamp the flag)
  }

  // Candidates: partial (no address), in window, not already recovered, has email
  var candidates = [];
  var skippedInvalid = 0, skippedLowEst = 0;
  Object.keys(byEmail).forEach(function(email){
    var e = byEmail[email];
    if (e.hasAddress) return;          // completed — skip
    if (e.alreadyRecovered) return;    // already emailed — skip
    if (!e.inWindow) return;           // outside date window — skip
    var sendTo = _validEmail(email) ? isPlausibleEmail(email) : '';   // Sep 14: typo domains fixed, junk addresses skipped
    if (!sendTo) { skippedInvalid++; return; }   // malformed or implausible email — skip (would bounce)
    var low = _estimateLow(e.estimate);
    if (minEst > 0 && low < minEst) { skippedLowEst++; return; }  // below value threshold — skip
    e._estLow = low;
    candidates.push({ email: email, sendTo: sendTo, data: e });
  });

  // Recent-first (warmest leads first)
  candidates.sort(function(a,b){ return (b.data.ts||0) - (a.data.ts||0); });

  Logger.log('═══ RECOVERY EMAIL ' + (dryRun ? '(PREVIEW)' : '(LIVE SEND)') + ' — last ' + daysBack + ' days ═══');
  if (minEst > 0) Logger.log('Min estimate filter: $' + minEst + '+ (low end)');
  Logger.log('Eligible partials: ' + candidates.length + (dryRun ? '' : '  · sending up to ' + maxSend));
  Logger.log('Skipped: ' + skippedInvalid + ' invalid email(s), ' + skippedLowEst + ' below $' + minEst);

  var sent = 0;
  for (var c = 0; c < candidates.length; c++) {
    if (!dryRun && sent >= maxSend) break;
    var cand = candidates[c];
    var d = cand.data;
    var firstName = d.firstName || 'there';
    var item = d.item || 'your item';
    var estimate = d.estimate || '';
    var url = buildReturnUrl('shipping', d.firstName, d.item, d.estimate);

    if (dryRun) {
      Logger.log('  WOULD EMAIL: ' + cand.email + ' · ' + firstName + ' · ' + item + ' · est=' + (estimate||'?') + ' · last ' + (d.ts ? d.ts.toISOString().slice(0,10) : '?'));
      continue;
    }

    try {
      var subject = estimate
        ? ('Your gold is still worth ' + (estimate.indexOf('$')===0?estimate:('$'+estimate)) + ', ' + firstName)
        : ('Finish your Snappy Gold offer, ' + firstName);
      var body = _recoveryEmailBody(firstName, item, estimate, url);
      if (typeof isDoNotContact === 'function' && (isDoNotContact(cand.email) || isDoNotContact(cand.sendTo))) { Logger.log('  ⛔ DNC: ' + cand.email); continue; }
      var pmRes = UrlFetchApp.fetch('https://api.postmarkapp.com/email', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'X-Postmark-Server-Token': _reengageToken(), 'Accept': 'application/json' },
        payload: JSON.stringify({
          From: FROM_NAME + ' <' + FROM_EMAIL + '>', To: cand.sendTo, Subject: subject,
          HtmlBody: body, TextBody: _stripHtml(body),
          MessageStream: _reengageStream(), Tag: 'recovery'
        })
      });
      if (pmRes.getResponseCode() !== 200) throw new Error('Postmark ' + pmRes.getResponseCode() + ': ' + pmRes.getContentText().slice(0, 200));
      COMMS_KIND = 'recovery'; logAutoSend(cand.sendTo, 'email', subject); COMMS_KIND = '';
      // stamp recovery flag in AUTO_REPLY col (append, don't overwrite)
      var existing = String(rows[d.rowIdx][COL.AUTO_REPLY] || '');
      var stamp = (existing ? existing + ' | ' : '') + 'RECOV:' + new Date().toISOString().slice(0,10);
      sheet.getRange(d.rowIdx + 1, COL.AUTO_REPLY + 1).setValue(stamp);
      sent++;
      Logger.log('  ✅ SENT: ' + cand.email + ' (' + item + ')');
      Utilities.sleep(400);  // gentle pacing
    } catch (err) {
      Logger.log('  ❌ FAIL: ' + cand.email + ' — ' + err.message);
    }
  }

  Logger.log(dryRun ? '═══ END PREVIEW (no emails sent) ═══' : ('═══ END — sent ' + sent + ' recovery emails ═══'));
  return { eligible: candidates.length, sent: dryRun ? 0 : sent, dryRun: dryRun };
}

function _recoveryEmailBody(firstName, item, estimate, url) {
  var estLine = estimate
    ? ('<p style="font-size:16px;color:#1A1816;margin:0 0 4px;">Your estimate was <strong style="color:#C8953C;">' + (estimate.indexOf('$')===0?estimate:('$'+estimate)) + '</strong>.</p>')
    : '';
  return '' +
    '<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;color:#1A1816;">' +
    '<p style="font-size:18px;">Hi ' + firstName + ',</p>' +
    '<p style="font-size:15px;line-height:1.6;color:#3a3a3a;">You started a quote with us for <strong>' + item + '</strong> but didn\'t finish. Good news — it\'s still ready to go.</p>' +
    estLine +
    '<p style="font-size:15px;line-height:1.6;color:#3a3a3a;">This is a <em>preliminary</em> estimate — your firm cash offer might be higher. Send it in for a free expert evaluation and we\'ll make you a same-day cash offer. Accept and get paid, or decline and we\'ll ship it back for free.</p>' +
    '<p style="text-align:center;margin:28px 0;">' +
    '<a href="' + url + '" style="background:#5BA82E;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block;">Finish &amp; Get My Firm Offer →</a>' +
    '</p>' +
    '<p style="font-size:13px;color:#888;line-height:1.5;">Free prepaid shipping · Expert in-person evaluation · Payment within 24 hours.</p>' +
    '<p style="font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:12px;margin-top:20px;">Snappy Gold · DW5 LLC · 1686 S Federal Hwy #318, Delray Beach FL 33483<br>Don\'t want these? <a href="{{{ pm:unsubscribe }}}" style="color:#aaa;">Unsubscribe</a> or reply STOP and we won\'t email about this again.</p>' +
    '</div>';
}

function _stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}


// ── DIAGNOSTIC: audit a shipment's margin-relevant fields ──
// Run auditShipmentMargin('SHP-887') from the editor.
function auditShipmentMargin(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var s = rows.filter(function(r){ return String(r.shipment_id) === String(shipmentId); });
  if (!s.length) { Logger.log('No shipment found: ' + shipmentId); return; }
  if (s.length > 1) Logger.log('⚠ ' + s.length + ' ROWS share id ' + shipmentId + ' (duplicate!)');
  s.forEach(function(r, i){
    Logger.log('─── ' + shipmentId + (s.length>1?(' [row '+(i+1)+']'):'') + ' ───');
    Logger.log('stage:          "' + r.stage + '"');
    Logger.log('purchase_price: "' + r.purchase_price + '"  (parsed: ' + (parseFloat(r.purchase_price)||0) + ')');
    Logger.log('appraised_value:"' + r.appraised_value + '"  (parsed: ' + (parseFloat(r.appraised_value)||0) + ')');
    Logger.log('estimate:       "' + r.estimate + '"');
    Logger.log('item:           "' + r.item + '"');
    var inPurchasedSet = ['complete','pending_leadsonline','pending_payment'].indexOf(r.stage) !== -1;
    Logger.log('counts as purchased? ' + inPurchasedSet + (inPurchasedSet?'':'  ← NOT in margin calc until stage is pending_payment/pending_leadsonline/complete'));
    Logger.log('this row contributes to margin: appraised('+(parseFloat(r.appraised_value)||0)+') - purchase('+(parseFloat(r.purchase_price)||0)+') = ' + ((parseFloat(r.appraised_value)||0)-(parseFloat(r.purchase_price)||0)));
  });

  // Recompute all-time margin the way analytics does, and show this shipment's effect
  var purchased = rows.filter(function(r){ return ['complete','pending_leadsonline','pending_payment'].indexOf(r.stage) !== -1; });
  var revenue = purchased.reduce(function(sum,r){ return sum + (parseFloat(r.appraised_value)||0); }, 0);
  var costs   = purchased.reduce(function(sum,r){ return sum + (parseFloat(r.purchase_price)||0); }, 0);
  Logger.log('═══ ALL-TIME (purchased set, n=' + purchased.length + ') ═══');
  Logger.log('Σ appraised_value (revenue): $' + revenue.toFixed(2));
  Logger.log('Σ purchase_price (cost):     $' + costs.toFixed(2));
  Logger.log('gross (rev - cost):          $' + (revenue-costs).toFixed(2));

  // How many purchased items are MISSING an appraised value?
  var missingAppr = purchased.filter(function(r){ return !(parseFloat(r.appraised_value)>0); });
  Logger.log('Purchased items missing appraised_value: ' + missingAppr.length + ' of ' + purchased.length);
  if (missingAppr.length) Logger.log('  → these add cost but $0 revenue, dragging margin DOWN');
}

// Zero-arg wrappers so you can run straight from the editor dropdown
function audit887() { return auditShipmentMargin('SHP-887'); }
function audit724() { return auditShipmentMargin('SHP-724'); }

// ── Full purchase ledger: every purchased item with estimate, paid, appraised, margin ──
// Run purchaseLedger() from the editor.
function purchaseLedger() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var purchased = rows.filter(function(r){
    return ['complete','pending_leadsonline','pending_payment'].indexOf(r.stage) !== -1;
  });
  // sort by margin descending
  purchased.forEach(function(r){
    r._paid = parseFloat(r.purchase_price)||0;
    r._appr = parseFloat(r.appraised_value)||0;
    r._margin = r._appr - r._paid;
  });
  purchased.sort(function(a,b){ return b._margin - a._margin; });

  Logger.log('═══ PURCHASE LEDGER (' + purchased.length + ' items) ═══');
  Logger.log('ID | PAID | APPRAISED | MARGIN | EST | ITEM');
  var tPaid=0, tAppr=0, tMargin=0;
  purchased.forEach(function(r){
    tPaid += r._paid; tAppr += r._appr; tMargin += r._margin;
    var flag = r._appr>0 ? '' : '  ⚠NO APPRAISAL';
    var item = String(r.item||'').slice(0,42);
    Logger.log(
      (r.shipment_id||'?') +
      ' | $' + r._paid +
      ' | $' + r._appr +
      ' | $' + r._margin +
      ' | ' + (r.estimate || '—') +
      ' | ' + item + flag
    );
  });
  Logger.log('─────────────────────────────');
  Logger.log('TOTALS: paid $' + tPaid.toFixed(0) + ' | appraised $' + tAppr.toFixed(0) + ' | margin $' + tMargin.toFixed(0));
  var marginPct = tAppr>0 ? Math.round((tMargin/tAppr)*100) : 0;
  Logger.log('Blended margin: ' + marginPct + '% of appraised value');
  return { count: purchased.length, paid: tPaid, appraised: tAppr, margin: tMargin };
}

// Dump the photos linked to a shipment + their source tags, to diagnose text/photo mismatch
function auditShipmentPhotos(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var photos = sheetToObjects(ss.getSheetByName(TAB.PHOTOS));
  var mine = photos.filter(function(p){ return String(p.shipment_id) === String(shipmentId); });
  Logger.log('═══ PHOTOS for ' + shipmentId + ' (' + mine.length + ') ═══');
  mine.forEach(function(p, i){
    Logger.log((i+1) + '. source="' + (p.source||'') + '"  status="' + (p.purchase_status||'') + '"  ts=' + (p.timestamp||p.created_at||'?'));
    Logger.log('    url=' + String(p.drive_url||p.url||'').slice(0,90));
    if (p.session_id) Logger.log('    session_id=' + p.session_id);
  });
  // also show the shipment's own session/email to compare
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(r){ return String(r.shipment_id)===String(shipmentId); });
  if (ships.length){
    var s = ships[0];
    Logger.log('─── shipment says ───');
    Logger.log('item: ' + s.item);
    Logger.log('session_id: ' + (s.session_id||'?') + '  email: ' + (s.email||s.customer_email||'?'));
  }
}
function audit933photos(){ return auditShipmentPhotos('SHP-933'); }

// Find a shipment by ANY tracking number (handles the FedEx 34-digit form too).
// Run findByTracking() after pasting your number below, or call with arg.
function findByTracking(tracking) {
  tracking = String(tracking || '').replace(/\s+/g,'').trim();
  if (!tracking) { Logger.log('No tracking provided'); return; }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  // FedEx sometimes prints a long form; the real 12/15-digit number is usually the TAIL.
  var tails = [tracking];
  if (tracking.length > 15) { tails.push(tracking.slice(-12)); tails.push(tracking.slice(-15)); }

  var hits = ships.filter(function(s){
    var fields = [s.outbound_tracking, s.return_tracking, s.kit_tracking].map(function(x){ return String(x||'').replace(/\s+/g,''); });
    return fields.some(function(f){
      if (!f) return false;
      return tails.some(function(t){ return f === t || f.indexOf(t) !== -1 || t.indexOf(f) !== -1; });
    });
  });

  Logger.log('═══ TRACKING SEARCH: ' + tracking + ' ═══');
  if (!hits.length) {
    Logger.log('No shipment matched. (Tried full + last-12 + last-15 digits.)');
    Logger.log('If this was a customer-paid label not generated by us, the number may not be stored.');
    return;
  }
  hits.forEach(function(s){
    Logger.log('✅ ' + s.shipment_id + ' — ' + (s.item||'(no item)'));
    Logger.log('   stage: ' + s.stage);
    Logger.log('   inbound(outbound_tracking): ' + s.outbound_tracking);
    Logger.log('   return_tracking: ' + (s.return_tracking||'—') + ' | kit_tracking: ' + (s.kit_tracking||'—'));
    Logger.log('   customer_id: ' + (s.customer_id||'?') + ' | email: ' + (s.email||s.customer_email||'?'));
  });
}
function findMyPackage(){ return findByTracking('9632013760210854246300792476034769'); }


// ═══════════════════════════════════════════════════════════════════════
//  OPENPHONE INBOUND WEBHOOK — Phase 1: catch & log (verify webhook fires)
//  Register your Apps Script /exec URL in OpenPhone → Settings → Webhooks,
//  subscribed to "message.received". Then text your OpenPhone number and
//  check the 'SMS Inbound' tab. If rows appear, inbound works.
// ═══════════════════════════════════════════════════════════════════════
function handleOpenPhoneInbound(payload) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var tab = ss.getSheetByName('SMS Inbound');
    if (!tab) {
      tab = ss.insertSheet('SMS Inbound');
      tab.appendRow(['received_at','type','from','to','body','matched_customer','matched_shipment','raw']);
    }

    // OpenPhone payload shape: { type, data: { object: { from, to, body/text, ... } } }
    var type = payload.type || '';
    var obj  = (payload.data && payload.data.object) || payload.object || {};
    var from = obj.from || (obj.participants && obj.participants[0]) || '';
    var to   = obj.to || '';
    var body = obj.body || obj.text || obj.content || '';

    // Only care about inbound messages (ignore delivery receipts, outbound echoes)
    var isInbound = (type.indexOf('message') !== -1) && (obj.direction === 'incoming' || obj.direction === 'inbound' || !obj.direction);

    // Sep 14: STOP / "don't contact me" → Do Not Contact list (both channels for that customer)
    if (isInbound && from && typeof dncLooksLikeStop === 'function' && dncLooksLikeStop(body)) {
      try { dncAddPerson(from, 'STOP via SMS: ' + String(body).slice(0, 60), 'sms'); } catch (dncErr) { Logger.log('DNC capture failed: ' + dncErr); }
    }

    // Try to match the sender to a customer by phone (last 10 digits)
    var matchedCust = '', matchedShip = '';
    try {
      var digits = String(from).replace(/\D/g,'').slice(-10);
      if (digits) {
        var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
        var hit = custs.filter(function(c){ return String(c.phone||'').replace(/\D/g,'').slice(-10) === digits; })[0];
        if (hit) {
          matchedCust = hit.name + ' (' + hit.customer_id + ')';
          var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS))
            .filter(function(s){ return String(s.customer_id) === String(hit.customer_id); });
          if (ships.length) {
            // most recent shipment
            ships.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
            matchedShip = ships[0].shipment_id + ' · ' + ships[0].stage + ' · ' + (ships[0].item||'').slice(0,40);
          }
        }
      }
    } catch(mErr) { matchedCust = 'match error: ' + mErr; }

    tab.appendRow([
      new Date(), type, from, to, body,
      matchedCust, matchedShip,
      JSON.stringify(payload).slice(0, 500)
    ]);

    // ── PHASE 2: draft a reply in David's voice and EMAIL it to David ──
    // Only for genuine inbound text messages with a body. Drafts, never auto-sends.
    if (isInbound && body && String(body).trim().length > 1) {
      try {
        var draft = draftCsReply(body, matchedCust, matchedShip, from);

        // ── CS INBOX: upsert thread + log message (new system) ──
        try {
          var custId = '';
          var m = String(matchedCust||'').match(/\((CUST-[^)]+)\)/);
          if (m) custId = m[1];
          var thread = csUpsertInboundThread(from, body, matchedCust, custId, matchedShip, draft);
          if (thread && thread.thread_id) csLogMessage(thread.thread_id, from, 'inbound', body, '');
        } catch(csErr) { Logger.log('CS thread upsert error: ' + csErr); }

        if (draft) {
          var who = matchedCust || ('Unknown number');
          var fromDigits = String(from).replace(/\D/g,'');
          var subj = '📩 CS draft — ' + who + (draft.flag ? (' ⚠ ' + draft.flag.toUpperCase()) : '');
          var flagLine = draft.flag
            ? '<div style="background:#FFF3CD;border:1px solid #E0B000;border-radius:6px;padding:10px 14px;margin:0 0 14px;color:#7A5C00;font-weight:bold;">⚠ JUDGMENT CALL (' + draft.flag + ') — review carefully before sending.</div>'
            : '';
          var ctxLine = matchedShip ? ('<div style="color:#666;font-size:14px;margin:2px 0 0;">' + matchedShip + '</div>') : '';
          var htmlBody =
            '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1A1816;">' +
            flagLine +
            '<div style="font-size:15px;"><strong>' + who + '</strong> &nbsp;·&nbsp; ' +
              '<a href="sms:+' + fromDigits + '" style="color:#C8953C;">' + from + '</a></div>' +
            ctxLine +
            '<div style="background:#F4F4F2;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
              '<div style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">They said</div>' +
              '<div style="font-size:15px;">' + String(body) + '</div>' +
            '</div>' +
            '<div style="background:#FFFCF5;border:1px solid #C8953C;border-radius:8px;padding:14px 16px;margin:14px 0;">' +
              '<div style="font-size:12px;color:#C8953C;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:bold;">Suggested reply</div>' +
              '<div style="font-size:16px;line-height:1.5;">' + draft.text + '</div>' +
            '</div>' +
            '<div style="font-size:13px;color:#999;margin-top:8px;">Copy the reply above, tweak if needed, and send from OpenPhone. Tap the number to text them.</div>' +
            '</div>';
          GmailApp.sendEmail(DRAFT_REVIEW_EMAIL, subj,
            who + '\n' + from + '\n\nThey said: ' + body + '\n\nSuggested reply:\n' + draft.text + (draft.flag ? ('\n\n⚠ JUDGMENT CALL: ' + draft.flag) : ''),
            { htmlBody: htmlBody, name: 'Snappy CS Assistant' });
          // Log the draft alongside the inbound row for a paper trail.
          tab.getRange(tab.getLastRow(), 9).setValue('DRAFT: ' + draft.text + (draft.flag ? (' [FLAG:'+draft.flag+']') : ''));
        }
      } catch(dErr) {
        Logger.log('draft error: ' + dErr);
      }
    }

    return jsonResponse({ success: true, logged: true, inbound: isInbound });
  } catch (err) {
    // Still 200 so OpenPhone doesn't retry-storm; log the failure
    try { SpreadsheetApp.openById(SHEET_ID).getSheetByName('SMS Inbound')
      .appendRow([new Date(), 'ERROR', '', '', String(err), '', '', '']); } catch(e2){}
    return jsonResponse({ success: false, error: String(err) });
  }
}


// ── Pull recent OpenPhone message history → 'SMS History' tab ──
// Harvests your real sent/received texts so we can learn your tone + common Qs.
// Run pullSmsHistory() from the editor. Writes to a sheet tab for review.
function pullSmsHistory() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tab = ss.getSheetByName('SMS History');
  if (!tab) { tab = ss.insertSheet('SMS History'); }
  tab.clear();
  tab.appendRow(['created_at','direction','from','to','body']);

  // First get your OpenPhone number id(s)
  var headers = { 'Authorization': QUO_API_KEY };
  var phoneNumberIds = [];
  try {
    var pnRes = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers', { headers: headers, muteHttpExceptions: true });
    var pnData = JSON.parse(pnRes.getContentText());
    (pnData.data || []).forEach(function(p){ phoneNumberIds.push(p.id); });
    Logger.log('Phone number IDs: ' + JSON.stringify(phoneNumberIds));
  } catch(e) { Logger.log('phone-numbers fetch failed: ' + e); }

  if (!phoneNumberIds.length) { Logger.log('No phone numbers found — check API key/permissions.'); return; }

  var pnId = phoneNumberIds[0];
  var total = 0;

  // Step 1: list recent conversations for this number
  var convs = [];
  try {
    var cRes = UrlFetchApp.fetch('https://api.openphone.com/v1/conversations?phoneNumberId=' + encodeURIComponent(pnId) + '&maxResults=50',
      { headers: headers, muteHttpExceptions: true });
    var cCode = cRes.getResponseCode();
    var cData = JSON.parse(cRes.getContentText());
    if (cCode !== 200) { Logger.log('conversations HTTP ' + cCode + ': ' + cRes.getContentText().slice(0,300)); }
    else { convs = cData.data || []; Logger.log('Found ' + convs.length + ' conversations'); }
  } catch(e) { Logger.log('conversations fetch error: ' + e); }

  // Step 2: for each conversation, fetch its messages using participants
  convs.forEach(function(conv){
    // a conversation's "participants" are the phone numbers in the thread (excludes your own typically)
    var parts = conv.participants || [];
    if (!parts.length && conv.phoneNumber) parts = [conv.phoneNumber];
    if (!parts.length) return;
    try {
      var qs = 'phoneNumberId=' + encodeURIComponent(pnId) + '&maxResults=50';
      parts.forEach(function(p){ qs += '&participants[]=' + encodeURIComponent(p); });
      var mRes = UrlFetchApp.fetch('https://api.openphone.com/v1/messages?' + qs, { headers: headers, muteHttpExceptions: true });
      var mCode = mRes.getResponseCode();
      if (mCode !== 200) { Logger.log('  msgs HTTP ' + mCode + ' for ' + JSON.stringify(parts) + ': ' + mRes.getContentText().slice(0,160)); return; }
      var mData = JSON.parse(mRes.getContentText());
      (mData.data || []).forEach(function(m){
        tab.appendRow([ m.createdAt||'', m.direction||'', m.from||'', (Array.isArray(m.to)?m.to.join(','):m.to)||'', m.text||m.body||'' ]);
        total++;
      });
      Utilities.sleep(120); // gentle pacing
    } catch(e) { Logger.log('  msgs error for ' + JSON.stringify(parts) + ': ' + e); }
  });

  Logger.log('Pulled ' + total + ' messages from ' + convs.length + ' conversations → "SMS History" tab.');
}


// ═══════════════════════════════════════════════════════════════════════
//  CS DRAFT ASSISTANT — Phase 2: draft replies in David's voice via Claude
// ═══════════════════════════════════════════════════════════════════════

// Where draft replies get sent for review (David's personal cell).
// TODO: set this to David's real mobile number (NOT the OpenPhone business line).
var DRAFT_REVIEW_PHONE = '';  // e.g. '15615551234'  (legacy — email is used now)

// Draft replies are emailed here for review (reliable; no carrier restrictions).
var DRAFT_REVIEW_EMAIL = 'davidisaacweiss@yahoo.com';

// Categories that need David's judgment — drafted but flagged, never trusted blindly.
function _csFlagCategory(inboundText) {
  var t = String(inboundText || '').toLowerCase();
  if (/lost|didn'?t (get|receive)|never (got|arrived)|missing/.test(t)) return 'lost package';
  if (/lower|less than|estimate|why.*(so )?low|disappoint|expected more|worth more/.test(t)) return 'offer dispute';
  if (/\$\d|offer|counter|come up|meet me|how much|price|haggle|negotiat/.test(t)) return 'negotiation';
  if (/fake|not real|misrepresent|scam|fraud|wrong/.test(t)) return 'authenticity';
  if (/refund|complain|unhappy|angry|upset|attorney|lawyer|bbb|report/.test(t)) return 'complaint';
  if (/send.*back|return|cancel|changed my mind/.test(t)) return 'return request';
  return '';  // no flag → routine, safe to draft normally
}

// The playbook (David's voice + rules), passed to Claude as the system prompt.
var CS_PLAYBOOK = [
  "You draft SMS replies for David, who runs Snappy Gold, a mail-in gold/jewelry buying business in Delray Beach FL. Customers photograph items, get a preliminary AI estimate, get a prepaid label, mail items in, and receive a firm cash offer after in-hand inspection. You draft; David reviews and sends. You NEVER send on your own.",
  "VOICE: Casual, warm, efficient — text like a real person, not a brand. Always use contractions. Keep it SHORT, usually one or two sentences. Light emoji sparingly (:) or ;) occasionally, max one, not every message). Radical honesty is the signature — tell the real deal even when unflattering. Explain the WHY when relevant. Ask ONE clear question at a time. Lowercase sentence starts are fine in casual replies. Sign with nothing or '— David', not every text.",
  "HARD RULES: NEVER quote a firm/binding price — estimates are preliminary, the binding offer comes after in-hand inspection. Don't over-promise timelines. Encourage gold 10k+; be honest that costume/plated/silver-only often isn't worth the shipping.",
  "KEY EXPLANATIONS you can use: the online estimate guesses weight from a photo and isn't foolproof; stones usually aren't worth much on the secondary market; offers are based on gold content; gold prices move (was ~$5,500/oz in Feb, ~$4,000 now).",
  "COMMON SITUATIONS: (1) 'is it gold/do you buy X' → ask karat + stamp, steer to gold. (2) label problems → reassure, offer to resend, mention they can print from phone at a post office/FedEx Office/CVS. (3) insurance → $100 default, can add more, reassure. (4) 'got my package/when paid' → warm status update. (5) 'anything else?' → invite more items, combining in one shipment is preferred (label costs the same). (6) review ask after a good interaction → BBB link: https://www.bbb.org/us/fl/delray-beach/profile/jewelry-buyers/snappy-gold-0633-92063874/leave-a-review",
  "OUTPUT: Return ONLY the SMS text David would send. No preamble, no 'Here's a draft', no surrounding quotes. Short, warm, honest, human."
].join('\n\n');

// Call Claude to draft a reply. Returns { text, flag } or null.
// Fetch recent message history with one phone number, most recent last.
// Returns an array of { direction, body } or [] on failure.
function _fetchThreadWith(phone) {
  try {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) return [];
    var plus = '+' + (digits.length === 10 ? '1' + digits : digits);
    var headers = { 'Authorization': QUO_API_KEY };
    var url = 'https://api.openphone.com/v1/messages?phoneNumberId=PNLV8nQUqK&participants[]=' +
      encodeURIComponent(plus) + '&maxResults=15';
    var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return [];
    var data = JSON.parse(res.getContentText());
    var msgs = (data.data || []).map(function(m){
      return { direction: m.direction, body: m.text || m.body || '', createdAt: m.createdAt || '' };
    }).filter(function(m){ return m.body; });
    // oldest first
    msgs.sort(function(a, b){ return String(a.createdAt).localeCompare(String(b.createdAt)); });
    return msgs;
  } catch (e) {
    Logger.log('_fetchThreadWith error: ' + e);
    return [];
  }
}

function draftCsReply(inboundText, matchedCust, matchedShip, fromPhone) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) { Logger.log('No ANTHROPIC_API_KEY script property set — skipping draft.'); return null; }

  var flag = _csFlagCategory(inboundText);
  var ctxLines = [];
  if (matchedCust) ctxLines.push('Customer: ' + matchedCust);
  if (matchedShip) ctxLines.push('Their shipment: ' + matchedShip);
  if (!matchedCust) ctxLines.push('(Unrecognized number — no CRM match. They may be a new lead.)');
  var contextBlock = ctxLines.join('\n');

  // Pull the recent SMS thread so the draft is aware of the ongoing conversation.
  var thread = _fetchThreadWith(fromPhone);
  var threadBlock = '';
  if (thread.length) {
    // Drop the very last inbound if it duplicates the message we're drafting for.
    var lines = thread.map(function(m){
      var who = (m.direction === 'incoming' || m.direction === 'inbound') ? 'Customer' : 'David';
      return who + ': ' + m.body;
    });
    threadBlock = '\n\nRecent conversation (oldest first) — use this so your reply fits the thread:\n' +
      lines.join('\n');
  }

  var userMsg =
    'Here is the customer context:\n' + contextBlock +
    threadBlock +
    '\n\nThe customer just texted:\n"' + String(inboundText).trim() + '"' +
    '\n\nDraft David\'s reply in his voice, taking the conversation above into account (do NOT ask what they\'re replying to if the thread makes it clear). Return only the SMS text.';

  var payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 350,
    system: CS_PLAYBOOK,
    messages: [{ role: 'user', content: userMsg }]
  };

  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) { Logger.log('Claude draft HTTP ' + code + ': ' + res.getContentText().slice(0,300)); return null; }
    var data = JSON.parse(res.getContentText());
    var text = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text.trim() : '';
    if (!text) return null;
    return { text: text, flag: flag };
  } catch (err) {
    Logger.log('draftCsReply error: ' + err);
    return null;
  }
}

// ── Test the drafter end-to-end without an inbound text ──
function testDraft() {
  var d = draftCsReply(
    "Why is your offer so much lower than the estimate I got online? It said $400.",
    'Sally Test (CUST-9999)',
    'SHP-999 · pending_response · 14K amethyst ring',
    '15550001234'
  );
  Logger.log(JSON.stringify(d, null, 2));
}

// ── Diagnostic: stage breakdown + defer status. Run stageBreakdown() in editor. ──
function stageBreakdown() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var byStage = {}, deferredInFulfill = 0, fulfillActive = 0, fulfillDeferred = [];
  rows.forEach(function(r){
    var st = String(r.stage||'(blank)');
    byStage[st] = (byStage[st]||0) + 1;
    if (st === 'ready_to_fulfill') {
      var isDef = !!String(r.deferred_at||'').trim();
      if (isDef) { fulfillDeferred.push(r.shipment_id + ' (deferred ' + r.deferred_at + ')'); }
      else { fulfillActive++; }
    }
  });
  Logger.log('═══ STAGE BREAKDOWN (' + rows.length + ' shipments) ═══');
  Object.keys(byStage).sort().forEach(function(s){ Logger.log('  ' + s + ': ' + byStage[s]); });
  Logger.log('─────────────');
  Logger.log('ready_to_fulfill ACTIVE (should show in Fulfill): ' + fulfillActive);
  Logger.log('ready_to_fulfill DEFERRED (hidden in Deferred tab): ' + fulfillDeferred.length);
  fulfillDeferred.forEach(function(x){ Logger.log('    • ' + x); });
  // Most recent few shipments — are new leads even landing as ready_to_fulfill?
  rows.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
  Logger.log('─── 5 most recent shipments ───');
  rows.slice(0,5).forEach(function(r){ Logger.log('  ' + (r.created_at||'?').slice(0,16) + ' · ' + r.shipment_id + ' · ' + r.stage + (String(r.deferred_at||'').trim()?' · DEFERRED':'')); });
}

// Show the 15 most recent shipments with full timestamps — is intake still flowing?
function recentShipments15() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  rows.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
  Logger.log('═══ 15 MOST RECENT SHIPMENTS (by created_at) ═══');
  Logger.log('Now: ' + new Date().toISOString());
  rows.slice(0,15).forEach(function(r){
    Logger.log((r.created_at||'?') + ' · ' + r.shipment_id + ' · ' + r.stage +
      (String(r.deferred_at||'').trim()?' · DEFERRED':'') +
      ' · ' + String(r.item||'').slice(0,30));
  });
}

// Show recent Lead Intake rows — the raw submissions before they become shipments.
function recentLeadIntake() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.LEADS);
  var rows = sheet.getDataRange().getValues();
  Logger.log('═══ LEAD INTAKE — last 20 rows of ' + (rows.length-1) + ' (Now: ' + new Date().toISOString() + ') ═══');
  var start = Math.max(1, rows.length - 20);
  for (var i = rows.length - 1; i >= start; i--) {
    var r = rows[i];
    Logger.log(
      (r[COL.TIMESTAMP]||'?') + ' · ' +
      'type=' + (r[COL.TYPE]||'') + ' · ' +
      (r[COL.EMAIL]||'(no email)') + ' · ' +
      'addr=' + (String(r[COL.ADDRESS]||'').trim()?'YES':'no') + ' · ' +
      'variant=' + (r[COL.VARIANT]||'') + ' · ' +
      String(r[COL.ITEM]||'').slice(0,30)
    );
  }
}

// Diagnose why a customer didn't get their label SMS. Run auditMichelinePhone().
function auditCustomerPhone(phoneOrName) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var q = String(phoneOrName||'').toLowerCase();
  var qDigits = q.replace(/\D/g,'');
  var hits = custs.filter(function(c){
    var cd = String(c.phone||'').replace(/\D/g,'');
    return (qDigits && cd.indexOf(qDigits.slice(-10)) !== -1) ||
           (String(c.name||'').toLowerCase().indexOf(q) !== -1);
  });
  if (!hits.length) { Logger.log('No customer match for: ' + phoneOrName); return; }
  hits.forEach(function(c){
    Logger.log('─── ' + c.name + ' (' + c.customer_id + ') ───');
    Logger.log('phone on customer record: "' + (c.phone||'') + '"  digits=' + String(c.phone||'').replace(/\D/g,'').length);
    var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return String(s.customer_id)===String(c.customer_id); });
    ships.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
    ships.slice(0,3).forEach(function(s){
      Logger.log('  ' + s.shipment_id + ' · ' + s.stage + ' · type=' + s.shipping_type +
        ' · tracking=' + (s.outbound_tracking||'—') +
        ' · svc=' + (s.shipping_service||'—') +
        ' · created=' + (s.created_at||'').slice(0,16));
    });
  });
}
function auditMichelinePhone(){ return auditCustomerPhone('micheline'); }

// Inspect a shipment's ship-to address to debug label/ZIP failures.
function auditShipmentAddress(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(r){ return String(r.shipment_id)===String(shipmentId); })[0];
  if (!s) { Logger.log('Not found: ' + shipmentId); return; }
  Logger.log('─── ' + shipmentId + ' address ───');
  Logger.log('customer_id: ' + s.customer_id);
  Logger.log('address (raw): "' + (s.address||'') + '"');
  Logger.log('shipping_type: ' + s.shipping_type + ' · stage: ' + s.stage);
  // Also pull the customer record address if present
  var c = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).filter(function(r){ return String(r.customer_id)===String(s.customer_id); })[0];
  if (c) {
    Logger.log('── customer record ──');
    Logger.log('name: ' + c.name);
    Logger.log('address: "' + (c.address||'') + '"');
    Logger.log('city: "' + (c.city||'') + '" state: "' + (c.state||'') + '" zip: "' + (c.zip||'') + '"');
  }
}
function audit978addr(){ return auditShipmentAddress('SHP-978'); }


// ═══════════════════════════════════════════════════════════════════════
//  LISTING MODULE — backend (Phase 1: composer + tracker, channels later)
//  A "listing" is a resale record for a piece: title, price, description,
//  photos, category/specifics, and per-channel status. Channels (Shopify/
//  eBay) get wired in a later phase; for now we compose, store, and track.
// ═══════════════════════════════════════════════════════════════════════

var LISTINGS_TAB = 'Listings';
var LISTING_HEADERS = [
  'listing_id','created_at','updated_at','source_shipment_id','source_customer_id',
  'title','description','price','category','condition',
  'metal','karat','gemstone','weight_grams','brand','item_specifics_json',
  'photos_json','status',
  'shopify_status','shopify_product_id','shopify_url',
  'ebay_status','ebay_listing_id','ebay_url',
  'sold_channel','sold_at','notes'
];

function _listingsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(LISTINGS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LISTINGS_TAB);
    sheet.appendRow(LISTING_HEADERS);
  }
  return sheet;
}

// Create a listing draft. data = { title, price, description, photos:[], ...,
// source_shipment_id? }. Returns the created listing.
function createListing(data) {
  var sheet = _listingsSheet();
  var now = new Date().toISOString();
  var id = 'LST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  var row = {
    listing_id: id, created_at: now, updated_at: now,
    source_shipment_id: data.source_shipment_id || '',
    source_customer_id: data.source_customer_id || '',
    title: data.title || '', description: data.description || '',
    price: data.price || '', category: data.category || '', condition: data.condition || 'Pre-owned',
    metal: data.metal || '', karat: data.karat || '', gemstone: data.gemstone || '',
    weight_grams: data.weight_grams || '', brand: data.brand || '',
    item_specifics_json: JSON.stringify(data.item_specifics || {}),
    photos_json: JSON.stringify(data.photos || []),
    status: 'draft',
    shopify_status: 'not_listed', shopify_product_id: '', shopify_url: '',
    ebay_status: 'not_listed', ebay_listing_id: '', ebay_url: '',
    sold_channel: '', sold_at: '', notes: data.notes || ''
  };
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }));
  return row;
}

// Update a listing by id with a partial object of fields.
function updateListing(listingId, updates) {
  var sheet = _listingsSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('listing_id');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(listingId)) {
      Object.keys(updates).forEach(function(k){
        var c = headers.indexOf(k);
        if (c >= 0) sheet.getRange(r+1, c+1).setValue(updates[k]);
      });
      var uc = headers.indexOf('updated_at');
      if (uc >= 0) sheet.getRange(r+1, uc+1).setValue(new Date().toISOString());
      return { success: true, listing_id: listingId };
    }
  }
  return { success: false, error: 'Listing not found: ' + listingId };
}

// List all listings (optionally filter by status).
function getListings(filterStatus) {
  var rows = sheetToObjects(_listingsSheet());
  if (filterStatus) rows = rows.filter(function(r){ return r.status === filterStatus; });
  rows.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
  return rows;
}

// Prefill a listing draft FROM an existing shipment (photos, item, appraised).
function composeFromShipment(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(r){ return String(r.shipment_id)===String(shipmentId); })[0];
  if (!s) return { success: false, error: 'Shipment not found' };
  // gather photos linked to this shipment
  var photos = [];
  try {
    photos = sheetToObjects(ss.getSheetByName(TAB.PHOTOS))
      .filter(function(p){ return String(p.shipment_id)===String(shipmentId); })
      .map(function(p){ return p.drive_url || p.url || ''; })
      .filter(Boolean);
  } catch(e){}
  // appraised value → suggested starting price (you'll set the real retail price)
  var suggested = parseFloat(s.appraised_value) || '';
  return {
    success: true,
    prefill: {
      source_shipment_id: s.shipment_id,
      source_customer_id: s.customer_id || '',
      title: s.item || '',
      description: s.item || '',
      price: suggested,
      photos: photos,
      condition: 'Pre-owned'
    }
  };
}

// Diagnose a specific shipment's carrier situation: what type was requested,
// and what rates Shippo actually returns for that customer's address.
function diagnoseShipmentCarrier(shipmentId) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(r){ return String(r.shipment_id)===String(shipmentId); })[0];
  if (!s) { Logger.log('Not found: ' + shipmentId); return; }
  Logger.log('─── ' + shipmentId + ' ───');
  Logger.log('shipping_type (raw): "' + (s.shipping_type||'') + '"');
  Logger.log('→ interpreted as: ' + (normalizeShipType(s.shipping_type) || '(blank — Fulfill refuses to generate a label)'));

  var c = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).filter(function(r){ return String(r.customer_id)===String(s.customer_id); })[0];
  var addr = c ? (c.address||'') : '';
  Logger.log('customer address: "' + addr + '"');

  // Ask Shippo what rates exist for this exact address
  var parsed = _parseUsAddress(addr);
  Logger.log('parsed: street="' + parsed.street1 + '" city="' + parsed.city + '" state="' + parsed.state + '" zip="' + parsed.zip + '"');

  var shipPayload = {
    address_from: SHIP_FROM,
    address_to: { name: (c&&c.name)||'Customer', street1: parsed.street1, city: parsed.city, state: parsed.state, zip: parsed.zip, country: 'US', phone: '5617026269', email: 'test@example.com' },
    parcels: [{ length: 9, width: 6, height: 2, distance_unit: 'in', weight: 8, mass_unit: 'oz' }],
    extra: { is_return: true, reference_1: shipmentId },
    async: false,
  };
  try {
    var r = UrlFetchApp.fetch('https://api.goshippo.com/shipments/', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'ShippoToken ' + SHIPPO_API_KEY },
      payload: JSON.stringify(shipPayload), muteHttpExceptions: true,
    });
    var d = JSON.parse(r.getContentText());
    var rates = d.rates || [];
    Logger.log('── ' + rates.length + ' rates for THIS address ──');
    var carriers = {};
    rates.forEach(function(rt){ carriers[rt.provider] = (carriers[rt.provider]||0)+1; });
    Logger.log('carriers present: ' + JSON.stringify(carriers));
    rates.forEach(function(rt){ Logger.log('  ' + rt.provider + ' / ' + (rt.servicelevel&&rt.servicelevel.token) + ' — $' + rt.amount); });
    // show FedEx/USPS-relevant messages
    (d.messages||[]).forEach(function(m){
      var t = m.text || '';
      if (/fedex|usps|ground|return|zip|address/i.test(t)) Logger.log('  MSG: ' + t);
    });
  } catch(e){ Logger.log('rate check failed: ' + e); }
}
function diag984(){ return diagnoseShipmentCarrier('SHP-984'); }

// Search ALL customers/shipments by any address fragment. Run searchByAddress('3555 mosswood').
function searchByAddress(fragment) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var q = String(fragment||'').toLowerCase().replace(/\s+/g,' ').trim();
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var hits = custs.filter(function(c){
    var a = String(c.address||'').toLowerCase();
    // also try matching individual words so partial/typo'd searches still surface
    return a.indexOf(q) !== -1 || q.split(' ').every(function(w){ return w.length>2 && a.indexOf(w)!==-1; });
  });
  Logger.log('═══ address search "' + fragment + '" — ' + hits.length + ' customer(s) ═══');
  hits.forEach(function(c){
    Logger.log('─ ' + c.name + ' (' + c.customer_id + ') · ' + (c.address||'(no address field)'));
    var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return String(s.customer_id)===String(c.customer_id); });
    ships.forEach(function(s){ Logger.log('    ' + s.shipment_id + ' · ' + s.stage + ' · ' + String(s.item||'').slice(0,40)); });
  });
  if (!hits.length) Logger.log('No customer address contained that fragment. The address may be stored only in the shipment row or be blank on the customer record.');
}
function findMosswood(){ return searchByAddress('3555 mosswood'); }

// Find a customer by name and dump their address + shipments (for label failures).
function auditByName(nameFragment) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var q = String(nameFragment||'').toLowerCase();
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).filter(function(c){ return String(c.name||'').toLowerCase().indexOf(q)!==-1; });
  Logger.log('═══ "' + nameFragment + '" — ' + custs.length + ' match(es) ═══');
  custs.forEach(function(c){
    Logger.log('─ ' + c.name + ' (' + c.customer_id + ')');
    Logger.log('   address: "' + (c.address||'') + '"');
    Logger.log('   city:"' + (c.city||'') + '" state:"' + (c.state||'') + '" zip:"' + (c.zip||'') + '" phone:"' + (c.phone||'') + '"');
    var parsed = _parseUsAddress(c.address||'');
    Logger.log('   parsed → street:"' + parsed.street1 + '" city:"' + parsed.city + '" state:"' + parsed.state + '" zip:"' + parsed.zip + '"');
    var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return String(s.customer_id)===String(c.customer_id); });
    ships.forEach(function(s){ Logger.log('   ' + s.shipment_id + ' · ' + s.stage + ' · type=' + s.shipping_type); });
  });
}
function auditAshley(){ return auditByName('ashley flores'); }

// Broad hunt: find "ashley" anywhere — customers, shipments, leads.
function findAshley() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var q = 'ashley';
  Logger.log('═══ CUSTOMERS with "ashley" ═══');
  sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).forEach(function(c){
    if (String(c.name||'').toLowerCase().indexOf(q)!==-1) {
      Logger.log('  ' + c.name + ' (' + c.customer_id + ') addr:"' + (c.address||'') + '" zip:"' + (c.zip||'') + '"');
    }
  });
  Logger.log('═══ SHIPMENTS with "ashley" in any field ═══');
  sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).forEach(function(s){
    var blob = JSON.stringify(s).toLowerCase();
    if (blob.indexOf(q)!==-1) {
      Logger.log('  ' + s.shipment_id + ' · cust=' + s.customer_id + ' · stage=' + s.stage + ' · type=' + s.shipping_type + ' · item=' + String(s.item||'').slice(0,30));
    }
  });
  Logger.log('═══ LEADS with "ashley" ═══');
  try {
    var sheet = ss.getSheetByName(TAB.LEADS);
    var rows = sheet.getDataRange().getValues();
    for (var i=1;i<rows.length;i++){
      if (JSON.stringify(rows[i]).toLowerCase().indexOf(q)!==-1) {
        Logger.log('  row ' + (i+1) + ': ' + rows[i][COL.EMAIL] + ' · ' + String(rows[i][COL.ADDRESS]||'').slice(0,50));
      }
    }
  } catch(e){ Logger.log('leads scan: '+e); }
}

// Weekend CS dig-out: list genuine inbound texts needing a reply, newest first.
// Filters OUT auto-replies and shows who actually messaged in.
function csNeedsReply(hoursBack) {
  hoursBack = hoursBack || 96; // default: last 4 days (covers a weekend)
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tab = ss.getSheetByName('SMS Inbound');
  if (!tab) { Logger.log('No SMS Inbound tab yet.'); return; }
  var rows = sheetToObjects(tab);
  var cutoff = new Date(Date.now() - hoursBack*3600*1000);
  var hits = rows.filter(function(r){
    var ts = new Date(r.received_at || r.created_at || 0);
    if (ts < cutoff) return false;
    var body = String(r.body||'').trim().toLowerCase();
    if (!body) return false;
    // filter out our own auto-reply if it ever got logged
    if (body.indexOf('get back to you in a snap') !== -1) return false;
    return true;
  });
  hits.sort(function(a,b){ return String(b.received_at||'').localeCompare(String(a.received_at||'')); });
  Logger.log('═══ ' + hits.length + ' inbound message(s) in last ' + hoursBack + 'h ═══');
  hits.forEach(function(r){
    var who = r.matched_customer || ('Unknown ' + (r.from||''));
    var ship = r.matched_shipment ? (' · ' + r.matched_shipment) : '';
    Logger.log('• ' + String(r.received_at||'').slice(0,16) + ' | ' + who + ship);
    Logger.log('    "' + String(r.body||'').slice(0,120) + '"');
  });
}
function csWeekend(){ return csNeedsReply(96); }


// ═══════════════════════════════════════════════════════════════════════
//  CS INBOX — Phase 1: data layer + triage
//  Turns the flat inbound stream into per-customer THREADS with a status,
//  so the CRM can show a clean "needs reply" queue instead of raw slop.
//
//  Two sheets:
//   • "CS Threads"  — one row per conversation (status, draft, previews)
//   • "CS Messages" — every message (inbound + our sent), linked by thread_id
// ═══════════════════════════════════════════════════════════════════════

var CS_THREADS_TAB  = 'CS Threads';
var CS_MESSAGES_TAB = 'CS Messages';

// Cache the spreadsheet handle within a single execution to avoid repeatedly
// re-opening a large document (which was causing Spreadsheet timeouts).
var _csSS = null;
function _csGetSS() {
  if (!_csSS) _csSS = SpreadsheetApp.openById(SHEET_ID);
  return _csSS;
}

var CS_THREAD_HEADERS = [
  'thread_id','phone','matched_customer','customer_id','matched_shipment',
  'status','unread','last_message_at','last_inbound_at','last_message_preview',
  'last_direction','draft','flag','snooze_until','created_at','updated_at'
];
var CS_MESSAGE_HEADERS = [
  'message_id','thread_id','phone','direction','body','created_at','sent_by'
];

// Run ONCE to create the CS sheets cleanly (avoids insertSheet timing out
// mid-operation under load). Safe to re-run.
function setupCsSheets() {
  var ss = _csGetSS();
  if (!ss.getSheetByName(CS_THREADS_TAB))  { ss.insertSheet(CS_THREADS_TAB).appendRow(CS_THREAD_HEADERS); Logger.log('Created ' + CS_THREADS_TAB); }
  else Logger.log(CS_THREADS_TAB + ' already exists');
  if (!ss.getSheetByName(CS_MESSAGES_TAB)) { ss.insertSheet(CS_MESSAGES_TAB).appendRow(CS_MESSAGE_HEADERS); Logger.log('Created ' + CS_MESSAGES_TAB); }
  else Logger.log(CS_MESSAGES_TAB + ' already exists');
  Logger.log('CS sheets ready.');
}

function _csThreadsSheet() {
  var ss = _csGetSS();
  var sh = ss.getSheetByName(CS_THREADS_TAB);
  if (!sh) { sh = ss.insertSheet(CS_THREADS_TAB); sh.appendRow(CS_THREAD_HEADERS); }
  return sh;
}
function _csMessagesSheet() {
  var ss = _csGetSS();
  var sh = ss.getSheetByName(CS_MESSAGES_TAB);
  if (!sh) { sh = ss.insertSheet(CS_MESSAGES_TAB); sh.appendRow(CS_MESSAGE_HEADERS); }
  return sh;
}

// Normalize a phone to last-10 digits for matching/threading.
function _phoneKey(phone) { return String(phone||'').replace(/\D/g,'').slice(-10); }

// Conservative noise classifier. Returns true if a message is pure
// acknowledgment/noise that does NOT need a human reply. Deliberately SHORT
// and safe — anything ambiguous returns false (surfaces to the queue).
function _csIsNoise(body) {
  var t = String(body||'').trim().toLowerCase();
  if (!t) return true;
  // strip trailing punctuation/emoji-ish
  var stripped = t.replace(/[!.…\s]+$/,'').replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/gu,'').trim();
  var noiseExact = [
    'ok','okay','k','kk','thanks','thank you','thx','ty','tysm','thank u',
    'got it','great','perfect','awesome','sounds good','will do','yes','yep',
    'yup','no','nope','cool','done','ok thanks','okay thanks','thanks!','👍','🙏','❤️'
  ];
  if (noiseExact.indexOf(stripped) !== -1) return true;
  // emoji-only / very short reactions
  if (stripped.length <= 2 && !/[a-z0-9]/.test(stripped)) return true;
  return false;
}

// Upsert a thread on new INBOUND message. Returns the thread row object.
function csUpsertInboundThread(phone, body, matchedCust, customerId, matchedShip, draftObj) {
  var sh = _csThreadsSheet();
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var key = _phoneKey(phone);
  var now = new Date().toISOString();
  var isNoise = _csIsNoise(body);
  var preview = String(body||'').slice(0, 80);

  // find existing thread by phone key
  var phoneCol = headers.indexOf('phone');
  var rowIdx = -1;
  for (var r = 1; r < data.length; r++) {
    if (_phoneKey(data[r][phoneCol]) === key) { rowIdx = r; break; }
  }

  function setCell(rowNum, field, val) {
    var c = headers.indexOf(field);
    if (c >= 0) sh.getRange(rowNum, c+1).setValue(val);
  }

  if (rowIdx === -1) {
    // new thread
    var id = 'CST-' + key + '-' + Math.random().toString(36).slice(2,5).toUpperCase();
    var row = {
      thread_id: id, phone: phone, matched_customer: matchedCust||'', customer_id: customerId||'',
      matched_shipment: matchedShip||'',
      status: isNoise ? 'resolved' : 'needs_reply',
      unread: isNoise ? '' : 'yes',
      last_message_at: now, last_inbound_at: now, last_message_preview: preview,
      last_direction: 'inbound',
      draft: (draftObj && !isNoise) ? draftObj.text : '',
      flag: (draftObj && draftObj.flag) || '',
      snooze_until: '', created_at: now, updated_at: now
    };
    sh.appendRow(headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }));
    return row;
  } else {
    var rowNum = rowIdx + 1;
    // update existing thread
    setCell(rowNum, 'last_message_at', now);
    setCell(rowNum, 'last_inbound_at', now);
    setCell(rowNum, 'last_message_preview', preview);
    setCell(rowNum, 'last_direction', 'inbound');
    setCell(rowNum, 'updated_at', now);
    if (matchedCust) setCell(rowNum, 'matched_customer', matchedCust);
    if (customerId)  setCell(rowNum, 'customer_id', customerId);
    if (matchedShip) setCell(rowNum, 'matched_shipment', matchedShip);
    if (!isNoise) {
      // a real message reopens the thread and refreshes the draft
      setCell(rowNum, 'status', 'needs_reply');
      setCell(rowNum, 'unread', 'yes');
      if (draftObj) { setCell(rowNum, 'draft', draftObj.text); setCell(rowNum, 'flag', draftObj.flag||''); }
    }
    // read back the row
    var updated = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    var obj = {}; headers.forEach(function(h,i){ obj[h] = updated[i]; });
    return obj;
  }
}

// Log a message (inbound or sent) to the CS Messages sheet.
function csLogMessage(threadId, phone, direction, body, sentBy) {
  var sh = _csMessagesSheet();
  var id = 'MSG-' + Date.now() + '-' + Math.random().toString(36).slice(2,5);
  sh.appendRow([id, threadId||'', phone||'', direction||'', body||'', new Date().toISOString(), sentBy||'']);
  return id;
}

// ── Read APIs for the CRM (Phase 2 will call these) ──

// Get threads, optionally filtered by status. Newest inbound first.
// Excludes snoozed-into-the-future unless status='snoozed' requested.
function getCsThreads(status) {
  var rows = sheetToObjects(_csThreadsSheet());
  var now = new Date().toISOString();
  rows = rows.filter(function(t){
    // wake snoozed threads whose time has passed
    if (t.status === 'snoozed' && t.snooze_until && t.snooze_until <= now) { t.status = 'needs_reply'; }
    return true;
  });
  if (status && status !== 'all') rows = rows.filter(function(t){ return t.status === status; });
  rows.sort(function(a,b){ return String(b.last_inbound_at||b.last_message_at||'').localeCompare(String(a.last_inbound_at||a.last_message_at||'')); });
  return rows;
}

// Get the full message log for one thread, oldest first.
function getCsThreadMessages(threadId) {
  var rows = sheetToObjects(_csMessagesSheet()).filter(function(m){ return String(m.thread_id)===String(threadId); });
  rows.sort(function(a,b){ return String(a.created_at||'').localeCompare(String(b.created_at||'')); });
  return rows;
}

// Update a thread's status/fields (used by Send/Snooze/Resolve in Phase 3).
function updateCsThread(threadId, updates) {
  var sh = _csThreadsSheet();
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('thread_id');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(threadId)) {
      Object.keys(updates).forEach(function(k){
        var c = headers.indexOf(k);
        if (c >= 0) sh.getRange(r+1, c+1).setValue(updates[k]);
      });
      var uc = headers.indexOf('updated_at'); if (uc>=0) sh.getRange(r+1, uc+1).setValue(new Date().toISOString());
      return { success: true };
    }
  }
  return { success: false, error: 'Thread not found' };
}

// Count of threads needing reply (for a nav badge).
function getCsNeedsReplyCount() {
  return sheetToObjects(_csThreadsSheet()).filter(function(t){ return t.status === 'needs_reply'; }).length;
}

// Backfill CS Threads from the existing 'SMS Inbound' log (one-time / re-runnable).
// Groups historical inbound messages into threads so the queue isn't empty on launch.
function backfillCsThreads() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var inbound = ss.getSheetByName('SMS Inbound');
  if (!inbound) { Logger.log('No SMS Inbound tab.'); return; }
  var rows = sheetToObjects(inbound);
  // oldest first so thread state ends on the latest message
  rows.sort(function(a,b){ return String(a.received_at||'').localeCompare(String(b.received_at||'')); });
  var count = 0;
  rows.forEach(function(r){
    var body = String(r.body||'').trim();
    if (!body) return;
    var from = r.from || '';
    if (!_phoneKey(from)) return;
    var custId = '';
    var m = String(r.matched_customer||'').match(/\((CUST-[^)]+)\)/);
    if (m) custId = m[1];
    // no draft regeneration on backfill (keep it fast); draft stays whatever's there
    var thread = csUpsertInboundThread(from, body, r.matched_customer||'', custId, r.matched_shipment||'', null);
    if (thread && thread.thread_id) csLogMessage(thread.thread_id, from, 'inbound', body, '');
    count++;
  });
  Logger.log('Backfilled ' + count + ' inbound messages into CS Threads.');
  Logger.log('needs_reply threads: ' + getCsNeedsReplyCount());
}

// Quick test of the data layer end to end.
function testCsDataLayer() {
  var t = csUpsertInboundThread('15551234567', 'where is my payment?', 'Test User (CUST-9999)', 'CUST-9999', 'SHP-999 · complete · ring', { text: 'Hey! Checking on that now.', flag: '' });
  Logger.log('thread: ' + JSON.stringify(t));
  csLogMessage(t.thread_id, '15551234567', 'inbound', 'where is my payment?', '');
  // noise test
  var n = csUpsertInboundThread('15559998888', '👍', 'Noise User (CUST-8888)', 'CUST-8888', '', null);
  Logger.log('noise thread status (should be resolved): ' + n.status);
  Logger.log('needs_reply count: ' + getCsNeedsReplyCount());
  Logger.log('threads needing reply: ' + JSON.stringify(getCsThreads('needs_reply').map(function(x){return x.matched_customer + ' / ' + x.last_message_preview;})));
}

// ── Refiner prep: items purchased 30+ days ago (past FL 538 hold), with bins ──
// Run refineReady() from the editor. Lists what's clear to melt + where it is.
function refineReady(minDays) {
  minDays = minDays || 30;
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var cutoff = new Date(Date.now() - minDays*24*3600*1000);

  // "purchased" = we own it: these stages mean we bought it and it's inventory
  var ownedStages = ['complete','pending_leadsonline','pending_payment'];

  var ready = rows.filter(function(s){
    if (ownedStages.indexOf(s.stage) === -1) return false;
    var pd = s.purchased_at ? new Date(s.purchased_at) : null;
    // fall back to created_at if purchased_at is missing, but flag it
    var eff = pd || (s.paid_at ? new Date(s.paid_at) : null);
    if (!eff || isNaN(eff)) return false;
    return eff <= cutoff;
  });

  ready.forEach(function(s){
    s._pd = s.purchased_at ? new Date(s.purchased_at) : (s.paid_at ? new Date(s.paid_at) : null);
    s._days = s._pd ? Math.floor((Date.now() - s._pd) / (24*3600*1000)) : 0;
    s._noPurchaseDate = !s.purchased_at;
  });
  // sort by bin so you can walk bins in order, then by age
  ready.sort(function(a,b){
    var ba = String(a.bin_number||'~'), bb = String(b.bin_number||'~');
    if (ba !== bb) return ba.localeCompare(bb, undefined, {numeric:true});
    return b._days - a._days;
  });

  Logger.log('═══ REFINE-READY: purchased ' + minDays + '+ days ago (' + ready.length + ' items) ═══');
  Logger.log('BIN | DAYS HELD | SHP | ITEM | PAID');
  var noBin = 0, noPd = 0;
  ready.forEach(function(s){
    var bin = s.bin_number ? ('Bin ' + s.bin_number) : '⚠NO BIN';
    if (!s.bin_number) noBin++;
    if (s._noPurchaseDate) noPd++;
    Logger.log(
      bin + ' | ' + s._days + 'd' + (s._noPurchaseDate?'*':'') +
      ' | ' + s.shipment_id +
      ' | ' + String(s.item||'').slice(0,42) +
      ' | $' + (s.purchase_price||'?')
    );
  });
  Logger.log('─────────────');
  Logger.log('Total clear to refine: ' + ready.length);
  if (noBin) Logger.log('⚠ ' + noBin + ' item(s) have NO bin assigned — locate before melting.');
  if (noPd) Logger.log('* ' + noPd + ' item(s) missing purchased_at; used created_at as fallback — verify the 30-day hold manually.');
}
function refineReady30(){ return refineReady(30); }

// Two lists: owned inventory 30+ days (clear of hold) vs under 30 (still holding).
// Both sorted by bin. Run refineSplit() from the editor.
function refineSplit() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var ownedStages = ['complete','pending_leadsonline','pending_payment'];
  var cutoff = Date.now() - 30*24*3600*1000;

  var owned = rows.filter(function(s){ return ownedStages.indexOf(s.stage) !== -1; });
  owned.forEach(function(s){
  var pd = s.purchased_at ? new Date(s.purchased_at) : (s.paid_at ? new Date(s.paid_at) : null);  
    s._pd = pd; s._noPd = !s.purchased_at;
    s._days = pd ? Math.floor((Date.now() - pd.getTime())/(24*3600*1000)) : null;
  });
  function byBin(a,b){
    var ba=String(a.bin_number||'~'), bb=String(b.bin_number||'~');
    if (ba!==bb) return ba.localeCompare(bb,undefined,{numeric:true});
    return (b._days||0)-(a._days||0);
  }
  function line(s){
    var bin = s.bin_number ? ('Bin '+s.bin_number) : '⚠NO BIN';
    return bin + ' | ' + (s._days==null?'?':s._days) + 'd' + (s._noPd?'*':'') +
      ' | ' + s.shipment_id + ' | ' + String(s.item||'').slice(0,40) + ' | $' + (s.purchase_price||'?');
  }

  var over = owned.filter(function(s){ return s._pd && s._pd.getTime() <= cutoff; }).sort(byBin);
  var under = owned.filter(function(s){ return !s._pd || s._pd.getTime() > cutoff; }).sort(byBin);

  Logger.log('════════ 30+ DAYS — CLEAR OF HOLD (' + over.length + ') ════════');
  Logger.log('BIN | DAYS | SHP | ITEM | PAID');
  over.forEach(function(s){ Logger.log(line(s)); });

  Logger.log('');
  Logger.log('════════ UNDER 30 DAYS — STILL HOLDING (' + under.length + ') ════════');
  Logger.log('BIN | DAYS | SHP | ITEM | PAID');
  under.forEach(function(s){ Logger.log(line(s)); });

  Logger.log('');
  Logger.log('* = missing purchased_at, used created_at as fallback — verify hold manually');
}

// ── Bin cleanup: clear bin_number on ALL shipments except bins 39 and 65 ──
// SAFE PATTERN: run binClearPreview() FIRST to see what will change.
// Then run binClearApply() to actually clear them.
var BIN_KEEP = ['39','65'];

function binClearPreview() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var toClear = rows.filter(function(s){
    var b = String(s.bin_number||'').trim();
    return b !== '' && BIN_KEEP.indexOf(b) === -1;
  });
  var keep = rows.filter(function(s){ return BIN_KEEP.indexOf(String(s.bin_number||'').trim()) !== -1; });
  Logger.log('═══ BIN CLEAR PREVIEW (dry run — nothing changed) ═══');
  Logger.log('KEEPING (bins ' + BIN_KEEP.join(', ') + '): ' + keep.length + ' shipment(s)');
  keep.forEach(function(s){ Logger.log('  KEEP Bin ' + s.bin_number + ' · ' + s.shipment_id + ' · ' + String(s.item||'').slice(0,35)); });
  Logger.log('─────────────');
  Logger.log('WILL CLEAR: ' + toClear.length + ' shipment(s) with a bin not in the keep-list');
  toClear.forEach(function(s){ Logger.log('  clear Bin ' + s.bin_number + ' → "" · ' + s.shipment_id + ' · ' + String(s.item||'').slice(0,35)); });
  Logger.log('─────────────');
  Logger.log('If this looks right, run binClearApply() to clear those ' + toClear.length + ' bins.');
}

function binClearApply() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SHIPMENTS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var binCol = headers.indexOf('bin_number');
  if (binCol === -1) { Logger.log('No bin_number column found.'); return; }
  var cleared = 0;
  for (var r = 1; r < data.length; r++) {
    var b = String(data[r][binCol]||'').trim();
    if (b !== '' && BIN_KEEP.indexOf(b) === -1) {
      sheet.getRange(r+1, binCol+1).setValue('');
      cleared++;
    }
  }
  Logger.log('✓ Cleared ' + cleared + ' bin assignment(s). Bins ' + BIN_KEEP.join(' & ') + ' left untouched.');
}

// Look up what was paid to a customer by name.
function lookupPayment(nameFragment) {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var q = String(nameFragment||'').toLowerCase();
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS)).filter(function(c){ return String(c.name||'').toLowerCase().indexOf(q)!==-1; });
  if (!custs.length) { Logger.log('No customer matching "' + nameFragment + '"'); return; }
  custs.forEach(function(c){
    Logger.log('─── ' + c.name + ' (' + c.customer_id + ') ───');
    var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return String(s.customer_id)===String(c.customer_id); });
    if (!ships.length) { Logger.log('  (no shipments)'); return; }
    ships.forEach(function(s){
      Logger.log('  ' + s.shipment_id + ' · ' + s.stage +
        ' · paid $' + (s.purchase_price||'—') +
        ' · appraised $' + (s.appraised_value||'—') +
        ' · ' + String(s.item||'').slice(0,40) +
        ' · pay=' + (s.payment_method||'') + ' ' + (s.payment_info||''));
    });
  });
}
function lookupHobert(){ return lookupPayment('hobert williams'); }

// Repeat-seller analytics: how many customers have shipped 1x, 2x, 3x, etc.
// Counts real shipments per customer (excludes estimate-only / dead leads).
function repeatSellers() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  // A "shipment" that counts = one that actually progressed (they sent something),
  // not just an estimate. Exclude estimate_only and dead.
  var realStages = ['outbound_complete','received','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var byCust = {};
  rows.forEach(function(s){
    if (realStages.indexOf(s.stage) === -1) return;
    var cid = String(s.customer_id||'');
    if (!cid) return;
    byCust[cid] = (byCust[cid]||0) + 1;
  });

  // distribution: how many customers have exactly N shipments
  var dist = {};
  Object.keys(byCust).forEach(function(cid){
    var n = byCust[cid];
    dist[n] = (dist[n]||0) + 1;
  });

  var totalCustomers = Object.keys(byCust).length;
  Logger.log('═══ REPEAT SELLER DISTRIBUTION ═══');
  Logger.log('Total customers with ≥1 real shipment: ' + totalCustomers);
  Logger.log('─────────────');
  var counts = Object.keys(dist).map(Number).sort(function(a,b){return a-b;});
  counts.forEach(function(n){
    var c = dist[n];
    var pct = ((c/totalCustomers)*100).toFixed(1);
    Logger.log('  shipped ' + n + 'x: ' + c + ' customer(s)  (' + pct + '%)');
  });
  Logger.log('─────────────');
  // cumulative "returned at least N times"
  var atLeast2 = 0, atLeast3 = 0, atLeast4 = 0;
  Object.keys(byCust).forEach(function(cid){
    var n = byCust[cid];
    if (n >= 2) atLeast2++;
    if (n >= 3) atLeast3++;
    if (n >= 4) atLeast4++;
  });
  Logger.log('Returned to ship 2+ times: ' + atLeast2 + ' (' + ((atLeast2/totalCustomers)*100).toFixed(1) + '%)');
  Logger.log('Returned to ship 3+ times: ' + atLeast3 + ' (' + ((atLeast3/totalCustomers)*100).toFixed(1) + '%)');
  Logger.log('Returned to ship 4+ times: ' + atLeast4 + ' (' + ((atLeast4/totalCustomers)*100).toFixed(1) + '%)');
}

// What does each stage actually mean in terms of "did the customer ship"?
// Show stage counts + whether inbound tracking exists (proof they shipped).
function stageVsTracking() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var byStage = {};
  rows.forEach(function(s){
    var st = String(s.stage||'(blank)');
    if (!byStage[st]) byStage[st] = {total:0, hasInbound:0, received_at:0};
    byStage[st].total++;
    // outbound_tracking holds the INBOUND (customer→us) tracking in this schema
    if (String(s.outbound_tracking||'').trim()) byStage[st].hasInbound++;
    if (String(s.received_at||'').trim()) byStage[st].received_at++;
  });
  Logger.log('═══ STAGE vs ACTUAL SHIPMENT EVIDENCE ═══');
  Logger.log('stage | total | has_inbound_tracking | has_received_at');
  Object.keys(byStage).sort().forEach(function(st){
    var b = byStage[st];
    Logger.log('  ' + st + ' | ' + b.total + ' | ' + b.hasInbound + ' | ' + b.received_at);
  });
  Logger.log('─────────────');
  // How many shipments have EITHER real evidence of arriving?
  var reallyReceived = rows.filter(function(s){
    return String(s.received_at||'').trim() || ['received','pending_response','pending_payment','pending_leadsonline','complete'].indexOf(s.stage)!==-1;
  });
  Logger.log('Shipments with received_at stamp OR at/past received stage: ' + reallyReceived.length);
  var withTracking = rows.filter(function(s){ return String(s.outbound_tracking||'').trim(); });
  Logger.log('Shipments with ANY inbound tracking number: ' + withTracking.length);
}

// How many customers have sent in MORE THAN ONE actual package (real inbound).
// A real inbound = package that ARRIVED: received stage or beyond, or has a
// received_at stamp. Excludes label-issued-but-never-shipped (outbound_complete).
function repeatInbounds() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var arrivedStages = ['received','pending_response','pending_payment','pending_leadsonline','complete','returned'];

  var arrived = rows.filter(function(s){
    return arrivedStages.indexOf(s.stage) !== -1 || String(s.received_at||'').trim() !== '';
  });

  Logger.log('Total ARRIVED inbound packages: ' + arrived.length);

  var byCust = {};
  arrived.forEach(function(s){
    var cid = String(s.customer_id||'');
    if (!cid) return;
    byCust[cid] = (byCust[cid]||0) + 1;
  });

  var totalCust = Object.keys(byCust).length;
  var dist = {};
  Object.keys(byCust).forEach(function(cid){ var n=byCust[cid]; dist[n]=(dist[n]||0)+1; });

  Logger.log('═══ INBOUND PACKAGES PER CUSTOMER ═══');
  Logger.log('Customers who have sent ≥1 package: ' + totalCust);
  Object.keys(dist).map(Number).sort(function(a,b){return a-b;}).forEach(function(n){
    Logger.log('  sent ' + n + ' package(s): ' + dist[n] + ' customer(s)');
  });
  var multi = 0, three = 0;
  Object.keys(byCust).forEach(function(cid){ if(byCust[cid]>=2) multi++; if(byCust[cid]>=3) three++; });
  Logger.log('─────────────');
  Logger.log('Sent MORE THAN 1 package: ' + multi + ' customer(s)');
  Logger.log('Sent 3+ packages: ' + three + ' customer(s)');

  // list the repeat ones by name so you can eyeball / sanity-check
  if (multi > 0) {
    Logger.log('─── the repeat senders ───');
    var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
    Object.keys(byCust).filter(function(cid){return byCust[cid]>=2;})
      .sort(function(a,b){return byCust[b]-byCust[a];})
      .forEach(function(cid){
        var c = custs.filter(function(x){return String(x.customer_id)===cid;})[0];
        Logger.log('  ' + byCust[cid] + '× · ' + (c?c.name:cid) + ' (' + cid + ')');
      });
  }
}

// Full list of COMPLETE shipments: customer, SHP#, paid, expected revenue (appraised).
function completesList() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return s.stage === 'complete'; });
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var nameOf = {};
  custs.forEach(function(c){ nameOf[String(c.customer_id)] = c.name; });

  rows.forEach(function(s){ s._paid = parseFloat(s.purchase_price)||0; s._rev = parseFloat(s.appraised_value)||0; });
  rows.sort(function(a,b){ return (b._rev-b._paid)-(a._rev-a._paid); });

  Logger.log('═══ COMPLETED SHIPMENTS (' + rows.length + ') ═══');
  Logger.log('CUSTOMER | SHP | PAID | EXPECTED REV | MARGIN');
  var tPaid=0, tRev=0;
  rows.forEach(function(s){
    tPaid+=s._paid; tRev+=s._rev;
    Logger.log(
      (nameOf[String(s.customer_id)]||s.customer_id||'?') +
      ' | ' + s.shipment_id +
      ' | $' + s._paid +
      ' | $' + s._rev +
      ' | $' + (s._rev - s._paid)
    );
  });
  Logger.log('─────────────');
  Logger.log('TOTALS: paid $' + tPaid.toFixed(0) + ' | expected rev $' + tRev.toFixed(0) + ' | margin $' + (tRev-tPaid).toFixed(0));
}

// Write the completes list to a clean 'Completes Report' tab (sortable/filterable).
function completesToTab() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var rows = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(s){ return s.stage === 'complete'; });
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var nameOf = {}; custs.forEach(function(c){ nameOf[String(c.customer_id)] = c.name; });

  rows.forEach(function(s){ s._paid = parseFloat(s.purchase_price)||0; s._rev = parseFloat(s.appraised_value)||0; });
  rows.sort(function(a,b){ return (b._rev-b._paid)-(a._rev-a._paid); });

  var tab = ss.getSheetByName('Completes Report');
  if (!tab) tab = ss.insertSheet('Completes Report');
  tab.clear();

  var out = [['Customer','SHP #','Item','Paid','Expected Rev','Margin','Margin %']];
  var tPaid=0, tRev=0;
  rows.forEach(function(s){
    tPaid+=s._paid; tRev+=s._rev;
    var marginPct = s._rev>0 ? Math.round(((s._rev-s._paid)/s._rev)*100) : 0;
    out.push([
      nameOf[String(s.customer_id)]||s.customer_id||'?',
      s.shipment_id,
      String(s.item||'').slice(0,60),
      s._paid,
      s._rev,
      s._rev - s._paid,
      marginPct + '%'
    ]);
  });
  out.push(['TOTALS','','', tPaid, tRev, tRev-tPaid, (tRev>0?Math.round(((tRev-tPaid)/tRev)*100):0)+'%']);

  tab.getRange(1,1,out.length,out[0].length).setValues(out);
  // formatting: bold header + totals, freeze header, currency
  tab.getRange(1,1,1,out[0].length).setFontWeight('bold').setBackground('#1A1816').setFontColor('#FAF6F0');
  tab.getRange(out.length,1,1,out[0].length).setFontWeight('bold').setBackground('#F5EFE6');
  tab.setFrozenRows(1);
  tab.getRange(2,4,out.length-1,3).setNumberFormat('$#,##0');
  tab.autoResizeColumns(1, out[0].length);
  Logger.log('Wrote ' + rows.length + ' completes to "Completes Report" tab. Totals: paid $'+tPaid.toFixed(0)+' | rev $'+tRev.toFixed(0)+' | margin $'+(tRev-tPaid).toFixed(0));
}

// Diagnose photo duplication + missing description/photo issues for specific shipments.
function diagnoseShipmentData(shipmentId) {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var s = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function(r){ return String(r.shipment_id)===String(shipmentId); });
  Logger.log('═══ ' + shipmentId + ' ═══');
  if (!s.length) { Logger.log('NOT FOUND'); return; }
  if (s.length > 1) Logger.log('⚠⚠ ' + s.length + ' SHIPMENT ROWS share this id (duplicate rows!)');
  s.forEach(function(r, i){
    Logger.log('--- shipment row ' + (i+1) + ' ---');
    Logger.log('  stage: ' + r.stage + ' | customer: ' + r.customer_id);
    Logger.log('  item: "' + String(r.item||'').slice(0,60) + '"');
    Logger.log('  item_manifest present: ' + (r.item_manifest ? 'yes ('+String(r.item_manifest).length+' chars)' : 'NO'));
    Logger.log('  has legacy photo/image field: ' + (r.image||r.photo||r.photo_url ? 'yes' : 'no'));
  });
  // photos linked to this shipment
  try {
    var photos = sheetToObjects(ss.getSheetByName(TAB.PHOTOS)).filter(function(p){ return String(p.shipment_id)===String(shipmentId); });
    Logger.log('--- PHOTOS tab: ' + photos.length + ' row(s) for this shipment ---');
    var urlCounts = {};
    photos.forEach(function(p){
      var u = String(p.drive_url||p.url||'').slice(-40);
      urlCounts[u] = (urlCounts[u]||0)+1;
      Logger.log('  source="' + (p.source||'') + '" session=' + (p.session_id||'') + ' url=…' + u);
    });
    // flag duplicate URLs
    Object.keys(urlCounts).forEach(function(u){ if (urlCounts[u]>1) Logger.log('  ⚠ URL …'+u+' appears '+urlCounts[u]+'× (DUPLICATE)'); });
  } catch(e){ Logger.log('photo check error: '+e); }
}
function diag1017(){ return diagnoseShipmentData('SHP-1017'); }
function diag1055(){ return diagnoseShipmentData('SHP-1055'); }
function diag1020(){ return diagnoseShipmentData('SHP-1020'); }

// Check if a shipment's photos are ALSO attached to other shipments (mis-association),
// and show what the sweep matcher is doing.
function checkPhotoSharing(shipmentId) {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var allPhotos = sheetToObjects(ss.getSheetByName(TAB.PHOTOS));
  var mine = allPhotos.filter(function(p){ return String(p.shipment_id)===String(shipmentId); });
  Logger.log('═══ photo sharing check for ' + shipmentId + ' ═══');
  mine.forEach(function(p){
    var url = String(p.drive_url||p.url||'');
    var key = url.slice(-45);
    // find all shipments that reference this same URL
    var others = allPhotos.filter(function(q){ return String(q.drive_url||q.url||'').slice(-45)===key; })
      .map(function(q){ return q.shipment_id + '(' + (q.source||'') + ')'; });
    Logger.log('  …' + url.slice(-30) + ' [' + (p.source||'') + ']');
    Logger.log('     attached to: ' + others.join(', '));
  });
  // also: how many total photos does the sweep source account for across ALL shipments?
  var sweepCount = allPhotos.filter(function(p){ return String(p.source||'').indexOf('sweep')!==-1; }).length;
  var totalCount = allPhotos.length;
  Logger.log('─────────────');
  Logger.log('Sweep-sourced photos across all shipments: ' + sweepCount + ' of ' + totalCount + ' total');
}
function share1017(){ return checkPhotoSharing('SHP-1017'); }

// How widespread is the empty-item problem? Count ready_to_fulfill + recent shipments
// with no item/description, and check if they have photos.
function emptyItemAudit() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var photos = sheetToObjects(ss.getSheetByName(TAB.PHOTOS));
  var photoCountBy = {};
  photos.forEach(function(p){ var id=String(p.shipment_id); photoCountBy[id]=(photoCountBy[id]||0)+1; });

  var emptyItem = ships.filter(function(s){ return !String(s.item||'').trim() && !String(s.item_manifest||'').trim(); });
  Logger.log('═══ SHIPMENTS WITH NO ITEM/DESCRIPTION: ' + emptyItem.length + ' of ' + ships.length + ' ═══');
  // break down by stage + whether they have photos
  var byStage = {}, withPhotos=0, withoutPhotos=0;
  emptyItem.forEach(function(s){
    byStage[s.stage] = (byStage[s.stage]||0)+1;
    if (photoCountBy[s.shipment_id]) withPhotos++; else withoutPhotos++;
  });
  Object.keys(byStage).sort().forEach(function(st){ Logger.log('  ' + st + ': ' + byStage[st]); });
  Logger.log('  → have photos (desc missing): ' + withPhotos + ' | totally empty (no photo, no desc): ' + withoutPhotos);
  // show the most recent 15 empty ones
  emptyItem.sort(function(a,b){ return String(b.created_at||'').localeCompare(String(a.created_at||'')); });
  Logger.log('─── 15 most recent empty-item shipments ───');
  emptyItem.slice(0,15).forEach(function(s){
    Logger.log('  ' + (s.created_at||'').slice(0,16) + ' · ' + s.shipment_id + ' · ' + s.stage + ' · photos=' + (photoCountBy[s.shipment_id]||0));
  });
}

// Funnel counts for grounding the pro forma: leads, labels issued (outbound
// fulfills), arrived packages. Gives real ship-rate + cost per step.
function funnelCounts() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));

  // Every shipment row = someone who completed the funnel far enough to get a label.
  var total = ships.length;

  // Label issued / outbound fulfilled = reached outbound_complete or beyond.
  var postLabelStages = ['outbound_complete','received','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var labelIssued = ships.filter(function(s){
    return postLabelStages.indexOf(s.stage) !== -1 || String(s.outbound_tracking||'').trim() !== '';
  });

  // Arrived = actually received.
  var arrivedStages = ['received','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var arrived = ships.filter(function(s){
    return arrivedStages.indexOf(s.stage) !== -1 || String(s.received_at||'').trim() !== '';
  });

  // Purchased = accepted offer (owned).
  var purchased = ships.filter(function(s){
    return ['complete','pending_payment','pending_leadsonline'].indexOf(s.stage) !== -1;
  });

  // stage breakdown for transparency
  var byStage = {};
  ships.forEach(function(s){ var st=String(s.stage||'(blank)'); byStage[st]=(byStage[st]||0)+1; });

  Logger.log('═══ FUNNEL COUNTS ═══');
  Logger.log('Total shipment rows (all): ' + total);
  Logger.log('Labels issued / outbound fulfilled: ' + labelIssued.length);
  Logger.log('Packages ARRIVED: ' + arrived.length);
  Logger.log('Purchased (accepted): ' + purchased.length);
  Logger.log('─── stage breakdown ───');
  Object.keys(byStage).sort().forEach(function(st){ Logger.log('  ' + st + ': ' + byStage[st]); });
  Logger.log('─── derived rates ───');
  if (labelIssued.length) Logger.log('Ship rate (arrived / labels issued): ' + (arrived.length/labelIssued.length*100).toFixed(1) + '%');
  if (arrived.length) Logger.log('Accept rate (purchased / arrived): ' + (purchased.length/arrived.length*100).toFixed(1) + '%');
  Logger.log('─── cost per step @ $9,000 spend ───');
  Logger.log('  per label issued: $' + (9000/labelIssued.length).toFixed(2));
  Logger.log('  per arrived pkg:  $' + (9000/arrived.length).toFixed(2));
  Logger.log('  per purchase:     $' + (9000/purchased.length).toFixed(2));
}

// Search shipments by item description text. Run: findItem('leo diamond')
function findItem(query) {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var nameOf = {}; custs.forEach(function(c){ nameOf[String(c.customer_id)] = c.name; });

  var terms = String(query||'').toLowerCase().split(/\s+/).filter(function(t){ return t.length; });
  var hits = ships.filter(function(s){
    var hay = (String(s.item||'') + ' ' + String(s.item_manifest||'') + ' ' + String(s.notes||'')).toLowerCase();
    // match if ALL terms appear somewhere in the item/manifest/notes
    return terms.every(function(t){ return hay.indexOf(t) !== -1; });
  });

  Logger.log('═══ item search "' + query + '" — ' + hits.length + ' match(es) ═══');
  if (!hits.length) {
    Logger.log('No match on all terms. Trying ANY term…');
    hits = ships.filter(function(s){
      var hay = (String(s.item||'') + ' ' + String(s.item_manifest||'') + ' ' + String(s.notes||'')).toLowerCase();
      return terms.some(function(t){ return hay.indexOf(t) !== -1; });
    });
    Logger.log('Any-term matches: ' + hits.length);
  }
  hits.forEach(function(s){
    Logger.log('─ ' + s.shipment_id + ' · ' + (nameOf[String(s.customer_id)]||s.customer_id) + ' · ' + s.stage);
    Logger.log('   item: "' + String(s.item||'').slice(0,80) + '"');
    Logger.log('   PAID: $' + (s.purchase_price||'—') + ' · appraised: $' + (s.appraised_value||'—'));
    if (s.notes) Logger.log('   notes: ' + String(s.notes).slice(0,80));
  });
}
function findLeo(){ return findItem('leo diamond'); }

// Which ARRIVED packages originated from Google Ads?
// Uses attribution (gclid present, or utm_source containing google).
function googleAdsPackages() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var nameOf = {}, emailOf = {};
  custs.forEach(function(c){ nameOf[String(c.customer_id)]=c.name; emailOf[String(c.customer_id)]=String(c.email||'').toLowerCase().trim(); });

  // Build email -> attribution from Lead Intake (earliest attributed row per email)
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var leadData = leadSheet.getDataRange().getValues();
  var attrByEmail = {};
  for (var r = 1; r < leadData.length; r++) {
    var em = String(leadData[r][COL.EMAIL]||'').toLowerCase().trim();
    if (!em) continue;
    var gclid = String(leadData[r][COL.GCLID]||'').trim();
    var src   = String(leadData[r][COL.TRAFFIC_SRC]||'').trim();
    var camp  = String(leadData[r][COL.CAMPAIGN]||'').trim();
    var med   = String(leadData[r][COL.MEDIUM]||'').trim();
    if (!gclid && !src && !camp) continue;
    // keep first attributed sighting
    if (!attrByEmail[em]) attrByEmail[em] = { gclid: gclid, src: src, camp: camp, med: med };
    else {
      if (!attrByEmail[em].gclid && gclid) attrByEmail[em].gclid = gclid;
      if (!attrByEmail[em].src && src) attrByEmail[em].src = src;
      if (!attrByEmail[em].camp && camp) attrByEmail[em].camp = camp;
    }
  }

  var arrivedStages = ['received','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var arrived = ships.filter(function(s){
    return arrivedStages.indexOf(s.stage)!==-1 || String(s.received_at||'').trim()!=='';
  });

  var google = [], other = [], unknown = [];
  arrived.forEach(function(s){
    var em = emailOf[String(s.customer_id)];
    var a = em ? attrByEmail[em] : null;
    if (!a) { unknown.push(s); return; }
    var isGoogle = !!a.gclid || /google|adwords|gads|cpc/i.test(a.src+' '+a.med);
    if (isGoogle) { s._attr = a; google.push(s); } else { s._attr = a; other.push(s); }
  });

  Logger.log('═══ ARRIVED PACKAGES BY SOURCE ═══');
  Logger.log('Total arrived: ' + arrived.length);
  Logger.log('  From GOOGLE ADS: ' + google.length);
  Logger.log('  From other known sources: ' + other.length);
  Logger.log('  No attribution data: ' + unknown.length);
  Logger.log('');
  Logger.log('─── GOOGLE ADS PACKAGES ───');
  if (!google.length) Logger.log('  (none found)');
  google.forEach(function(s){
    Logger.log('  ' + s.shipment_id + ' · ' + (nameOf[String(s.customer_id)]||'?') + ' · ' + s.stage +
      ' · paid $' + (s.purchase_price||'—') + ' · appraised $' + (s.appraised_value||'—'));
    Logger.log('      item: ' + String(s.item||'').slice(0,50));
    Logger.log('      src=' + (s._attr.src||'') + ' camp=' + (s._attr.camp||'') + ' gclid=' + (s._attr.gclid?'YES':'no'));
  });
  // summarize the other sources so you can see the mix
  var srcCounts = {};
  other.forEach(function(s){ var k=(s._attr.src||'(blank)'); srcCounts[k]=(srcCounts[k]||0)+1; });
  Logger.log('');
  Logger.log('─── other sources mix ───');
  Object.keys(srcCounts).sort(function(a,b){return srcCounts[b]-srcCounts[a];}).forEach(function(k){ Logger.log('  ' + k + ': ' + srcCounts[k]); });
}

// Diagnose the Sales tab: real header order vs schema, and show raw rows
// to find where date/payment got swapped.
function diagSales() {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SALES);
  if (!sheet) { Logger.log('No Sales tab'); return; }
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  Logger.log('═══ SALES TAB SCHEMA CHECK ═══');
  Logger.log('Sheet columns: ' + headers.length + ' | Schema columns: ' + COLS.SALES.length);
  var max = Math.max(headers.length, COLS.SALES.length);
  for (var i = 0; i < max; i++) {
    var sh = headers[i] !== undefined ? headers[i] : '(none)';
    var sc = COLS.SALES[i] !== undefined ? COLS.SALES[i] : '(none)';
    Logger.log('  col ' + i + ': sheet="' + sh + '" schema="' + sc + '"' + (String(sh)===String(sc)?'':'  ◀── MISMATCH'));
  }
  Logger.log('');
  Logger.log('═══ RAW ROWS (last 8) ═══');
  var start = Math.max(1, data.length - 8);
  for (var r = start; r < data.length; r++) {
    var parts = [];
    headers.forEach(function(h, i){ parts.push(h + '="' + String(data[r][i]).slice(0,28) + '"'); });
    Logger.log('  row ' + (r+1) + ': ' + parts.join(' | '));
  }
}

// ── Repair scrambled Sales rows (from the COLS.SALES drift) ──
// The bad rows have values rotated across sale_date/notes/created_at/payment_method.
// Detect by shape: sale_date holds a payment word, or payment_method holds a timestamp.
// SAFE: run salesRepairPreview() first, then salesRepairApply().
function _looksLikeDate(v){ return /^\d{4}-\d{2}-\d{2}T|^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4}/.test(String(v||'').trim()); }
function _looksLikePayment(v){ return /^(ach|cash|check|zelle|venmo|paypal|other|wire)$/i.test(String(v||'').trim()); }

function _salesRepairCore(dryRun) {
  var ss = _csGetSS ? _csGetSS() : SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB.SALES);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var iDate = h.indexOf('sale_date'), iNotes = h.indexOf('notes'),
      iCreated = h.indexOf('created_at'), iPay = h.indexOf('payment_method'),
      iId = h.indexOf('sale_id');
  var fixed = 0;

  Logger.log('═══ SALES REPAIR ' + (dryRun ? '(PREVIEW — no writes)' : '(APPLYING)') + ' ═══');
  for (var r = 1; r < data.length; r++) {
    var dateV = data[r][iDate], notesV = data[r][iNotes],
        createdV = data[r][iCreated], payV = data[r][iPay];
    // Scrambled shape: date field holds a payment word AND payment field holds a timestamp
    var scrambled = _looksLikePayment(dateV) && _looksLikeDate(payV);
    if (!scrambled) continue;
    // Rotate back: correct = date<-notes, notes<-created, created<-payment, payment<-date
    var newDate = notesV, newNotes = createdV, newCreated = payV, newPay = dateV;
    Logger.log('  ' + data[r][iId] + ':');
    Logger.log('     date: "' + String(dateV).slice(0,24) + '" → "' + String(newDate).slice(0,24) + '"');
    Logger.log('     pay:  "' + String(payV).slice(0,24) + '" → "' + String(newPay).slice(0,24) + '"');
    if (!dryRun) {
      sheet.getRange(r+1, iDate+1).setValue(newDate);
      sheet.getRange(r+1, iNotes+1).setValue(newNotes);
      sheet.getRange(r+1, iCreated+1).setValue(newCreated);
      sheet.getRange(r+1, iPay+1).setValue(newPay);
    }
    fixed++;
  }
  Logger.log('─────────────');
  Logger.log((dryRun ? 'WOULD fix: ' : 'Fixed: ') + fixed + ' row(s)');
  if (dryRun && fixed) Logger.log('If correct, run salesRepairApply().');
  if (!fixed) Logger.log('No scrambled rows detected (you may have already hand-fixed them).');
  return { fixed: fixed };
}
function salesRepairPreview(){ return _salesRepairCore(true); }
function salesRepairApply(){ return _salesRepairCore(false); }
function diagPowell() { diagnoseShipmentCarrier('SHP-1163'); }
function recoveryPreview130(){ return recoveryEmailPreview(130); }
function recoverySend130(){ return recoveryEmailSend(130, 100, 100); }