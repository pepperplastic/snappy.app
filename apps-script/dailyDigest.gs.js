// ═══════════════════════════════════════════════
//  SNAPPY GOLD — Daily Photo Digest
//  Sends 8 AM email with all photos from last 24h
//  Setup: run createDailyDigestTrigger() once
// ═══════════════════════════════════════════════

var DIGEST_EMAIL = 'davidisaacweiss@yahoo.com';

function sendDailyDigest() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var photosSheet   = ss.getSheetByName('Photos');
  var shipmentsSheet = ss.getSheetByName('Shipments');
  var customersSheet = ss.getSheetByName('Customers');

  var now = new Date();
  var cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Build lookups
  var shipRows = shipmentsSheet.getDataRange().getValues();
  var shipHeaders = shipRows[0];
  var ships = {};
  for (var i = 1; i < shipRows.length; i++) {
    var obj = {};
    shipHeaders.forEach(function(h, idx) { obj[h] = shipRows[i][idx]; });
    ships[obj.shipment_id] = obj;
  }

  var custRows = customersSheet.getDataRange().getValues();
  var custHeaders = custRows[0];
  var custs = {};
  for (var i = 1; i < custRows.length; i++) {
    var obj = {};
    custHeaders.forEach(function(h, idx) { obj[h] = custRows[i][idx]; });
    custs[obj.customer_id] = obj;
  }

  // Get photos from last 24h
  var photoRows = photosSheet.getDataRange().getValues();
  var photoHeaders = photoRows[0];
  var recentPhotos = [];

  for (var i = 1; i < photoRows.length; i++) {
    var obj = {};
    photoHeaders.forEach(function(h, idx) { obj[h] = photoRows[i][idx]; });
    var uploadedAt = obj.uploaded_at ? new Date(obj.uploaded_at) : null;
    if (!uploadedAt || uploadedAt < cutoff) continue;
    if (!obj.drive_url || obj.drive_url.indexOf('drive.google.com') === -1) continue;

    var ship = ships[obj.shipment_id] || {};
    var cust = custs[ship.customer_id] || {};

    recentPhotos.push({
      photo_id:   obj.photo_id,
      drive_url:  obj.drive_url,
      shipment_id: obj.shipment_id,
      name:       cust.name     || 'Unknown',
      email:      cust.email    || '',
      phone:      cust.phone    || '',
      item:       ship.item     || '(no item)',
      estimate:   ship.estimate || '',
      stage:      ship.stage    || '',
      uploaded_at: uploadedAt,
    });
  }

  if (recentPhotos.length === 0) {
    Logger.log('Daily digest: no new photos in last 24h, skipping.');
    return;
  }

  // Sort by upload time descending
  recentPhotos.sort(function(a, b) { return b.uploaded_at - a.uploaded_at; });

  // Build HTML email
  var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#F5EFE6;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 16px;">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">' +

    // Header
    '<tr><td style="background:#1A1816;padding:20px 24px;border-radius:8px 8px 0 0;">' +
    '<span style="font-size:22px;font-weight:bold;color:#C8953C;">Snappy</span>' +
    '<span style="font-size:22px;color:#FAF6F0;">.Gold</span>' +
    '<span style="font-size:13px;color:#8B7D70;margin-left:12px;">Daily Photo Digest</span>' +
    '</td></tr>' +

    // Subheader
    '<tr><td style="background:#fff;padding:14px 24px;border-bottom:1px solid #E2D9CC;">' +
    '<span style="font-size:13px;color:#8B7D70;">' + dateStr + ' &nbsp;·&nbsp; ' +
    recentPhotos.length + ' new photo' + (recentPhotos.length !== 1 ? 's' : '') + ' in the last 24 hours</span>' +
    '</td></tr>';

  // One row per photo
  recentPhotos.forEach(function(p, idx) {
    // Extract Drive file ID for thumbnail
    var fileIdMatch = p.drive_url.match(/\/d\/([^\/]+)\//);
    var fileId = fileIdMatch ? fileIdMatch[1] : null;
    var thumbUrl = fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w300' : null;

    var bg = idx % 2 === 0 ? '#fff' : '#FDFAF6';
    var estimateStr = p.estimate ? ' &nbsp;·&nbsp; <strong style="color:#C8953C;">' + p.estimate + '</strong>' : '';
    var phoneStr = p.phone ? String(p.phone).replace(/\D/g, '') : '';
    if (phoneStr.length === 10) phoneStr = '(' + phoneStr.slice(0,3) + ') ' + phoneStr.slice(3,6) + '-' + phoneStr.slice(6);
    else if (phoneStr.length === 11 && phoneStr[0] === '1') phoneStr = '(' + phoneStr.slice(1,4) + ') ' + phoneStr.slice(4,7) + '-' + phoneStr.slice(7);

    html += '<tr><td style="background:' + bg + ';padding:16px 24px;border-bottom:1px solid #E2D9CC;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +

      // Photo thumbnail
      '<td width="120" style="vertical-align:top;padding-right:16px;">' +
      (thumbUrl
        ? '<a href="' + p.drive_url + '" style="display:block;width:100px;height:100px;overflow:hidden;border-radius:6px;border:1px solid #E2D9CC;">' +
          '<img src="' + thumbUrl + '" width="100" height="100" style="object-fit:cover;display:block;" /></a>'
        : '<div style="width:100px;height:100px;background:#F5EFE6;border-radius:6px;border:1px solid #E2D9CC;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8B7D70;">No image</div>'
      ) +
      '</td>' +

      // Details
      '<td style="vertical-align:top;">' +
      '<div style="font-size:14px;font-weight:bold;color:#2C2420;margin-bottom:4px;">' + p.name + '</div>' +
      '<div style="font-size:13px;color:#2C2420;margin-bottom:6px;">' + p.item + estimateStr + '</div>' +
      '<div style="font-size:12px;color:#8B7D70;margin-bottom:2px;">' +
        (p.email ? '<a href="mailto:' + p.email + '" style="color:#C8953C;text-decoration:none;">' + p.email + '</a>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:#8B7D70;margin-bottom:6px;">' +
        (phoneStr ? '<a href="tel:+1' + String(p.phone).replace(/\D/g,'') + '" style="color:#8B7D70;text-decoration:none;">' + phoneStr + '</a>' : '') +
      '</div>' +
      '<div style="font-size:11px;color:#aaa;">' + p.shipment_id + ' &nbsp;·&nbsp; ' + p.stage + '</div>' +
      '</td></tr></table>' +
      '</td></tr>';
  });

  // Footer
  html += '<tr><td style="background:#1A1816;padding:14px 24px;border-radius:0 0 8px 8px;text-align:center;">' +
    '<span style="font-size:11px;color:#555;">DW5 LLC d/b/a Snappy Gold &nbsp;·&nbsp; ' +
    '<a href="https://snappy.gold/crm" style="color:#C8953C;text-decoration:none;">Open CRM</a></span>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  // Send via Postmark
  var payload = {
    From: 'Snappy Gold <hello@snappy.gold>',
    To: DIGEST_EMAIL,
    Subject: 'Daily Photo Digest — ' + recentPhotos.length + ' new photo' + (recentPhotos.length !== 1 ? 's' : '') + ' · ' + dateStr,
    HtmlBody: html,
    MessageStream: 'outbound',
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Postmark-Server-Token': POSTMARK_API_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var res = UrlFetchApp.fetch(POSTMARK_API_URL, options);
  var data = JSON.parse(res.getContentText());
  Logger.log('Daily digest sent: ' + (data.MessageID || JSON.stringify(data)));
}


// ── Setup trigger — run once ─────────────────────
function createDailyDigestTrigger() {
  // Remove any existing digest triggers
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('sendDailyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log('Daily digest trigger created: 8 AM daily');
}


// ── Test — sends immediately ─────────────────────
function testDailyDigest() {
  sendDailyDigest();
}