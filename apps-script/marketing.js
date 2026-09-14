// ═══════════════════════════════════════════════════════════════════════
//  marketing.gs — Ad Spend ledger + Meta spend sync + ROI aggregation (Sep 8)
//
//  WHAT THIS ADDS
//   • "Ad Spend" tab — the single ledger for every marketing dollar. Rows come
//     from three feeders: the Meta Insights API (daily trigger below), a
//     Google Ads Script running inside the Ads account (googleads-spend.js),
//     and manual entries from the CRM (flyers, FlexOffers, anything else).
//     Upserts are keyed on date+channel+campaign+adset so re-pulls restate
//     rather than duplicate (Meta revises spend for ~3 days after the fact).
//   • getMarketingRoi(from, to, mature_days) — one server-side pass that joins
//     spend against first-touch attribution from Lead Intake and the outcome
//     of every shipment those registrations produced. Cached 10 min.
//
//  SETUP (one time)
//   1. Add Script Property META_ADS_TOKEN. Try the existing META_CAPI_TOKEN
//      first — a system-user token assigned to the ad account with ads_read
//      works for both. Run testMetaSpendPull() to find out.
//   2. Run setupAdSpendTab().
//   3. Run backfillMetaSpend() once (pulls the full history in monthly chunks).
//   4. Run createMetaSpendTrigger() — daily ~6am ET, re-pulls the last 7 days.
//   5. Paste googleads-spend.js into Google Ads → Tools → Scripts, authorize,
//      run once, then schedule daily.
//   6. Code.gs: add the five actions to doPost (see EDITS in the chat reply)
//      and to WRITE_ACTIONS in api/crm-proxy.js. Redeploy the web app.
// ═══════════════════════════════════════════════════════════════════════

var AD_SPEND_TAB = 'Ad Spend';
var AD_SPEND_HEADERS = [
  'spend_id','date','channel','campaign','adset','spend','impressions','clicks',
  'source','synced_at','notes'
];
var META_AD_ACCOUNT_ID = '482500379217005';
var META_GRAPH_VERSION = 'v19.0';
var ROI_CACHE_SECS = 600;

// ── helpers ────────────────────────────────────────────────────────────

// Normalise a name for matching across systems: "convert A - CR" (Meta adset
// name) and "convert_a_cr" (utm_content on the landing page) both → "convertacr".
function _mkSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function _mkDateStr(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
  var s = String(d || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  var dd = new Date(s);
  return isNaN(dd.getTime()) ? '' : Utilities.formatDate(dd, 'America/New_York', 'yyyy-MM-dd');
}

function _mkSpendKey(date, channel, campaign, adset) {
  return _mkDateStr(date) + '|' + _mkSlug(channel) + '|' + _mkSlug(campaign) + '|' + _mkSlug(adset);
}

function _adSpendSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(AD_SPEND_TAB);
  if (!sh) {
    sh = ss.insertSheet(AD_SPEND_TAB);
    sh.getRange(1, 1, 1, AD_SPEND_HEADERS.length).setValues([AD_SPEND_HEADERS]);
    sh.getRange(1, 1, 1, AD_SPEND_HEADERS.length).setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    sh.setFrozenRows(1);
  }
  return sh;
}

function setupAdSpendTab() {
  var sh = _adSpendSheet();
  // date column must stay plain text — Sheets will otherwise coerce
  // "2026-09-01" into a Date and the join key drifts by timezone.
  sh.getRange(2, 2, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  Logger.log('Ad Spend tab ready: ' + sh.getLastRow() + ' row(s)');
}

// ── ledger read/write ──────────────────────────────────────────────────

function getAdSpend(opts) {
  opts = opts || {};
  var rows = sheetToObjects(_adSpendSheet());
  rows.forEach(function (r) { r.date = _mkDateStr(r.date); r.spend = parseFloat(r.spend) || 0; });
  if (opts.from) rows = rows.filter(function (r) { return r.date >= opts.from; });
  if (opts.to)   rows = rows.filter(function (r) { return r.date <= opts.to; });
  rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return rows;
}

// Upsert a batch of {date, channel, campaign, adset, spend, impressions, clicks,
// source, notes}. One read, one write. Returns {inserted, updated}.
function upsertAdSpend(entries, source) {
  var sh = _adSpendSheet();
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var col = {}; headers.forEach(function (h, i) { col[h] = i; });
  var keyToRow = {};
  var maxId = 0;
  for (var r = 1; r < data.length; r++) {
    var k = _mkSpendKey(data[r][col.date], data[r][col.channel], data[r][col.campaign], data[r][col.adset]);
    keyToRow[k] = r;
    var m = String(data[r][col.spend_id] || '').match(/ADS-(\d+)/);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  }
  var now = new Date().toISOString();
  var inserted = 0, updated = 0, appendRows = [];
  entries.forEach(function (e) {
    var date = _mkDateStr(e.date);
    if (!date || !e.channel) return;
    var key = _mkSpendKey(date, e.channel, e.campaign || '', e.adset || '');
    var spend = Math.round((parseFloat(e.spend) || 0) * 100) / 100;
    if (keyToRow[key] !== undefined) {
      var rr = keyToRow[key];
      var changed = (parseFloat(data[rr][col.spend]) || 0) !== spend;
      data[rr][col.spend] = spend;
      if (e.impressions !== undefined) data[rr][col.impressions] = e.impressions;
      if (e.clicks !== undefined)      data[rr][col.clicks] = e.clicks;
      data[rr][col.source] = source || e.source || data[rr][col.source];
      data[rr][col.synced_at] = now;
      if (changed) updated++;
    } else {
      maxId++;
      var row = headers.map(function (h) {
        switch (h) {
          case 'spend_id':    return 'ADS-' + String(maxId).padStart(5, '0');
          case 'date':        return date;
          case 'channel':     return String(e.channel).toLowerCase().trim();
          case 'campaign':    return e.campaign || '';
          case 'adset':       return e.adset || '';
          case 'spend':       return spend;
          case 'impressions': return e.impressions || '';
          case 'clicks':      return e.clicks || '';
          case 'source':      return source || e.source || 'manual';
          case 'synced_at':   return now;
          case 'notes':       return e.notes || '';
          default:            return '';
        }
      });
      appendRows.push(row);
      keyToRow[key] = data.length + appendRows.length - 1;
      inserted++;
    }
  });
  if (data.length > 1) sh.getRange(2, 1, data.length - 1, headers.length).setValues(data.slice(1));
  if (appendRows.length) sh.getRange(data.length + 1, 1, appendRows.length, headers.length).setValues(appendRows);
  sh.getRange(2, col.date + 1, Math.max(sh.getLastRow() - 1, 1), 1).setNumberFormat('@');
  _roiCacheBust();
  return { inserted: inserted, updated: updated };
}

// CRM handlers
function handleAddAdSpend(parsed) {
  try {
    var d = parsed.data || {};
    if (!d.date || !d.channel) return { success: false, error: 'date and channel required' };
    if (!(parseFloat(d.spend) >= 0)) return { success: false, error: 'spend must be a number' };
    var r = upsertAdSpend([d], 'manual');
    return { success: true, inserted: r.inserted, updated: r.updated };
  } catch (err) { return { success: false, error: err.toString() }; }
}

function handleDeleteAdSpend(parsed) {
  try {
    var sh = _adSpendSheet();
    var data = sh.getDataRange().getValues();
    var idIdx = data[0].indexOf('spend_id');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === parsed.spend_id) { sh.deleteRow(r + 1); _roiCacheBust(); return { success: true }; }
    }
    return { success: false, error: 'not found' };
  } catch (err) { return { success: false, error: err.toString() }; }
}

