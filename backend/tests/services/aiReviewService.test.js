import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { explainPayrollFindings } from '../../services/aiReviewService.js';

const originalEnv = {
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_PROVIDER_NAME: process.env.AI_PROVIDER_NAME,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.restoreAllMocks();
});

describe('explainPayrollFindings', () => {
  it('uses deterministic rules-only mode when no provider key is configured', async () => {
    delete process.env.AI_API_KEY;
    const result = await explainPayrollFindings([{ code: 'MISSING_BANK_DETAILS' }]);
    expect(result).toEqual({ provider: 'rules-only', model: null, summary: null, explanations: [] });
  });

  it('uses Gemini defaults and sends only minimal anonymised finding context', async () => {
    process.env.AI_API_KEY = 'test-key';
    delete process.env.AI_BASE_URL;
    delete process.env.AI_PROVIDER_NAME;
    delete process.env.AI_MODEL;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          summary: 'Review the flagged movement.',
          explanations: [
            { code: 'GROSS_PAY_CHANGE', explanation: 'Check the approved salary record.' },
            { code: 'UNTRUSTED_CODE', explanation: 'This must be ignored.' },
          ],
        }) } }],
      }),
    });

    const result = await explainPayrollFindings([{
      code: 'GROSS_PAY_CHANGE',
      category: 'PAY_VARIANCE',
      severity: 'HIGH',
      title: 'Unusual gross pay movement',
      description: 'Gross pay changed by 25%.',
      recommendation: 'Check approved salary changes.',
      employeeId: 'private-employee-id',
      evidence: { bankAccount: '123456789012', salary: 10000 },
    }]);

    expect(result.provider).toBe('Gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.explanations).toEqual([
      { code: 'GROSS_PAY_CHANGE', explanation: 'Check the approved salary record.' },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe('gemini-2.5-flash');
    const userMessage = body.messages.find((message) => message.role === 'user').content;
    expect(userMessage).not.toContain('private-employee-id');
    expect(userMessage).not.toContain('123456789012');
    expect(userMessage).not.toContain('10000');
    expect(userMessage).toContain('GROSS_PAY_CHANGE');
  });

  it('supports overriding Gemini with another OpenAI-compatible provider', async () => {
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://example.test/v1/';
    process.env.AI_MODEL = 'custom-model';
    process.env.AI_PROVIDER_NAME = 'Custom';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"summary":"OK","explanations":[]}' } }] }),
    });

    const result = await explainPayrollFindings([]);
    expect(result).toMatchObject({ provider: 'Custom', model: 'custom-model', summary: 'OK' });
  });

  it('falls back safely when the provider fails', async () => {
    process.env.AI_API_KEY = 'test-key';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider timeout'));
    const result = await explainPayrollFindings([{ code: 'MISSING_BANK_DETAILS' }]);
    expect(result.provider).toBe('rules-only');
    expect(result.explanations).toEqual([]);
  });
});
