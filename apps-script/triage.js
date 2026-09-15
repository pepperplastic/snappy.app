// ═══════════════════════════════════════════════════════════════════════
//  triage.gs — registration triage agent (Sep 14 2026). Spec: docs/TRIAGE_BRIEF.md
//
//  Every 5 minutes: a ready_to_fulfill shipment David hasn't acted on for
//  TRIAGE_WAIT_MIN minutes is either FULFILLED through the normal
//  generateAndSendLabel path, or HELD in Fulfill with a triage_flag
//  ("CODE: reason"). Nothing is ever deferred or moved backward.
//
//  Script Property TRIAGE_MODE: off (default) · shadow · on.
//  Shadow runs the exact same decision code (_triageDecide, caps included);
//  only the side effects are stubbed — no label, no customer message, no
//  triage_flag write, no SMS to David. Every decision still gets a Contact
//  Log row (kind auto:triage-shadow) for comparison with David's calls.
//
//  Contact Log kinds (all "auto:triage*", source = auto):
//    auto:triage           fulfilled (reason row on the shipment; the label SMS
//                          is logged under the same kind via COMMS_KIND)
//    auto:triage-hold      held, notes "CODE: reason"
//    auto:triage-shadow    shadow decision, notes "FULFILL: …" / "HOLD CODE: …"
//    auto:triage-override  written from the CRM 👎 button
//
//  Setup: createTriageTrigger() once, then set TRIAGE_MODE = shadow.
// ═══════════════════════════════════════════════════════════════════════

var TRIAGE_WAIT_MIN        = 20;     // David's window before triage acts
var TRIAGE_MAX_AGE_HOURS   = 72;     // don't sweep an old backlog when first switched on
var TRIAGE_MAX_PER_RUN     = 6;      // vision calls per 5-minute run (6-min execution limit)
var TRIAGE_CAP_HOUR        = 10;
var TRIAGE_CAP_DAY         = 40;
var TRIAGE_CONFIDENCE_MIN  = 80;
var TRIAGE_EST_LOW_MIN     = 100;    // low end must be ≥ this
var TRIAGE_EST_HIGH_MAX    = 2500;   // high end must be < this
var TRIAGE_MAX_ITEMS       = 3;
var TRIAGE_MAX_PHOTOS      = 5;
var TRIAGE_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
var TRIAGE_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
var TRIAGE_MODEL           = 'claude-sonnet-4-6';   // same model + key as draftCsReply
var TRIAGE_SUMMARY_PROP    = 'TRIAGE_LAST_SUMMARY_ISO';
var TRIAGE_KIND = { FULFILL: 'auto:triage', HOLD: 'auto:triage-hold', SHADOW: 'auto:triage-shadow', OVERRIDE: 'auto:triage-override' };

function triageMode() {
  var m = String(PropertiesService.getScriptProperties().getProperty('TRIAGE_MODE') || 'off').trim().toLowerCase();
  return (m === 'shadow' || m === 'on') ? m : 'off';
}