// ── Meta Insights pull ─────────────────────────────────────────────────

function _metaAdsToken() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty('META_ADS_TOKEN') || p.getProperty('META_CAPI_TOKEN') || '';
}

// Pull daily spend per ad set for [since, until] (YYYY-MM-DD). Returns entries.
function fetchMetaSpend(since, until) {
  var token = _metaAdsToken();
  if (!token) throw new Error('No META_ADS_TOKEN / META_CAPI_TOKEN in Script Properties');
  var url = 'https://graph.facebook.com/' + META_GRAPH_VERSION + '/act_' + META_AD_ACCOUNT_ID + '/insights' +
    '?level=adset&fields=campaign_name,adset_name,spend,impressions,clicks' +
    '&time_increment=1&limit=500' +
    '&time_range=' + encodeURIComponent(JSON.stringify({ since: since, until: until })) +
    '&access_token=' + encodeURIComponent(token);
  var entries = [];
  var guard = 0;
  while (url && guard++ < 20) {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    var body = JSON.parse(res.getContentText());
    if (code !== 200) {
      var msg = body.error ? (body.error.message + ' (code ' + body.error.code + ')') : res.getContentText().slice(0, 300);
      throw new Error('Meta insights HTTP ' + code + ': ' + msg);
    }
    (body.data || []).forEach(function (d) {
      entries.push({
        date: d.date_start, channel: 'facebook',
        campaign: d.campaign_name || '', adset: d.adset_name || '',
        spend: parseFloat(d.spend) || 0,
        impressions: parseInt(d.impressions, 10) || 0,
        clicks: parseInt(d.clicks, 10) || 0,
      });
    });
    url = body.paging && body.paging.next ? body.paging.next : null;
  }
  return entries;
}

// Daily trigger target. Re-pulls the last 7 days so Meta's restatements land.
function syncMetaSpend(daysBack) {
  // A time-based trigger passes an EVENT OBJECT as the first argument, not a
  // number — so guard the type or the date math turns into NaN (Sep 9 failure).
  daysBack = (typeof daysBack === 'number' && daysBack > 0) ? daysBack : 7;
  var until = new Date();
  var since = new Date(until.getTime() - daysBack * 86400000);
  var entries = fetchMetaSpend(_mkDateStr(since), _mkDateStr(until));
  var r = upsertAdSpend(entries, 'meta_api');
  var total = entries.reduce(function (s, e) { return s + e.spend; }, 0);
  Logger.log('syncMetaSpend: ' + entries.length + ' adset-days, $' + total.toFixed(2) + ' — inserted ' + r.inserted + ', updated ' + r.updated);
  return { success: true, rows: entries.length, spend: total, inserted: r.inserted, updated: r.updated };
}

function handleSyncMetaSpend(parsed) {
  try { return syncMetaSpend(parseInt(parsed && parsed.days_back, 10) || 7); }
  catch (err) { return { success: false, error: err.toString() }; }
}

// One-time: pull everything since first ad spend (Feb 17 2026) in monthly chunks.
function backfillMetaSpend() {
  var start = new Date('2026-02-01T00:00:00');
  var end = new Date();
  var total = 0, rows = 0;
  for (var d = new Date(start); d < end; ) {
    var next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    var until = next < end ? new Date(next.getTime() - 86400000) : end;
    var entries = fetchMetaSpend(_mkDateStr(d), _mkDateStr(until));
    var r = upsertAdSpend(entries, 'meta_api');
    var chunk = entries.reduce(function (s, e) { return s + e.spend; }, 0);
    Logger.log('  ' + _mkDateStr(d) + ' → ' + _mkDateStr(until) + ': ' + entries.length + ' rows, $' + chunk.toFixed(2) + ' (+' + r.inserted + ' new)');
    total += chunk; rows += entries.length;
    d = next;
    Utilities.sleep(300);
  }
  Logger.log('backfillMetaSpend done: ' + rows + ' adset-days, $' + total.toFixed(2) + ' total');
}

function testMetaSpendPull() {
  var until = new Date(), since = new Date(until.getTime() - 3 * 86400000);
  Logger.log('Token present: ' + (_metaAdsToken() ? 'yes' : 'NO'));
  try {
    var e = fetchMetaSpend(_mkDateStr(since), _mkDateStr(until));
    Logger.log('✓ ' + e.length + ' adset-day rows in the last 3 days');
    e.slice(0, 10).forEach(function (x) { Logger.log('  ' + x.date + ' · ' + x.adset + ' · $' + x.spend + ' · ' + x.impressions + ' imp / ' + x.clicks + ' clicks'); });
  } catch (err) {
    Logger.log('✗ ' + err);
    Logger.log('If the error mentions permissions: the token needs ads_read on act_' + META_AD_ACCOUNT_ID + '. Business Settings → System Users → Add Assets → the ad account → Generate token with ads_read.');
  }
}

function createMetaSpendTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMetaSpend') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncMetaSpend').timeBased().atHour(6).everyDays(1).inTimezone('America/New_York').create();
  Logger.log('Trigger created: syncMetaSpend daily ~6am ET');
}

// ── ROI aggregation ────────────────────────────────────────────────────

// Classify a first-touch attribution record into a channel key + label, and a
// sub-key (ad set / campaign) that can be matched to spend rows.
//   ref present     → google if it's a gads ref, else the ref code itself
//                     (affiliates, cfd_flyer, flexoffers all live here)
//   gclid / google  → google
//   fbclid / fb     → facebook, subkey = utm_content (convert_a_cr etc.)
//   other utm_source→ other:<source>
//   nothing         → direct
// Ad-set grouping. Registrations and spend rows both map through this table,
// so tags from different eras and Meta's ad-set names land in the same bucket.
//   CR era:    utm_campaign = convert_a_cr / convert_b_cr  (== ad-set name)
//   leads era: utm_campaign = leads, utm_content = creative (v1, v2c…) — the
//              ad sets "convert" and "convert - Copy" can't be told apart from
//              the tags, so both fold into one "snappy convert" group.
// Diagnose with diagRoiAttribution(); add new campaigns here as you launch them.
var ROI_ADSET_ALIASES = {
  leads: 'snappyconvert', convert: 'snappyconvert', convertcopy: 'snappyconvert',
  retaget: 'retargeting', v2r: 'retargeting', retargetingphotodropoff: 'retargeting',
  snappytrafficadset: 'snappytraffic',
  nophotoquote: 'nophoto',
};
var ROI_GROUP_LABELS = {
  snappyconvert: 'snappy convert (leads era: convert + convert - Copy)',
  convertacr: 'convert A - CR', convertbcr: 'convert B - CR',
  retargeting: 'Retargeting - photo dropoff', snappytraffic: 'snappy traffic',
  nophoto: 'no_photo_quote',
};
function _mkSub(s) { var k = _mkSlug(s); return ROI_ADSET_ALIASES[k] || k; }
function _mkSubLabel(sub, fallback) { return ROI_GROUP_LABELS[sub] || fallback || '(no ad set)'; }
// Facebook registration → group. Campaign first (it carries the ad-set name in
// the CR era); content only when campaign is blank.
function _mkFbSub(a) {
  var raw = a.utm_campaign || a.utm_content || '';
  var sub = _mkSub(raw);
  return { sub: sub, subLabel: _mkSubLabel(sub, raw) };
}

function _mkClassify(a) {
  var ref = String(a.ref || '').trim().toLowerCase();
  if (/^\(?(direct|none|null|undefined)\)?$/.test(ref)) ref = '';   // "(direct)" etc. are not a source
  var src = String(a.utm_source || '').toLowerCase().trim();
  var med = String(a.utm_medium || '').toLowerCase();
  var isFbSrc = /facebook|^fb$|instagram|^ig$|meta/.test(src);
  var isGoogSrc = /google|adwords|gads/.test(src);
  if (ref) {
    if (/^gads/.test(ref)) return { key: 'google', label: 'Google Ads', sub: _mkSub(a.utm_campaign || ref), subLabel: a.utm_campaign || ref };
    // fb_* refs are our own ad tags, not affiliates — fold into the Facebook channel
    if (/^fb_/.test(ref) || (isFbSrc && a.fbclid)) {
      var fb1 = _mkFbSub(a);
      return { key: 'facebook', label: 'Facebook / Instagram', sub: fb1.sub, subLabel: fb1.subLabel };
    }
    return { key: ref, label: ref, sub: '', subLabel: '' };
  }
  if (a.gclid || isGoogSrc || (/cpc/.test(med) && !a.fbclid)) {
    return { key: 'google', label: 'Google Ads', sub: _mkSub(a.utm_campaign), subLabel: a.utm_campaign || '(no campaign)' };
  }
  if (a.fbclid || isFbSrc) {
    var fb2 = _mkFbSub(a);
    return { key: 'facebook', label: 'Facebook / Instagram', sub: fb2.sub, subLabel: fb2.subLabel };
  }
  // utm_source with no click id: key on the source itself so ?ref=flexoffers and
  // utm_source=flexoffers land in the same bucket
  if (src) return { key: src, label: src, sub: '', subLabel: '' };
  return { key: 'direct', label: 'Direct / unknown', sub: '', subLabel: '' };
}

function _mkEmptyMetrics() {
  return { spend: 0, regs: 0, fulfilled: 0, arrived: 0, purchased: 0, returned: 0, paid: 0, appraised: 0, margin: 0, missingAppr: 0,
           rep_fulfilled: 0, rep_arrived: 0, rep_purchased: 0, rep_paid: 0, rep_appraised: 0, rep_margin: 0, rep_missingAppr: 0, inferred: 0 };
}
function _mkAdd(t, m) { Object.keys(m).forEach(function (k) { t[k] += m[k]; }); }

function _roiCacheBust() {
  try { CacheService.getScriptCache().put('ROI_VER', String(Date.now()), 21600); } catch (e) {}
}


// ── ROI INDEX — the expensive Lead Intake pass, precomputed ───────────
// One row per email: first completed registration + first-touch attribution.
// getMarketingRoi reads this (~2k rows) instead of scanning Lead Intake (~17k).
// rebuildRoiIndex() runs on a 15-min trigger (createRoiIndexTrigger()).
var ROI_INDEX_TAB = 'ROI Index';
var ROI_REGS_TAB = 'ROI Regs';   // every registration row: email, ts, channel key, sub label
var ROI_INDEX_HEADERS = ['email','first_reg','attr_ts','utm_source','utm_medium','utm_campaign','utm_content','fbclid','gclid','ref','via'];
var ROI_INDEX_MAX_AGE_MIN = 60;

