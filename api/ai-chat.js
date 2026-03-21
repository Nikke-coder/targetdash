export const config = { runtime: 'nodejs' };

const SUPABASE_URL         = process.env.SUPABASE_URL || 'https://nghlvfngpfrhhigkoeem.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Rate limiter — max 30 requests per user per minute ───────────────
const RATE_LIMIT  = 30;
const RATE_WINDOW = 60;

async function checkRateLimit(userEmail) {
  if(!SUPABASE_SERVICE_KEY || !userEmail) return true;
  const windowStart = new Date(Date.now() - RATE_WINDOW * 1000).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_transactions?user_email=eq.${encodeURIComponent(userEmail)}&created_at=gte.${windowStart}&select=id`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const data = await res.json();
    return !data || data.length < RATE_LIMIT;
  } catch(e) { return true; }
}

// ── Suspicious prompt detection ──────────────────────────────────────
const ALERT_PATTERNS = [
  // Prompt injection / jailbreak attempts
  { pattern: /ignore.*(?:instructions|rules|prompt|above|previous)/i, category: 'prompt_injection', severity: 'high' },
  { pattern: /(?:forget|disregard|override).*(?:system|rules|instructions)/i, category: 'prompt_injection', severity: 'high' },
  { pattern: /act as|pretend.*(?:you are|to be)|role.?play|you are now/i, category: 'prompt_injection', severity: 'high' },
  { pattern: /(?:reveal|show|print|output|display).*(?:system prompt|instructions|rules|configuration)/i, category: 'prompt_extraction', severity: 'high' },
  { pattern: /what are your (?:instructions|rules|guidelines|system)/i, category: 'prompt_extraction', severity: 'medium' },
  { pattern: /DAN|do anything now|jailbreak/i, category: 'prompt_injection', severity: 'high' },

  // Code / SQL injection attempts
  { pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s+(?:FROM|INTO|TABLE|\*)/i, category: 'code_injection', severity: 'high' },
  { pattern: /(?:write|generate|create|give).*(?:script|code|SQL|query|API call|python|javascript)/i, category: 'code_request', severity: 'medium' },
  { pattern: /curl\s|fetch\(|import\s|require\(/i, category: 'code_injection', severity: 'medium' },

  // Personal data extraction
  { pattern: /(?:social security|henkilötunnus|personnummer|hetu)\s*(?:number|#)?/i, category: 'personal_data', severity: 'high' },
  { pattern: /(?:give|show|list|tell).*(?:names|salaries|addresses|phone|email|IBAN|bank account)/i, category: 'personal_data', severity: 'high' },
  { pattern: /(?:who|which).*(?:employee|person|individual).*(?:earn|salary|paid|make)/i, category: 'personal_data', severity: 'medium' },

  // Cross-client data fishing
  { pattern: /(?:other|another|different).*(?:client|company|customer|dashboard|business)/i, category: 'cross_client', severity: 'high' },
  { pattern: /(?:all|every|list).*(?:clients|companies|customers|dashboards)/i, category: 'cross_client', severity: 'high' },

  // Data export attempts
  { pattern: /(?:export|download|dump|extract).*(?:all|entire|complete|full).*(?:data|database|records)/i, category: 'data_export', severity: 'medium' },

  // Abusive or inappropriate language
  { pattern: /\b(?:fuck|shit|damn|ass|bitch|bastard|idiot|stupid|perkele|vittu|helvetti|jävla|fan)\b/i, category: 'abusive_language', severity: 'medium' },
  { pattern: /(?:kill|destroy|hack|attack|bomb|threat)/i, category: 'inappropriate_content', severity: 'high' },
];

function detectSuspiciousPrompt(text) {
  const alerts = [];
  for(const rule of ALERT_PATTERNS) {
    if(rule.pattern.test(text)) {
      alerts.push({ category: rule.category, severity: rule.severity, matched: rule.pattern.toString() });
    }
  }
  return alerts;
}

async function logAlert(userEmail, client, prompt, alerts) {
  if(!SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/prompt_alerts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_email: userEmail || 'unknown',
        client: client || 'unknown',
        prompt_text: prompt.slice(0, 1000), // cap stored length
        categories: alerts.map(a => a.category).join(', '),
        severity: alerts.some(a => a.severity === 'high') ? 'high' : 'medium',
        alert_count: alerts.length,
        created_at: new Date().toISOString(),
      }),
    });
  } catch(e) {
    console.error('Alert log failed:', e.message);
  }
}

// ── Main handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
  if(!MISTRAL_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    const { messages, system, user_email, client } = req.body;

    if(!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages required' });
    }

    // Rate limit
    if(user_email) {
      const allowed = await checkRateLimit(user_email);
      if(!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please wait a minute.' });
      }
    }

    // Check latest user message for suspicious patterns
    const latestUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if(latestUserMsg?.content) {
      const alerts = detectSuspiciousPrompt(latestUserMsg.content);
      if(alerts.length > 0) {
        // Log the alert asynchronously — don't block the response
        logAlert(user_email, client, latestUserMsg.content, alerts);

        // Block high-severity attempts entirely
        if(alerts.some(a => a.severity === 'high')) {
          return res.status(200).json({
            text: '⚠ This request has been flagged by our security system. EBITDA-9000 is designed to analyse financial data only and cannot assist with this type of request. This incident has been logged.',
            flagged: true,
          });
        }
        // Medium severity — let it through but it's logged
      }
    }

    // Cap conversation
    const trimmedMessages = messages.slice(-20);

    const mistralMessages = [
      { role: 'system', content: system || 'You are a helpful financial advisor.' },
      ...trimmedMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000),
      })),
    ];

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_KEY}`,
      },
      body: JSON.stringify({
        model: 'mistral-medium-latest',
        max_tokens: 600,
        temperature: 0.4,
        messages: mistralMessages,
      }),
    });

    const data = await response.json();
    if(!response.ok) throw new Error(data.message || data.detail || 'Mistral error');

    const text = data.choices?.[0]?.message?.content || 'No response generated.';
    return res.status(200).json({ text });

  } catch(e) {
    console.error('ai-chat error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