// "$240 – $480" / "$1,420 - $2,180" / "$300" → { low, high } or null
function _triageRange(est) {
  var nums = (String(est || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(function (n) { return n > 0; });
  if (!nums.length) return null;
  return { low: nums[0], high: nums[nums.length - 1] };
}

function _triageDriveId(url) {
  var m = String(url || '').match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || String(url || '').match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}

// Item photos for a shipment (ID photos excluded, same rule as the CRM), de-duplicated by Drive file.
function _triagePhotos(allPhotos, shipmentId) {
  var seen = {};
  return allPhotos.filter(function (p) {
    if (p.shipment_id !== shipmentId) return false;
    var src = String(p.source || '').toLowerCase();
    if (src === 'id' || src === 'customerid' || src === 'id_photo') return false;
    var id = _triageDriveId(p.drive_url);
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function _triageItemCount(s) {
  var tokens = String(s.item || '').split(/\s*\+\s*/).filter(function (t) { return t.trim(); }).length;
  var manifest = s.item_manifest;
  if (typeof manifest === 'string') { try { manifest = JSON.parse(manifest); } catch (e) { manifest = null; } }
  return Math.max(tokens, Array.isArray(manifest) ? manifest.length : 0);
}

var TRIAGE_CATEGORY_RE = {
  watch: /\bwatch(es)?\b|\brolex\b|\bomega\b|\bpatek\b|\baudemars\b|\bbreitling\b|\btag heuer\b/i,
  coin: /\bcoins?\b|\bkrugerrand\b|\bmaple leaf\b|\bamerican (gold )?eagle\b|\bdouble eagle\b|\bsovereign\b/i,
  loose_diamond: /\bloose (diamonds?|stones?|gems?)\b/i,
};

function _triageIsTest(cust) {
  var email = String(cust.email || ''), phone = _dncNormPhone(cust.phone), name = String(cust.name || '').trim();
  var pats = (typeof MY_EMAIL_PATTERNS !== 'undefined') ? MY_EMAIL_PATTERNS : [];
  var phones = (typeof MY_PHONES !== 'undefined') ? MY_PHONES : [];
  var names = (typeof MY_NAMES !== 'undefined') ? MY_NAMES : [];
  if (pats.some(function (re) { return re.test(email); })) return 'test email';
  if (phone && phones.indexOf(phone) !== -1) return 'test phone';
  if (names.some(function (re) { return re.test(name); })) return 'test name';
  return '';
}

function _triageContactProblem(cust) {
  if (!isPlausibleEmail(cust.email)) return 'email looks fake (' + (cust.email || 'none') + ')';
  var phone = _dncNormPhone(cust.phone);
  if (!phone || /^(\d)\1{9}$/.test(phone) || phone === '1234567890' || /^\d{3}555\d{4}$/.test(phone)) return 'phone looks fake (' + (cust.phone || 'none') + ')';
  var a = _parseUsAddress(cust.address);
  if (!/\d/.test(a.street1) || !/[a-z]{2}/i.test(a.street1)) return 'street looks incomplete';
  if (!String(a.city || '').trim()) return 'no city';
  if (!/^[A-Z]{2}$/.test(a.state) || (typeof _isValidUsState === 'function' && !_isValidUsState(a.state))) return 'no valid US state';
  if (!/^\d{5}(-\d{4})?$/.test(String(a.zip || ''))) return 'no valid ZIP';
  return '';
}

// ── THE decision. Shadow and on both call this; it has no side effects
//    except the Claude read (aiRead), which is a read.
//    ctx: { shipment, customer, photos, otherShipments, aiRead(shipment, photos) }
//    → { action: 'fulfill'|'hold', code, reason, ai }
function _triageDecide(ctx) {
  var s = ctx.shipment, c = ctx.customer || {};
  var hold = function (code, reason, ai) { return { action: 'hold', code: code, reason: reason, ai: ai || null }; };

  var test = _triageIsTest(c);
  if (test) return hold('TEST', test);
  if (isDoNotContact(c.email) || (c.phone && isDoNotContact(c.phone))) return hold('DNC', 'customer is on Do Not Contact');

  var type = normalizeShipType(s.shipping_type);
  if (type === 'kit') return hold('KIT', 'kits always wait for David');
  if (type !== 'usps' && type !== 'fedex') return hold('ERROR', 'unrecognized shipping type "' + (s.shipping_type || '') + '"');

  var contact = _triageContactProblem(c);
  if (contact) return hold('BAD_CONTACT', contact);

  var prior = (ctx.otherShipments || []).filter(function (o) {
    var st = String(o.stage || '').toLowerCase();
    return st === 'returned' || st === 'return_complete' || String(o.returned_at || '').trim();
  });
  if (prior.length) return hold('HISTORY', 'prior return on ' + prior.map(function (o) { return o.shipment_id; }).join(', '));

  var items = _triageItemCount(s);
  if (items > TRIAGE_MAX_ITEMS) return hold('LOT_TOO_BIG', items + ' items (max ' + TRIAGE_MAX_ITEMS + ')');

  var text = [s.item, s.customer_message, s.ai_rationale].join(' ');
  for (var cat in TRIAGE_CATEGORY_RE) {
    if (TRIAGE_CATEGORY_RE[cat].test(text)) return hold('CATEGORY', cat.replace(/_/g, ' ') + ' in the item text');
  }

  var range = _triageRange(s.estimate);
  if (!range) return hold('LOW_ESTIMATE', 'no estimate');
  if (range.low < TRIAGE_EST_LOW_MIN) return hold('LOW_ESTIMATE', 'estimate low end $' + range.low + ' < $' + TRIAGE_EST_LOW_MIN);
  if (range.high >= TRIAGE_EST_HIGH_MAX) return hold('HIGH_VALUE', 'estimate high end $' + range.high + ' ≥ $' + TRIAGE_EST_HIGH_MAX);

  if (!(ctx.photos || []).length) return hold('NO_PHOTOS', 'no item photos');

  var ai;
  try { ai = ctx.aiRead(s, ctx.photos); } catch (e) { return hold('ERROR', 'AI read failed: ' + String(e && e.message || e).slice(0, 120)); }
  if (!ai.photos_used) return hold('PHOTO_UNCLEAR', 'no photo could be read (' + ai.photos_skipped + ' skipped)', ai);
  if (ai.photo_quality === 'no_item' || ai.photo_quality === 'unclear') return hold('PHOTO_UNCLEAR', 'photos ' + (ai.photo_quality === 'no_item' ? "don't show the item" : 'too unclear') + (ai.evidence ? ' — ' + ai.evidence : ''), ai);
  if (ai.category === 'watch' || ai.category === 'coin' || ai.category === 'loose_diamond') return hold('CATEGORY', ai.category.replace(/_/g, ' ') + ' (AI read)', ai);
  if (ai.item_count > TRIAGE_MAX_ITEMS) return hold('LOT_TOO_BIG', ai.item_count + ' items in the photos (max ' + TRIAGE_MAX_ITEMS + ')', ai);
  if (ai.material !== 'karat_gold' && ai.material !== 'platinum') return hold('NOT_GOLD', 'AI read: ' + ai.material.replace(/_/g, ' ') + (ai.evidence ? ' — ' + ai.evidence : ''), ai);
  if (!ai.photos_support) return hold('PHOTO_UNCLEAR', "photos don't support gold (no hallmark, color or brand)" + (ai.evidence ? ' — ' + ai.evidence : ''), ai);
  if (ai.confidence < TRIAGE_CONFIDENCE_MIN) return hold('PHOTO_UNCLEAR', 'gold confidence ' + ai.confidence + '% < ' + TRIAGE_CONFIDENCE_MIN + '%' + (ai.evidence ? ' — ' + ai.evidence : ''), ai);

  return { action: 'fulfill', code: '', ai: ai,
           reason: ai.material.replace(/_/g, ' ') + ' ' + ai.confidence + '% (' + (ai.evidence || 'photos support it') + '), est ' + s.estimate + ', ' + type + ', ' + items + ' item' + (items === 1 ? '' : 's') };
}

// ── Claude gold read — same call pattern as draftCsReply (key, model, headers) ──
var TRIAGE_SYSTEM =
  'You screen jewelry registrations for Snappy Gold, a mail-in gold buyer. You get the customer\'s photos, the item text, ' +
  'the pricing AI\'s rationale and the estimate. Judge only from what is visible and written. When unsure, say so with a lower ' +
  'confidence: a wrong "gold" call sends a shipping label to someone with nothing to buy.\n\n' +
  'Reply with one JSON object and nothing else:\n' +
  '{"material": "karat_gold" | "platinum" | "silver" | "gold_plated_or_filled" | "costume" | "unknown",\n' +
  ' "confidence": <0-100, how sure you are the lot is genuine karat gold or platinum>,\n' +
  ' "photos_support": <true only if the photos show a karat or platinum hallmark, a convincing solid-gold color, or a known fine-jewelry brand>,\n' +
  ' "photo_quality": "clear" | "unclear" | "no_item",\n' +
  ' "category": "jewelry" | "watch" | "coin" | "loose_diamond" | "bullion" | "other",\n' +
  ' "item_count": <number of distinct items shown or described>,\n' +
  ' "evidence": "<one short line on what you saw, e.g. 14K stamp on the clasp>"}';

function _triageAiRead(s, photos) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('no ANTHROPIC_API_KEY script property');

  // Drive "view" links aren't image URLs the API can fetch, so the bytes go in as base64 image blocks.
  var content = [], used = 0, skipped = 0, total = 0;
  photos.slice(0, TRIAGE_MAX_PHOTOS).forEach(function (p) {
    try {
      var blob = DriveApp.getFileById(_triageDriveId(p.drive_url)).getBlob();
      var mime = String(blob.getContentType() || '').toLowerCase();
      var bytes = blob.getBytes();
      if (!/^image\/(jpeg|png|gif|webp)$/.test(mime) || bytes.length > TRIAGE_MAX_PHOTO_BYTES || total + bytes.length > TRIAGE_MAX_TOTAL_BYTES) { skipped++; return; }
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: Utilities.base64Encode(bytes) } });
      used++; total += bytes.length;
    } catch (e) { skipped++; Logger.log('triage photo ' + p.drive_url + ': ' + e); }
  });
  if (!used) return { photos_used: 0, photos_skipped: skipped };

  content.push({ type: 'text', text:
    'Item text: ' + (s.item || '(none)') +
    '\nEstimate: ' + (s.estimate || '(none)') +
    '\nPricing AI rationale: ' + (s.ai_rationale || '(none)') +
    (s.customer_message ? '\nCustomer message: ' + s.customer_message : '') +
    '\n\n' + used + ' photo' + (used === 1 ? '' : 's') + ' above. Return the JSON object.' });

  var payload = { model: TRIAGE_MODEL, max_tokens: 600, system: TRIAGE_SYSTEM, messages: [{ role: 'user', content: content }] };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  var data = JSON.parse(res.getContentText());
  if (data.stop_reason === 'refusal') throw new Error('Claude declined the request');
  var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
  var m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply: ' + text.slice(0, 120));
  var j = JSON.parse(m[0].replace(/[\u0000-\u001f]+/g, " "));   // a raw newline inside a string would otherwise throw
  var oneOf = function (v, list, dflt) { v = String(v || '').toLowerCase().trim(); return list.indexOf(v) !== -1 ? v : dflt; };
  return {
    material: oneOf(j.material, ['karat_gold', 'platinum', 'silver', 'gold_plated_or_filled', 'costume', 'unknown'], 'unknown'),
    confidence: Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0))),
    photos_support: j.photos_support === true,
    photo_quality: oneOf(j.photo_quality, ['clear', 'unclear', 'no_item'], 'unclear'),
    category: oneOf(j.category, ['jewelry', 'watch', 'coin', 'loose_diamond', 'bullion', 'other'], 'other'),
    item_count: Math.max(0, Math.round(Number(j.item_count) || 0)),
    evidence: String(j.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    photos_used: used, photos_skipped: skipped,
  };
}

