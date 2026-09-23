// ═══════════════════════════════════════════════════════════════════════
//  rules.gs — data for the CRM "Rules" tab (Sep 14 2026). READ-ONLY.
//
//  Surfaces the automated behaviour straight from the live code so it can't
//  drift from a hand-written doc:
//    • constants that are globals (DRIP_MAX_SENDS, PL2_TOUCHES, …) are read
//      directly;
//    • constants that are LOCAL to a function (the append window inside
//      handleLeadIngestion, drip thresholds, recovery defaults, …) are read
//      from that function's own source (Function.prototype.toString) with a
//      narrow regex. Every such rule carries the matched source line as
//      evidence; if the pattern no longer matches, the rule says so instead
//      of showing a stale value.
//    • copy is rendered by calling the real template functions with a fixed
//      sample customer. Nothing is sent and nothing is written.
//
//  getRules              — cached 10 min
//  explainRegistration   — { email } → what ingestion did for that person
// ═══════════════════════════════════════════════════════════════════════

var RULES_CACHE_KEY = 'RULES_V2';   // bump when the payload shape changes, so a cached older payload isn't served after a deploy
var RULES_CACHE_SEC = 600;
var RULES_SAMPLE = { first: 'Jane', item: '14K gold ring', phrase: 'your 14K gold ring', estimate: '$240 – $480' };

function _rulesSrc(fn) {
  try { return typeof fn === 'function' ? String(fn) : ''; } catch (e) { return ''; }
}

// Match re against fn's source. → { ok, value (group 1), groups, line, where }
function _rulesPick(fn, re, where) {
  var src = _rulesSrc(fn);
  var m = src ? src.match(re) : null;
  if (!m) return { ok: false, where: where };
  var start = src.lastIndexOf('\n', m.index) + 1;
  var end = src.indexOf('\n', m.index + m[0].length);
  return { ok: true, value: m[1], groups: m, where: where,
           line: src.slice(start, end < 0 ? src.length : end).trim().slice(0, 240) };
}

// A global's current value, as a pick.
function _rulesGlobal(name, value) {
  return { ok: value !== undefined, value: value, where: 'global ' + name,
           line: 'var ' + name + ' = ' + JSON.stringify(value) };
}

// Numbers written as simple products, e.g. "14 * 24 * 60". Anything else → null.
function _rulesNum(expr) {
  var s = String(expr == null ? '' : expr).trim();
  if (!/^[\d.\s*]+$/.test(s)) return null;
  return s.split('*').reduce(function (acc, p) { return acc * parseFloat(p); }, 1);
}

// Build a rule sentence from picks. fmt(values, picks) runs only if every pick matched
// (picks[name].groups has every regex group).
function _rule(picks, fmt) {
  var names = Object.keys(picks), vals = {}, missing = [];
  var evidence = names.map(function (n) {
    var p = picks[n];
    if (!p.ok) missing.push(n + ' (' + p.where + ')');
    vals[n] = p.value;
    return { where: p.where, line: p.ok ? p.line : '— pattern not found —' };
  });
  if (missing.length) return { ok: false, text: '⚠ Could not read ' + missing.join(', ') + ' from the code — the code changed; update rules.gs.', evidence: evidence };
  var text;
  try { text = fmt(vals, picks); } catch (e) { return { ok: false, text: '⚠ ' + e, evidence: evidence }; }
  return { ok: true, text: text, evidence: evidence };
}

// Which of these functions call `needle` in their source.
function _rulesCallers(fns, needle) {
  return Object.keys(fns).filter(function (name) { return _rulesSrc(fns[name]).indexOf(needle) !== -1; });
}

