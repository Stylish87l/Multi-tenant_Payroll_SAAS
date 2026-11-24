import logger from '../config/logger.js';

/**
 * Optional OpenAI-compatible explanation adapter.
 * Only anonymised, rule-generated findings are sent to the provider. Payroll
 * amounts, employee names, employee IDs, bank data, Ghana Card and SSNIT data
 * are deliberately excluded. Missing/failed AI configuration never blocks a review.
 */
export const explainPayrollFindings = async (findings) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return { provider: 'rules-only', model: null, summary: null, explanations: [] };

  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const safeFindings = findings.map(({ code, category, severity, title, description, recommendation }) => ({
    code, category, severity, title, description, recommendation,
  }));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 10000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a payroll review assistant. Explain only the supplied deterministic findings. Never calculate or change payroll, infer wrongdoing, approve payments, or invent facts. Return JSON with summary (string) and explanations (array of objects with code and explanation). Use cautious language and recommend human verification.',
          },
          { role: 'user', content: JSON.stringify({ findings: safeFindings }) },
        ],
      }),
    });
    if (!response.ok) {
      logger.warn('Payroll AI provider returned non-success status', { status: response.status });
      return { provider: 'rules-only', model: null, summary: null, explanations: [] };
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { provider: 'rules-only', model: null, summary: null, explanations: [] };
    const parsed = JSON.parse(content);
    const explanations = Array.isArray(parsed.explanations)
      ? parsed.explanations.filter((item) => typeof item?.code === 'string' && typeof item?.explanation === 'string')
      : [];
    return {
      provider: process.env.AI_PROVIDER_NAME || 'openai-compatible',
      model,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 3000) : null,
      explanations,
    };
  } catch (error) {
    logger.warn('Payroll AI explanation unavailable; continuing with deterministic findings', { message: error.message });
    return { provider: 'rules-only', model: null, summary: null, explanations: [] };
  }
};
