// Small Gemini wrapper for the parlour FAQ answers.
// Returns the reply text, or null (then the bot falls back to its keyword answers).
async function llm({ system, user }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
      }),
    });

    if (!res.ok) {
      console.error('[salon/llm] failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }

    const json = await res.json();
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();

    // Gemini writes **bold**, WhatsApp uses *bold*
    return text ? text.replace(/\*\*/g, '*') : null;
  } catch (e) {
    console.error('[salon/llm] error', e.message);
    return null;
  }
}

module.exports = llm;
