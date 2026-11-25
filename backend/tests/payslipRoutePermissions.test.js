import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  payrollItem: {
    findFirst: jest.fn(),
  },
};
const writeAuditSafe = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = req.headers['x-test-user'] || 'employee-user';
    req.userRole = req.headers['x-test-role'] || 'EMPLOYEE';
    req.companyId = req.userRole === 'SUPER_ADMIN' ? null : (req.headers['x-test-company'] || 'tenant-a');
    next();
  },
}));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../utils/fetchLogo.js', () => ({
  getLogoBuffer: jest.fn().mockResolvedValue(null),
}));
jest.unstable_mockModule('../services/auditService.js', () => ({
  writeAuditSafe,
  actorFromReq: jest.fn().mockReturnValue({ userId: 'test-user' }),
}));

const { default: payslipRoutes } = await import('../routes/payslips.js');

const app = express();
app.use(express.json());
app.use('/payslips', payslipRoutes);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('individual payslip route authorization', () => {
  test('does not let HR inherit employee payslip access through hierarchical RBAC', async () => {
    const response = await request(app)
      .get('/payslips/item/item-1/pdf')
      .set('x-test-role', 'HR')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(403);
    expect(prisma.payrollItem.findFirst).not.toHaveBeenCalled();
  });

  test('scopes employee downloads to their own user and tenant finalized payroll item', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get('/payslips/item/item-1/pdf')
      .set('x-test-role', 'EMPLOYEE')
      .set('x-test-user', 'employee-user')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(404);
    expect(prisma.payrollItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'item-1',
        employee: { userId: 'employee-user' },
        deletedAt: null,
        payrollRun: { companyId: 'tenant-a', status: 'FINALIZED', deletedAt: null },
      },
    }));
  });

  test('does not let HR inherit employee-only payslip explanation access', async () => {
    const response = await request(app)
      .get('/payslips/item/item-1/explanation')
      .set('x-test-role', 'HR')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(403);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(prisma.payrollItem.findFirst).not.toHaveBeenCalled();
  });

  test('returns a no-store explanation using only the signed-in employee and finalized tenant scope', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue({
      id: 'item-1',
      grossSalary: 9700,
      basicSalarySnapshot: 8000,
      housingAllowanceSnapshot: 1000,
      transportAllowanceSnapshot: 500,
      otherAllowanceSnapshot: 200,
      taxableIncome: 8150,
      ssnitEmployee: 550,
      ssnitEmployer: 1300,
      ssnitTier1: 1350,
      ssnitTier2: 500,
      payeTax: 1200,
      netPay: 7950,
      paymentStatus: 'PAID',
      reliefInputsSnapshot: { childrenCount: 0 },
      employee: { companyId: 'tenant-a' },
      payrollRun: {
        id: 'run-1', month: '2026-10-01', companyId: 'tenant-a', status: 'FINALIZED',
        taxConfigSnapshot: { year: 2026, effectiveAt: '2026-10-01', PAYE: { bands: [] }, SSNIT: {} },
      },
    });

    const response = await request(app)
      .get('/payslips/item/item-1/explanation')
      .set('x-test-role', 'EMPLOYEE')
      .set('x-test-user', 'employee-user')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.explanation.netPayGhs).toBe('7950.00');
    expect(response.body.explanation.employerContributions[0].amountGhs).toBe('1300.00');
    expect(response.body.explanation.ssnitRemittances).toHaveLength(2);
    expect(prisma.payrollItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'item-1',
        employee: { userId: 'employee-user' },
        deletedAt: null,
        payrollRun: { companyId: 'tenant-a', status: 'FINALIZED', deletedAt: null },
      },
      select: expect.objectContaining({
        employee: { select: { companyId: true } },
        payrollRun: { select: expect.objectContaining({ taxConfigSnapshot: true }) },
      }),
    }));
    expect(JSON.stringify(response.body)).not.toContain('employee-user');
    expect(JSON.stringify(response.body)).not.toContain('companyId');
    expect(writeAuditSafe).toHaveBeenCalledWith(prisma, expect.objectContaining({
      action: 'PAYSLIP_EXPLAINED',
      companyId: 'tenant-a',
      resourceId: 'item-1',
      details: { payrollRunId: 'run-1', period: '2026-10' },
    }));
  });

  test('does not explain a payslip with inconsistent employee and payroll tenant relationships', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue({
      payrollRun: { id: 'run-1', companyId: 'tenant-a', status: 'FINALIZED' },
      employee: { companyId: 'tenant-b' },
    });
    const response = await request(app)
      .get('/payslips/item/item-1/explanation')
      .set('x-test-role', 'EMPLOYEE')
      .set('x-test-user', 'employee-user')
      .set('x-test-company', 'tenant-a');
    expect(response.status).toBe(404);
  });

  test('rejects inconsistent employee and payroll tenant relationships', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue({
      payrollRun: { id: 'run-1', companyId: 'tenant-a' },
      employee: { id: 'employee-2', companyId: 'tenant-b' },
    });

    const response = await request(app)
      .get('/payslips/item/item-1/pdf')
      .set('x-test-role', 'ADMIN')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(404);
  });
});
