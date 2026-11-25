import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const prisma = {
  employee: { count: jest.fn() },
  payrollRun: { findFirst: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  payrollItem: { aggregate: jest.fn(), groupBy: jest.fn() },
};
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../config/logger.js', () => ({ default: { warn: jest.fn() } }));

const { askPaylio, classifyAskPaylioQuestion } = await import('../services/askPaylioService.js');

describe('Ask Paylio read-only reporting tools', () => {
  beforeEach(() => {
    delete process.env.AI_API_KEY;
    prisma.employee.count.mockReset();
    prisma.payrollRun.findFirst.mockReset();
    prisma.payrollRun.findMany.mockReset();
    prisma.payrollRun.groupBy.mockReset();
    prisma.payrollItem.aggregate.mockReset();
    prisma.payrollItem.groupBy.mockReset();
  });
  afterEach(() => jest.clearAllMocks());

  it('maps natural language to a fixed allowlisted report intent', () => {
    expect(classifyAskPaylioQuestion('How many active employees do we have?')).toBe('HEADCOUNT');
    expect(classifyAskPaylioQuestion('Show payroll trends over time')).toBe('PAYROLL_TREND');
    expect(classifyAskPaylioQuestion('How many draft payroll runs?')).toBe('PAYROLL_STATUS');
    expect(classifyAskPaylioQuestion('What is our latest payroll cost?')).toBe('PAYROLL_SUMMARY');
    expect(classifyAskPaylioQuestion('Show me private employee details')).toBe('HEADCOUNT');
  });

  it('returns company-scoped headcount totals without reading employee records', async () => {
    prisma.employee.count.mockResolvedValueOnce(18).mockResolvedValueOnce(2);
    const result = await askPaylio({ companyId: 'tenant-a', role: 'HR', question: 'How many active employees?' });
    expect(result.data).toEqual({ activeEmployees: 18, inactiveEmployees: 2, totalEmployees: 20 });
    expect(result.answer).toContain('18 active employees');
    expect(prisma.employee.count).toHaveBeenNthCalledWith(1, {
      where: { companyId: 'tenant-a', isActive: true, deletedAt: null },
    });
    expect(prisma.employee.count).toHaveBeenNthCalledWith(2, {
      where: { companyId: 'tenant-a', isActive: false, deletedAt: null },
    });
  });

  it('does not expose financial reports to HR and does not query payroll data', async () => {
    const result = await askPaylio({ companyId: 'tenant-a', role: 'HR', question: 'Summarise payroll costs and PAYE' });
    expect(result).toEqual({ forbidden: true });
    expect(prisma.payrollRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.payrollItem.aggregate).not.toHaveBeenCalled();
  });

  it('returns only aggregate totals for the latest finalized payroll run', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({ id: 'run-1', month: '2026-10' });
    prisma.payrollItem.aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _sum: { grossSalary: 10000, netPay: 8000, payeTax: 900, ssnitEmployee: 550, ssnitEmployer: 1200 },
    });
    const result = await askPaylio({ companyId: 'tenant-a', role: 'ACCOUNTANT', question: 'Summarise the latest finalized payroll' });
    expect(result.data).toEqual({
      available: true, period: '2026-10', employeeCount: 5,
      grossPayrollGhs: '10000.00', netPayrollGhs: '8000.00', payeGhs: '900.00',
      employeeSsnitGhs: '550.00', employerSsnitGhs: '1200.00',
    });
    expect(prisma.payrollRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 'tenant-a', status: 'FINALIZED', deletedAt: null },
    }));
  });

  it('does not send the raw user question to the AI provider', async () => {
    process.env.AI_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: 'There are 3 active employees.' } }] }),
    });
    global.fetch = fetchMock;
    try {
      prisma.employee.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
      const rawQuestion = 'How many employees? My Ghana Card PIN is SECRET-123';
      await askPaylio({ companyId: 'tenant-a', role: 'HR', question: rawQuestion });
      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(JSON.stringify(sentBody)).not.toContain('SECRET-123');
      expect(JSON.stringify(sentBody)).not.toContain(rawQuestion);
      expect(JSON.stringify(sentBody)).toContain('activeEmployees');
    } finally {
      global.fetch = originalFetch;
      delete process.env.AI_API_KEY;
    }
  });

  it('does not call a model for unsupported questions', async () => {
    const result = await askPaylio({ companyId: 'tenant-a', role: 'ADMIN', question: 'Can you write a poem?' });
    expect(result.intent).toBeNull();
    expect(result.provider).toBe('rules-only');
    expect(prisma.employee.count).not.toHaveBeenCalled();
    expect(prisma.payrollRun.findFirst).not.toHaveBeenCalled();
  });
});
