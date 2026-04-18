export const config = { runtime: 'nodejs', api: { bodyParser: false } };

import crypto from 'crypto';

/**
 * /api/stripe-webhook
 *
 * Hardening applied:
 *  1. HMAC-SHA256 signature verified with crypto.timingSafeEqual.
 *  2. Timestamp tolerance (default 5 min) — rejects replayed payloads.
 *  3. Idempotency — event.id deduplicated via Supabase table `stripe_events`
 *     (fail-open if table is missing to avoid blocking prod; warn in logs).
 *  4. Errors in Supabase PATCH now bubble as 500 so Stripe retries.
 *  5. Service key logged nowhere.
 *
 * Required env:
 *   STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL (defaulted)
 *   SUPABASE_SERVICE_KEY
 */

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL          = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const TIMESTAMP_TOLERANCE   = 300; // seconds — 5 min (Stripe's recommended default)

async function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return { ok: false, reason: 'missing-sig-or-secret' };

  const parts = signature.split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const sig       = parts['v1'];
  if (!timestamp || !sig) return { ok: false, reason: 'malformed-sig' };

  // Timestamp replay protection
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad-timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE) {
    return { ok: false, reason: 'timestamp-out-of-tolerance' };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'length-mismatch' };
    return { ok: crypto.timingSafeEqual(a, b), reason: 'ok' };
  } catch {
    return { ok: false, reason: 'compare-failed' };
  }
}

/**
 * Record the event.id; returns true if newly inserted, false if already seen.
 * Expects a table:
 *   create table stripe_events (
 *     id text primary key,
 *     type text,
 *     received_at timestamptz default now()
 *   );
 * If the table doesn't exist yet, we log and proceed (fail-open on dedup, not on signature).
 */
async function markProcessed(eventId, eventType) {
  if (!SUPABASE_SERVICE_KEY) return { inserted: true, skipped: 'no-key' };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/stripe_events`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({ id: eventId, type: eventType }),
    });
    // 201 = inserted, 200 w/ ignore-duplicates may also return 201 or empty 200
    // 409 = duplicate (already processed)
    if (r.status === 409) return { inserted: false };
    if (!r.ok && r.status !== 201 && r.status !== 200) {
      // Fail-open (avoid breaking prod if table missing) but log loudly
      console.warn('[stripe-webhook] stripe_events write failed', r.status);
      return { inserted: true, skipped: 'write-failed' };
    }
    return { inserted: true };
  } catch (e) {
    console.warn('[stripe-webhook] dedup error', e?.message);
    return { inserted: true, skipped: 'exception' };
  }
}

async function supabasePatch(path, bodyObj) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${path} -> ${r.status} ${txt.slice(0, 200)}`);
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature');

  let verdict;
  try {
    verdict = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response('Signature error', { status: 400 });
  }
  if (!verdict.ok) {
    // Log the reason server-side but don't leak it
    console.warn('[stripe-webhook] sig invalid:', verdict.reason);
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(payload); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  if (!event?.id || !event?.type) {
    return new Response('Malformed event', { status: 400 });
  }

  // Idempotency
  const dedup = await markProcessed(event.id, event.type);
  if (!dedup.inserted) {
    // Already handled — return 200 so Stripe stops retrying
    return new Response('Already processed', { status: 200 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session     = event.data.object;
      const user_id     = session.metadata?.user_id;
      const user_email  = session.metadata?.user_email;
      const customer_id = session.customer;
      const sub_id      = session.subscription;

      if (!user_id && !user_email) {
        // Can't resolve profile — acknowledge so Stripe doesn't retry forever,
        // but log for manual reconciliation
        console.error('[stripe-webhook] checkout.completed missing user_id/email', event.id);
        return new Response('OK (unresolved)', { status: 200 });
      }

      const query = user_id
        ? `user_id=eq.${encodeURIComponent(user_id)}`
        : `email=eq.${encodeURIComponent(user_email)}`;

      await supabasePatch(`user_profiles?${query}`, {
        plan:               'mainuser',
        stripe_customer_id: customer_id,
        stripe_sub_id:      sub_id,
        plan_activated_at:  new Date().toISOString(),
        onboarded:          true,
      });
    }

    else if (event.type === 'customer.subscription.deleted') {
      const sub         = event.data.object;
      const customer_id = sub.customer;
      if (!customer_id) {
        return new Response('OK (no customer)', { status: 200 });
      }
      await supabasePatch(
        `user_profiles?stripe_customer_id=eq.${encodeURIComponent(customer_id)}`,
        { plan: 'cancelled' }
      );
    }

    // Other event types: accept silently
    return new Response('OK', { status: 200 });

  } catch (e) {
    // Return 500 so Stripe retries the webhook
    console.error('[stripe-webhook] handler failed:', e?.message);
    return new Response('Server error', { status: 500 });
  }
}
