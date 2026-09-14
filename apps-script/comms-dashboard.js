// ═══════════════════════════════════════════════════════════════════════
//  comms-dashboard.gs — data for the CRM "Comms" tab (Sep 14 2026)
//
//  getCommsDashboard (read-only, cached 5 min):
//    sequences  — per-sequence trigger status + last send / 7d / 30d / total,
//                 read from the stamps each sender already writes
//    postmark   — /stats/outbound for the 'outbound' + broadcast streams and
//                 the recovery / referral-invite / re-engage tags, 7d and 30d
//    dnc        — Do Not Contact total, added in 7d, last 5 rows
//    due        — the drip and post-label v2 dry-run "would send" lists
//  addDoNotContact wraps dncAddPerson(value, reason, 'crm') and busts the cache.
// ═══════════════════════════════════════════════════════════════════════

var COMMS_CACHE_KEY = 'COMMS_DASH_V1';
var COMMS_CACHE_SEC = 300;
var COMMS_DAY_MS = 86400000;

function _commsDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T12:00:00';                       // date-only stamps: midday, so the day doesn't shift
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T'); // "yyyy-MM-dd HH:mm:ss" (script time zone)
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// times: one entry per send (null when the send's date is unknown — still counts toward total)
function _commsTally(times, now) {
  var last = null, d7 = 0, d30 = 0;
  times.forEach(function (t) {
    if (!t) return;
    var age = now.getTime() - t.getTime();
    if (!last || t > last) last = t;
    if (age <= 7 * COMMS_DAY_MS) d7++;
    if (age <= 30 * COMMS_DAY_MS) d30++;
  });
  return { last_send: last ? last.toISOString() : null, sent_7d: d7, sent_30d: d30, total: times.length };
}

function _commsSafe(fn) {
  try { return fn(); } catch (e) { Logger.log('comms dashboard: ' + e); return { error: String(e && e.message || e) }; }
}

