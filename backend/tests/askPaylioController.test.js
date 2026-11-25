import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const prisma = {};
const askPaylio = jest.fn();
const writeAuditSafe = jest.fn();
const actorFromReq = jest.fn(() => ({ userId: 'user-1' }));
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../services/askPaylioService.js', () => ({ askPaylio }));
jest.unstable_mockModule('../services/auditService.js', () => ({ writeAuditSafe, actorFromReq }));

const { askPaylioQuestion } = await import('../controllers/askPaylioController.js');

const makeResponse = () => ({
  headers: {},
  statusCode: 200,
  set(name, value) { this.headers[name] = value; return this; },
  status(value) { this.statusCode = value; return this; },
  json(value) { this.body = value; return this; },
});
const next = jest.fn();

describe('Ask Paylio controller', () => {
  beforeEach(() => {
    askPaylio.mockReset();
    writeAuditSafe.mockReset();
    actorFromReq.mockClear();
    next.mockReset();
  });
  afterEach(() => jest.clearAllMocks());

  it('rejects empty and oversized questions', async () => {
    const req = { body: { question: ' ' } };
    const res = makeResponse();
    await askPaylioQuestion(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(askPaylio).not.toHaveBeenCalled();

    const oversized = makeResponse();
    await askPaylioQuestion({ body: { question: 'x'.repeat(501) } }, oversized, next);
    expect(oversized.statusCode).toBe(400);
  });

  it('uses the middleware-resolved company and audits only the intent, never the question', async () => {
    askPaylio.mockResolvedValue({ intent: 'HEADCOUNT', answer: '2 active employees.', data: { activeEmployees: 2 }, provider: 'rules-only' });
    const res = makeResponse();
    await askPaylioQuestion({
      body: { question: 'How many active employees? personal data must not be logged' },
      reviewCompanyId: 'company-verified',
      userRole: 'HR',
      userId: 'user-1',
    }, res, next);

    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.answer).toBe('2 active employees.');
    expect(askPaylio).toHaveBeenCalledWith({
      companyId: 'company-verified', role: 'HR',
      question: 'How many active employees? personal data must not be logged',
    });
    expect(writeAuditSafe).toHaveBeenCalledWith(prisma, expect.objectContaining({
      companyId: 'company-verified',
      action: 'ASK_PAYLIO_QUERY',
      details: { intent: 'HEADCOUNT', provider: 'rules-only' },
    }));
    expect(JSON.stringify(writeAuditSafe.mock.calls[0])).not.toContain('personal data');
  });

  it('returns a forbidden response when the selected report exceeds role permissions', async () => {
    askPaylio.mockResolvedValue({ forbidden: true });
    const res = makeResponse();
    await askPaylioQuestion({
      body: { question: 'What is payroll cost?' }, reviewCompanyId: 'company-verified', userRole: 'HR',
    }, res, next);
    expect(res.statusCode).toBe(403);
    expect(writeAuditSafe).not.toHaveBeenCalled();
  });

  it('passes unexpected errors to the shared error handler', async () => {
    askPaylio.mockRejectedValue(new Error('database unavailable'));
    await askPaylioQuestion({
      body: { question: 'How many employees?' }, reviewCompanyId: 'company-verified', userRole: 'HR',
    }, makeResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'database unavailable' }));
  });
});
