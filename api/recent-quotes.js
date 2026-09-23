export default async function handler(req, res) {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyyQPxQfHWB8Y_7GyR7Uh-zn8DEru429ASvGfzAGjkEkjvk6GBdFZg1zpl9DpTtZFV1Fg/exec?action=recent';
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