// ── (a) sequence health ────────────────────────────────────────────────
function _commsSequences(now) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var installed = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { installed[t.getHandlerFunction()] = true; });

  // Lead Intake: email + AUTO_REPLY columns only
  var leadsSh = ss.getSheetByName(TAB.LEADS), nLeads = leadsSh.getLastRow() - 1;
  var leadEmails = nLeads > 0 ? leadsSh.getRange(2, COL.EMAIL + 1, nLeads, 1).getValues() : [];
  var leadY = nLeads > 0 ? leadsSh.getRange(2, COL.AUTO_REPLY + 1, nLeads, 1).getValues() : [];
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));

  var seqs = [
    { key: 'drip', label: 'Pre-registration drip', handlers: ['sendFollowUpEmails_v3'], source: 'Lead Intake AUTO_REPLY · INCOMPLETE_1/2/3',
      collect: function () {
        // The drip stamps the same status on every row of a lead, so dedupe by email + stage + time.
        var seen = {}, times = [];
        for (var i = 0; i < leadY.length; i++) {
          var y = String(leadY[i][0] || ''); if (y.indexOf('INCOMPLETE_') === -1) continue;
          var em = String(leadEmails[i][0] || '').trim().toLowerCase();
          var re = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\|\s*(INCOMPLETE_[123])\s*\|/g, m;
          while ((m = re.exec(y)) !== null) {
            var k = em + '|' + m[2] + '|' + m[1];
            if (seen[k]) continue;
            seen[k] = true; times.push(_commsDate(m[1]));
          }
        }
        return _commsTally(times, now);
      } },
    { key: 'reg_alert', label: 'Registration alerts', handlers: ['notifyNewRegistrations'], source: 'Script Property REG_ALERT_LAST_ISO',
      collect: function () {
        // Only the newest alerted registration's created_at is stored — no history to count.
        var d = _commsDate(PropertiesService.getScriptProperties().getProperty('REG_ALERT_LAST_ISO'));
        return { last_send: d ? d.toISOString() : null, sent_7d: null, sent_30d: null, total: null, note: 'only the last alert time is recorded' };
      } },
    { key: 'post_label', label: 'Post-label v2', handlers: ['sendPostLabelFollowups_v2'], source: 'Shipments.ship_followups_sent',
      collect: function () {
        // The column holds touch keys only, so a send's date is estimated as sent_at + the touch's day.
        var dayByKey = {}; PL2_TOUCHES.forEach(function (t) { dayByKey[t.key] = t.day; });
        var times = [];
        ships.forEach(function (s) {
          var sentAt = _commsDate(s.sent_at);
          String(s.ship_followups_sent || '').split(',').forEach(function (k) {
            k = k.trim(); if (!(k in dayByKey)) return;
            times.push(sentAt ? new Date(sentAt.getTime() + dayByKey[k] * COMMS_DAY_MS) : null);
          });
        });
        var r = _commsTally(times, now); r.estimated = true; r.note = 'dates estimated from sent_at + touch day';
        return r;
      } },
    { key: 'label_expiry', label: 'Label expiry', handlers: ['processDailyRefunds'], source: 'Shipments.label_refunded_at',
      collect: function () {
        var times = [];
        ships.forEach(function (s) { if (String(s.label_refunded_at || '').trim()) times.push(_commsDate(s.label_refunded_at)); });
        return _commsTally(times, now);
      } },
    { key: 'offers', label: 'Offers', handlers: [], manual: true, source: 'Contact Log type=offer',
      collect: function () {
        var times = [];
        sheetToObjects(ss.getSheetByName(TAB.CONTACT_LOG)).forEach(function (l) {
          if (String(l.type || '').trim().toLowerCase() === 'offer') times.push(_commsDate(l.timestamp));
        });
        return _commsTally(times, now);
      } },
    { key: 'reengage', label: 'Re-engagement', handlers: ['reengageSend', 'reengageSend25', 'reengageSend100'], manual: true, source: 'Shipments.reengage_sent_at',
      collect: function () {
        var times = [];
        ships.forEach(function (s) { if (String(s.reengage_sent_at || '').trim()) times.push(_commsDate(s.reengage_sent_at)); });
        return _commsTally(times, now);
      } },
    { key: 'recovery', label: 'Recovery', handlers: ['recoveryEmailSend'], manual: true, source: 'Lead Intake AUTO_REPLY · RECOV:',
      collect: function () {
        var times = [];
        for (var i = 0; i < leadY.length; i++) {
          var re = /RECOV:(\d{4}-\d{2}-\d{2})/g, m, y = String(leadY[i][0] || '');
          while ((m = re.exec(y)) !== null) times.push(_commsDate(m[1]));
        }
        return _commsTally(times, now);
      } },
    { key: 'referral', label: 'Referral invites', handlers: ['sendReferralInvites'], manual: true, source: 'Affiliates notes · invited',
      collect: function () {
        var sh = ss.getSheetByName('Affiliates'), times = [];
        if (sh) sheetToObjects(sh).forEach(function (a) {
          var m = String(a.notes || '').match(/\binvited (\d{4}-\d{2}-\d{2})/);
          if (m) times.push(_commsDate(m[1]));
        });
        return _commsTally(times, now);
      } },
  ];

  return seqs.map(function (q) {
    var found = q.handlers.filter(function (h) { return installed[h]; });
    var stats = _commsSafe(q.collect);
    var out = { key: q.key, label: q.label, source: q.source, manual: !!q.manual,
                trigger_installed: found.length > 0, trigger_handlers: found, expected_handlers: q.handlers };
    Object.keys(stats).forEach(function (k) { out[k] = stats[k]; });
    return out;
  });
}

