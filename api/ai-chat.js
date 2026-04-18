export const config = { runtime: 'nodejs' };

/**
 * /api/ai-chat  — DEPRECATED compatibility shim.
 *
 * This endpoint used to proxy to Anthropic with client-supplied messages.
 * That was a credit-drain / jailbreak vector on a public unauthenticated surface.
 *
 * It has been replaced with /api/did-you-know (strict, server-controlled prompt).
 * This shim now returns static fallback facts so any lingering old caller keeps
 * working without cost or risk. Migrate callers to /api/did-you-know when convenient.
 */

const FALLBACK = [
  "Finnish limited companies must file annual financial statements with PRH within 8 months of fiscal year-end — failing the deadline triggers a deletion warning from the trade register.",
  "DSO and DPO are the two fastest levers to improve working capital without changing margins or volume.",
  "Under EVL 119 §, Finnish corporate tax losses can be carried forward 10 years — but a >50% ownership change generally voids them.",
  "A Finnish statutory merger (sulautuminen, OYL 16) completes only when the Trade Register registers it — not when the merger plan is signed.",
  "The SVOP reserve can be distributed back to shareholders tax-efficiently if contributions and distributions are fully documented with shareholder resolutions.",
];

const ALLOWED_ORIGINS = [
  'https://www.targetdash.ai',
  'https://targetdash.ai',
  'https://admin.targetdash.ai',
];
if (process.env.VERCEL_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Deprecated', 'Use /api/did-you-know');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Old clients expected `{ text: "..." }`. New clients expect `{ facts: [...] }`.
  // Return both shapes for maximum compat.
  return res.status(200).json({
    text:   FALLBACK[Math.floor(Math.random() * FALLBACK.length)],
    facts:  FALLBACK,
    notice: 'This endpoint is deprecated. Use /api/did-you-know.',
  });
}