function _roiScanLeadIntake(ss) {
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var attrByEmail = {}, regByEmail = {}, allRegs = [];
  function attrOf(row, tsD, via) {
    return {
      _ts: tsD, via: via,
      utm_source: String(row[COL.TRAFFIC_SRC] || '').trim(), utm_medium: String(row[COL.MEDIUM] || '').trim(),
      utm_campaign: String(row[COL.CAMPAIGN] || '').trim(), utm_content: String(row[COL.AD_CONTENT] || '').trim(),
      fbclid: String(row[COL.FBCLID] || '').trim(), gclid: String(row[COL.GCLID] || '').trim(),
      ref: String(row[COL.REF] || '').trim(),
    };
  }
  function hasAttr(row) {
    return !!(row[COL.TRAFFIC_SRC] || row[COL.MEDIUM] || row[COL.CAMPAIGN] || row[COL.AD_CONTENT] || row[COL.FBCLID] || row[COL.GCLID] || row[COL.REF]);
  }
  // Pass 1: emailed rows → direct attribution + registration; also index every
  // tagged row by session and by IP for the two fallback lookups below.
  var sessionOf = {};          // email → {sid: true}
  var ipTimesOf = {};          // email → [{ts}] of that email's rows
  var taggedBySession = {};    // sid → earliest tagged row {row, ts}
  var taggedByIp = {};         // ip  → [{row, ts}]
  for (var r = 1; r < lead.length; r++) {
    var row = lead[r];
    var ts = row[COL.TIMESTAMP]; var tsD = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsD.getTime())) continue;
    var sid = String(row[COL.SESSION_ID] || '').trim();
    var ip = String(row[COL.IP] || '').trim();
    var tagged = hasAttr(row);
    if (tagged) {
      if (sid && (!taggedBySession[sid] || tsD < taggedBySession[sid].ts)) taggedBySession[sid] = { row: row, ts: tsD };
      if (ip) (taggedByIp[ip] = taggedByIp[ip] || []).push({ row: row, ts: tsD });
    }
    var em = String(row[COL.EMAIL] || '').toLowerCase().trim();
    if (!em || em.indexOf('@') === -1) continue;
    if (tagged && (!attrByEmail[em] || tsD < attrByEmail[em]._ts)) attrByEmail[em] = attrOf(row, tsD, 'row');
    if (sid) (sessionOf[em] = sessionOf[em] || {})[sid] = true;
    if (ip) (ipTimesOf[em] = ipTimesOf[em] || []).push({ ip: ip, ts: tsD });
    if (String(row[COL.ADDRESS] || '').trim()) {
      if (!regByEmail[em] || tsD < regByEmail[em]) regByEmail[em] = tsD;
      var cls0 = _mkClassify(tagged ? attrOf(row, tsD, 'row') : {});
      allRegs.push({ email: em, ts: tsD, key: cls0.key, label: cls0.label, tagged: tagged });
    }
  }
  // Pass 2: emails with no tagged row of their own — follow their sessions
  // (exact), then their IPs within 90 min (inferred).
  var IP_WINDOW_MS = 24 * 3600000;   // Sep 11: widened from 90 min to 1 day (diagDirectIp: +5 recoveries, 2 risky; wider adds shared-IP noise)
  Object.keys(regByEmail).forEach(function (em) {
    if (attrByEmail[em]) return;
    var sids = Object.keys(sessionOf[em] || {});
    var best = null;
    for (var i = 0; i < sids.length; i++) {
      var t = taggedBySession[sids[i]];
      if (t && (!best || t.ts < best.ts)) best = t;
    }
    if (best) { attrByEmail[em] = attrOf(best.row, best.ts, 'session'); return; }
    var visits = ipTimesOf[em] || [];
    for (var v = 0; v < visits.length && !best; v++) {
      var cands = taggedByIp[visits[v].ip] || [];
      for (var c = 0; c < cands.length; c++) {
        if (Math.abs(cands[c].ts - visits[v].ts) <= IP_WINDOW_MS && (!best || cands[c].ts < best.ts)) best = cands[c];
      }
    }
    if (best) attrByEmail[em] = attrOf(best.row, best.ts, 'ip');
  });
  return { attrByEmail: attrByEmail, regByEmail: regByEmail, allRegs: allRegs };
}

function rebuildRoiIndex() {
  var t0 = Date.now();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var scan = _roiScanLeadIntake(ss);
  var emails = {};
  Object.keys(scan.attrByEmail).forEach(function (e) { emails[e] = true; });
  Object.keys(scan.regByEmail).forEach(function (e) { emails[e] = true; });
  var rows = Object.keys(emails).map(function (e) {
    var a = scan.attrByEmail[e] || {};
    var reg = scan.regByEmail[e];
    return [e, reg ? reg.toISOString() : '', a._ts ? a._ts.toISOString() : '',
      a.utm_source || '', a.utm_medium || '', a.utm_campaign || '', a.utm_content || '', a.fbclid || '', a.gclid || '', a.ref || '', a.via || ''];
  });
  var sh = ss.getSheetByName(ROI_INDEX_TAB);
  if (!sh) { sh = ss.insertSheet(ROI_INDEX_TAB); sh.setFrozenRows(1); }
  sh.clearContents();
  sh.getRange(1, 1, 1, ROI_INDEX_HEADERS.length).setValues([ROI_INDEX_HEADERS]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, ROI_INDEX_HEADERS.length).setNumberFormat('@').setValues(rows);
  }
  var rsh = ss.getSheetByName(ROI_REGS_TAB);
  if (!rsh) { rsh = ss.insertSheet(ROI_REGS_TAB); rsh.setFrozenRows(1); }
  rsh.clearContents();
  rsh.getRange(1, 1, 1, 5).setValues([['email','ts','key','label','tagged']]);
  var regRows = scan.allRegs.map(function (g) { return [g.email, g.ts.toISOString(), g.key, g.label, g.tagged ? 'y' : '']; });
  if (regRows.length) rsh.getRange(2, 1, regRows.length, 5).setNumberFormat('@').setValues(regRows);
  PropertiesService.getScriptProperties().setProperty('ROI_INDEX_AT', new Date().toISOString());
  _roiCacheBust();
  Logger.log('rebuildRoiIndex: ' + rows.length + ' emails in ' + (Date.now() - t0) + 'ms');
  return rows.length;
}

