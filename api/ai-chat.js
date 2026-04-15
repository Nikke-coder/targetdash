export const config = { runtime: 'nodejs' };

// NOTE: This endpoint uses Anthropic (US) — for admin/internal use only.
// Client-facing AI in the dashboard uses Mistral Medium (EU) for GDPR compliance.
// Do NOT send client financial data through this endpoint.

const ALLOWED_ORIGINS = ['https://admin.targetdash.ai','https://www.targetdash.ai','http://localhost:5173'];
const _rateMap = new Map();
function _rateLimit(key, max=20, windowMs=60000) {
  const now = Date.now();
  const e = _rateMap.get(key) || {count:0, reset:now+windowMs};
  if (now > e.reset) { e.count=0; e.reset=now+windowMs; }
  e.count++;
  _rateMap.set(key, e);
  return e.count > max;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (_rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if(!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    const { messages, system } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system,
        messages,
      }),
    });

    const data = await response.json();
    if(!response.ok) throw new Error(data.error?.message || 'Anthropic error');

    const text = data.content?.[0]?.text || 'No response generated.';
    return res.status(200).json({ text });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