// ── (b) Postmark deliverability ────────────────────────────────────────
function _commsPostmark() {
  var token = PropertiesService.getScriptProperties().getProperty('POSTMARK_API_TOKEN') || '';
  if (!token) return { error: 'POSTMARK_API_TOKEN not set' };
  var bStream = _reengageStream();
  var bToken = _reengageToken();   // = POSTMARK_API_TOKEN unless POSTMARK_BROADCAST_TOKEN points at another server
  // recovery, referral-invite and re-engage all send on the broadcast stream, and
  // Postmark stats default to the transactional stream, so the tag rows filter by it.
  var rows = [
    { key: 'outbound', label: 'outbound', kind: 'stream', stream: 'outbound', token: token },
    { key: 'broadcast', label: bStream, kind: 'stream', stream: bStream, token: bToken },
    { key: 'tag:recovery', label: 'recovery', kind: 'tag', stream: bStream, tag: 'recovery', token: bToken },
    { key: 'tag:referral-invite', label: 'referral-invite', kind: 'tag', stream: bStream, tag: 'referral-invite', token: bToken },
    { key: 'tag:' + REENGAGE_TAG, label: REENGAGE_TAG, kind: 'tag', stream: bStream, tag: REENGAGE_TAG, token: bToken },
  ];
  var tz = Session.getScriptTimeZone(), now = Date.now();
  var today = Utilities.formatDate(new Date(now), tz, 'yyyy-MM-dd');
  var windows = [['d7', 6], ['d30', 29]];   // inclusive of today
  var reqs = [], slots = [];
  rows.forEach(function (row) {
    windows.forEach(function (w) {
      var from = Utilities.formatDate(new Date(now - w[1] * COMMS_DAY_MS), tz, 'yyyy-MM-dd');
      reqs.push({
        url: 'https://api.postmarkapp.com/stats/outbound?fromdate=' + from + '&todate=' + today +
             '&messagestream=' + encodeURIComponent(row.stream) + (row.tag ? '&tag=' + encodeURIComponent(row.tag) : ''),
        headers: { 'X-Postmark-Server-Token': row.token, 'Accept': 'application/json' },
        muteHttpExceptions: true,
      });
      slots.push([row, w[0]]);
    });
  });
  var responses = UrlFetchApp.fetchAll(reqs);
  var out = rows.map(function (row) { return { key: row.key, label: row.label, kind: row.kind, stream: row.stream }; });
  responses.forEach(function (res, i) {
    var row = slots[i][0], win = slots[i][1], target = out[rows.indexOf(row)];
    if (res.getResponseCode() !== 200) { target[win] = { error: 'HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120) }; return; }
    var j = JSON.parse(res.getContentText());
    target[win] = { sent: j.Sent || 0, bounced: j.Bounced || 0, spam: j.SpamComplaints || 0, opens: j.Opens || 0, unique_opens: j.UniqueOpens || 0 };
  });
  return { rows: out };
}

// ── (c) Do Not Contact ─────────────────────────────────────────────────
function _commsDnc(now) {
  var rows = sheetToObjects(_dncSheet()).filter(function (r) { return String(r.email || '').trim() || String(r.phone || '').trim(); });
  var added7 = 0;
  rows.forEach(function (r) { var d = _commsDate(r.added_at); if (d && now.getTime() - d.getTime() <= 7 * COMMS_DAY_MS) added7++; });
  var recent = rows.slice(-5).reverse().map(function (r) {
    var d = _commsDate(r.added_at);
    return { dnc_id: String(r.dnc_id || ''), email: String(r.email || ''), phone: String(r.phone || ''),
             reason: String(r.reason || ''), source: String(r.source || ''), added_at: d ? d.toISOString() : String(r.added_at || '') };
  });
  return { total: rows.length, added_7d: added7, recent: recent };
}

// ── (d) due next — the senders' own dry runs ───────────────────────────
function _commsDue() {
  return {
    drip: _commsSafe(function () { var r = _dripCore(true); return { cap: DRIP_MAX_SENDS, items: r.would }; }),
    post_label: _commsSafe(function () { var r = _pl2Core(true, true); return { cap: PL2_MAX_PER_RUN, sms_quiet_hours: r.sms_quiet_hours, items: r.would }; }),
  };
}

function getCommsDashboard() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(COMMS_CACHE_KEY);
  if (hit) { try { var c = JSON.parse(hit); c.cached = true; return c; } catch (e) {} }
  var now = new Date();
  var out = {
    success: true,
    generated_at: now.toISOString(),
    sequences: _commsSafe(function () { return _commsSequences(now); }),
    postmark: _commsSafe(_commsPostmark),
    dnc: _commsSafe(function () { return _commsDnc(now); }),
    due: _commsDue(),
  };
  try { cache.put(COMMS_CACHE_KEY, JSON.stringify(out), COMMS_CACHE_SEC); } catch (e) { Logger.log('comms dashboard cache put: ' + e); }
  return out;
}

function handleGetCommsDashboard(parsed) {
  try { return getCommsDashboard(); } catch (e) { return { success: false, error: String(e && e.message || e) }; }
}

function handleAddDoNotContact(parsed) {
  var value = String(parsed.value || '').trim();
  if (!value) return { success: false, error: 'email or phone required' };
  var reason = String(parsed.reason || '').trim() || 'added in CRM';
  var r;
  try { r = dncAddPerson(value, reason, 'crm'); } catch (e) { return { success: false, error: String(e && e.message || e) }; }
  try { CacheService.getScriptCache().remove(COMMS_CACHE_KEY); } catch (e) {}
  return r;
}
