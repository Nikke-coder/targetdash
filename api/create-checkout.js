export const config = { runtime: 'nodejs' };

const ALLOWED_ORIGINS = ['https://app.targetdash.ai','https://admin.targetdash.ai','https://www.targetdash.ai','http://localhost:5173'];
const _rateMap = new Map();
function _rateLimit(key, max=10, windowMs=60000) {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (_rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const SUCCESS_URL   = 'https://app.targetdash.ai?payment=success';
  const CANCEL_URL    = 'https://app.targetdash.ai?payment=cancelled';

  try {
    const { user_id, user_email, company_name, price_id } = req.body;

    // Support multiple packages — fallback to default
    const PRICE = price_id || 'price_1TBrBQ36nlMWZMRYgi6eSlZ3';

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', PRICE);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', SUCCESS_URL);
    params.append('cancel_url', CANCEL_URL);
    if (user_email) params.append('customer_email', user_email);
    if (user_id) params.append('metadata[user_id]', user_id);
    if (user_email) params.append('metadata[user_email]', user_email);
    if (company_name) params.append('metadata[company_name]', company_name);
    params.append('allow_promotion_codes', 'true');
    params.append('billing_address_collection', 'auto');
    params.append('tax_id_collection[enabled]', 'true');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if(!stripeRes.ok) throw new Error(session.error?.message || 'Stripe error');

    return res.status(200).json({ url: session.url });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
