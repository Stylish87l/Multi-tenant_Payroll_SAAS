import express from 'express';
import request from 'supertest';
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const payrollRunFindFirst = jest.fn();
const payrollItemFindMany = jest.fn();
const writeAuditSafe = jest.fn();

jest.unstable_mockModule('../config/db.js', () => ({
  default: {
    payrollRun: { findFirst: payrollRunFindFirst },
    payrollItem: { findMany: payrollItemFindMany },
  },
}));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (_req, _res, next) => next(),
}));
jest.unstable_mockModule('../middleware/rbac.js', () => ({
  default: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../services/auditService.js', () => ({
  writeAuditSafe,
  actorFromReq: jest.fn(() => ({ userId: 'user-1', companyId: 'tenant-1' })),
}));
jest.unstable_mockModule('../utils/csv.js', () => ({
  toCsv: jest.fn(() => 'serialNo,ssnitNumber\n'),
}));

const { default: reportsRouter } = await import('../routes/reports.js');

const app = express();
app.use((req, _res, next) => {
  req.userId = 'user-1';
  req.companyId = 'tenant-1';
  req.userRole = 'ADMIN';
  next();
});
app.use('/', reportsRouter);

describe('statutory payroll exports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['/gra-schedule/run-1', 'GRA'],
    ['/ssnit-schedule/run-1', 'SSNIT'],
  ])('blocks %s unless the payroll run is finalized (%s)', async (path) => {
    payrollRunFindFirst.mockResolvedValue({ id: 'run-1', status: 'DRAFT' });

    const response = await request(app).get(path);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/finalized payroll runs/i);
    expect(payrollItemFindMany).not.toHaveBeenCalled();
    expect(writeAuditSafe).not.toHaveBeenCalled();
  });

  test('scopes the finalized-run check to the authenticated tenant', async () => {
    payrollRunFindFirst.mockResolvedValue({ id: 'run-1', status: 'DRAFT' });

    await request(app).get('/gra-schedule/run-1');

    expect(payrollRunFindFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', companyId: 'tenant-1' },
      select: { id: true, status: true },
    });
  });
});
