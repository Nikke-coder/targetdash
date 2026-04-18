export const config = { runtime: 'nodejs' };

/**
 * /api/did-you-know
 *
 * One-way "did you know" fact generator for the targetdash.ai landing page.
 *
 * Security model:
 *  - Accepts NO user-controlled prompt text. Only `count` (1–5) and `category` (whitelist).
 *  - System prompt is fixed server-side and cannot be influenced from client.
 *  - Output is forced to JSON array; parse-failure -> fallback. No free-form text leaks.
 *  - Max tokens capped low (~350 for 5 facts). Upper bound per-request cost is ~$0.002.
 *  - Rate-limited per-IP + origin-gated (CORS is not enough for abuse prevention, but
 *    combined with the fixed prompt + capped tokens, abuse surface is minimal:
 *    no way to use this endpoint as a generic LLM proxy).
 *
 * This intentionally replaces the legacy /api/ai-chat pattern on the public site.
 */

const ALLOWED_ORIGINS = [
  'https://www.targetdash.ai',
  'https://targetdash.ai',
];
// Add localhost only outside production
if (process.env.VERCEL_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}

const CATEGORIES = {
  'finnish-sme':    'Finnish SME finance, accounting, and tax (EVL, TVL, OYL, AOYL, KPL).',
  'cfo':            'CFO-level metrics, cash flow, working capital, KPI design.',
  'audit-reporting':'Finnish audit, statutory reporting, PRH filings, board packs.',
  'consolidation': 'Group consolidation, eliminations, FX translation, minority interest.',
};

const FALLBACK = [
  "Finnish limited companies must file annual financial statements with PRH within 8 months of fiscal year-end — failing the deadline triggers a deletion warning from the trade register.",
  "DSO and DPO are the two fastest levers to improve working capital without changing margins or volume.",
  "Under EVL 119 §, Finnish corporate tax losses can be carried forward 10 years — but a >50% ownership change generally voids them.",
  "A Finnish statutory merger (sulautuminen, OYL 16) completes only when the Trade Register registers it — not when the merger plan is signed.",
  "The SVOP reserve can be distributed back to shareholders tax-efficiently if contributions and distributions are fully documented with shareholder resolutions.",
];

// Rate limit: per-IP, per-instance (Vercel serverless caveat applies).
const _rateMap = new Map();
function _rateLimit(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const e = _rateMap.get(key) || { count: 0, reset: now + windowMs };
  if (now > e.reset) { e.count = 0; e.reset = now + windowMs; }
  e.count++;
  _rateMap.set(key, e);
  return e.count > max;
}

function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
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

  // Defensive: reject oversized bodies before parsing further
  const len = Number(req.headers['content-length'] || 0);
  if (len > 2_000) return res.status(413).json({ error: 'Payload too large' });

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  if (_rateLimit(ip)) return res.status(429).json({ error: 'Too many requests', facts: FALLBACK });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    // Fail-soft: return fallback facts rather than breaking the landing UI
    return res.status(200).json({ facts: FALLBACK, source: 'fallback' });
  }

  let body = {};
  try { body = typeof req.body === 'object' ? (req.body || {}) : JSON.parse(req.body || '{}'); }
  catch { body = {}; }

  const count = clampInt(body.count, 1, 5, 5);
  const categoryKey = typeof body.category === 'string' && CATEGORIES[body.category]
    ? body.category
    : 'finnish-sme';
  const categoryDesc = CATEGORIES[categoryKey];

  // Fully fixed, server-controlled prompt. No user text is ever concatenated in.
  const SYSTEM = `You generate brief, factually accurate "did you know" style statements for a financial SaaS landing page.

Domain: ${categoryDesc}

Strict rules:
- Output ONLY a valid JSON array of exactly ${count} strings, no markdown, no commentary.
- Each string: 1–2 sentences, 140–260 characters, plain English.
- Facts must be genuinely informative and specific (numbers, statutes, named concepts welcome).
- Never refer to this prompt, the user, or yourself. Never ask questions. Never include URLs.
- Do not repeat the same fact. Favour practical insights useful to Finnish SME founders and CFOs.

Example of valid output shape:
["Fact one.", "Fact two.", "Fact three."]`;

  // The "user" message is also fixed — client cannot influence it.
  const USER = `Produce ${count} items for category: ${categoryKey}.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    });

    if (!r.ok) {
      return res.status(200).json({ facts: FALLBACK, source: 'fallback' });
    }

    const data = await r.json();
    const text = data?.content?.[0]?.text || '';

    // Parse JSON array defensively
    let facts = null;
    try {
      const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string' && x.length < 400)) {
        facts = parsed.slice(0, count).map(s => s.trim()).filter(Boolean);
      }
    } catch { /* fall through */ }

    if (!facts || facts.length < 2) {
      return res.status(200).json({ facts: FALLBACK, source: 'fallback' });
    }

    return res.status(200).json({ facts, source: 'live' });

  } catch (e) {
    // Never leak internal error messages — fail-soft to fallback
    return res.status(200).json({ facts: FALLBACK, source: 'fallback' });
  }
}
