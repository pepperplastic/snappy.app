// ═══════════════════════════════════════════════
//  ONE-TIME PATCH: Fix Jac Smith + Lora Cowan
//  Run patchJacAndLora() once then delete
// ═══════════════════════════════════════════════

function patchJacAndLora() {
  Logger.log('=== Starting Jac + Lora patch ===');
  _patchJac();
  _patchLora();
  Logger.log('=== Patch complete ===');
}

// ── JAC SMITH ────────────────────────────────────────────────
// SHP-340 exists with label/address but missing 2 of 3 photos
// and missing the ruby bracelet + cross bracelet item info.
// The ring (last photo_flow row) is already on the shipment.
// We need to add:
//   1. Ruby Tennis Bracelet photo + estimate
//   2. Cross Bracelet with Black Onyx photo + estimate
//   3. Ring photo (from photo_flow row — may already exist, deduped)

function _patchJac() {
  var SHP_ID = 'SHP-340';

  var photosToAdd = [
    // Ruby Tennis Bracelet (from anonymous photo_browse row — was never linked)
    {
      drive_url: 'https://drive.google.com/file/d/1RlOnMWnj6xRWHUfs9G7HqjUM3f9z7aSk/view?usp=drivesdk',
      source: 'backfill_patch'
    },
    // Cross Bracelet with Black Onyx
    {
      drive_url: 'https://drive.google.com/file/d/1iMkDZpaSz2rIotrV3gj7zmYQfla2s-ag/view?usp=drivesdk',
      source: 'backfill_patch'
    },
    // Cocktail Ring (photo_browse version — photo_flow version may already exist)
    {
      drive_url: 'https://drive.google.com/file/d/1_enBIS2Y1iHlqzlv5RnYqji_ERf6VjWR/view?usp=drivesdk',
      source: 'backfill_patch'
    },
    // Cocktail Ring (photo_flow version — the one that triggered shipment creation)
    {
      drive_url: 'https://drive.google.com/file/d/1-o9tuSv2FIJidjod4B7HBZpiip-/view?usp=drivesdk',
      source: 'backfill_patch'
    },
  ];

  var existingPhotos = getPhotos(SHP_ID);
  var existingUrls = existingPhotos.map(function(p) { return String(p.drive_url).trim(); });
  var added = 0;

  photosToAdd.forEach(function(p) {
    if (existingUrls.indexOf(p.drive_url.trim()) !== -1) {
      Logger.log('Jac: photo already exists, skipping: ' + p.drive_url);
      return;
    }
    addPhoto({ shipment_id: SHP_ID, drive_url: p.drive_url, source: p.source });
    Logger.log('Jac: added photo to ' + SHP_ID + ': ' + p.drive_url);
    added++;
  });

  // Patch notes on the shipment to include all 3 items + estimates
  var itemNotes =
    '+ 18K Yellow Gold Ruby Tennis Bracelet ($1,580 – $2,535)\n' +
    '+ 14K Yellow Gold Cross Bracelet with Black Onyx ($920 – $1,650)\n' +
    '+ 14K Gold Cocktail Ring with Red Gemstones and Diamonds ($700 – $1,400)';

  updateShipment(SHP_ID, {
    item:    '3 items: Ruby Bracelet, Cross Bracelet, Cocktail Ring',
    estimate: '$3,200 – $5,585 (combined)',
    notes:   itemNotes
  });

  Logger.log('Jac patch complete. Photos added: ' + added + ', shipment notes updated.');
}

// ── LORA COWAN ───────────────────────────────────────────────
// SHP exists (from 6ccb3ffa session — emerald ring, label/address)
// Need to find her shipment ID and add:
//   1. Bee brooch photos from sessions on Apr 2 and Apr 3
//   2. Update notes with Cellino bee brooch item info
// Her emerald ring estimate: $350–$750 (already on shipment)

function _patchLora() {
  var LORA_EMAIL = 'reiss.n.training@gmail.com';

  // Find Lora's customer record
  var customer = getCustomerByEmail(LORA_EMAIL);
  if (!customer) {
    Logger.log('Lora: customer not found for ' + LORA_EMAIL);
    return;
  }
  Logger.log('Lora: found customer ' + customer.customer_id);

  // Find her pre-received shipment
  var shipments = getShipments(customer.customer_id);
  Logger.log('Lora: found ' + shipments.length + ' shipment(s)');

  var PRE_RECEIVED = ['ready_to_fulfill', 'outbound_pending', 'outbound_complete'];
  var target = null;
  shipments.forEach(function(s) {
    if (PRE_RECEIVED.indexOf(String(s.stage || '').trim()) !== -1) {
      target = s;
    }
  });

  if (!target) {
    Logger.log('Lora: no pre-received shipment found. Shipments: ' + JSON.stringify(shipments.map(function(s){ return s.shipment_id + '/' + s.stage; })));
    return;
  }

  Logger.log('Lora: patching shipment ' + target.shipment_id + ' (stage: ' + target.stage + ')');

  var photosToAdd = [
    // Apr 2 session — insect brooch photo 1
    { drive_url: 'https://drive.google.com/file/d/14zpKLCQVWeAvDMxVcze8xdEB2pZ39vj3/view?usp=drivesdk', source: 'backfill_patch' },
    // Apr 2 session — insect brooch photo 2
    { drive_url: 'https://drive.google.com/file/d/1pkVdoc9hul4B3D36nBBTnnWHR0ZR-h1E/view?usp=drivesdk', source: 'backfill_patch' },
    // Apr 2 session — silver ring (low value, include for completeness)
    { drive_url: 'https://drive.google.com/file/d/1tHGMXLBYFimPsPBxYIGYgvmxUWUFQI2r/view?usp=drivesdk', source: 'backfill_patch' },
    // Apr 2 session — amethyst ring
    { drive_url: 'https://drive.google.com/file/d/1kWa96eCeM6vEEWHBdB9LRoXJ3C8r2tsm/view?usp=drivesdk', source: 'backfill_patch' },
    // Apr 3 session — bee brooch (clearest photo, direct_quote session)
    { drive_url: 'https://drive.google.com/file/d/1hjdmzSEXYetN7nB8b9sx26drDpLkh-Xm/view?usp=drivesdk', source: 'backfill_patch' },
  ];

  var existingPhotos = getPhotos(target.shipment_id);
  var existingUrls = existingPhotos.map(function(p) { return String(p.drive_url).trim(); });
  var added = 0;

  photosToAdd.forEach(function(p) {
    if (existingUrls.indexOf(p.drive_url.trim()) !== -1) {
      Logger.log('Lora: photo already exists, skipping: ' + p.drive_url);
      return;
    }
    addPhoto({ shipment_id: target.shipment_id, drive_url: p.drive_url, source: p.source });
    Logger.log('Lora: added photo to ' + target.shipment_id);
    added++;
  });

  // Update notes with all known items
  // Emerald ring already on shipment as primary item
  // Add brooch + other items to notes
  var itemNotes =
    '+ 14K Yellow Gold Emerald and Diamond Ring ($350 – $750) [primary]\n' +
    '+ Cellino 18K Gold Bee Brooch w/ Onyx Eyes, ~14g — customer confirmed 18K/Cellino stamp (AI misidentified as costume jewelry — REVIEW PHOTOS)\n' +
    '+ 14K Yellow Gold Ring with Purple Amethyst ($245 – $525)\n' +
    '+ Sterling Silver Ring with Clear Stone ($5 – $10) [low value]';

  updateShipment(target.shipment_id, {
    notes: itemNotes
  });

  Logger.log('Lora patch complete. Photos added: ' + added + ', notes updated on ' + target.shipment_id);
}
