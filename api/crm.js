// Generic Vercel serverless proxy for any CRM action.
// Forwards POST body to Apps Script and returns the response.
// Used by:
//   - Public verify page (/verify) — calls validateSelfServeToken + submitSelfServe
//   - Any future public-facing CRM action that needs to skip the CORS dance
//
// The Apps Script web app's doPost router reads `action` from the parsed body
// and dispatches to the right handler. This proxy is dumb on purpose.

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  // CORS — needed because /verify may be loaded via direct browser link
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby82CuMrlr0us5SUSCusqzGoxZYHPQg9nQuzalIplObIjtbXNUpRBNPrJWuV1qimmJbgA/exec';

  try {
    const upstream = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },  // text/plain avoids CORS preflight to Apps Script
      body: JSON.stringify(req.body),
      redirect: 'follow',
    });

    const text = await upstream.text();
    // Apps Script returns JSON wrapped in ContentService — parse to forward shape cleanly
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — pass through raw text in an error envelope so frontend can show something useful
      return res.status(200).json({ success: false, error: 'Non-JSON upstream response', raw: text.substring(0, 500) });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('crm.js proxy error:', err);
    return res.status(200).json({ success: false, error: 'Proxy error: ' + err.message });
  }
}
