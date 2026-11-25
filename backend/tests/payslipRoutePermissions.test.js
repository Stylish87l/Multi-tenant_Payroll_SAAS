import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  payrollItem: {
    findFirst: jest.fn(),
  },
};

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
  writeAuditSafe: jest.fn().mockResolvedValue(undefined),
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
        payrollRun: { companyId: 'tenant-a', status: 'FINALIZED' },
      },
    }));
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
