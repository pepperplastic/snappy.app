export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = req.query.key;
  if (key !== 'snappy_crm_2026') {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  try {
    const url = 'https://script.google.com/macros/s/AKfycby82CuMrlr0us5SUSCusqzGoxZYHPQg9nQuzalIplObIjtbXNUpRBNPrJWuV1qimmJbgA/exec?action=crm_leads&key=snappy_crm_2026';
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'Accept': 'application/json' }
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      return res.status(500).json({ status: 'error', message: 'Failed to parse Google response', raw: text.slice(0, 500) });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
