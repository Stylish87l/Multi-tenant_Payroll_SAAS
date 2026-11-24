import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { explainPayrollFindings } from '../../services/aiReviewService.js';

const originalEnv = {
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_PROVIDER_NAME: process.env.AI_PROVIDER_NAME,
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

  it('sends only the minimal anonymised finding context to the provider', async () => {
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'test-model';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          summary: 'Review the flagged movement.',
          explanations: [{ code: 'GROSS_PAY_CHANGE', explanation: 'Check the approved salary record.' }],
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

    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('test-model');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const userMessage = body.messages.find((message) => message.role === 'user').content;
    expect(userMessage).not.toContain('private-employee-id');
    expect(userMessage).not.toContain('123456789012');
    expect(userMessage).not.toContain('10000');
    expect(userMessage).toContain('GROSS_PAY_CHANGE');
  });

  it('falls back safely when the provider fails', async () => {
    process.env.AI_API_KEY = 'test-key';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider timeout'));
    const result = await explainPayrollFindings([{ code: 'MISSING_BANK_DETAILS' }]);
    expect(result.provider).toBe('rules-only');
    expect(result.explanations).toEqual([]);
  });
});
