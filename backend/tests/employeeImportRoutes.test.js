import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { encryptSensitiveValue } from '../services/employeePiiEncryption.js';

const prisma = {
  company: { findFirst: jest.fn() },
  employee: { findMany: jest.fn(), create: jest.fn() },
  user: { findFirst: jest.fn() },
  employeeImportPreview: {
    create: jest.fn(), deleteMany: jest.fn(), findFirst: jest.fn(),
    updateMany: jest.fn(), update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const tx = prisma;
const writeAudit = jest.fn().mockResolvedValue({});
const actorFromReq = jest.fn(() => ({ userId: 'admin-user', companyId: 'tenant-a' }));

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = req.headers['x-test-user'] || 'admin-user';
    req.userRole = req.headers['x-test-role'] || 'ADMIN';
    req.companyId = req.userRole === 'SUPER_ADMIN' ? null : (req.headers['x-test-company'] || 'tenant-a');
    next();
  },
}));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../services/auditService.js', () => ({ writeAudit, actorFromReq }));

const { default: employeeRoutes } = await import('../routes/employees.js');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/employees', employeeRoutes);

const csv = 'Name,Email,Position,Basic Salary\nAma Mensah,ama@example.test,Teacher,4500';
const fileBase64 = Buffer.from(csv).toString('base64');
const makePayload = () => ({
  rows: [{
    rowNumber: 2,
    data: {
      name: 'Ama Mensah', email: 'ama@example.test', position: 'Teacher',
      basicSalary: 4500, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0,
      isMarried: false, hasResponsibility: false, childrenCount: 0, age: 30,
      isDisabled: false, agedDependentsCount: 0, isActive: true,
    },
    errors: [],
  }],
  mapping: { name: 'Name', email: 'Email', position: 'Position', basicSalary: 'Basic Salary' },
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  prisma.company.findFirst.mockResolvedValue({ id: 'tenant-a' });
  prisma.employee.findMany.mockResolvedValue([]);
  prisma.employee.create.mockResolvedValue({ id: 'employee-1' });
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.employeeImportPreview.deleteMany.mockResolvedValue({ count: 0 });
  prisma.employeeImportPreview.create.mockResolvedValue({ id: 'preview-1', expiresAt: new Date('2026-11-25T04:00:00Z') });
  prisma.employeeImportPreview.findFirst.mockResolvedValue({
    id: 'preview-1', payloadEncrypted: encryptSensitiveValue(JSON.stringify(makePayload())), rowCount: 1,
  });
  prisma.employeeImportPreview.updateMany.mockResolvedValue({ count: 1 });
  prisma.employeeImportPreview.update.mockResolvedValue({ id: 'preview-1', status: 'IMPORTED' });
});

describe('employee import preview and commit routes', () => {
  test('stores preview rows encrypted and returns only masked sensitive-field indicators', async () => {
    const response = await request(app).post('/employees/import/preview').send({
      fileName: 'employees.csv', fileBase64,
    });

    expect(response.status).toBe(201);
    expect(response.body.summary).toEqual({ totalRows: 1, validRows: 1, invalidRows: 0 });
    expect(response.body.previewId).toBe('preview-1');
    const stored = prisma.employeeImportPreview.create.mock.calls[0][0].data;
    expect(stored.payloadEncrypted).toMatch(/^enc:v1:/);
    expect(stored.payloadEncrypted).not.toContain('Ama Mensah');
    expect(writeAudit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'EMPLOYEE_IMPORT_PREVIEWED',
      details: { rowCount: 1, validRows: 1, invalidRows: 0 },
    }));
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  test('requires explicit company selection for SUPER_ADMIN', async () => {
    const response = await request(app)
      .post('/employees/import/preview')
      .set('x-test-role', 'SUPER_ADMIN')
      .send({ fileName: 'employees.csv', fileBase64 });
    expect(response.status).toBe(400);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  test('does not allow HR to import compensation and identity records', async () => {
    const response = await request(app)
      .post('/employees/import/preview')
      .set('x-test-role', 'HR')
      .send({ fileName: 'employees.csv', fileBase64 });
    expect(response.status).toBe(403);
    expect(prisma.employeeImportPreview.create).not.toHaveBeenCalled();
  });

  test('commits only the signed-in admin preview in one transaction and audits counts only', async () => {
    const response = await request(app).post('/employees/import/commit').send({ previewId: 'preview-1' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ importedCount: 1, skippedInvalidCount: 0 });
    expect(prisma.employeeImportPreview.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'preview-1', companyId: 'tenant-a', userId: 'admin-user',
        status: 'PREVIEWED', expiresAt: expect.any(Object),
      },
    }));
    expect(prisma.employeeImportPreview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'preview-1', userId: 'admin-user', status: 'PREVIEWED' }),
      data: { status: 'IMPORTING' },
    }));
    expect(prisma.employee.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Ama Mensah', email: 'ama@example.test', companyId: 'tenant-a' }),
      select: { id: true },
    }));
    expect(prisma.employeeImportPreview.update).toHaveBeenCalledWith({
      where: { id: 'preview-1' }, data: { status: 'IMPORTED' },
    });
    expect(writeAudit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'EMPLOYEES_IMPORTED',
      details: { importedCount: 1, skippedInvalidCount: 0 },
    }));
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain('ama@example.test');
  });

  test('rejects a preview owned by another user or outside the selected tenant', async () => {
    prisma.employeeImportPreview.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .post('/employees/import/commit')
      .set('x-test-user', 'another-admin')
      .send({ previewId: 'preview-1' });
    expect(response.status).toBe(410);
    expect(prisma.employeeImportPreview.updateMany).not.toHaveBeenCalled();
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });
});