// HTML → readable plain text (keeps line breaks, shows link targets).
function _rulesText(html) {
  return String(html || '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, href, t) {
      t = t.replace(/<[^>]+>/g, '').trim();
      return (!href || href.indexOf('{{') === 0 || t === href) ? t : t + ' (' + href + ')';
    })
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// "every 10 min" etc. from a createXTrigger function, plus whether it's installed.
function _rulesTrigger(creatorFn, creatorName, handler, installed) {
  var p = _rulesPick(creatorFn, new RegExp("newTrigger\\('" + handler + "'\\)((?:\\s*\\.\\s*\\w+\\([^)]*\\))+)"), creatorName);
  var cadence = null;
  if (p.ok) {
    var parts = [], re = /\.(\w+)\(([^)]*)\)/g, m;
    while ((m = re.exec(p.groups[1])) !== null) {
      var a = m[2].replace(/['"]/g, '').trim();
      if (m[1] === 'everyMinutes') parts.push('every ' + a + ' min');
      else if (m[1] === 'everyHours') parts.push('every ' + a + ' h');
      else if (m[1] === 'everyDays') parts.push(a === '1' ? 'daily' : 'every ' + a + ' days');
      else if (m[1] === 'atHour') parts.push('around ' + a + ':00');
      else if (m[1] === 'inTimezone') parts.push('(' + a + ')');
    }
    cadence = parts.join(' ');
  }
  return { handler: handler, installed: !!installed[handler], cadence: cadence, creator: creatorName,
           evidence: [{ where: creatorName, line: p.ok ? p.line : '— pattern not found —' }] };
}

function _rulesInstalled() {
  var out = {};
  try { ScriptApp.getProjectTriggers().forEach(function (t) { out[t.getHandlerFunction()] = true; }); } catch (e) {}
  return out;
}

// A global function by name (null when it doesn't exist), so a renamed function shows up as "couldn't read".
function _rulesFn(name) {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  return (g && typeof g[name] === 'function') ? g[name] : null;
}
function _rulesLit(s) { return '"' + String(s).replace(/\\n/g, '↵') + '"'; }
function _rulesList(s) { return (String(s).match(/'([^']+)'/g) || []).map(function (x) { return x.slice(1, -1); }); }
function _rulesJoin(a) { return a.length ? a.join(', ') : 'none'; }

// ── 1. Intake ──────────────────────────────────────────────────────────
function _rulesIntake() {
  var ing = _rulesFn('handleLeadIngestion'), W = 'handleLeadIngestion';
  var out = [];
  out.push(_rule({
    stages: _rulesPick(ing, /var PRE_RECEIVED_FRESH = \[([^\]]*)\]/, W),
    recent: _rulesPick(ing, /\(stage === '([a-z_]+)'\)\s*&&\s*createdAt && createdAt > STALE_CUTOFF/, W),
    days:   _rulesPick(ing, /var STALE_DAYS = (\d+)/, W),
  }, function (v) {
    return 'A new lead with an email is APPENDED to the customer\'s open shipment when one exists: any shipment in ' +
      _rulesJoin(_rulesList(v.stages)) + ' (any age), or in ' + v.recent + ' created within the last ' + v.days +
      ' days (measured from created_at, not sent_at). If several qualify, the most recently created wins.';
  }));
  out.push(_rule({
    item:  _rulesPick(ing, /currentItem \+ '([^']*)' \+ newItem/, W),
    notes: _rulesPick(ing, /currentNotes \+ '([^']*)' \+ newItemNote/, W),
    msg:   _rulesPick(ing, /existingMsg \+ '([^']*)' \+ data\.notes/, W),
  }, function (v) {
    return 'When appending: the item is added to the item column joined with ' + _rulesLit(v.item) +
      ', to notes as ' + _rulesLit(v.notes) + '<item> (<estimate>) — <offer notes>, and the customer message is joined with ' + _rulesLit(v.msg) + '.';
  }));
  out.push(_rule({
    dup:    _rulesPick(ing, /var dupInItemCol = ([^;]+);/, W),
    enrich: _rulesPick(ing, /if \((data\.offerRange && !appendTarget\.estimate)\)/, W),
  }, function () {
    return 'Duplicate items: if the same item name is already in the shipment\'s item list or notes, it is not added again; ' +
      'a repeat submission only fills an empty estimate / AI rationale on the existing shipment.';
  }));
  out.push(_rule({
    cond:  _rulesPick(ing, /else if \((data\.shippingMethod && data\.address)\)/, W),
    stage: _rulesPick(ing, /createShipment\(\{[\s\S]*?stage:\s*'([a-z_]+)'/, W),
    cool:  _rulesPick(ing, /daysSince < (\d+)/, W),
  }, function (v) {
    return 'With no open shipment, a NEW shipment is created in ' + v.stage + ' only when the lead has both a shipping method and an address — ' +
      'unless the customer\'s most recent received-or-later shipment was created less than ' + v.cool + ' days ago (cooldown: the photo is attached to that shipment instead). ' +
      'Without shipping + address the lead is estimate-only and no shipment is created.';
  }));
  out.push(_rule({
    match: _rulesPick(_rulesFn('getCustomerByEmail'), /(String\(c\.email\)\.toLowerCase\(\) === String\(email\)\.toLowerCase\(\))/, 'getCustomerByEmail'),
    over:  _rulesPick(_rulesFn('upsertCustomer'), /(data\[key\] !== '')/, 'upsertCustomer'),
  }, function () {
    return 'Customers are de-duplicated by email (case-insensitive, not trimmed): an existing customer is reused and any non-blank submitted field overwrites theirs; otherwise a new CUST- row is created.';
  }));
  out.push(_rule({
    drip: _rulesPick(_rulesFn('_dripCore'), /var isComplete = !!\((lead\.address && lead\.shipping)\)/, '_dripCore'),
  }, function () {
    return 'A lead counts as REGISTERED when it has both an address and a shipping method. Registered leads get no drip email; the label email is their confirmation.';
  }));

  var plaus = _rulesFn('isPlausibleEmail');
  var senders = {
    handleLeadIngestion: ing, sendViaPostmark: _rulesFn('sendViaPostmark'), sendSms: _rulesFn('sendSms'),
    _dripCore: _rulesFn('_dripCore'), _pl2Core: _rulesFn('_pl2Core'), _recoveryCore: _rulesFn('_recoveryCore'),
    _reengageCandidates: _rulesFn('_reengageCandidates'), reengageSend: _rulesFn('reengageSend'), _refInvitesCore: _rulesFn('_refInvitesCore'),
  };
  out.push(_rule({
    len:    _rulesPick(plaus, /local\.length < (\d+)/, 'isPlausibleEmail'),
    vowels: _rulesPick(plaus, /\/\[([a-z]+)\]\/\.test\(local\)/, 'isPlausibleEmail'),
    fixes:  _rulesGlobal('DNC_DOMAIN_FIXES', typeof DNC_DOMAIN_FIXES !== 'undefined' ? DNC_DOMAIN_FIXES : undefined),
  }, function (v) {
    var used = _rulesCallers(senders, 'isPlausibleEmail(');
    return 'Plausibility filter (dnc.gs isPlausibleEmail): an address is rejected when its local part is under ' + v.len +
      ' characters or has none of the letters "' + v.vowels + '"; domain typos are corrected (' +
      Object.keys(v.fixes).map(function (k) { return k + ' → ' + v.fixes[k]; }).join(', ') + '). Applied by: ' + _rulesJoin(used) +
      (used.indexOf('handleLeadIngestion') === -1 ? '. Not applied at intake — the lead is still recorded.' : '.');
  }));
  out.push(_rule({
    guard: _rulesPick(_rulesFn('sendViaPostmark'), /(isDoNotContact\(to\))/, 'sendViaPostmark'),
  }, function () {
    var used = _rulesCallers(senders, 'isDoNotContact(');
    return 'Do Not Contact guard (dnc.gs isDoNotContact, email or phone): checked by ' + _rulesJoin(used) +
      (used.indexOf('handleLeadIngestion') === -1 ? '. Not checked at intake — a DNC person can still register; only automated sends are suppressed.' : '.');
  }));
  return out;
}

// ── 3. Routing ─────────────────────────────────────────────────────────
function _rulesRouting() {
  var gen = _rulesFn('generateAndSendLabel'), buy = _rulesFn('_buyShippoLabel');
  var out = [];
  out.push(_rule({
    norm: _rulesPick(_rulesFn('normalizeShipType'), /t === '(\w+)' \? '(\w+)' : t/, 'normalizeShipType'),
    ok:   _rulesPick(gen, /if \(shippingType !== '(\w+)' && shippingType !== '(\w+)'\)/, 'generateAndSendLabel'),
  }, function (v, P) {
    return 'shipping_type is lower-cased and trimmed; legacy "' + P.norm.groups[1] + '" is read as "' + P.norm.groups[2] + '". Labels are generated only for "' +
      P.ok.groups[1] + '" and "' + P.ok.groups[2] + '". Blank, "kit" or anything else is refused with an error (the CRM Fulfill button shows it) — nothing falls through to USPS. Kits get no label: moving a kit to Outbound is a plain stage change.';
  }));
  out.push(_rule({
    provider: _rulesGlobal('LABEL_PROVIDER', typeof LABEL_PROVIDER !== 'undefined' ? LABEL_PROVIDER : undefined),
    ret:      _rulesPick(buy, /var labelExtra = \{ (is_return: true)/, '_buyShippoLabel'),
    parcel:   _rulesPick(buy, /parcels: \[\{ ([^}]*) \}\]/, '_buyShippoLabel'),
    svc:      _rulesPick(buy, /var preferredService = shippingType === '(\w+)' \? '(\w+)' : '(\w+)'/, '_buyShippoLabel'),
  }, function (v, P) {
    var s = P.svc;
    return 'Provider: ' + v.provider + ' (_buyShippoLabel). Every label is a scan-based return label (' + v.ret + ', billed only when the carrier scans it), parcel ' + v.parcel +
      '. usps → ' + s.groups[2] + '; fedex → ' + s.groups[3] + '.';
  }));
  out.push(_rule({
    step2: _rulesPick(buy, /\/\/ 2\) (cheapest rate from the requested carrier)/, '_buyShippoLabel'),
    step3: _rulesPick(buy, /if \(!rate && carrierToken === '(\w+)'\)/, '_buyShippoLabel'),
  }, function (v) {
    return 'Rate selection: the exact preferred service, else the cheapest rate from the same carrier. Only a ' + v.step3 +
      ' request may fall back to the other major carrier (USPS/FedEx) when its own carrier has no rate; a FedEx request never becomes a USPS label.';
  }));
  out.push(_rule({
    fedex: _rulesPick(gen, /if \(shippingType === '(\w+)'\) \{\s*Logger\.log\('✗ Shippo/, 'generateAndSendLabel'),
    ep:    _rulesPick(gen, /(falling back to EasyPost \(BILLED ON CREATION\))/, 'generateAndSendLabel'),
  }, function (v) {
    return 'If Shippo fails: ' + v.fedex + ' returns an error (no EasyPost fallback); usps falls back to EasyPost, which bills on creation, and emails hello@ an alert.';
  }));
  return out;
}

// ── 4. Money & policy (server side; eBay fee + ROI shipping come from crm.jsx) ──
function _rulesMoney() {
  var G = function (n, v) { return _rulesGlobal(n, v); };
  var out = [];
  out.push(_rule({
    after: G('REFUND_AFTER_DAYS', typeof REFUND_AFTER_DAYS !== 'undefined' ? REFUND_AFTER_DAYS : undefined),
    max:   G('REFUND_WINDOW_MAX_DAYS', typeof REFUND_WINDOW_MAX_DAYS !== 'undefined' ? REFUND_WINDOW_MAX_DAYS : undefined),
    ep:    _rulesPick(_rulesFn('_dailyRefundCore'), /if \(!epId\) continue;\s*\/\/ (EasyPost labels only)/, '_dailyRefundCore'),
  }, function (v) {
    return 'Label refund: unused EasyPost labels are refunded (and the customer told the label expired) between day ' + v.after + ' and day ' + v.max +
      ' after sent_at, once EasyPost confirms no scan. Shippo labels are pay-on-scan, so there is nothing to refund.';
  }));
  out.push(_rule({ ttl: G('SELF_SERVE_TTL_DAYS', typeof SELF_SERVE_TTL_DAYS !== 'undefined' ? SELF_SERVE_TTL_DAYS : undefined) },
    function (v) { return 'Self-serve (offer / ID) links expire ' + v.ttl + ' days after they are generated.'; }));
  out.push(_rule({
    bonus: G('REFERRAL_BONUS', typeof REFERRAL_BONUS !== 'undefined' ? REFERRAL_BONUS : undefined),
    thr:   _rulesPick(_rulesFn('_refCodesCore'), /case 'bonus_threshold': return (\d+)/, '_refCodesCore'),
    cpl:   _rulesPick(_rulesFn('_refCodesCore'), /case 'cpl': return (\d+)/, '_refCodesCore'),
    paid:  G('REFERRAL_PURCHASED', typeof REFERRAL_PURCHASED !== 'undefined' ? REFERRAL_PURCHASED : undefined),
  }, function (v) {
    return 'Referral: each paying customer\'s code pays $' + v.bonus + ' per referred purchase (threshold $' + v.thr + ', $' + v.cpl +
      ' per registration). A purchase = a referred shipment in ' + _rulesJoin(v.paid) + ' with a purchase price. Self-referrals (same email/phone/address) are withheld in referralPayoutReport.';
  }));
  return out;
}

// ── 2. Sequences ───────────────────────────────────────────────────────
function _rulesDur(min) {
  if (min == null || isNaN(min)) return '?';
  if (min < 60) return min + ' min';
  if (min < 2880) return (min / 60) + ' h';
  return (min / 1440) + ' days';
}
function _rulesManual(handlers, installed) {
  var on = handlers.filter(function (h) { return installed[h]; });
  return { manual: true, handler: handlers.join(' / '), installed: on.length > 0,
           cadence: on.length ? 'trigger installed: ' + on.join(', ') : 'no trigger — run by hand from the Apps Script editor', evidence: [] };
}
function _rulesEmail(touch, variant, subject, html) { return { touch: touch, channel: 'email', variant: variant || '', subject: subject || '', body: _rulesText(html) }; }
function _rulesSms(touch, variant, text) { return { touch: touch, channel: 'sms', variant: variant || '', subject: '', body: String(text || '') }; }
function _rulesCopy(fn) {
  try { return fn(); } catch (e) { return [{ touch: '', channel: '', variant: '', subject: '', body: '⚠ could not render: ' + e, error: true }]; }
}
// A subject built by an expression (not a literal) — shown as written.
function _rulesExpr(p) { return p.ok ? '(as written in code) ' + p.value.replace(/\s+/g, ' ').trim() : '⚠ subject expression not found'; }
function _rulesG(name) { var g = (typeof globalThis !== 'undefined') ? globalThis : this; return g ? g[name] : undefined; }

function _rulesSequences(installed) {
  var S = RULES_SAMPLE, out = [];

  // Pre-registration drip
  var drip = _rulesFn('_dripCore'), DW = '_dripCore';
  out.push({
    key: 'drip', label: 'Pre-registration drip', file: 'drip.gs',
    trigger: _rulesTrigger(_rulesFn('createTriggerV3'), 'createTriggerV3', 'sendFollowUpEmails_v3', installed),
    rules: [
      _rule({
        t1: _rulesPick(drip, /THRESHOLD_1_MIN = ([\d\s*]+)[,;]/, DW), t2: _rulesPick(drip, /THRESHOLD_2_MIN = ([\d\s*]+)[,;]/, DW),
        t3: _rulesPick(drip, /THRESHOLD_3_MIN = ([\d\s*]+)[,;]/, DW), max: _rulesPick(drip, /MAX_AGE_MIN = ([\d\s*]+)[,;]/, DW),
      }, function (v) {
        return 'Emails a lead that gave an email but never registered: INCOMPLETE_1 once the lead is ' + _rulesDur(_rulesNum(v.t1)) + ' old, INCOMPLETE_2 at ' +
          _rulesDur(_rulesNum(v.t2)) + ', INCOMPLETE_3 at ' + _rulesDur(_rulesNum(v.t3)) + '; nothing once the lead is older than ' + _rulesDur(_rulesNum(v.max)) + '.';
      }),
      _rule({ cap: _rulesGlobal('DRIP_MAX_SENDS', _rulesG('DRIP_MAX_SENDS')), one: _rulesPick(drip, /(touchedThisRun\[lead\.email\]) = true/, DW) },
        function (v) { return 'At most ' + v.cap + ' emails per run, and one stage per person per run. Stages already sent are read from every stamp on the lead\'s Lead Intake rows.'; }),
      _rule({ drained: _rulesPick(drip, /indexOf\('(DRAINED)'\)/, DW), recov: _rulesPick(drip, /indexOf\('(RECOV:)'\)/, DW) },
        function () { return 'Skips anyone stamped DRAINED or who already got a recovery email (RECOV:), registered leads, Do Not Contact, and implausible addresses (typo domains are corrected, not skipped).'; }),
      { ok: true, text: _rulesSrc(drip).indexOf("'H'") === -1 ? 'No quiet hours — email only, sent whenever the trigger runs.' : '⚠ drip has an hour check — review _dripCore.', evidence: [] },
    ],
    copy: _rulesCopy(function () {
      return ['INCOMPLETE_1', 'INCOMPLETE_2', 'INCOMPLETE_3'].map(function (t) {
        var tpl = getTemplate(t, S.first, S.item, S.estimate, '', null);
        return _rulesEmail(t, '', tpl.subject, tpl.html);
      });
    }),
  });

  // Registration alerts
  var reg = _rulesFn('notifyNewRegistrations');
  out.push({
    key: 'reg_alert', label: 'Registration alerts', file: 'drip.gs',
    trigger: _rulesTrigger(_rulesFn('createRegAlertTrigger'), 'createRegAlertTrigger', 'notifyNewRegistrations', installed),
    rules: [
      _rule({
        stage: _rulesPick(reg, /toLowerCase\(\) === '([a-z_]+)'/, 'notifyNewRegistrations'),
        prop:  _rulesPick(reg, /getProperty\('(REG_ALERT_LAST_ISO)'\)/, 'notifyNewRegistrations'),
        phone: _rulesGlobal('REG_ALERT_PHONE', _rulesG('REG_ALERT_PHONE')), email: _rulesGlobal('REG_ALERT_EMAIL', _rulesG('REG_ALERT_EMAIL')),
      }, function (v) {
        return 'Texts ' + v.phone + ' and emails ' + v.email + ' for each shipment created since ' + v.prop + ' that is in ' + v.stage + '. Nothing goes to the customer.';
      }),
    ],
    copy: [], copy_note: 'Alert copy is built inline in notifyNewRegistrations (internal, to DW) — there is no template function to render.',
  });

  // Post-label v2
  var pl2 = _rulesFn('_pl2Core'), PW = '_pl2Core';
  out.push({
    key: 'post_label', label: 'Post-label v2', file: 'postlabel-v2.gs',
    trigger: _rulesTrigger(_rulesFn('createPostLabelTriggerV2'), 'createPostLabelTriggerV2', 'sendPostLabelFollowups_v2', installed),
    rules: [
      _rule({ touches: _rulesGlobal('PL2_TOUCHES', _rulesG('PL2_TOUCHES')), grace: _rulesGlobal('PL2_GRACE_DAYS', _rulesG('PL2_GRACE_DAYS')) }, function (v) {
        return 'Touches after the label is sent: ' + v.touches.map(function (t) { return 'day ' + t.day + ' ' + t.channel + ' (' + t.key + ')'; }).join(', ') +
          '. Each fires once, from its day until ' + v.grace + ' days after it; a missed window is skipped, never caught up.';
      }),
      _rule({ qs: _rulesGlobal('PL2_QUIET_START', _rulesG('PL2_QUIET_START')), qe: _rulesGlobal('PL2_QUIET_END', _rulesG('PL2_QUIET_END')), cap: _rulesGlobal('PL2_MAX_PER_RUN', _rulesG('PL2_MAX_PER_RUN')) },
        function (v) { return 'SMS only from ' + v.qs + ':00 to ' + v.qe + ':00 ET (a night-time SMS waits for the next daytime run); email any time. At most ' + v.cap + ' sends per run.'; }),
      _rule({
        stage: _rulesPick(pl2, /toLowerCase\(\) !== '([a-z_]+)'\) continue;/, PW), age: _rulesPick(pl2, /days > (\d+)\) continue;/, PW),
        re: _rulesPick(pl2, /re < (\d+)\) continue;/, PW), transit: _rulesPick(_rulesFn('_pl2InTransit'), /return \/([^/]+)\/\.test/, '_pl2InTransit'),
      }, function (v) {
        return 'Only shipments in ' + v.stage + ' with nothing received and a label sent at most ' + v.age + ' days ago. Skipped when the inbound tracking status matches /' + v.transit +
          '/, when the re-engagement email went out under ' + v.re + ' days ago, when the customer lacks the phone/email for that touch, or is on Do Not Contact.';
      }),
      _rule({ svc: _rulesPick(_rulesFn('_pl2IsUsps'), /if \(\/(fedex)\/\.test\(svc\)\) return false;/, '_pl2IsUsps') },
        function () { return 'Carrier wording follows shipping_service (FedEx vs USPS), falling back to shipping_type: usps or blank → USPS copy; fedex (incl. legacy label) and kit → FedEx copy.'; }),
    ],
    copy: _rulesCopy(function () {
      var variants = [['USPS', { shipping_service: 'USPS Ground Advantage', shipping_type: 'usps', label_qr_url: '' }],
                      ['FedEx', { shipping_service: 'FedEx Ground', shipping_type: 'fedex', label_qr_url: '' }]];
      var rows = [];
      PL2_TOUCHES.forEach(function (t) {
        variants.forEach(function (vv) {
          var c = _pl2Content(t.key, S.first, S.phrase, vv[1]);
          var label = t.key + ' · day ' + t.day;
          rows.push(t.channel === 'sms' ? _rulesSms(label, vv[0], c.sms) : _rulesEmail(label, vv[0], c.subject, buildPlainEmail(S.first, c.body)));
        });
      });
      return rows;
    }),
  });

  // Label expiry
  var ref = _rulesFn('_dailyRefundCore');
  var subj = _rulesPick(ref, /var emailSubj = '([^']*)'/, '_dailyRefundCore');
  out.push({
    key: 'label_expiry', label: 'Label expiry', file: 'Code.gs',
    trigger: _rulesTrigger(_rulesFn('createRefundTrigger'), 'createRefundTrigger', 'processDailyRefunds', installed),
    rules: [
      _rule({ after: _rulesGlobal('REFUND_AFTER_DAYS', _rulesG('REFUND_AFTER_DAYS')), max: _rulesGlobal('REFUND_WINDOW_MAX_DAYS', _rulesG('REFUND_WINDOW_MAX_DAYS')),
              ep: _rulesPick(ref, /if \(!epId\) continue;\s*\/\/ (EasyPost labels only)/, '_dailyRefundCore') },
        function (v) { return 'EasyPost labels only: between day ' + v.after + ' and ' + v.max + ' after sent_at, with nothing received and EasyPost confirming no scan, the label is refunded, label_refunded_at stamped, and the customer gets an SMS + email saying it expired (reply for a fresh one).'; }),
    ],
    copy: subj.ok ? [{ touch: 'label expired', channel: 'email', variant: '', subject: subj.value, body: '' }] : [],
    copy_note: 'Only the email subject is a literal; the SMS and email bodies are built inline in _dailyRefundCore, so they are not rendered here.',
  });

  // Re-engagement
  var rs = _rulesFn('reengageSend');
  var rsub = _rulesPick(rs, /Subject: '([^']*)'/, 'reengageSend');
  out.push({
    key: 'reengage', label: 'Re-engagement', file: 'reengage.gs',
    trigger: _rulesManual(['reengageSend25', 'reengageSend100', 'reengageSend'], installed),
    rules: [
      _rule({
        min: _rulesGlobal('REENGAGE_MIN_DAYS', _rulesG('REENGAGE_MIN_DAYS')), tag: _rulesGlobal('REENGAGE_TAG', _rulesG('REENGAGE_TAG')),
        stage: _rulesPick(_rulesFn('_reengageCandidates'), /toLowerCase\(\)\.trim\(\) !== '([a-z_]+)'\) continue;/, '_reengageCandidates'),
        batch: _rulesPick(rs, /limit = limit \|\| (\d+);/, 'reengageSend'),
      }, function (v) {
        return 'Manual batches (reengageSend(limit), default ' + v.batch + '): one email per person holding a label in ' + v.stage + ' with nothing received, sent at least ' + v.min +
          ' days ago and never re-engaged; freshest label first; stamped reengage_sent_at so nobody gets it twice. Broadcast stream "' + _reengageStream() + '", tag ' + v.tag + '. Skips Do Not Contact and implausible addresses.';
      }),
    ],
    copy: _rulesCopy(function () { return [{ touch: 'reengage', channel: 'email', variant: '', subject: rsub.ok ? rsub.value : '⚠ subject not found', body: _reengageText(S.first).trim() }]; }),
  });

  // Recovery
  var rec = _rulesFn('_recoveryCore'), rsend = _rulesFn('recoveryEmailSend');
  out.push({
    key: 'recovery', label: 'Recovery', file: 'Code.gs',
    trigger: _rulesManual(['recoveryEmailSend'], installed),
    rules: [
      _rule({ days: _rulesPick(rsend, /daysBack \|\| (\d+)/, 'recoveryEmailSend'), max: _rulesPick(rsend, /maxSend \|\| (\d+)/, 'recoveryEmailSend'),
              tag: _rulesPick(rec, /Tag: '([\w-]+)'/, '_recoveryCore') },
        function (v) { return 'Manual (recoveryEmailSend(daysBack, maxSend, minEst), defaults ' + v.days + ' days / ' + v.max + ' emails): emails partials — gave an email, never an address — with activity in the window, most recent first, once per email (stamped RECOV: in Lead Intake). Skips invalid or implausible emails, estimates below minEst, and Do Not Contact. Broadcast stream, tag ' + v.tag + '.'; }),
    ],
    copy: _rulesCopy(function () {
      return [_rulesEmail('recovery', '', _rulesExpr(_rulesPick(rec, /var subject = ([\s\S]*?);\n/, '_recoveryCore')),
        _recoveryEmailBody(S.first, S.item, S.estimate, buildReturnUrl('shipping', S.first, S.item, S.estimate)))];
    }),
  });

  // Referral invites
  var inv = _rulesFn('_refInvitesCore');
  out.push({
    key: 'referral', label: 'Referral invites', file: 'referral.gs',
    trigger: _rulesManual(['sendReferralInvites'], installed),
    rules: [
      _rule({ paid: _rulesGlobal('REFERRAL_PURCHASED', _rulesG('REFERRAL_PURCHASED')), prefix: _rulesGlobal('REFERRAL_PREFIX', _rulesG('REFERRAL_PREFIX')),
              once: _rulesPick(inv, /indexOf\('(invited )'\)/, '_refInvitesCore') },
        function (v) { return 'Manual (createReferralCodes, then sendReferralInvites): one invite per customer referral code (' + v.prefix + '…), created for customers with a paid shipment in ' + _rulesJoin(v.paid) + '; stamped "invited <date>" in the Affiliates notes. Broadcast stream, tag referral-invite; skips Do Not Contact and implausible emails.'; }),
    ],
    copy: _rulesCopy(function () {
      return [_rulesEmail('invite', '', _rulesExpr(_rulesPick(inv, /var subject = ([^;]+);/, '_refInvitesCore')),
        _refInviteHtml(S.first, SITE_BASE_URL_SAFE() + '/?ref=' + REFERRAL_PREFIX + 'jane-0'))];
    }),
  });

  return out;
}

