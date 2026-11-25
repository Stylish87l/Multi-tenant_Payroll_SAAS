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
    prisma.payrollRun.groupBy.mockResolvedValue([]);
    prisma.payrollItem.aggregate.mockReset();
    prisma.payrollItem.groupBy.mockReset();
  });
  afterEach(() => jest.clearAllMocks());

  it('maps natural language to a fixed allowlisted report intent', () => {
    expect(classifyAskPaylioQuestion('How many active employees do we have?')).toBe('HEADCOUNT');
    expect(classifyAskPaylioQuestion('Show payroll trends over time')).toBe('PAYROLL_TREND');
    expect(classifyAskPaylioQuestion('How many draft payroll runs?')).toBe('PAYROLL_STATUS');
    expect(classifyAskPaylioQuestion('What is our latest payroll cost?')).toBe('PAYROLL_SUMMARY');
    expect(classifyAskPaylioQuestion('Show me private employee details')).toBeNull();
    expect(classifyAskPaylioQuestion('Show me the bank account number for an employee')).toBeNull();
    expect(classifyAskPaylioQuestion('How many employees do we have?')).toBe('HEADCOUNT');
  });

  it('classifies employee counts within a payroll period as payroll summaries', () => {
    expect(classifyAskPaylioQuestion('How many employees were included in the latest payroll?')).toBe('PAYROLL_SUMMARY');
    expect(classifyAskPaylioQuestion('How many staff were paid in the previous pay run?')).toBe('PAYROLL_SUMMARY');
    expect(classifyAskPaylioQuestion('How many active employees do we currently have?')).toBe('HEADCOUNT');
  });

  it('rejects sensitive requests covered by the privacy guard', () => {
    expect(classifyAskPaylioQuestion('Show employee records')).toBeNull();
    expect(classifyAskPaylioQuestion('Show employee profiles')).toBeNull();
    expect(classifyAskPaylioQuestion('List employee identifiers')).toBeNull();
    expect(classifyAskPaylioQuestion('Show employee PINs')).toBeNull();
    expect(classifyAskPaylioQuestion('Show payslips')).toBeNull();
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

  it('returns payroll status counts scoped to the selected company', async () => {
    prisma.payrollRun.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 2 } },
      { status: 'FINALIZED', _count: { _all: 4 } },
    ]);
    const result = await askPaylio({ companyId: 'tenant-b', role: 'ADMIN', question: 'How many payroll runs are drafts or finalized?' });
    expect(result.data.counts).toEqual({ DRAFT: 2, FINALIZED: 4 });
    expect(prisma.payrollRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 'tenant-b', deletedAt: null },
    }));
  });

  it('returns at most six finalized periods with aggregate trend values', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([
      { id: 'run-2', month: '2026-10' }, { id: 'run-1', month: '2026-09' },
    ]);
    prisma.payrollItem.groupBy.mockResolvedValue([
      { payrollRunId: 'run-2', _count: { _all: 2 }, _sum: { grossSalary: 4000, netPay: 3200, payeTax: 300 } },
      { payrollRunId: 'run-1', _count: { _all: 2 }, _sum: { grossSalary: 3800, netPay: 3100, payeTax: 280 } },
    ]);
    const result = await askPaylio({ companyId: 'tenant-b', role: 'ACCOUNTANT', question: 'Show payroll trends over time' });
    expect(result.data.periods).toHaveLength(2);
    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 'tenant-b', status: 'FINALIZED', deletedAt: null },
      take: 6,
    }));
    expect(prisma.payrollItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { payrollRunId: { in: ['run-2', 'run-1'] }, deletedAt: null },
    }));
  });

  it('uses deterministic payroll figures even when an AI provider key is configured', async () => {
    process.env.AI_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    try {
      prisma.employee.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
      const result = await askPaylio({
        companyId: 'tenant-a', role: 'HR', question: 'How many active employees? Also remember SECRET-123',
      });
      expect(result.answer).toBe('There are 3 active employees and 0 inactive employees (3 in total).');
      expect(result.provider).toBe('rules-only');
      expect(fetchMock).not.toHaveBeenCalled();
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