// ── Side effects. "on" does them; "shadow" gets the same calls, stubbed. ──
function _triageEffects(mode) {
  if (mode === 'on') {
    return {
      fulfill: function (s, c) {
        COMMS_KIND = TRIAGE_KIND.FULFILL;   // the label SMS is logged as auto:triage
        try { return generateAndSendLabel(c.customer_id, s.shipment_id, normalizeShipType(s.shipping_type), c.address, c.name || '', c.email, c.phone || '', s.item || ''); }
        finally { COMMS_KIND = ''; }
      },
      flag: function (s, text) { _triageEnsureColumn(); updateShipment(s.shipment_id, { triage_flag: text }); },
      smsDavid: function (text) { COMMS_KIND = ''; sendSms(REG_ALERT_PHONE, 'David', text); },
    };
  }
  return {
    fulfill: function (s) { Logger.log('[triage shadow] would fulfill ' + s.shipment_id); return { success: true, shadow: true }; },
    flag: function (s, text) { Logger.log('[triage shadow] would flag ' + s.shipment_id + ' — ' + text); },
    smsDavid: function (text) { Logger.log('[triage shadow] would text David: ' + text); },
  };
}

var _triageColChecked = false;
function _triageEnsureColumn() {
  if (_triageColChecked) return;
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.SHIPMENTS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('triage_flag') < 0) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue('triage_flag').setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    Logger.log('triage: added Shipments.triage_flag');
  }
  _triageColChecked = true;
}

