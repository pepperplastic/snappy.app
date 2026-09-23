export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // One source of truth: Vercel env APPS_SCRIPT_URL (same var the CRM proxy uses).
  const GOOGLE_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  if (!GOOGLE_SCRIPT_URL) return res.status(500).json({ success: false, error: 'APPS_SCRIPT_URL is not set' });

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(req.body),
      headers: { 'Content-Type': 'text/plain' },
      redirect: 'follow',
    });

    const text = await response.text();
    console.log('Google Script response:', response.status, text);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Lead submit error:', err);
    res.status(200).json({ status: 'ok' });
  }
}
