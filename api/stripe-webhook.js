export const config = { runtime: 'nodejs', api: { bodyParser: false } };

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL           = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

async function verifyStripeSignature(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const sig = parts['v1'];
  const signedPayload = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expected = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === sig;
}

export default async function handler(req) {
  if(req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature');

  try {
    const valid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
    if(!valid) return new Response('Invalid signature', { status: 400 });
  } catch(e) {
    return new Response('Signature error', { status: 400 });
  }

  const event = JSON.parse(payload);

  // Handle successful payment
  if(event.type === 'checkout.session.completed') {
    const session     = event.data.object;
    const user_id     = session.metadata?.user_id;
    const user_email  = session.metadata?.user_email;
    const customer_id = session.customer;
    const sub_id      = session.subscription;

    if(!user_id && !user_email) {
      return new Response('No user info', { status: 400 });
    }

    // Update user_profiles in Supabase
    const query = user_id
      ? `user_id=eq.${user_id}`
      : `email=eq.${encodeURIComponent(user_email)}`;

    await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?${query}`, {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        plan:              'mainuser',
        stripe_customer_id: customer_id,
        stripe_sub_id:      sub_id,
        plan_activated_at:  new Date().toISOString(),
        onboarded:          true,
      }),
    });
  }

  // Handle subscription cancelled
  if(event.type === 'customer.subscription.deleted') {
    const sub        = event.data.object;
    const customer_id = sub.customer;

    await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?stripe_customer_id=eq.${customer_id}`, {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ plan: 'cancelled' }),
    });
  }

  return new Response('OK', { status: 200 });
}
