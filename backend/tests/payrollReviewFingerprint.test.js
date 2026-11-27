import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';

const prisma = {
  payrollRun: { findFirst: jest.fn() },
  employee: { findMany: jest.fn() },
};
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../services/aiReviewService.js', () => ({
  explainPayrollFindings: jest.fn(),
}));
const { getPayrollReviewInputFingerprint } = await import('../services/payrollAnomalyService.js');

const makeRun = () => ({
  id: 'run-1',
  companyId: 'tenant-1',
  month: '2026-11-01',
  runType: 'REGULAR',
  taxConfigSnapshot: { PAYE: { year: 2026 }, SSNIT: { year: 2026 } },
  items: [{
    id: 'item-1',
    employeeId: 'employee-1',
    deletedAt: null,
    updatedAt: new Date('2026-11-24T10:00:00.000Z'),
    grossSalary: '5000.00',
    basicSalarySnapshot: '4500.00',
    housingAllowanceSnapshot: '300.00',
    transportAllowanceSnapshot: '200.00',
    otherAllowanceSnapshot: '0.00',
    taxableIncome: '4800.00',
    ssnitEmployee: '275.00',
    ssnitEmployer: '600.00',
    ssnitTier1: '450.00',
    ssnitTier2: '150.00',
    payeTax: '600.00',
    netPay: '4125.00',
    reliefInputsSnapshot: { age: 30 },
    employee: {
      id: 'employee-1', isActive: true, deletedAt: null,
      updatedAt: new Date('2026-11-24T10:00:00.000Z'),
      bankName: 'Example Bank', bankCode: '001', bankAccount: '123456789012',
    },
  }],
});
const makePreviousRun = () => ({
  id: 'prior-run-1',
  month: '2026-10-01',
  runType: 'REGULAR',
  items: [{
    employeeId: 'employee-1',
    grossSalary: '4800.00',
    netPay: '3900.00',
    payeTax: '550.00',
    ssnitEmployee: '260.00',
  }],
});

const makeActiveEmployees = () => [{
  id: 'employee-1', isActive: true, deletedAt: null,
  updatedAt: new Date('2026-11-24T10:00:00.000Z'),
}];

describe('payroll review input fingerprint', () => {
  const originalFingerprintSecret = process.env.PAYROLL_REVIEW_FINGERPRINT_SECRET;
  const originalCsrfSecret = process.env.CSRF_SECRET;

  beforeEach(() => {
    process.env.PAYROLL_REVIEW_FINGERPRINT_SECRET = 'test-payroll-review-fingerprint-secret-32-bytes';
    delete process.env.CSRF_SECRET;
    prisma.payrollRun.findFirst.mockImplementation(async ({ where }) => (
      where?.status === 'FINALIZED' ? makePreviousRun() : makeRun()
    ));
    prisma.employee.findMany.mockResolvedValue(makeActiveEmployees());
  });

  afterEach(() => {
    if (originalFingerprintSecret === undefined) delete process.env.PAYROLL_REVIEW_FINGERPRINT_SECRET;
    else process.env.PAYROLL_REVIEW_FINGERPRINT_SECRET = originalFingerprintSecret;
    if (originalCsrfSecret === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = originalCsrfSecret;
    jest.clearAllMocks();
  });

  it('returns a stable keyed digest without exposing bank details', async () => {
    const first = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    const second = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('123456789012');
  });

  it('changes when a payroll item amount changes', async () => {
    const first = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    prisma.payrollRun.findFirst.mockResolvedValue({
      ...makeRun(),
      items: [{ ...makeRun().items[0], netPay: '4000.00' }],
    });
    const changed = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(changed).not.toBe(first);
  });

  it('changes when the previous finalized payroll comparison basis changes', async () => {
    const first = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    prisma.payrollRun.findFirst.mockImplementation(async ({ where }) => (
      where?.status === 'FINALIZED'
        ? { ...makePreviousRun(), items: [{ ...makePreviousRun().items[0], netPay: '3700.00' }] }
        : makeRun()
    ));
    const changed = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(changed).not.toBe(first);
  });

  it('changes when a previous finalized payroll becomes available', async () => {
    const first = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    prisma.payrollRun.findFirst.mockImplementation(async ({ where }) => (
      where?.status === 'FINALIZED' ? null : makeRun()
    ));
    const changed = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(changed).not.toBe(first);
  });

  it('changes when employee roster or bank instructions change', async () => {
    const first = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    prisma.employee.findMany.mockResolvedValue([
      ...makeActiveEmployees(),
      { id: 'employee-2', isActive: true, deletedAt: null, updatedAt: new Date('2026-11-25T00:00:00.000Z') },
    ]);
    const rosterChanged = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(rosterChanged).not.toBe(first);

    prisma.employee.findMany.mockResolvedValue(makeActiveEmployees());
    prisma.payrollRun.findFirst.mockResolvedValue({
      ...makeRun(),
      items: [{ ...makeRun().items[0], employee: { ...makeRun().items[0].employee, bankAccount: '999999999999' } }],
    });
    const bankChanged = await getPayrollReviewInputFingerprint({ companyId: 'tenant-1', payrollRunId: 'run-1' });
    expect(bankChanged).not.toBe(first);
  });
});