function _roiLoadIndex(ss) {
  try {
    var at = PropertiesService.getScriptProperties().getProperty('ROI_INDEX_AT');
    var sh = ss.getSheetByName(ROI_INDEX_TAB);
    if (at && sh && (Date.now() - new Date(at).getTime()) < ROI_INDEX_MAX_AGE_MIN * 60000) {
      var data = sh.getDataRange().getValues();
      var h = data[0]; var c = {}; h.forEach(function (x, i) { c[x] = i; });
      var attrByEmail = {}, regByEmail = {};
      for (var r = 1; r < data.length; r++) {
        var em = String(data[r][c.email] || '');
        if (!em) continue;
        if (data[r][c.first_reg]) { var d = new Date(data[r][c.first_reg]); if (!isNaN(d.getTime())) regByEmail[em] = d; }
        if (data[r][c.attr_ts]) {
          attrByEmail[em] = { _ts: new Date(data[r][c.attr_ts]),
            utm_source: String(data[r][c.utm_source] || ''), utm_medium: String(data[r][c.utm_medium] || ''),
            utm_campaign: String(data[r][c.utm_campaign] || ''), utm_content: String(data[r][c.utm_content] || ''),
            fbclid: String(data[r][c.fbclid] || ''), gclid: String(data[r][c.gclid] || ''), ref: String(data[r][c.ref] || ''),
            via: c.via !== undefined ? String(data[r][c.via] || '') : 'row' };
        }
      }
      var allRegs = [];
      try {
        var rsh = ss.getSheetByName(ROI_REGS_TAB);
        if (rsh) { var rd = rsh.getDataRange().getValues();
          for (var q = 1; q < rd.length; q++) { var t = new Date(rd[q][1]); if (!isNaN(t.getTime())) allRegs.push({ email: String(rd[q][0]), ts: t, key: String(rd[q][2]), label: String(rd[q][3]), tagged: rd[q][4] === 'y' }); } }
      } catch (e2) {}
      return { attrByEmail: attrByEmail, regByEmail: regByEmail, allRegs: allRegs, source: 'index' };
    }
  } catch (e) { Logger.log('ROI index unavailable, scanning live: ' + e); }
  var live = _roiScanLeadIntake(ss); live.source = 'live'; return live;
}

function createRoiIndexTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildRoiIndex') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildRoiIndex').timeBased().everyMinutes(15).create();
  Logger.log('Trigger created: rebuildRoiIndex every 15 min');
}