function _triageLog(mode, s, d) {
  var kind = mode === 'shadow' ? TRIAGE_KIND.SHADOW : (d.action === 'fulfill' ? TRIAGE_KIND.FULFILL : TRIAGE_KIND.HOLD);
  var notes = mode === 'shadow'
    ? (d.action === 'fulfill' ? 'FULFILL: ' + d.reason : 'HOLD ' + d.code + ': ' + d.reason)
    : (d.action === 'fulfill' ? 'Fulfilled: ' + d.reason : d.code + ': ' + d.reason);
  try {
    _ensureContactLogColumns(SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB.CONTACT_LOG));
    addContactLog({ customer_id: s.customer_id, shipment_id: s.shipment_id, type: 'note', direction: '', source: 'auto', kind: kind, notes: String(notes).slice(0, 300) });
  } catch (e) { Logger.log('triage log ' + s.shipment_id + ': ' + e); }
}

function _triageTime(v) { var t = v instanceof Date ? v.getTime() : new Date(v).getTime(); return isNaN(t) ? 0 : t; }
function _triageParse(notes) {   // "CODE: reason" / "HOLD CODE: reason" / "FULFILL: reason" / "Fulfilled: reason"
  var n = String(notes || '');
  if (/^(FULFILL|Fulfilled):/.test(n)) return { fulfilled: true, code: '', reason: n.replace(/^[^:]+:\s*/, '') };
  var m = n.match(/^(?:HOLD )?([A-Z_]+):\s*(.*)$/);
  return { fulfilled: false, code: m ? m[1] : '', reason: m ? m[2] : n };
}

