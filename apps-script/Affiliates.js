// ═══════════════════════════════════════════════════════════════════════
//  AFFILIATES — registry + cohort analytics (Aug 3)
//
//  Lives in its own .gs file. Apps Script shares globals across files, so
//  SHEET_ID / TAB / COL / sheetToObjects / nextId / jsonResponse all resolve
//  from Code.gs. Nothing in Code.gs changes except three routing lines.
//
//  WHY ?ref AND NOT utm_source:
//  captureUtmParams() in App.jsx does this —
//      if (!utm.utm_source && utm.fbclid) utm.utm_source = 'facebook'
//  — so if an influencer's link is clicked from Facebook, fbclid is appended
//  and utm_source gets OVERWRITTEN. Affiliate credit would silently vanish
//  exactly when an influencer does their job well. A separate `ref` field
//  can't collide with anything.
//
//  ATTRIBUTION MODEL: first-touch. A customer belongs to whichever affiliate
//  appeared on their EARLIEST ref-bearing Lead Intake row, forever. That's
//  the right model for paying affiliates — they get credit for introducing
//  the customer, and a later Facebook click can't steal it.
// ═══════════════════════════════════════════════════════════════════════

var TAB_AFFILIATES = 'Affiliates';

// NOTE ON ADDING COLUMNS: _affiliatesSheet appends new columns to the END of
// the sheet, so new fields MUST be appended to the END of this array too —
// same rule that COLS.SALES learned the hard way in July.
//   channel_type: 'affiliate' (paid per lead) or 'campaign' (paid per click,
//     e.g. Google Ads — cost is ad_spend, not registrations x cpl)
//   ad_spend: hand-entered total spend for a campaign row
var COLS_AFFILIATES = [
  'affiliate_id','ref_code','name','contact','cpl','bonus_amount',
  'bonus_threshold','active','start_date','notes','created_at',
  'channel_type','ad_spend'
];

function _affiliatesSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_AFFILIATES);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_AFFILIATES);
    sheet.appendRow(COLS_AFFILIATES);
    sheet.getRange(1, 1, 1, COLS_AFFILIATES.length)
      .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
    sheet.setFrozenRows(1);
    Logger.log('Created Affiliates tab');
  } else {
    // Idempotent column add — same pattern as _ensureSalesTab. New fields MUST
    // be appended to the END of COLS_AFFILIATES or the schema drifts.
    var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    COLS_AFFILIATES.forEach(function(col) {
      if (existing.indexOf(col) < 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col)
          .setFontWeight('bold').setBackground('#1A1816').setFontColor('#C8953C');
        Logger.log('Added missing column ' + col + ' to Affiliates tab');
      }
    });
  }
  return sheet;
}

function getAffiliates() {
  return sheetToObjects(_affiliatesSheet());
}