function getMarketingRoi(parsed) {
  parsed = parsed || {};
  var to   = parsed.to   || _mkDateStr(new Date());
  var from = parsed.from || '2026-01-01';
  var matureDays = parseInt(parsed.mature_days, 10) || 30;
  // Outlier guard: purchases paid above this are kept in the counts (reg, arrival,
  // purchase) but their dollars are dropped from paid/appraised/margin. 0 = off.
  var excludeOver = parseFloat(parsed.exclude_over) || 0;
  var cache = CacheService.getScriptCache();
  var ver = cache.get('ROI_VER') || '0';
  var cacheKey = 'ROI|' + ver + '|' + from + '|' + to + '|' + matureDays + '|' + excludeOver;
  if (!parsed.nocache) {
    var hit = cache.get(cacheKey);
    if (hit) { var o = JSON.parse(hit); o.cached = true; return o; }
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var now = new Date();
  var matureCutoff = new Date(now.getTime() - matureDays * 86400000);
  var fromDate = new Date(from + 'T00:00:00');
  var toDate   = new Date(to + 'T23:59:59');

  // 1. Per-email first attribution + first registration. Served from the
  //    "ROI Index" tab (rebuilt every 15 min by rebuildRoiIndex) when it is
  //    fresh; otherwise scanned live from Lead Intake (~8s on 17k rows).
  var idx = _roiLoadIndex(ss);
  var attrByEmail = idx.attrByEmail, regByEmail = idx.regByEmail;

  // 2. Customers: email → customer_id
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var custIdByEmail = {};
  custs.forEach(function (c) { var e = String(c.email || '').toLowerCase().trim(); if (e && c.customer_id) custIdByEmail[e] = c.customer_id; });

  // 3. Shipments grouped by customer
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var shipsByCust = {};
  ships.forEach(function (s) { if (s.customer_id) (shipsByCust[s.customer_id] = shipsByCust[s.customer_id] || []).push(s); });
  var ARRIVED = ['received', 'inspected', 'pending_response', 'pending_payment', 'pending_leadsonline', 'complete', 'returned'];
  var PURCHASED = ['complete', 'pending_payment', 'pending_leadsonline'];
  var FULFILLED = ['outbound_complete'].concat(ARRIVED);   // a label went out (or further)
  // Repeat flag: a shipment is a repeat if the same customer had an EARLIER
  // shipment that arrived. Walk each customer's shipments oldest→newest.
  Object.keys(shipsByCust).forEach(function (cid) {
    var list = shipsByCust[cid].slice().sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
    var seenArrived = false;
    list.forEach(function (s) {
      s._repeat = seenArrived;
      var st = String(s.stage || '').toLowerCase();
      if (ARRIVED.indexOf(st) !== -1 || String(s.received_at || '').trim()) seenArrived = true;
    });
  });

  // Registration touches per email, for "what brought the repeater back"
  var regsByEmail = {};
  (idx.allRegs || []).forEach(function (g) { (regsByEmail[g.email] = regsByEmail[g.email] || []).push(g); });
  var repeatSources = {};   // key → {key,label,fulfilled,arrived,purchased,paid}
  var repeatRegs = 0;       // registrations by people who already registered before
  Object.keys(regsByEmail).forEach(function (em) { if (regsByEmail[em].length > 1) repeatRegs += regsByEmail[em].length - 1; });
  function returnTouch(em, shipCreated) {
    // the registration row nearest (within 2 days before/after) the repeat shipment's creation
    var list = regsByEmail[em] || [], best = null, bestGap = 2 * 86400000;
    for (var i = 0; i < list.length; i++) {
      var gap = Math.abs(list[i].ts.getTime() - shipCreated);
      if (gap <= bestGap) { bestGap = gap; best = list[i]; }
    }
    if (!best) return { key: 'no_reregistration', label: 'No new registration (kit reused / label resent)' };
    if (!best.tagged) return { key: 'untagged_return', label: 'Untagged return (typed URL / bookmark / our email)' };
    return { key: best.key, label: best.label };
  }

  // 4. Walk the registration cohort in the window
  var channels = {};   // key → {key,label,all,mature,adsets:{}}
  var excluded = { count: 0, paid: 0, appraised: 0, shipments: [] };
  var weekly = {};     // weekStart → {spend, regs, arrived, purchased, paid}
  function week(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return _mkDateStr(x); }
  function chan(cls) {
    if (!channels[cls.key]) channels[cls.key] = { key: cls.key, label: cls.label, all: _mkEmptyMetrics(), mature: _mkEmptyMetrics(), adsets: {} };
    return channels[cls.key];
  }
  function adset(ch, cls) {
    var k = cls.sub || '_';
    if (!ch.adsets[k]) ch.adsets[k] = { key: k, label: cls.subLabel || '(unattributed within channel)', all: _mkEmptyMetrics(), mature: _mkEmptyMetrics() };
    return ch.adsets[k];
  }

  Object.keys(regByEmail).forEach(function (em) {
    var reg = regByEmail[em];
    if (reg < fromDate || reg > toDate) return;
    var cls = _mkClassify(attrByEmail[em] || {});
    var m = _mkEmptyMetrics(); m.regs = 1;
    var cid = custIdByEmail[em];
    var mine = cid ? (shipsByCust[cid] || []) : [];
    var since = reg.getTime() - 86400000;   // registration creates the shipment; allow a day of slack
    mine.forEach(function (s) {
      var c = s.created_at ? new Date(s.created_at) : null;
      if (!c || isNaN(c.getTime()) || c.getTime() < since) return;
      var st = String(s.stage || '').toLowerCase();
      var arrived = ARRIVED.indexOf(st) !== -1 || !!String(s.received_at || '').trim();
      var rep = !!s._repeat;
      var fulfilled = FULFILLED.indexOf(st) !== -1 || !!String(s.outbound_tracking || '').trim();
      if (fulfilled) { m.fulfilled++; if (rep) m.rep_fulfilled++; }
      var rs = null;
      if (rep && fulfilled) {
        var rt = returnTouch(em, c.getTime());
        rs = repeatSources[rt.key] = repeatSources[rt.key] || { key: rt.key, label: rt.label, fulfilled: 0, arrived: 0, purchased: 0, paid: 0 };
        rs.fulfilled++;
      }
      if (arrived) { m.arrived++; if (rep) m.rep_arrived++; if (rs) rs.arrived++; }
      if (st === 'returned') m.returned++;
      if (PURCHASED.indexOf(st) !== -1) {
        m.purchased++; if (rep) m.rep_purchased++;
        var paid = parseFloat(s.purchase_price) || 0, appr = parseFloat(s.appraised_value) || 0;
        if (excludeOver > 0 && paid > excludeOver) {
          excluded.count++; excluded.paid += paid; excluded.appraised += appr;
          excluded.shipments.push({ shipment_id: s.shipment_id, paid: paid, appraised: appr, repeat: rep });
          return;
        }
        m.paid += paid; m.appraised += appr;
        if (appr > 0) m.margin += (appr - paid); else m.missingAppr++;
        if (rs) { rs.purchased++; rs.paid += paid; }
        if (rep) { m.rep_paid += paid; m.rep_appraised += appr; if (appr > 0) m.rep_margin += (appr - paid); else m.rep_missingAppr++; }
      }
    });
    if (attrByEmail[em] && attrByEmail[em].via && attrByEmail[em].via !== 'row') m.inferred = 1;
    var ch = chan(cls), as = adset(ch, cls);
    _mkAdd(ch.all, m); _mkAdd(as.all, m);
    var isMature = reg <= matureCutoff;
    if (isMature) { _mkAdd(ch.mature, m); _mkAdd(as.mature, m); }
    var wk = week(reg);
    if (!weekly[wk]) weekly[wk] = { week: wk, spend: 0, regs: 0, fulfilled: 0, arrived: 0, purchased: 0, paid: 0, mature: isMature, by: {} };
    weekly[wk].fulfilled += m.fulfilled; weekly[wk].regs += m.regs; weekly[wk].arrived += m.arrived; weekly[wk].purchased += m.purchased; weekly[wk].paid += m.paid;
    var wb = weekly[wk].by[cls.key] = weekly[wk].by[cls.key] || { spend: 0, regs: 0, fulfilled: 0, arrived: 0, purchased: 0, paid: 0 };
    wb.fulfilled += m.fulfilled; wb.regs += m.regs; wb.arrived += m.arrived; wb.purchased += m.purchased; wb.paid += m.paid;
  });

  // 5. Spend in the window, joined by channel + adset slug
  var spendRows = getAdSpend({ from: from, to: to });
  var matureDateStr = _mkDateStr(matureCutoff);
  var unmatched = { all: 0, mature: 0 };
  var freshness = {};
  spendRows.forEach(function (sp) {
    var chKey = String(sp.channel || '').toLowerCase().trim();
    if (!freshness[chKey] || sp.date > freshness[chKey]) freshness[chKey] = sp.date;
    var ch = channels[chKey];
    var isMature = sp.date <= matureDateStr;
    var wk = week(new Date(sp.date + 'T12:00:00'));
    if (!weekly[wk]) weekly[wk] = { week: wk, spend: 0, regs: 0, arrived: 0, purchased: 0, paid: 0, mature: isMature, by: {} };
    weekly[wk].spend += sp.spend;
    var wbs = weekly[wk].by[chKey] = weekly[wk].by[chKey] || { spend: 0, regs: 0, arrived: 0, purchased: 0, paid: 0 };
    wbs.spend += sp.spend;
    if (!ch) {
      var lbl = chKey === 'facebook' ? 'Facebook / Instagram' : chKey === 'google' ? 'Google Ads' : chKey;
      ch = channels[chKey] = { key: chKey, label: lbl, all: _mkEmptyMetrics(), mature: _mkEmptyMetrics(), adsets: {} };
    }
    ch.all.spend += sp.spend; if (isMature) ch.mature.spend += sp.spend;
    var subKey = _mkSub(sp.adset) || _mkSub(sp.campaign);
    var as = subKey && (ch.adsets[subKey] || ch.adsets[_mkSub(sp.campaign)]);
    if (as) { as.all.spend += sp.spend; if (isMature) as.mature.spend += sp.spend; }
    else if (subKey) {
      // spend for an ad set that produced no registrations in this window — still real money
      ch.adsets[subKey] = { key: subKey, label: _mkSubLabel(subKey, sp.adset || sp.campaign), all: _mkEmptyMetrics(), mature: _mkEmptyMetrics() };
      ch.adsets[subKey].all.spend += sp.spend; if (isMature) ch.adsets[subKey].mature.spend += sp.spend;
    } else { unmatched.all += sp.spend; if (isMature) unmatched.mature += sp.spend; }
  });

  // 6. Shape output
  var totals = { all: _mkEmptyMetrics(), mature: _mkEmptyMetrics() };
  var chanList = Object.keys(channels).map(function (k) {
    var ch = channels[k];
    _mkAdd(totals.all, ch.all); _mkAdd(totals.mature, ch.mature);
    var adsets = Object.keys(ch.adsets).map(function (a) { return ch.adsets[a]; })
      .sort(function (a, b) { return (b.all.spend + b.all.regs) - (a.all.spend + a.all.regs); });
    return { key: ch.key, label: ch.label, all: ch.all, mature: ch.mature, adsets: adsets };
  }).sort(function (a, b) { return (b.all.spend || 0) - (a.all.spend || 0) || b.all.regs - a.all.regs; });

  var out = {
    success: true, from: from, to: to, mature_days: matureDays, exclude_over: excludeOver, generated_at: now.toISOString(),
    excluded: excluded, index_source: idx.source,
    repeat_sources: Object.keys(repeatSources).map(function (k) { return repeatSources[k]; }).sort(function (a, b) { return b.fulfilled - a.fulfilled; }),
    repeat_registrations: repeatRegs,
    totals: totals, channels: chanList, unmatched_spend: unmatched, spend_freshness: freshness,
    weekly: Object.keys(weekly).sort().map(function (k) { return weekly[k]; }),
  };
  try { cache.put(cacheKey, JSON.stringify(out), ROI_CACHE_SECS); } catch (e) { Logger.log('ROI cache put skipped: ' + e); }
  return out;
}

// ── DIAGNOSTIC: what do Facebook registrations actually carry in their UTMs? ──
// Prints the top (utm_campaign | utm_content | ref) combos among registrations
// classified as Facebook, alongside the ad-set names Meta uses, so you can see
// which registration tags need an entry in ROI_ADSET_ALIASES.
function diagRoiAttribution() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var attrByEmail = {}, regEmails = {};
  for (var r = 1; r < lead.length; r++) {
    var row = lead[r];
    var em = String(row[COL.EMAIL] || '').toLowerCase().trim();
    if (!em || em.indexOf('@') === -1) continue;
    var ts = row[COL.TIMESTAMP]; var tsD = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsD.getTime())) continue;
    var hasAttr = !!(row[COL.TRAFFIC_SRC] || row[COL.MEDIUM] || row[COL.CAMPAIGN] || row[COL.AD_CONTENT] || row[COL.FBCLID] || row[COL.GCLID] || row[COL.REF]);
    if (hasAttr && (!attrByEmail[em] || tsD < attrByEmail[em]._ts)) {
      attrByEmail[em] = { _ts: tsD, utm_source: String(row[COL.TRAFFIC_SRC]||'').trim(), utm_medium: String(row[COL.MEDIUM]||'').trim(),
        utm_campaign: String(row[COL.CAMPAIGN]||'').trim(), utm_content: String(row[COL.AD_CONTENT]||'').trim(),
        fbclid: String(row[COL.FBCLID]||'').trim(), gclid: String(row[COL.GCLID]||'').trim(), ref: String(row[COL.REF]||'').trim() };
    }
    if (String(row[COL.ADDRESS] || '').trim()) regEmails[em] = true;
  }
  var combos = {}, byChannel = {};
  Object.keys(regEmails).forEach(function (em) {
    var a = attrByEmail[em] || {};
    var cls = _mkClassify(a);
    byChannel[cls.key] = (byChannel[cls.key] || 0) + 1;
    if (cls.key !== 'facebook') return;
    var k = 'campaign="' + (a.utm_campaign||'') + '" | content="' + (a.utm_content||'') + '" | ref="' + (a.ref||'') + '" → sub=' + (cls.sub||'(none)');
    combos[k] = (combos[k] || 0) + 1;
  });
  Logger.log('═══ REGISTRATIONS BY CHANNEL KEY ═══');
  Object.keys(byChannel).sort(function(a,b){return byChannel[b]-byChannel[a];}).forEach(function(k){ Logger.log('  ' + byChannel[k] + '  ' + k); });
  Logger.log('');
  Logger.log('═══ FACEBOOK REGISTRATION TAGS (top 30) ═══');
  Object.keys(combos).sort(function(a,b){return combos[b]-combos[a];}).slice(0,30).forEach(function(k){ Logger.log('  ' + combos[k] + '  ' + k); });
  Logger.log('');
  Logger.log('═══ META AD-SET NAMES IN THE LEDGER (with slug) ═══');
  var seen = {};
  getAdSpend({}).forEach(function(sp){ if (sp.channel==='facebook') { var k = sp.campaign + ' / ' + sp.adset; if(!seen[k]) { seen[k]=0; } seen[k]+=sp.spend; } });
  Object.keys(seen).sort(function(a,b){return seen[b]-seen[a];}).forEach(function(k){ Logger.log('  $' + seen[k].toFixed(0) + '  ' + k + '  → slug ' + _mkSlug(k.split(' / ')[1])); });
  Logger.log('');
  Logger.log('Add mismatches to ROI_ADSET_ALIASES as  registrationSlug: metaAdsetSlug  and re-run testMarketingRoi().');
}


