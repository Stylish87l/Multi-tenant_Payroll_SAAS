import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = { payrollItem: { findFirst: jest.fn() } };

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = req.headers['x-test-user'] || 'employee-user';
    req.userRole = req.headers['x-test-role'] || 'EMPLOYEE';
    req.companyId = req.userRole === 'SUPER_ADMIN' ? null : (req.headers['x-test-company'] || 'tenant-a');
    next();
  },
}));
jest.unstable_mockModule('../middleware/rbac.js', () => ({
  default: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../utils/csv.js', () => ({ toCsv: jest.fn() }));
jest.unstable_mockModule('../services/auditService.js', () => ({
  writeAuditSafe: jest.fn().mockResolvedValue(undefined),
  actorFromReq: jest.fn().mockReturnValue({ userId: 'test-user' }),
}));

const { default: reportRoutes } = await import('../routes/reports.js');
const app = express();
app.use('/reports', reportRoutes);

beforeEach(() => jest.clearAllMocks());

describe('individual payslip report authorization', () => {
  test('blocks HR even though hierarchical RBAC would otherwise inherit EMPLOYEE', async () => {
    const response = await request(app)
      .get('/reports/payslip/item-1')
      .set('x-test-role', 'HR')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(403);
    expect(prisma.payrollItem.findFirst).not.toHaveBeenCalled();
  });

  test('limits employee payslip data to their own finalized item in their tenant', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get('/reports/payslip/item-1')
      .set('x-test-role', 'EMPLOYEE')
      .set('x-test-user', 'employee-1')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(404);
    expect(prisma.payrollItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'item-1',
        payrollRun: { companyId: 'tenant-a', status: 'FINALIZED' },
        employee: { userId: 'employee-1' },
      },
    }));
  });

  test('keeps administrators tenant-scoped', async () => {
    prisma.payrollItem.findFirst.mockResolvedValue(null);

    await request(app)
      .get('/reports/payslip/item-1')
      .set('x-test-role', 'ADMIN')
      .set('x-test-company', 'tenant-a');

    expect(prisma.payrollItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1', payrollRun: { companyId: 'tenant-a' } },
    }));
  });
});