function addAffiliate(data) {
  try {
    var sheet = _affiliatesSheet();
    var code = String(data.ref_code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!code) return { success: false, error: 'ref_code required (letters, numbers, - and _ only)' };
    // Codes must be unique — two affiliates sharing one would merge their cohorts.
    var dupe = getAffiliates().some(function(a) {
      return String(a.ref_code || '').trim().toLowerCase() === code;
    });
    if (dupe) return { success: false, error: 'ref_code "' + code + '" already exists' };

    var id = nextId(sheet, 'AFF-', 0);
    var row = COLS_AFFILIATES.map(function(col) {
      if (col === 'affiliate_id') return id;
      if (col === 'created_at')   return new Date().toISOString();
      if (col === 'ref_code')     return code;
      if (col === 'active')       return data.active === false ? 'no' : 'yes';
      if (col === 'channel_type')  return String(data.channel_type || 'affiliate').toLowerCase() === 'campaign' ? 'campaign' : 'affiliate';
      return data[col] !== undefined ? data[col] : '';
    });
    sheet.appendRow(row);
    return { success: true, affiliate_id: id, ref_code: code };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function updateAffiliate(affiliateId, updates) {
  try {
    var sheet = _affiliatesSheet();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('affiliate_id');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === affiliateId) {
        Object.keys(updates).forEach(function(key) {
          var col = headers.indexOf(key);
          if (col < 0) return;
          var val = updates[key];
          if (key === 'ref_code') val = String(val || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
          sheet.getRange(r + 1, col + 1).setValue(val);
        });
        return { success: true };
      }
    }
    return { success: false, error: 'affiliate not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deleteAffiliate(affiliateId) {
  try {
    var sheet = _affiliatesSheet();
    var data = sheet.getDataRange().getValues();
    var idIdx = data[0].indexOf('affiliate_id');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idIdx] === affiliateId) { sheet.deleteRow(r + 1); return { success: true }; }
    }
    return { success: false, error: 'affiliate not found' };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}


// ═══════════════════════════════════════════════════════════════════════
//  COHORT ANALYTICS
//
//  Walks Lead Intake ONCE to resolve email → first-touch ref + registration
//  date, then joins through Customers → Shipments to build the funnel per
//  affiliate. Returns a compact summary (a dozen numbers per affiliate)
//  rather than shipping thousands of lead rows to the browser.
//
//  COHORT MATURITY — the thing that would otherwise mislead you:
//  packages arrive on a long tail (the post-label drip alone runs to day 12).
//  An affiliate whose registrations are a week old will show a terrible ship
//  rate purely because their cohort hasn't matured. So every rate is computed
//  TWICE: once over mature registrations only (default 30+ days old), and
//  once over everything. Judge CPL on the mature numbers.
// ═══════════════════════════════════════════════════════════════════════

var ARRIVED_STAGES   = ['received','pending_response','pending_payment','pending_leadsonline','complete','returned'];
var PURCHASED_STAGES = ['pending_payment','pending_leadsonline','complete'];

function getAffiliateStats(params) {
  params = params || {};
  var matureDays = parseInt(params.mature_days, 10);
  if (isNaN(matureDays)) matureDays = 30;
  if (matureDays < 0) matureDays = 0;
  var matureCutoff = new Date(Date.now() - matureDays * 86400000);

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Pass 1: Lead Intake → email → { ref (first-touch), regTs (earliest
  //    completed registration), everRegistered } ──
  var leadSheet = ss.getSheetByName(TAB.LEADS);
  var leadData = leadSheet.getDataRange().getValues();
  var refIdx = (typeof COL.REF === 'number') ? COL.REF : leadData[0].indexOf('Ref');

  var byEmail = {};
  for (var r = 1; r < leadData.length; r++) {
    var em = String(leadData[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em || em.indexOf('@') === -1) continue;

    var ts = leadData[r][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;

    if (!byEmail[em]) byEmail[em] = { ref: '', refTs: null, regTs: null };
    var rec = byEmail[em];

    // first-touch ref: keep the EARLIEST ref-bearing row
    var ref = refIdx >= 0 ? String(leadData[r][refIdx] || '').trim().toLowerCase() : '';
    if (ref && (!rec.refTs || tsDate < rec.refTs)) { rec.ref = ref; rec.refTs = tsDate; }

    // registration = address AND shipping method present (the shippable moment)
    var addr = String(leadData[r][COL.ADDRESS] || '').trim();
    var ship = String(leadData[r][COL.SHIPPING] || '').trim();
    if (addr && ship && (!rec.regTs || tsDate < rec.regTs)) rec.regTs = tsDate;
  }

  // ── Pass 2: Customers → email ↔ customer_id ──
  var custData = ss.getSheetByName(TAB.CUSTOMERS).getDataRange().getValues();
  var cH = custData[0];
  var cIdIdx = cH.indexOf('customer_id'), cEmIdx = cH.indexOf('email');
  var custIdToEmail = {};
  for (var r = 1; r < custData.length; r++) {
    var cid = custData[r][cIdIdx];
    if (cid) custIdToEmail[cid] = String(custData[r][cEmIdx] || '').toLowerCase().trim();
  }

  // ── Pass 3: Shipments → per-email funnel facts ──
  var shipData = ss.getSheetByName(TAB.SHIPMENTS).getDataRange().getValues();
  var sH = shipData[0];
  var sCustIdx  = sH.indexOf('customer_id');
  var sStageIdx = sH.indexOf('stage');
  var sRecvIdx  = sH.indexOf('received_at');
  var sPriceIdx = sH.indexOf('purchase_price');
  var sApprIdx  = sH.indexOf('appraised_value');

  var perEmail = {};   // email → { arrived, purchased, paid, appraised, qualifyingPurchases }
  for (var r = 1; r < shipData.length; r++) {
    var em = custIdToEmail[shipData[r][sCustIdx]];
    if (!em) continue;
    if (!perEmail[em]) perEmail[em] = { arrived: 0, purchased: 0, paid: 0, appraised: 0, qualifying: 0 };
    var p = perEmail[em];
    var stage = String(shipData[r][sStageIdx] || '').toLowerCase().trim();
    var didArrive = ARRIVED_STAGES.indexOf(stage) !== -1 || String(shipData[r][sRecvIdx] || '').trim() !== '';
    if (didArrive) p.arrived++;
    if (PURCHASED_STAGES.indexOf(stage) !== -1) {
      p.purchased++;
      var price = parseFloat(shipData[r][sPriceIdx]) || 0;
      p.paid += price;
      p.appraised += parseFloat(shipData[r][sApprIdx]) || 0;
      p._prices = p._prices || [];
      p._prices.push(price);
    }
  }

  // ── Roll up per affiliate ──
  var affiliates = getAffiliates();
  var byCode = {};
  affiliates.forEach(function(a) {
    var code = String(a.ref_code || '').trim().toLowerCase();
    if (!code) return;
    byCode[code] = {
      affiliate_id: a.affiliate_id, ref_code: code, name: a.name || code,
      cpl: parseFloat(a.cpl) || 0,
      bonus_amount: parseFloat(a.bonus_amount) || 0,
      bonus_threshold: parseFloat(a.bonus_threshold) || 0,
      active: String(a.active || 'yes').toLowerCase() !== 'no',
      channel_type: String(a.channel_type || 'affiliate').toLowerCase() === 'campaign' ? 'campaign' : 'affiliate',
      ad_spend: parseFloat(a.ad_spend) || 0,
      // mature = registration older than the cutoff; all = everything
      mature: _blankBucket(), all: _blankBucket(),
    };
  });

  Object.keys(byEmail).forEach(function(em) {
    var rec = byEmail[em];
    if (!rec.ref || !byCode[rec.ref]) return;      // no ref, or an unknown code
    if (!rec.regTs) return;                        // never completed registration
    var A = byCode[rec.ref];
    var funnel = perEmail[em] || { arrived: 0, purchased: 0, paid: 0, appraised: 0, _prices: [] };
    var isMature = rec.regTs <= matureCutoff;
    _addToBucket(A.all, funnel, A);
    if (isMature) _addToBucket(A.mature, funnel, A);
  });

  // ── Finalise: rates + payout owed ──
  var out = Object.keys(byCode).map(function(code) {
    var A = byCode[code];
    // For a CAMPAIGN, cost is the ad spend — a single lump figure covering all
    // traffic. The mature view is a SUBSET of that traffic, so charging it the
    // full spend would make mature ROI look far worse than reality. Prorate by
    // registration share instead, and flag it so the number is never mistaken
    // for a measured cost.
    var shareMature = A.all.registrations > 0
      ? (A.mature.registrations / A.all.registrations) : 0;
    _finaliseBucket(A.all, A, A.channel_type === 'campaign' ? A.ad_spend : null);
    _finaliseBucket(A.mature, A, A.channel_type === 'campaign' ? (A.ad_spend * shareMature) : null);
    A.mature.spend_prorated = A.channel_type === 'campaign' && shareMature > 0 && shareMature < 1;
    return A;
  });
  out.sort(function(a, b) { return b.all.registrations - a.all.registrations; });

  // Unknown ref codes seen in the wild — a typo'd link or an affiliate you
  // haven't registered yet. Worth surfacing rather than silently dropping.
  var unknown = {};
  Object.keys(byEmail).forEach(function(em) {
    var ref = byEmail[em].ref;
    if (ref && !byCode[ref]) unknown[ref] = (unknown[ref] || 0) + 1;
  });

  return {
    success: true,
    mature_days: matureDays,
    affiliates: out,
    unknown_refs: Object.keys(unknown).map(function(k) { return { ref_code: k, count: unknown[k] }; }),
  };
}

function _blankBucket() {
  return { registrations: 0, arrived: 0, purchased: 0, paid: 0, appraised: 0, qualifying: 0 };
}

function _addToBucket(b, funnel, A) {
  b.registrations++;
  b.arrived   += funnel.arrived;
  b.purchased += funnel.purchased;
  b.paid      += funnel.paid;
  b.appraised += funnel.appraised;
  // A purchase earns the bonus only if it cleared the threshold.
  (funnel._prices || []).forEach(function(price) {
    if (price >= A.bonus_threshold && A.bonus_amount > 0) b.qualifying++;
  });
}

// overrideCost: for campaign rows, the (possibly prorated) ad spend. Pass null
// for affiliate rows, where cost is derived from registrations and bonuses.
function _finaliseBucket(b, A, overrideCost) {
  b.ship_rate     = b.registrations ? b.arrived / b.registrations : null;
  b.purchase_rate = b.arrived ? b.purchased / b.arrived : null;
  b.margin        = b.appraised - b.paid;                       // expected gross
  b.payout        = (overrideCost !== null && overrideCost !== undefined)
    ? overrideCost
    : ((b.registrations * A.cpl) + (b.qualifying * A.bonus_amount));
  b.net           = b.margin - b.payout;
  b.cost_per_reg      = b.registrations ? b.payout / b.registrations : null;
  b.cost_per_arrival  = b.arrived ? b.payout / b.arrived : null;
  b.cost_per_purchase = b.purchased ? b.payout / b.purchased : null;
  // Round money so the frontend doesn't render 17 decimal places.
  ['paid','appraised','margin','payout','net','cost_per_reg','cost_per_arrival','cost_per_purchase'].forEach(function(k) {
    if (typeof b[k] === 'number') b[k] = Math.round(b[k] * 100) / 100;
  });
}


// ── Run from the editor to sanity-check without the CRM ──
function testAffiliateStats() {
  var r = getAffiliateStats({ mature_days: 30 });
  Logger.log('═══ AFFILIATE STATS (mature = ' + r.mature_days + '+ days) ═══');
  if (!r.affiliates.length) Logger.log('  (no affiliates registered yet — add one in the CRM)');
  r.affiliates.forEach(function(a) {
    var m = a.mature, all = a.all;
    Logger.log('─ ' + a.name + '  (?ref=' + a.ref_code + ')  ' + (a.active ? '' : '[INACTIVE]'));
    Logger.log('   type: ' + a.channel_type + (a.channel_type === 'campaign' ? ('  · spend $' + a.ad_spend) : ('  · $' + a.cpl + '/reg')));
    Logger.log('   MATURE: ' + m.registrations + ' regs → ' + m.arrived + ' arrived (' +
      (m.ship_rate === null ? '—' : (m.ship_rate * 100).toFixed(0) + '%') + ') → ' +
      m.purchased + ' purchased');
    Logger.log('           margin $' + m.margin + ' · payout $' + m.payout + ' · NET $' + m.net);
    Logger.log('   ALL:    ' + all.registrations + ' regs → ' + all.arrived + ' arrived → ' + all.purchased + ' purchased');
  });
  if (r.unknown_refs.length) {
    Logger.log('⚠ Unknown ref codes seen (typo, or unregistered affiliate):');
    r.unknown_refs.forEach(function(u) { Logger.log('   ?ref=' + u.ref_code + ' — ' + u.count + ' lead(s)'); });
  }
  return r;
}


// ═══════════════════════════════════════════════════════════════════════
//  DRILL-DOWN — the records behind a REGS / ARRIVED / PURCHASED number
//
//  Same three passes as getAffiliateStats, and deliberately the same rules
//  (first-touch ref, "registration" = address + shipping present, the
//  ARRIVED_STAGES / PURCHASED_STAGES lists) so a drill-down can never
//  disagree with the count it was opened from. One row per shipment; a
//  registered customer with no shipment still gets a row, with blank
//  shipment fields. counts_reg marks one row per customer so the caller can
//  show REGS without double-counting a customer who sent two boxes.
//
//  ref_codes is an explicit list — the customer-referral group row passes
//  every r-… code at once, which is also how its aggregate is drilled.
// ═══════════════════════════════════════════════════════════════════════
var AFF_RECORDS_MAX = 5000;

function _affDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function getAffiliateRecords(params) {
  params = params || {};

  var codes = params.ref_codes;
  if (typeof codes === 'string') codes = codes.split(',');
  if (!codes || !codes.length) return { success: false, error: 'ref_codes required' };
  var want = {};
  codes.forEach(function (c) { c = String(c || '').trim().toLowerCase(); if (c) want[c] = true; });
  if (!Object.keys(want).length) return { success: false, error: 'ref_codes required' };

  var matureDays = parseInt(params.mature_days, 10);
  if (isNaN(matureDays)) matureDays = 30;
  if (matureDays < 0) matureDays = 0;
  var matureCutoff = new Date(Date.now() - matureDays * 86400000);

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Pass 1: Lead Intake → first-touch ref + earliest registration ──
  var leadData = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var refIdx = (typeof COL.REF === 'number') ? COL.REF : leadData[0].indexOf('Ref');
  var nameIdx = (typeof COL.NAME === 'number') ? COL.NAME : leadData[0].indexOf('Name');

  var byEmail = {};
  for (var r = 1; r < leadData.length; r++) {
    var em = String(leadData[r][COL.EMAIL] || '').toLowerCase().trim();
    if (!em || em.indexOf('@') === -1) continue;
    var ts = leadData[r][COL.TIMESTAMP];
    var tsDate = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(tsDate.getTime())) continue;

    if (!byEmail[em]) byEmail[em] = { ref: '', refTs: null, regTs: null, name: '' };
    var rec = byEmail[em];

    var ref = refIdx >= 0 ? String(leadData[r][refIdx] || '').trim().toLowerCase() : '';
    if (ref && (!rec.refTs || tsDate < rec.refTs)) { rec.ref = ref; rec.refTs = tsDate; }

    var addr = String(leadData[r][COL.ADDRESS] || '').trim();
    var ship = String(leadData[r][COL.SHIPPING] || '').trim();
    if (addr && ship && (!rec.regTs || tsDate < rec.regTs)) rec.regTs = tsDate;
    if (!rec.name && nameIdx >= 0) rec.name = String(leadData[r][nameIdx] || '').trim();
  }

  // Only the emails this call asked about, and only completed registrations —
  // the same two filters getAffiliateStats applies before it counts anything.
  var wanted = {};
  Object.keys(byEmail).forEach(function (em) {
    var rec = byEmail[em];
    if (!rec.ref || !want[rec.ref] || !rec.regTs) return;
    wanted[em] = { ref: rec.ref, regTs: rec.regTs, name: rec.name, mature: rec.regTs <= matureCutoff, rows: [] };
  });
  if (!Object.keys(wanted).length) {
    return { success: true, mature_days: matureDays, records: [], truncated: false };
  }

  // ── Pass 2: Customers → customer_id ↔ email ──
  var custData = ss.getSheetByName(TAB.CUSTOMERS).getDataRange().getValues();
  var cH = custData[0];
  var cIdIdx = cH.indexOf('customer_id'), cEmIdx = cH.indexOf('email'), cNmIdx = cH.indexOf('name');
  var custIdToEmail = {}, emailToCust = {};
  for (var r = 1; r < custData.length; r++) {
    var cid = custData[r][cIdIdx];
    if (!cid) continue;
    var cem = String(custData[r][cEmIdx] || '').toLowerCase().trim();
    custIdToEmail[cid] = cem;
    if (cem && wanted[cem] && !emailToCust[cem]) {
      emailToCust[cem] = { customer_id: cid, name: String(custData[r][cNmIdx] || '').trim() };
    }
  }

  // ── Pass 3: Shipments → one record per shipment ──
  var shipData = ss.getSheetByName(TAB.SHIPMENTS).getDataRange().getValues();
  var sH = shipData[0];
  var ix = {};
  ['shipment_id','customer_id','stage','received_at','purchase_price','sent_at','created_at',
   'purchased_at','paid_at','flex_click_id','flex_postback_sent'].forEach(function (k) { ix[k] = sH.indexOf(k); });

  function cell(row, key) { return ix[key] >= 0 ? row[ix[key]] : ''; }

  for (var r = 1; r < shipData.length; r++) {
    var row = shipData[r];
    var em = custIdToEmail[cell(row, 'customer_id')];
    if (!em || !wanted[em]) continue;
    var stage = String(cell(row, 'stage') || '').toLowerCase().trim();
    var received = cell(row, 'received_at');
    var didArrive = ARRIVED_STAGES.indexOf(stage) !== -1 || String(received || '').trim() !== '';
    var purchasedAt = _affDate(cell(row, 'purchased_at')) || _affDate(cell(row, 'paid_at'));
    wanted[em].rows.push({
      shipment_id: String(cell(row, 'shipment_id') || ''),
      customer_id: String(cell(row, 'customer_id') || ''),
      sent_at: _affDate(cell(row, 'sent_at')),
      arrived_at: _affDate(received),
      purchased_at: purchasedAt,
      paid: parseFloat(cell(row, 'purchase_price')) || 0,
      stage: stage,
      flex_click_id: String(cell(row, 'flex_click_id') || ''),
      flex_postback_sent: _affDate(cell(row, 'flex_postback_sent')),
      arrived: didArrive,
      purchased: PURCHASED_STAGES.indexOf(stage) !== -1,
      _sortTs: new Date(_affDate(cell(row, 'sent_at')) || _affDate(cell(row, 'created_at')) || 0).getTime() || 0,
    });
  }

  // ── Flatten. Earliest shipment first, and that row carries counts_reg. ──
  var records = [], truncated = false;
  Object.keys(wanted).forEach(function (em) {
    if (truncated) return;
    var w = wanted[em];
    var who = emailToCust[em] || { customer_id: '', name: '' };
    var base = {
      ref_code: w.ref, email: em, name: who.name || w.name || '',
      registered_at: _affDate(w.regTs), mature: w.mature,
    };
    w.rows.sort(function (a, b) { return a._sortTs - b._sortTs; });
    if (!w.rows.length) {
      records.push(_affMerge(base, {
        customer_id: who.customer_id, shipment_id: '', sent_at: '', arrived_at: '', purchased_at: '',
        paid: 0, stage: '', flex_click_id: '', flex_postback_sent: '',
        arrived: false, purchased: false, counts_reg: true,
      }));
      return;
    }
    w.rows.forEach(function (s, i) {
      if (records.length >= AFF_RECORDS_MAX) { truncated = true; return; }
      delete s._sortTs;
      s.counts_reg = (i === 0);
      if (!s.customer_id) s.customer_id = who.customer_id;
      records.push(_affMerge(base, s));
    });
  });

  return { success: true, mature_days: matureDays, records: records, truncated: truncated };
}

function _affMerge(base, extra) {
  var o = {};
  Object.keys(base).forEach(function (k) { o[k] = base[k]; });
  Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

// ── Run from the editor to check a code without the CRM ──
function testAffiliateRecords() {
  var stats = getAffiliateStats({ mature_days: 30 });
  if (!stats.affiliates.length) { Logger.log('no affiliates'); return; }
  var code = stats.affiliates[0].ref_code;
  var r = getAffiliateRecords({ ref_codes: [code], mature_days: 30 });
  Logger.log('═══ RECORDS for ?ref=' + code + ' — ' + r.records.length + ' row(s) ═══');
  r.records.slice(0, 25).forEach(function (x) {
    Logger.log('  ' + (x.shipment_id || '(no shipment)') + ' · ' + x.name + ' · ' + x.email +
      ' · reg ' + String(x.registered_at).slice(0, 10) + ' · ' + (x.stage || '—') +
      (x.arrived ? ' · arrived' : '') + (x.purchased ? ' · purchased $' + x.paid : '') +
      (x.counts_reg ? ' · [reg]' : ''));
  });
}
