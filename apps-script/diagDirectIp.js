// ═══════════════════════════════════════════════════════════════════════
//  diagDirectIp.gs — how many "Direct" registrations recover at wider same-IP
//  windows? Read-only. Run diagDirectIp().
//
//  For every registration with NO tagged row of its own, look for a tagged
//  row from the same IP within 1h / 1d / 7d / 30d (either direction). Reports
//  recoveries per window, where they'd be credited, and how many of the
//  matches look risky (the same IP also served OTHER emailed people — shared
//  Wi-Fi, office, campus).
// ═══════════════════════════════════════════════════════════════════════
function diagDirectIp() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var lead = ss.getSheetByName(TAB.LEADS).getDataRange().getValues();
  var hasAttr = function (row) { return !!(row[COL.TRAFFIC_SRC] || row[COL.MEDIUM] || row[COL.CAMPAIGN] || row[COL.AD_CONTENT] || row[COL.FBCLID] || row[COL.GCLID] || row[COL.REF]); };
  var attrOf = function (row) { return { utm_source: String(row[COL.TRAFFIC_SRC]||''), utm_medium: String(row[COL.MEDIUM]||''), utm_campaign: String(row[COL.CAMPAIGN]||''), utm_content: String(row[COL.AD_CONTENT]||''), fbclid: String(row[COL.FBCLID]||''), gclid: String(row[COL.GCLID]||''), ref: String(row[COL.REF]||'') }; };

  var taggedByIp = {}, emailsByIp = {}, ownTagged = {}, regByEmail = {}, visits = {};
  for (var r = 1; r < lead.length; r++) {
    var row = lead[r];
    var ts = row[COL.TIMESTAMP]; var t = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(t.getTime())) continue;
    var ip = String(row[COL.IP] || '').trim();
    var em = String(row[COL.EMAIL] || '').toLowerCase().trim();
    var tagged = hasAttr(row);
    if (ip && tagged) (taggedByIp[ip] = taggedByIp[ip] || []).push({ t: t, a: attrOf(row), em: em });
    if (!em || em.indexOf('@') === -1) continue;
    if (ip) { (emailsByIp[ip] = emailsByIp[ip] || {})[em] = true; (visits[em] = visits[em] || []).push({ ip: ip, t: t }); }
    if (tagged) ownTagged[em] = true;
    if (String(row[COL.ADDRESS] || '').trim() && (!regByEmail[em] || t < regByEmail[em])) regByEmail[em] = t;
  }

  var direct = Object.keys(regByEmail).filter(function (em) { return !ownTagged[em]; });
  var windows = [['1h', 3600000], ['1d', 86400000], ['7d', 7 * 86400000], ['30d', 30 * 86400000]];
  Logger.log('═══ DIRECT RECOVERY BY SAME-IP WINDOW — ' + direct.length + ' untagged registrations ═══');
  windows.forEach(function (w) {
    var name = w[0], ms = w[1];
    var matched = 0, risky = 0, byChan = {};
    direct.forEach(function (em) {
      var vs = visits[em] || [], best = null, bestGap = ms + 1, sharedIp = false;
      vs.forEach(function (v) {
        var cands = taggedByIp[v.ip] || [];
        cands.forEach(function (c) {
          if (c.em && c.em === em) return;              // (can't happen — own rows are untagged — but be safe)
          var gap = Math.abs(c.t - v.t);
          if (gap <= ms && gap < bestGap) { best = c; bestGap = gap; sharedIp = Object.keys(emailsByIp[v.ip] || {}).length > 2; }
        });
      });
      if (!best) return;
      matched++;
      if (sharedIp) risky++;
      var k = _mkClassify(best.a).key;
      byChan[k] = (byChan[k] || 0) + 1;
    });
    var chans = Object.keys(byChan).sort(function (a, b) { return byChan[b] - byChan[a]; }).map(function (k) { return k + ' ' + byChan[k]; }).join(', ');
    Logger.log('  ' + name.padEnd(4) + ' recovers ' + String(matched).padStart(3) + ' of ' + direct.length + '   (' + risky + ' on an IP shared by 3+ different people)   → ' + (chans || '—'));
  });
  Logger.log('');
  Logger.log('Reading it: a big jump from 1h→1d is people who came back the same day; 1d→7d is the "came back later" story;');
  Logger.log('7d→30d with many "shared IP" flags is where false credit starts. Pick the widest window that stays clean.');
}
