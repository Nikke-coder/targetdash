export const config = { runtime: 'nodejs' };

/**
 * /api/create-checkout
 *
 * Creates a Stripe Checkout Session for targetdash subscription packages.
 *
 * Security posture:
 *  - `price_id` is whitelisted server-side. Arbitrary prices from the client are rejected.
 *  - `user_id` / `user_email` / `company_name` are accepted as metadata only — they do NOT
 *    grant plan access directly. Plan activation happens in /api/stripe-webhook after a
 *    real payment, keyed on the verified Stripe customer and the verified Stripe signature.
 *  - Localhost origin allowed only outside production.
 *  - Errors are scrubbed (no raw Stripe message leakage).
 *
 * NOTE: This endpoint intentionally does not verify the caller's Supabase session here —
 * that's acceptable because plan entitlement is only granted after Stripe confirms payment
 * (webhook), keyed on server-trusted data. The worst a casual abuser can do is create
 * checkout sessions they'd have to pay for.
 */

const PROD_ORIGINS = [
  'https://app.targetdash.ai',
  'https://admin.targetdash.ai',
  'https://www.targetdash.ai',
  'https://targetdash.ai',
];
const ALLOWED_ORIGINS = process.env.VERCEL_ENV === 'production'
  ? PROD_ORIGINS
  : [...PROD_ORIGINS, 'http://localhost:5173', 'http://localhost:3000'];

// Stripe price IDs permitted on this endpoint. Keep in sync with Stripe dashboard.
// Env override available for staging/test.
const ALLOWED_PRICE_IDS = (process.env.ALLOWED_PRICE_IDS || [
  'price_1TBrBQ36nlMWZMRYgi6eSlZ3', // default / Insight (adjust as needed)
  // Add Spark / Oracle IDs here:
  // 'price_xxx_spark',
  // 'price_xxx_oracle',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

const DEFAULT_PRICE = ALLOWED_PRICE_IDS[0];

const _rateMap = new Map();
function _rateLimit(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const e = _rateMap.get(key) || { count: 0, reset: now + windowMs };
  if (now > e.reset) { e.count = 0; e.reset = now + windowMs; }
  e.count++;
  _rateMap.set(key, e);
  return e.count > max;
}

// Minimal input sanitizers — Stripe accepts string metadata up to 500 chars
function clean(v, maxLen = 200) {
  if (typeof v !== 'string') return '';
  return v.slice(0, maxLen).replace(/[\r\n\t]/g, ' ').trim();
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 255;
}
function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  if (_rateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET) return res.status(500).json({ error: 'Checkout not configured' });

  const SUCCESS_URL = 'https://app.targetdash.ai?payment=success';
  const CANCEL_URL  = 'https://app.targetdash.ai?payment=cancelled';

  let body = {};
  try { body = typeof req.body === 'object' ? (req.body || {}) : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const priceId = clean(body.price_id, 60) || DEFAULT_PRICE;
  if (!ALLOWED_PRICE_IDS.includes(priceId)) {
    return res.status(400).json({ error: 'Invalid price' });
  }

  const user_id      = clean(body.user_id, 64);
  const user_email   = clean(body.user_email, 255);
  const company_name = clean(body.company_name, 200);

  // Soft-validate but don't hard-fail (webhook is the source of truth)
  if (user_id && !isUuid(user_id)) return res.status(400).json({ error: 'Invalid user_id' });
  if (user_email && !isEmail(user_email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', SUCCESS_URL);
    params.append('cancel_url', CANCEL_URL);
    if (user_email)   params.append('customer_email', user_email);
    if (user_id)      params.append('metadata[user_id]', user_id);
    if (user_email)   params.append('metadata[user_email]', user_email);
    if (company_name) params.append('metadata[company_name]', company_name);
    params.append('allow_promotion_codes', 'true');
    params.append('billing_address_collection', 'auto');
    params.append('tax_id_collection[enabled]', 'true');

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe recommends Idempotency-Key to avoid duplicate sessions on retry
        'Idempotency-Key': `${user_id || user_email || ip}-${Date.now()}`,
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      // Log server-side but return a generic error to client
      console.error('[create-checkout] Stripe error:', session?.error?.message);
      return res.status(502).json({ error: 'Checkout unavailable' });
    }

    return res.status(200).json({ url: session.url });

  } catch (e) {
    console.error('[create-checkout] Unexpected:', e?.message);
    return res.status(500).json({ error: 'Checkout failed' });
  }
}