// ── 5. Explain a registration ─────────────────────────────────────────
// Ingestion doesn't log append decisions, so this RECONSTRUCTS them from the
// Lead Intake rows, the customer's shipments (created_at / sent_at /
// received_at) and DebugLog, using the live append-window constants.
function _rulesDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');   // Lead Intake "yyyy-MM-dd HH:mm:ss" (script time zone)
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function _rulesDay(d) { return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d') : '?'; }
function _rulesIso(d) { return d ? d.toISOString() : ''; }

function _rulesDecide(L, ships, cfg, dbg) {
  var DAY = 86400000, MIN = 60000;
  if (!L._t) return { shipment_id: '', text: 'Timestamp unreadable — cannot reconstruct.' };
  var t = L._t.getTime();
  var near = function (ev, mins) { return dbg.filter(function (d) { return d.event === ev && d._t && Math.abs(d._t.getTime() - t) <= mins * MIN; })[0]; };

  var created = ships.filter(function (s) { return s._c && s._c.getTime() >= t - 2 * MIN && s._c.getTime() <= t + 10 * MIN; })[0];
  if (created) {
    return { shipment_id: created.shipment_id, text: 'Created ' + created.shipment_id + ' (' + (created.shipping_type || 'no type') + ', stage now ' + created.stage + ')' +
      (near('PATH_CREATE', 5) ? ' — DebugLog PATH_CREATE confirms.' : '.') };
  }
  var before = ships.filter(function (s) { return s._c && s._c.getTime() < t; });
  var eligible = before.filter(function (s) {
    if (s._r && s._r.getTime() <= t) return false;              // already received by then
    var sent = s._s && s._s.getTime() <= t;
    if (!sent) return true;                                      // not shipped yet → open at any age
    return cfg.staleDays != null && (t - s._c.getTime()) < cfg.staleDays * DAY;
  }).sort(function (a, b) { return b._c - a._c; });
  if (eligible.length) {
    var g = eligible[0], sent = g._s && g._s.getTime() <= t;
    var why = sent
      ? cfg.recentStage + ', sent ' + _rulesDay(g._s) + ', created ' + Math.floor((t - g._c.getTime()) / DAY) + ' days earlier — inside the ' + cfg.staleDays + '-day window'
      : 'not shipped yet — ' + _rulesJoin(cfg.open);
    var itemNote = '';
    if (L.item) {
      var hay = (String(g.item || '') + '\n' + String(g.notes || '')).toLowerCase();
      itemNote = hay.indexOf(String(L.item).trim().toLowerCase()) !== -1
        ? ' Item "' + L.item + '" is on it.'
        : ' Item "' + L.item + '" is not on it (dropped as a duplicate, or edited since).';
    }
    return { shipment_id: g.shipment_id, text: 'Appended to ' + g.shipment_id + ' because it was open (' + why + ').' + itemNote };
  }
  if (L.shipping && L.has_address) {
    var last = before.sort(function (a, b) { return b._c - a._c; })[0];
    if (last && cfg.coolDays != null && (t - last._c.getTime()) < cfg.coolDays * DAY) {
      return { shipment_id: last.shipment_id, text: 'No new shipment: ' + cfg.coolDays + '-day cooldown — ' + last.shipment_id + ' was created ' +
        Math.floor((t - last._c.getTime()) / DAY) + ' days earlier and had already arrived (the photo went to it).' };
    }
    var err = near('ERROR', 5);
    return { shipment_id: '', text: 'Registered (shipping + address) but no shipment was created near this time' +
      (err ? ' — DebugLog ERROR: ' + err.detail : (near('PATH_CREATE', 5) ? ' although DebugLog shows PATH_CREATE' : '')) + '.' };
  }
  var missing = !L.shipping && !L.has_address ? 'shipping method or address' : (!L.shipping ? 'shipping method' : 'address');
  return { shipment_id: '', text: 'No shipment: estimate-only lead (no ' + missing + ').' };
}

function explainRegistration(email) {
  var em = String(email || '').trim().toLowerCase();
  if (em.indexOf('@') === -1) return { success: false, error: 'Enter an email address.' };
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var ing = _rulesFn('handleLeadIngestion'), notes = [];
  var p = {
    open: _rulesPick(ing, /var PRE_RECEIVED_FRESH = \[([^\]]*)\]/, ''),
    recent: _rulesPick(ing, /\(stage === '([a-z_]+)'\)\s*&&\s*createdAt && createdAt > STALE_CUTOFF/, ''),
    days: _rulesPick(ing, /var STALE_DAYS = (\d+)/, ''),
    cool: _rulesPick(ing, /daysSince < (\d+)/, ''),
  };
  var bad = Object.keys(p).filter(function (k) { return !p[k].ok; });
  if (bad.length) notes.push('⚠ Could not read ' + bad.join(', ') + ' from handleLeadIngestion — decisions may be incomplete.');
  var cfg = { open: p.open.ok ? _rulesList(p.open.value) : [], recentStage: p.recent.ok ? p.recent.value : 'outbound_complete',
              staleDays: p.days.ok ? Number(p.days.value) : null, coolDays: p.cool.ok ? Number(p.cool.value) : null };
  notes.push('Reconstructed: ingestion does not record its append/create decision. The stage at the time is inferred from sent_at / received_at; the "stage now" shown can differ.');

  // Customer — ingestion matches String(email).toLowerCase() without trimming.
  var custs = getCustomers();
  var loose = custs.filter(function (c) { return String(c.email || '').trim().toLowerCase() === em; });
  var exact = custs.filter(function (c) { return String(c.email).toLowerCase() === em; });
  var customer = exact[0] || loose[0] || null;

  var guards = [];
  if (!customer) guards.push({ kind: 'no_customer', text: 'No customer row has this email.' });
  if (loose.length > 1) guards.push({ kind: 'duplicate', text: loose.length + ' customer rows share this email (' + loose.map(function (c) { return c.customer_id; }).join(', ') + '); ingestion reuses the first exact match.' });
  if (customer && !exact.length) guards.push({ kind: 'duplicate', text: 'The stored email differs by spaces; ingestion does not trim, so a new submission would create a second customer.' });
  var fixed = isPlausibleEmail(em);
  if (!fixed) guards.push({ kind: 'implausible', text: 'Implausible email — the drip and broadcast senders skip it (intake still records the lead).' });
  else if (fixed !== em) guards.push({ kind: 'typo', text: 'Domain typo — automated emails go to ' + fixed + ' instead.' });
  if (isDoNotContact(em) || (customer && customer.phone && isDoNotContact(customer.phone))) {
    guards.push({ kind: 'dnc', text: 'On Do Not Contact — intake still records leads and shipments; automated SMS and email are suppressed.' });
  }

  var ships = customer ? sheetToObjects(ss.getSheetByName(TAB.SHIPMENTS)).filter(function (s) { return s.customer_id === customer.customer_id; }) : [];
  ships.forEach(function (s) { s._c = _rulesDate(s.created_at); s._s = _rulesDate(s.sent_at); s._r = _rulesDate(s.received_at); });

  var lsh = ss.getSheetByName(TAB.LEADS), n = lsh.getLastRow() - 1;
  var data = n > 0 ? lsh.getRange(2, 1, n, COL.REF + 1).getValues() : [];
  var leads = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COL.EMAIL] || '').trim().toLowerCase() !== em) continue;
    leads.push({ row: i + 2, _t: _rulesDate(data[i][COL.TIMESTAMP]), type: String(data[i][COL.TYPE] || ''), item: String(data[i][COL.ITEM] || ''),
                 estimate: String(data[i][COL.ESTIMATE] || ''), shipping: String(data[i][COL.SHIPPING] || '').trim(),
                 has_address: !!String(data[i][COL.ADDRESS] || '').trim(), session_id: String(data[i][COL.SESSION_ID] || ''),
                 auto_reply: String(data[i][COL.AUTO_REPLY] || '').slice(0, 300) });
  }
  var totalLeads = leads.length;
  leads = leads.slice(-8).reverse();

  var dbg = [], dsh = ss.getSheetByName('DebugLog');
  if (dsh && dsh.getLastRow() > 1) {
    var last = dsh.getLastRow(), cnt = Math.min(3000, last - 1);
    dsh.getRange(last - cnt + 1, 1, cnt, Math.min(7, dsh.getLastColumn())).getValues().forEach(function (r) {
      if (String(r[2] || '').trim().toLowerCase() !== em) return;
      dbg.push({ _t: _rulesDate(r[0]), event: String(r[1] || ''), detail: r.slice(3).filter(function (x) { return String(x || '').trim(); }).join(' · ').slice(0, 300) });
    });
  }

  leads.forEach(function (L) { var d = _rulesDecide(L, ships, cfg, dbg); L.decision = d.text; L.shipment_id = d.shipment_id; });

  return {
    success: true, email: em,
    customer: customer ? { customer_id: customer.customer_id, name: customer.name || '', email: customer.email || '', phone: customer.phone || '', address: customer.address || '', created_at: String(customer.created_at || '') } : null,
    guards: guards, notes: notes, total_leads: totalLeads,
    leads: leads.map(function (L) { var o = {}; Object.keys(L).forEach(function (k) { if (k !== '_t') o[k] = L[k]; }); o.ts = _rulesIso(L._t); return o; }),
    shipments: ships.sort(function (a, b) { return (b._c || 0) - (a._c || 0); }).map(function (s) {
      return { shipment_id: s.shipment_id, stage: s.stage, shipping_type: s.shipping_type || '', item: String(s.item || ''),
               created_at: _rulesIso(s._c), sent_at: _rulesIso(s._s), received_at: _rulesIso(s._r) };
    }),
    debug: dbg.slice(-10).reverse().map(function (d) { return { ts: _rulesIso(d._t), event: d.event, detail: d.detail }; }),
  };
}