// ── DIAGNOSTIC: what is "Direct / unknown" really made of? ──
// For every registration that still classifies as direct after the session +
// IP lookups, report: repeat customer?, Lead Intake Type, month, and how many
// the two lookups reclassified. Run diagDirect() and read the log.
function diagDirect() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var scan = _roiScanLeadIntake(ss);
  var custs = sheetToObjects(ss.getSheetByName(TAB.CUSTOMERS));
  var custIdByEmail = {}; custs.forEach(function (c) { var e = String(c.email || '').toLowerCase().trim(); if (e) custIdByEmail[e] = c.customer_id; });
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var ARR = ['received','inspected','pending_response','pending_payment','pending_leadsonline','complete','returned'];
  var firstArrivedByCust = {};
  ships.forEach(function (s) {
    if (!s.customer_id || !s.created_at) return;
    if (ARR.indexOf(String(s.stage||'').toLowerCase()) === -1 && !String(s.received_at||'').trim()) return;
    var d = new Date(s.created_at); if (isNaN(d.getTime())) return;
    if (!firstArrivedByCust[s.customer_id] || d < firstArrivedByCust[s.customer_id]) firstArrivedByCust[s.customer_id] = d;
  });
  // Lead Intake Type of the registration row per email
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var typeByEmail = {};
  for (var r = 1; r < lead.length; r++) {
    var em = String(lead[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em || !String(lead[r][COL.ADDRESS] || '').trim()) continue;
    if (!typeByEmail[em]) typeByEmail[em] = String(lead[r][COL.TYPE] || '(blank)');
  }
  var via = { row: 0, session: 0, ip: 0, none: 0 };
  var direct = [];
  Object.keys(scan.regByEmail).forEach(function (em) {
    var a = scan.attrByEmail[em];
    if (a) via[a.via || 'row'] = (via[a.via || 'row'] || 0) + 1; else via.none++;
    var cls = _mkClassify(a || {});
    if (cls.key !== 'direct') return;
    var reg = scan.regByEmail[em];
    var cid = custIdByEmail[em];
    var fa = cid ? firstArrivedByCust[cid] : null;
    direct.push({ email: em, reg: reg, repeat: !!(fa && fa < new Date(reg.getTime() - 86400000)), type: typeByEmail[em] || '(unknown)',
      arrivedLater: !!fa });
  });
  var byType = {}, byMonth = {}, rep = 0, arrived = 0;
  direct.forEach(function (d) {
    byType[d.type] = (byType[d.type] || 0) + 1;
    var mo = d.reg.toISOString().slice(0, 7); byMonth[mo] = (byMonth[mo] || 0) + 1;
    if (d.repeat) rep++; if (d.arrivedLater) arrived++;
  });
  Logger.log('═══ ATTRIBUTION SOURCE FOR ALL ' + Object.keys(scan.regByEmail).length + ' REGISTRATIONS ═══');
  Logger.log('  own tagged row: ' + via.row + ' · via session link: ' + via.session + ' · via IP+90min: ' + via.ip + ' · nothing found: ' + via.none);
  Logger.log('');
  Logger.log('═══ STILL DIRECT: ' + direct.length + ' registrations ═══');
  Logger.log('  repeat customers (had an arrived shipment before registering again): ' + rep);
  Logger.log('  ever arrived: ' + arrived);
  Logger.log('  by Lead Intake Type:'); Object.keys(byType).sort(function(a,b){return byType[b]-byType[a];}).forEach(function(k){ Logger.log('    ' + byType[k] + '  ' + k); });
  Logger.log('  by month:'); Object.keys(byMonth).sort().forEach(function(k){ Logger.log('    ' + k + '  ' + byMonth[k]); });
  Logger.log('');
  Logger.log('Reading it: repeat = returning sellers (bookmark/typed URL); manual_entry = you keyed them in; a month that');
  Logger.log('spikes with ad spend but no tags = ad traffic losing its click id (Safari/in-app browsers). The rest is organic.');
}

