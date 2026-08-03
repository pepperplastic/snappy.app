// ═══════════════════════════════════════════════════════════════
//  POST /api/crm-auth  { password }        → sets session cookie
//  POST /api/crm-auth  { action:'logout' } → clears it
//  GET  /api/crm-auth                      → { authed: true|false }
//
//  The password lives in the Vercel env var CRM_PASSWORD and is never
//  shipped to the browser. Replaces the client-side PIN in crm.jsx,
//  which anyone could read out of the bundle.
// ═══════════════════════════════════════════════════════════════

import crypto from 'crypto';
import {
  issueToken, verifyToken, buildCookie, clearCookie,
  readCookie, COOKIE_NAME,
} from './_lib/session.js';

// Constant-time string compare so we don't leak the password by timing.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Very small in-memory throttle. Serverless instances are ephemeral and not
// shared, so this is a speed bump, not a wall — it just makes a brute-force
// from a single warm instance annoying. Real rate limiting would need a store.
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function throttled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { first: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  const secret = process.env.CRM_SESSION_SECRET;
  const password = process.env.CRM_PASSWORD;

  if (!secret || !password) {
    return res.status(500).json({
      error: 'Server not configured — set CRM_PASSWORD and CRM_SESSION_SECRET',
    });
  }

  if (req.method === 'GET') {
    const token = readCookie(req, COOKIE_NAME);
    return res.status(200).json({ authed: verifyToken(token, secret) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
    : (req.body || {});

  if (body.action === 'logout') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ ok: true });
  }

  const ip = String(
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
  ).split(',')[0].trim();

  if (throttled(ip)) {
    return res.status(429).json({ error: 'too many attempts — wait 10 minutes' });
  }

  if (!body.password || !safeEqual(body.password, password)) {
    return res.status(401).json({ error: 'incorrect password' });
  }

  attempts.delete(ip);
  res.setHeader('Set-Cookie', buildCookie(issueToken(secret)));
  return res.status(200).json({ ok: true });
}
