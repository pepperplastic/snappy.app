// ═══════════════════════════════════════════════
//  ONE-TIME PATCH: Fix Wilton Knight (SHP-339)
//  Run patchWilton() once then delete this file
// ═══════════════════════════════════════════════

function patchWilton() {
  Logger.log('=== Starting Wilton Knight patch ===');

  var SHP_ID = 'SHP-339';

  var photosToAdd = [
    // Textured Link Chain with Medallion Pendant (photo_browse)
    { drive_url: 'https://drive.google.com/file/d/1DBpm6XMLE-xnlUF8bMNTU9yOyCieNcDo/view?usp=drivesdk', source: 'backfill_patch' },
    // Textured Link Chain with Medallion Pendant (photo_flow)
    { drive_url: 'https://drive.google.com/file/d/12B1PHtj5PdkSSN8L0yCmszdkznEMut2r/view?usp=drivesdk', source: 'backfill_patch' },
    // Nugget Bracelet (photo_browse)
    { drive_url: 'https://drive.google.com/file/d/1UCZKySjTR40keiHqCvPlUSKpleUhFDDg/view?usp=drivesdk', source: 'backfill_patch' },
    // Nugget Bracelet (photo_flow)
    { drive_url: 'https://drive.google.com/file/d/1xYSQwdsXwumTKKXMLjFFG9vCsgn5h_xE/view?usp=drivesdk', source: 'backfill_patch' },
    // Fancy Link Bracelet (photo_browse)
    { drive_url: 'https://drive.google.com/file/d/1yXxC9WzCI0NJwoDgGZWkgeE8IiPeWvol/view?usp=drivesdk', source: 'backfill_patch' },
    // Fancy Link Bracelet (photo_flow)
    { drive_url: 'https://drive.google.com/file/d/1ZF1xcQYZIfcuOmkXxS7uh6d0cX3hclVI/view?usp=drivesdk', source: 'backfill_patch' },
    // Figaro Chain (photo_browse)
    { drive_url: 'https://drive.google.com/file/d/1hcpN61fDVzTAo6Ce6K4eZGDnMDqMyvIP/view?usp=drivesdk', source: 'backfill_patch' },
    // Figaro Chain (photo_flow — may already exist as shipment-creation photo)
    { drive_url: 'https://drive.google.com/file/d/1bpe4PEE8Ot9XE2Silrq1fWrBGLLuPKuz/view?usp=drivesdk', source: 'backfill_patch' },
  ];

  var existingPhotos = getPhotos(SHP_ID);
  var existingUrls = existingPhotos.map(function(p) { return String(p.drive_url).trim(); });
  var added = 0;

  photosToAdd.forEach(function(p) {
    if (existingUrls.indexOf(p.drive_url.trim()) !== -1) {
      Logger.log('Wilton: photo already exists, skipping');
      return;
    }
    addPhoto({ shipment_id: SHP_ID, drive_url: p.drive_url, source: p.source });
    Logger.log('Wilton: added photo to ' + SHP_ID);
    added++;
  });

  updateShipment(SHP_ID, {
    item:     '4 items: Textured Chain+Pendant, Nugget Bracelet, Fancy Link Bracelet, Figaro Chain',
    estimate: '$12,550 – $13,700 (combined)',
    notes:
      '+ 14K Textured Link Chain w/ Medallion Pendant ~70g ($4,750 – $5,100)\n' +
      '+ 14K Nugget Style Bracelet ~44g ($2,900 – $3,200)\n' +
      '+ 14K Fancy Link Bracelet ~44g ($2,900 – $3,200)\n' +
      '+ 14K Figaro Chain ~30g ($2,000 – $2,200)\n' +
      'Customer note: "Had personal from 1986 to present. Personally owned."'
  });

  Logger.log('Wilton patch complete. Photos added: ' + added + ', shipment updated.');
  Logger.log('=== Done ===');
}
