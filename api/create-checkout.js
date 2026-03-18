export const config = { runtime: 'edge' };

const STRIPE_SECRET    = process.env.STRIPE_SECRET_KEY;
const PRICE_ID         = 'price_1TBrBQ36nlMWZMRYgi6eSlZ3';
const SUCCESS_URL      = 'https://www.targetdash.ai/dashboard?payment=success';
const CANCEL_URL       = 'https://www.targetdash.ai/onboarding?mode=subscribe';

export default async function handler(req) {
  if(req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { user_id, user_email, company_name } = await req.json();

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

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await res.json();
    if(!res.ok) throw new Error(session.error?.message || 'Stripe error');

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
