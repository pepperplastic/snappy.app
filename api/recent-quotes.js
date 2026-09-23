export default async function handler(req, res) {
  // One source of truth: Vercel env APPS_SCRIPT_URL (same var the CRM proxy uses).
  if (!process.env.APPS_SCRIPT_URL) return res.status(500).json({ error: 'APPS_SCRIPT_URL is not set' });
  const GOOGLE_SCRIPT_URL = process.env.APPS_SCRIPT_URL + '?action=recent';
  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'GET',
      redirect: 'follow',
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('Recent quotes error:', err);
    res.status(200).json({ quotes: [] });
  }
}