function handleGetMarketingRoi(parsed) {
  try { return getMarketingRoi(parsed); }
  catch (err) { return { success: false, error: err.toString() }; }
}

// Editor smoke test
function testMarketingRoi() {
  var t0 = Date.now();
  var r = getMarketingRoi({ from: '2026-01-01', to: _mkDateStr(new Date()), mature_days: 30, nocache: true });
  Logger.log('getMarketingRoi in ' + (Date.now() - t0) + 'ms');
  Logger.log('Totals (all): ' + JSON.stringify(r.totals.all));
  r.channels.forEach(function (c) {
    var a = c.all;
    Logger.log('  ' + c.label + ': spend $' + a.spend.toFixed(0) + ' · regs ' + a.regs + ' · fulfilled ' + a.fulfilled + ' · arrived ' + a.arrived + ' · bought ' + a.purchased + ' · margin $' + a.margin.toFixed(0) +
      (a.arrived ? ' · $' + (a.spend / a.arrived).toFixed(0) + '/arrival' : ''));
    c.adsets.slice(0, 5).forEach(function (s) { Logger.log('      ' + s.label + ': $' + s.all.spend.toFixed(0) + ' · ' + s.all.regs + ' regs · ' + s.all.arrived + ' arrived'); });
  });
  Logger.log('Unmatched spend: ' + JSON.stringify(r.unmatched_spend) + ' · freshness: ' + JSON.stringify(r.spend_freshness));
}
