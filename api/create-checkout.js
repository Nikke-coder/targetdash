export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if(req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const PRICE_ID      = 'price_1TBrBQ36nlMWZMRYgi6eSlZ3';
  const SUCCESS_URL   = 'https://www.targetdash.ai/dashboard?payment=success';
  const CANCEL_URL    = 'https://www.targetdash.ai/onboarding?mode=subscribe';

  try {
    const { user_id, user_email, company_name } = req.body;

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', PRICE_ID);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', SUCCESS_URL);
    params.append('cancel_url', CANCEL_URL);
    params.append('customer_email', user_email);
    params.append('metadata[user_id]', user_id);
    params.append('metadata[user_email]', user_email);
    params.append('metadata[company_name]', company_name || '');
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
