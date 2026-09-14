// ═══════════════════════════════════════════════════════════════════════
//  dnc.gs — Do Not Contact list (Sep 14 2026)
//
//  One list, both channels. Backed by a "Do Not Contact" tab (email, phone,
//  reason, source, added_at). Cached 5 minutes so the guard is cheap.
//
//  GUARD — add ONE line at the top of each of these in Code.gs:
//    function sendSms(to, name, body) {        →  if (isDoNotContact(to)) return { success:false, error:'suppressed (do not contact)' };
//    function sendViaPostmark(to, subject, h) { →  if (isDoNotContact(to)) return { success:false, error:'suppressed (do not contact)' };
//  and in the recovery sender (_recoveryCore), reengage.gs and referral.gs
//  Postmark fetches, before the fetch:
//                                              →  if (isDoNotContact(cand.email)) { Logger.log('  ⛔ DNC: ' + cand.email); continue; }
//  CAPTURE — in handleOpenPhoneWebhook, where an inbound SMS body is known:
//                                              →  if (dncLooksLikeStop(body)) dncAdd(from, 'STOP via SMS: ' + body.slice(0,60), 'sms');
//  Then run: setupDncTab() → dncSeed() → createDncTrigger()  (nightly Postmark suppression sync)
// ═══════════════════════════════════════════════════════════════════════

var DNC_TAB = 'Do Not Contact';
var DNC_HEADERS = ['dnc_id', 'email', 'phone', 'reason', 'source', 'added_at', 'notes'];
var DNC_CACHE_KEY = 'DNC_SET_V1';

function _dncNormEmail(v) { v = String(v || '').trim().toLowerCase(); return v.indexOf('@') !== -1 ? v : ''; }
function _dncNormPhone(v) { var d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1); return d.length === 10 ? d : ''; }