// ── Trigger entry point ────────────────────────────────────────────────
function triageNewRegistrations() {
  var mode = triageMode();
  if (mode === 'off') return null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { Logger.log('triage: previous run still going'); return null; }
  try { return _triageRun(mode, _triageEffects(mode), new Date()); }
  finally { lock.releaseLock(); }
}

// One pass. mode + effects are the only difference between shadow and on.
function _triageRun(mode, fx, now) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var T = now.getTime(), MIN = 60000, HOUR = 3600000;
  var ships = sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS));
  var custs = {}; getCustomers().forEach(function (c) { if (c.customer_id) custs[c.customer_id] = c; });
  var photosAll = sheetToObjects(ss.getSheetByName(TAB.PHOTOS));
  var logs = getContactLog(null);

  var byShip = {};
  logs.forEach(function (l) { if (l.shipment_id) (byShip[l.shipment_id] = byShip[l.shipment_id] || []).push(l); });
  var modeKinds = mode === 'on' ? [TRIAGE_KIND.FULFILL, TRIAGE_KIND.HOLD] : [TRIAGE_KIND.SHADOW];
  var ownRows = function (sid) { return (byShip[sid] || []).filter(function (l) { return modeKinds.indexOf(l.kind) !== -1; }); };

  // Fulfillments counted toward the caps: real ones when on, would-be ones in shadow.
  var fulfillTimes = logs.filter(function (l) { return l.shipment_id && modeKinds.indexOf(l.kind) !== -1 && _triageParse(l.notes).fulfilled; })
                         .map(function (l) { return _triageTime(l.timestamp); });
  var capFull = function () {
    return fulfillTimes.filter(function (t) { return T - t < HOUR; }).length >= TRIAGE_CAP_HOUR ||
           fulfillTimes.filter(function (t) { return T - t < 24 * HOUR; }).length >= TRIAGE_CAP_DAY;
  };

  var cands = ships.filter(function (s) {
    if (String(s.stage || '').toLowerCase() !== 'ready_to_fulfill') return false;
    if (String(s.deferred_at || '').trim()) return false;                       // David deferred it
    var created = _triageTime(s.created_at), age = T - created;
    if (!created || age < TRIAGE_WAIT_MIN * MIN || age > TRIAGE_MAX_AGE_HOURS * HOUR) return false;
    if (ownRows(s.shipment_id).some(function (l) { return _triageParse(l.notes).code !== 'CAP'; })) return false;   // already decided (CAP holds are retried)
    var davidTouched = (byShip[s.shipment_id] || []).some(function (l) {                // a manual Contact Log note since registration
      return String(l.source || '') !== 'auto' && String(l.kind || '').indexOf('auto:') !== 0 && _triageTime(l.timestamp) >= created;
    });
    return !davidTouched;
  }).sort(function (a, b) { return _triageTime(a.created_at) - _triageTime(b.created_at); }).slice(0, TRIAGE_MAX_PER_RUN);

  var results = [];
  cands.forEach(function (s) {
    var c = custs[s.customer_id] || {}, d;
    if (capFull()) {
      d = { action: 'hold', code: 'CAP', reason: 'fulfillment cap reached (' + TRIAGE_CAP_HOUR + '/hour, ' + TRIAGE_CAP_DAY + '/day)' };
    } else {
      try {
        d = _triageDecide({
          shipment: s, customer: c, photos: _triagePhotos(photosAll, s.shipment_id),
          otherShipments: ships.filter(function (o) { return o.customer_id === s.customer_id && o.shipment_id !== s.shipment_id; }),
          aiRead: _triageAiRead,
        });
      } catch (e) { d = { action: 'hold', code: 'ERROR', reason: String(e && e.message || e).slice(0, 160) }; }
    }

    if (d.action === 'fulfill') {
      var r;
      try { r = fx.fulfill(s, c); } catch (e) { r = { success: false, error: String(e) }; }
      if (r && r.success) {
        fulfillTimes.push(T);
      } else {
        var err = String((r && r.error) || 'unknown error').slice(0, 160);
        d = { action: 'hold', code: 'ERROR', reason: 'fulfillment failed: ' + err, ai: d.ai };
        try { fx.smsDavid('Triage: fulfillment FAILED on ' + s.shipment_id + ' — ' + err.slice(0, 100)); } catch (e2) { Logger.log('triage error sms: ' + e2); }
      }
    }

    // A CAP hold is retried every run; flag + log it only the first time.
    var repeatCap = d.code === 'CAP' && ownRows(s.shipment_id).some(function (l) { return _triageParse(l.notes).code === 'CAP'; });
    if (!repeatCap) {
      if (d.action === 'hold') { try { fx.flag(s, d.code + ': ' + d.reason); } catch (e3) { Logger.log('triage flag ' + s.shipment_id + ': ' + e3); } }
      _triageLog(mode, s, d);
    }
    results.push({ shipment_id: s.shipment_id, action: d.action, code: d.code, reason: d.reason, repeat: repeatCap });
    Logger.log('triage [' + mode + '] ' + s.shipment_id + ' → ' + (d.action === 'fulfill' ? 'FULFILL' : 'HOLD ' + d.code) + ': ' + d.reason);
  });

  return { mode: mode, evaluated: results, summary: _triageSummary(mode, fx, now, logs, results) };
}

