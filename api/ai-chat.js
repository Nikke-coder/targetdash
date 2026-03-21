export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