function _dncSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DNC_TAB);
  if (!sh) { sh = ss.insertSheet(DNC_TAB); sh.getRange(1, 1, 1, DNC_HEADERS.length).setValues([DNC_HEADERS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function setupDncTab() { _dncSheet(); Logger.log('Do Not Contact tab ready'); }

function _dncLoad() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(DNC_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var set = { emails: {}, phones: {} };
  try {
    var data = _dncSheet().getDataRange().getValues();
    var h = data[0], iE = h.indexOf('email'), iP = h.indexOf('phone');
    for (var r = 1; r < data.length; r++) {
      var e = _dncNormEmail(data[r][iE]); if (e) set.emails[e] = true;
      var p = _dncNormPhone(data[r][iP]); if (p) set.phones[p] = true;
    }
  } catch (e) { Logger.log('DNC load failed (failing OPEN would be unsafe → failing CLOSED): ' + e); return { emails: {}, phones: {}, _error: true }; }
  var nonEmpty = Object.keys(set.emails).length + Object.keys(set.phones).length > 0;
  if (nonEmpty) { try { cache.put(DNC_CACHE_KEY, JSON.stringify(set), 120); } catch (e) {} }
  return set;
}
function _dncBust() { try { CacheService.getScriptCache().remove(DNC_CACHE_KEY); } catch (e) {} }

// Works for an email OR a phone in any format.
function isDoNotContact(v) {
  var set = _dncLoad();
  var e = _dncNormEmail(v); if (e && set.emails[e]) return true;
  var p = _dncNormPhone(v); if (p && set.phones[p]) return true;
  return false;
}

function dncAdd(v, reason, source, notes) {
  var e = _dncNormEmail(v), p = _dncNormPhone(v);
  if (!e && !p) return { success: false, error: 'not an email or phone: ' + v };
  if (isDoNotContact(v)) return { success: true, already: true };
  var sh = _dncSheet();
  var data = sh.getDataRange().getValues();
  var maxId = 0; for (var r = 1; r < data.length; r++) { var m = String(data[r][0] || '').match(/(\d+)/); if (m) maxId = Math.max(maxId, parseInt(m[1], 10)); }
  sh.appendRow(['DNC-' + String(maxId + 1).padStart(4, '0'), e, p, reason || '', source || 'manual', new Date().toISOString(), notes || '']);
  SpreadsheetApp.flush();
  _dncBust();
  // Write-through: rebuild the set from the sheet now and cache THAT, so a
  // stale empty set can never outlive an add (Sep 14 bug).
  try { var fresh = _dncLoad(); if (!(fresh.emails[e] || fresh.phones[p])) Logger.log('DNC WARNING: add not visible on re-read for ' + (e || p)); } catch (err) {}
  Logger.log('DNC added: ' + (e || p) + ' — ' + (reason || ''));
  return { success: true };
}

// Also block the OTHER channel for the same person when we can find them.
// (Someone who says "stop texting me" should not get the day-12 email either.)
function dncAddPerson(v, reason, source) {
  var r = dncAdd(v, reason, source);
  try {
    var e = _dncNormEmail(v), p = _dncNormPhone(v);
    getCustomers().forEach(function (c) {
      var ce = _dncNormEmail(c.email), cp = _dncNormPhone(c.phone);
      if ((e && ce === e) || (p && cp === p)) { if (ce && ce !== e) dncAdd(ce, reason + ' (same customer)', source); if (cp && cp !== p) dncAdd(cp, reason + ' (same customer)', source); }
    });
  } catch (err) { Logger.log('dncAddPerson lookup: ' + err); }
  return r;
}

function dncLooksLikeStop(body) {
  var t = String(body || '').trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit|remove)\b/.test(t)) return true;
  if (/(stop|quit)\s+(texting|contacting|messaging|emailing)/.test(t)) return true;
  if (/(do not|don't|dont|never)\s+(text|contact|message|email)\s+me/.test(t)) return true;
  if (/take me off|remove me|leave me alone|not interested.*stop/.test(t)) return true;
  return false;
}

// One-time seed from replies already received.
function dncSeed() {
  dncAddPerson('deloreseverett7@gmail.com', 'replied "stop contacting me"', 'email-reply');
}

// Nightly: pull Postmark suppressions (unsubscribes, spam complaints, hard
// bounces) from both streams into the list. Postmark already blocks these on
// its own side; this keeps SMS and the CRM in step.
function syncPostmarkSuppressions() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('POSTMARK_API_TOKEN') || '';
  if (!token) { Logger.log('no POSTMARK_API_TOKEN'); return; }
  var streams = ['outbound', props.getProperty('POSTMARK_BROADCAST_STREAM') || 'broadcast'];
  var added = 0;
  streams.forEach(function (stream) {
    var res = UrlFetchApp.fetch('https://api.postmarkapp.com/message-streams/' + encodeURIComponent(stream) + '/suppressions/dump', {
      headers: { 'X-Postmark-Server-Token': token, 'Accept': 'application/json' }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { Logger.log('suppressions ' + stream + ': HTTP ' + res.getResponseCode()); return; }
    var list = (JSON.parse(res.getContentText()).Suppressions || []);
    list.forEach(function (s) {
      var reason = String(s.SuppressionReason || ''), origin = String(s.Origin || '');
      if (!isDoNotContact(s.EmailAddress)) { dncAdd(s.EmailAddress, 'Postmark ' + reason + (origin ? ' (' + origin + ')' : ''), 'postmark-' + stream, s.CreatedAt || ''); added++; }
    });
  });
  Logger.log('syncPostmarkSuppressions: added ' + added);
}
function createDncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncPostmarkSuppressions') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncPostmarkSuppressions').timeBased().atHour(4).everyDays(1).inTimezone('America/New_York').create();
  Logger.log('Trigger: syncPostmarkSuppressions daily ~4am ET');
}

// Editor check: dncCheck() → edit the value inside first
function dncCheck() { var v = 'deloreseverett7@gmail.com'; Logger.log(v + ' → ' + (isDoNotContact(v) ? 'BLOCKED' : 'ok to contact')); }

// Probe: what does the reader actually see? Run dncDebug() and paste the log.
function dncDebug() {
  var cache = CacheService.getScriptCache();
  Logger.log('cache: ' + (cache.get(DNC_CACHE_KEY) || '(empty)'));
  cache.remove(DNC_CACHE_KEY);
  var sh = _dncSheet();
  Logger.log('sheet: ' + sh.getName() + ' rows=' + sh.getLastRow() + ' cols=' + sh.getLastColumn());
  var data = sh.getDataRange().getValues();
  Logger.log('headers: ' + JSON.stringify(data[0]));
  Logger.log('row2: ' + JSON.stringify(data[1] || null));
  Logger.log('email col index: ' + data[0].indexOf('email') + ' phone col index: ' + data[0].indexOf('phone'));
  var set = _dncLoad();
  Logger.log('set: ' + JSON.stringify(set));
  Logger.log('isDoNotContact(delores): ' + isDoNotContact('deloreseverett7@gmail.com'));
}