var TRIAGE_WORDS = { KIT: 'kit', NO_PHOTOS: 'no photos', PHOTO_UNCLEAR: 'unclear photos', NOT_GOLD: 'not gold', LOW_ESTIMATE: 'low estimate',
  HIGH_VALUE: 'high value', BAD_CONTACT: 'bad contact', HISTORY: 'prior return', LOT_TOO_BIG: 'too many items', DNC: 'do not contact',
  TEST: 'test', CAP: 'cap', ERROR: 'error' };

// Hourly SMS to David when there was activity: "Triage: fulfilled 4 · holding 2 (watch, no photos)".
function _triageSummary(mode, fx, now, logs, results) {
  var props = PropertiesService.getScriptProperties();
  var last = _triageTime(props.getProperty(TRIAGE_SUMMARY_PROP));
  if (last && now.getTime() - last < 3600000) return null;
  var since = last || now.getTime() - 3600000;
  var modeKinds = mode === 'on' ? [TRIAGE_KIND.FULFILL, TRIAGE_KIND.HOLD] : [TRIAGE_KIND.SHADOW];
  var latest = {};   // shipment → its latest decision this hour
  logs.forEach(function (l) {
    if (!l.shipment_id || modeKinds.indexOf(l.kind) === -1 || _triageTime(l.timestamp) <= since) return;
    latest[l.shipment_id] = _triageParse(l.notes);
  });
  results.forEach(function (r) { latest[r.shipment_id] = { fulfilled: r.action === 'fulfill', code: r.code, reason: r.reason }; });
  var all = Object.keys(latest).map(function (k) { return latest[k]; });
  props.setProperty(TRIAGE_SUMMARY_PROP, now.toISOString());
  if (!all.length) return null;
  var fulfilled = all.filter(function (x) { return x.fulfilled; }).length;
  var holds = all.filter(function (x) { return !x.fulfilled; });
  var words = [];
  holds.forEach(function (h) {
    var w = h.code === 'CATEGORY' ? String(h.reason || 'category').split(' ')[0] : (TRIAGE_WORDS[h.code] || h.code.toLowerCase());
    if (words.indexOf(w) === -1) words.push(w);
  });
  var text = 'Triage' + (mode === 'shadow' ? ' (shadow)' : '') + ': fulfilled ' + fulfilled + ' · holding ' + holds.length + (words.length ? ' (' + words.join(', ') + ')' : '');
  try { fx.smsDavid(text); } catch (e) { Logger.log('triage summary sms: ' + e); }
  return text;
}

// Run once from the editor. Mode stays whatever TRIAGE_MODE says (default off).
function createTriageTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'triageNewRegistrations') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('triageNewRegistrations').timeBased().everyMinutes(5).create();
  Logger.log('Trigger: triageNewRegistrations every 5 min. TRIAGE_MODE is "' + triageMode() + '" — set it to "shadow" first, "on" to go live.');
}
