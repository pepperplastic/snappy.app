// ═══════════════════════════════════════════════════════════════════════
//  settings.gs — small key/value store for CRM-wide settings (Sep 11 2026)
//
//  Backed by Script Properties, so a value set on one device shows on every
//  device. First use: the Sales-tab inventory estimate, which used to live in
//  the browser's localStorage and read $0 on any other phone/laptop.
//
//  Code.gs: add 'getSetting','setSetting' to CRM_WRITE_ACTIONS and route:
//    if (action === 'getSetting') return jsonResponse(handleGetSetting(parsed));
//    if (action === 'setSetting') return jsonResponse(handleSetSetting(parsed));
//  api/crm-proxy.js: add 'getSetting','setSetting' to WRITE_ACTIONS. Redeploy.
// ═══════════════════════════════════════════════════════════════════════

var SETTING_KEYS = ['inventory_estimate'];   // allowlist — nothing else is readable/writable this way

function handleGetSetting(parsed) {
  var key = String(parsed && parsed.key_name || '');
  if (SETTING_KEYS.indexOf(key) === -1) return { success: false, error: 'unknown setting' };
  var raw = PropertiesService.getScriptProperties().getProperty('SETTING_' + key);
  var val = null;
  try { val = raw ? JSON.parse(raw) : null; } catch (e) { val = null; }
  return { success: true, key_name: key, value: val };
}

function handleSetSetting(parsed) {
  var key = String(parsed && parsed.key_name || '');
  if (SETTING_KEYS.indexOf(key) === -1) return { success: false, error: 'unknown setting' };
  var rec = { value: parsed.value, updated: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('SETTING_' + key, JSON.stringify(rec));
  return { success: true, key_name: key, value: rec };
}

// One-time: seed from a number you read off the Sales tab, e.g. seedInventoryEstimate(2500)
function seedInventoryEstimate(n) {
  n = (typeof n === 'number') ? n : 2500;
  var r = handleSetSetting({ key_name: 'inventory_estimate', value: n });
  Logger.log('inventory_estimate = $' + n + ' (' + r.value.updated + ')');
}
function seedInventory2500() { return seedInventoryEstimate(1800); }
