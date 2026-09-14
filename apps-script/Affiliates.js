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
