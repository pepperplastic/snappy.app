export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby82CuMrlr0us5SUSCusqzGoxZYHPQg9nQuzalIplObIjtbXNUpRBNPrJWuV1qimmJbgA/exec';

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
