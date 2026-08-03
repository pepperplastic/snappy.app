// ═══════════════════════════════════════════════════════════════
//  CRM session helper — HMAC-signed cookie, no dependencies.
//
//  Why a signed cookie and not just a shared secret in the bundle:
//  anything shipped to the browser is public. The PIN in crm.jsx and
//  CRM_KEY ("snappy_crm_2026") are both already burned — they sit in
//  the Vite bundle on snappy.gold. This keeps the real secret on the
//  server and hands the browser only a signed, expiring token.
// ═══════════════════════════════════════════════════════════════

import crypto from 'crypto';

export const COOKIE_NAME = 'sg_crm_session';
const TTL_HOURS = 12;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

// Token format: <expiresAtMs>.<hmac>
export function issueToken(secret) {
  const exp = String(Date.now() + TTL_HOURS * 60 * 60 * 1000);
  return exp + '.' + sign(exp, secret);
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx < 1) return false;
  const exp = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;

  const expected = sign(exp, secret);
  // Constant-time compare — lengths must match first or timingSafeEqual throws.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildCookie(token) {
  const maxAge = TTL_HOURS * 60 * 60;
  return [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',            // JS in the page can't read it — blunts XSS token theft
    'Secure',
    'SameSite=Strict',     // not sent on cross-site requests
    'Path=/',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

// Guard for protected endpoints. Returns true if the request may proceed;
// otherwise it has already written a 401 and the caller should return.
export function requireSession(req, res) {
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRM_SESSION_SECRET not configured' });
    return false;
  }
  const token = readCookie(req, COOKIE_NAME);
  if (!verifyToken(token, secret)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