// ── 6. Stages & actions ────────────────────────────────────────────────
// Every CRM action that moves a shipment: where it moves it from and to, and
// what else it does. Read from the handlers, like every other section.
function _rulesStages() {
  var gen = _rulesFn('generateAndSendLabel'), upd = _rulesFn('updateShipment');
  var tok = _rulesFn('handleGenerateSelfServeToken'), ss = _rulesFn('_notifySelfServeSubmission');
  var pay = _rulesFn('handleCapturePaymentId'), lo = _rulesFn('handlePushToLeadsOnline'), ret = _rulesFn('handleGenerateReturnLabel');
  var stamp = function (stage) { return _rulesPick(upd, new RegExp("'" + stage + "':\\s*'(\\w+)'"), 'updateShipment'); };
  var out = [];

  out.push({ action: 'Fulfill (generate + send label)', file: 'Code.gs · handleGenerateUSPSLabel → generateAndSendLabel',
    from: 'ready_to_fulfill (the CRM only offers the button there; the server does not check the current stage)',
    to: _rulesPick(gen, /stage: '([a-z_]+)',\s*\n\s*shipping_cost/, 'generateAndSendLabel'),
    rules: [
      _rule({ to: _rulesPick(gen, /stage: '([a-z_]+)',\s*\n\s*shipping_cost/, 'generateAndSendLabel'), st: stamp('outbound_complete') },
        function (v) { return 'Buys the label, sets stage ' + v.to + ' and stamps ' + v.st + ' (updateShipment stamps it on the transition), and writes outbound_tracking, shipping_cost, shipping_service, the provider id and label_qr_url.'; }),
      _rule({ mail: _rulesPick(gen, /Subject: 'Your prepaid ' \+ (carrierName)/, 'generateAndSendLabel'), sms: _rulesPick(gen, /(sendSms)\(customerPhone/, 'generateAndSendLabel') },
        function () { return 'Emails the customer the label (Postmark direct, BCC to DW) and texts them; the carrier wording follows the label that was actually bought.'; }),
      _rule({ q: _rulesPick(upd, /_enqueue\('(capi)'/, 'updateShipment'), flex: _rulesPick(upd, /_enqueue\('(flex)'/, 'updateShipment'), fire: _rulesGlobal('FLEX_FIRE_STAGE', _rulesG('FLEX_FIRE_STAGE')) },
        function (v) { return 'Every stage change queues a "' + v.q + '" job (Meta CAPI); a "' + v.flex + '" job is queued only when the new stage is ' + v.fire + '.'; }),
    ] });

  out.push({ action: 'Mark received', file: 'Code.gs · updateShipment (CRM stage change)',
    from: 'outbound_complete', to: { ok: true, value: 'received' },
    rules: [ _rule({ st: stamp('received'), fire: _rulesGlobal('FLEX_FIRE_STAGE', _rulesG('FLEX_FIRE_STAGE')) },
      function (v) { return 'Stamps ' + v.st + ' if it is empty, queues the CAPI job, and fires the FlexOffers conversion (FLEX_FIRE_STAGE = ' + v.fire + '). No message goes to the customer.'; }) ] });

  out.push({ action: 'Send offer (self-serve link)', file: 'Code.gs · handleGenerateSelfServeToken',
    from: 'inspected', to: { ok: true, value: 'pending_response — moved by the CRM, not by this handler' },
    rules: [
      _rule({ ttl: _rulesGlobal('SELF_SERVE_TTL_DAYS', _rulesG('SELF_SERVE_TTL_DAYS')), log: _rulesPick(tok, /type: '(offer)'/, 'handleGenerateSelfServeToken') },
        function (v) { return 'Writes a self-serve token good for ' + v.ttl + ' days, records offer_price / offer_description on the shipment, emails the customer the offer link, and logs a Contact Log row of type "' + v.log + '". The stage itself is changed by the CRM (the offer prompt on inspected → pending_response).'; }),
    ] });

  out.push({ action: 'Customer accepts (self-serve form)', file: 'Code.gs · handleSubmitSelfServe → _notifySelfServeSubmission',
    from: _rulesPick(ss, /curStage === '([a-z_]+)' \|\| curStage === '([a-z_]+)'/, '_notifySelfServeSubmission'),
    to: _rulesPick(ss, /ssUpdates\.stage = '([a-z_]+)'/, '_notifySelfServeSubmission'),
    rules: [
      _rule({ from: _rulesPick(ss, /curStage === '([a-z_]+)' \|\| curStage === '([a-z_]+)'/, '_notifySelfServeSubmission'),
              to: _rulesPick(ss, /ssUpdates\.stage = '([a-z_]+)'/, '_notifySelfServeSubmission'),
              st: _rulesPick(ss, /(self_serve_submitted_at): new Date/, '_notifySelfServeSubmission') },
        function (v, P) { return 'Only advances from ' + P.from.groups[1] + ', ' + P.from.groups[2] + ' or a blank stage → ' + v.to + ' (never backward), stamps ' + v.st + ', logs a Contact Log note, and emails DW the payment + ID details.'; }),
    ] });

  out.push({ action: 'Capture payment / ID', file: 'Code.gs · handleCapturePaymentId',
    from: { ok: true, value: 'any' }, to: { ok: true, value: 'unchanged — the CRM moves the stage separately' },
    rules: [ _rule({ w: _rulesPick(pay, /(updateShipment)\(shipmentId, shipmentUpdates\)/, 'handleCapturePaymentId'), st: stamp('pending_payment') },
      function (v) { return 'Writes the ID fields, sworn-statement fields and payment method/info to the shipment and customer. It changes no stage itself; when the CRM moves a shipment to pending_payment, updateShipment stamps ' + v.st + '.'; }) ] });

  out.push({ action: 'Push to LeadsOnline', file: 'leadsonline.gs · handlePushToLeadsOnline',
    from: _rulesPick(lo, /toLowerCase\(\) !== '([a-z_]+)'\)/, 'handlePushToLeadsOnline'),
    to: _rulesPick(lo, /leadsonline_submitted_at: stamp[\s\S]{0,60}?stage: '([a-z_]+)'/, 'handlePushToLeadsOnline'),
    rules: [
      _rule({ gate: _rulesPick(lo, /toLowerCase\(\) !== '([a-z_]+)'\)/, 'handlePushToLeadsOnline'),
              to: _rulesPick(lo, /leadsonline_submitted_at: stamp[\s\S]{0,60}?stage: '([a-z_]+)'/, 'handlePushToLeadsOnline'),
              done: _rulesPick(lo, /(completed_at): stamp/, 'handlePushToLeadsOnline'),
              kind: _rulesPick(lo, /kind: '(auto:leadsonline)'/, 'handlePushToLeadsOnline') },
        function (v) { return 'Refuses unless the shipment is at ' + v.gate + '. On a confirmed ticket it stamps leadsonline_submitted_at and ' + v.done + ', sets stage ' + v.to + ', and logs a Contact Log row with kind ' + v.kind + '. Photos upload afterwards through a separate uploadLeadsOnlinePhotos call, so a slow upload cannot fail the submission.'; }),
    ] });

  out.push({ action: 'Return label', file: 'Code.gs · handleGenerateReturnLabel',
    from: { ok: true, value: 'any' }, to: { ok: true, value: 'unchanged — returning is a separate CRM stage change' },
    rules: [ _rule({ trk: _rulesPick(ret, /updateShipment\(shipmentId, \{ (return_tracking): label\.tracking_number \}\)/, 'handleGenerateReturnLabel'), st: stamp('returned') },
      function (v) { return 'Buys a USPS Ground Advantage label us → customer (billed on creation, not scan-based), writes ' + v.trk + ', emails the customer the tracking, logs a Contact Log note and returns the label PDF to the CRM. When the CRM later sets the stage to returned, updateShipment stamps ' + v.st + '.'; }) ] });

  // from/to may be a literal string (a stage the CRM sets, not this handler) or a pick.
  var show = function (v) {
    if (typeof v === 'string') return v;
    return (v && v.ok) ? v.value : '⚠ not found in code';
  };
  return out.map(function (x) {
    return { action: x.action, file: x.file, from: show(x.from), to: show(x.to), rules: x.rules };
  });
}

// ── getRules + handlers ────────────────────────────────────────────────
function _rulesSafe(fn) { try { return fn(); } catch (e) { return { error: String(e && e.message || e) }; } }

function getRules() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(RULES_CACHE_KEY);
  if (hit) { try { var c = JSON.parse(hit); c.cached = true; return c; } catch (e) {} }
  var installed = _rulesInstalled();
  var out = {
    success: true, generated_at: new Date().toISOString(), sample: RULES_SAMPLE,
    intake: _rulesSafe(_rulesIntake),
    sequences: _rulesSafe(function () { return _rulesSequences(installed); }),
    routing: _rulesSafe(_rulesRouting),
    money: _rulesSafe(_rulesMoney),
    stages: _rulesSafe(_rulesStages),
  };
  try { cache.put(RULES_CACHE_KEY, JSON.stringify(out), RULES_CACHE_SEC); } catch (e) { Logger.log('rules cache put: ' + e); }
  return out;
}

function handleGetRules(parsed) {
  try { return getRules(); } catch (e) { return { success: false, error: String(e && e.message || e) }; }
}
function handleExplainRegistration(parsed) {
  try { return explainRegistration(parsed.email); } catch (e) { return { success: false, error: String(e && e.message || e) }; }
}
