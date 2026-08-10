// ═══════════════════════════════════════════════════════════════
//  /api/_lib/supabase.js — server-only Postgres client.
//
//  SECURITY RULE (from the Aug 4 RLS incident): the secret key bypasses Row
//  Level Security entirely. It lives in Vercel env vars and is imported ONLY
//  by files under /api. It must never be imported by crm.jsx, App.jsx, or
//  anything that ends up in the Vite bundle. The browser reaches Postgres
//  exclusively through /api/crm-proxy.
//
//  Env vars (Vercel → Settings → Environment Variables):
//    SUPABASE_URL               https://gnfkxdgxcrhaexltnjaw.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY  the sb_secret_... value
//    PG_TABLES                  comma list served FROM Postgres (reads)
//    PG_MIRROR                  comma list dual-written TO Postgres (writes)
//  Both lists empty = everything still flows to Apps Script.
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && serviceKey);

// Lazily created so a missing env var doesn't crash unrelated routes.
let _client = null;
export function supabase() {
  if (!supabaseConfigured) {
    throw new Error('Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!_client) {
    _client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'snappy-crm-proxy' } },
    });
  }
  return _client;
}

function parseList(v) {
  return new Set(
    String(v || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

const READ_FROM_PG = parseList(process.env.PG_TABLES);
const MIRROR_TO_PG = parseList(process.env.PG_MIRROR);

export function readsFromPg(table) {
  return supabaseConfigured && READ_FROM_PG.has(String(table).toLowerCase());
}

export function mirrorsToPg(table) {
  return supabaseConfigured && MIRROR_TO_PG.has(String(table).toLowerCase());
}
