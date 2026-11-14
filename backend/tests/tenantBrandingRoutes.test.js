import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  company: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = req.headers['x-test-user'] || 'test-user';
    req.userRole = req.headers['x-test-role'] || 'ADMIN';
    req.companyId = req.userRole === 'SUPER_ADMIN' ? null : (req.headers['x-test-company'] || 'tenant-a');
    next();
  },
}));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../services/auditService.js', () => ({
  writeAuditSafe: jest.fn().mockResolvedValue(undefined),
  actorFromReq: jest.fn().mockReturnValue({ userId: 'test-user' }),
}));

const { default: tenantBrandingRoutes } = await import('../routes/tenantBranding.js');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/companies', tenantBrandingRoutes);

const tenantBranding = {
  id: 'tenant-a',
  name: 'Tenant A Ltd',
  address: 'Accra, Ghana',
  contactEmail: 'payroll@tenant-a.test',
  contactPhone: '+233 20 000 0000',
  themeColor: '#123456',
  logoUrl: null,
  footerNote: 'Confidential',
  payslipTemplate: { tagline: 'People first', logoAlignment: 'left', showFooter: true },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tenant branding API authorization and persistence', () => {
  test('blocks an administrator from reading another tenant branding', async () => {
    const response = await request(app)
      .get('/companies/tenant-b/branding')
      .set('x-test-role', 'ADMIN')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(403);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  test('does not grant branding access to employees', async () => {
    const response = await request(app)
      .get('/companies/tenant-a/branding')
      .set('x-test-role', 'EMPLOYEE')
      .set('x-test-company', 'tenant-a');

    expect(response.status).toBe(403);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  test('allows Super Admin to read the selected tenant branding', async () => {
    prisma.company.findUnique.mockResolvedValue({ ...tenantBranding, id: 'tenant-b' });

    const response = await request(app)
      .get('/companies/tenant-b/branding')
      .set('x-test-role', 'SUPER_ADMIN');

    expect(response.status).toBe(200);
    expect(response.body.branding.id).toBe('tenant-b');
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-b' },
      select: expect.objectContaining({ contactEmail: true, payslipTemplate: true }),
    });
  });

  test('persists partial tenant settings without erasing existing template preferences', async () => {
    const updated = {
      ...tenantBranding,
      contactEmail: 'accounts@tenant-a.test',
      footerNote: 'x'.repeat(500),
      payslipTemplate: { tagline: 'People first', logoAlignment: 'right', showFooter: false },
    };
    prisma.company.findUnique.mockResolvedValue({ payslipTemplate: tenantBranding.payslipTemplate });
    prisma.company.update.mockResolvedValue(updated);

    const response = await request(app)
      .put('/companies/tenant-a/branding')
      .set('x-test-role', 'ADMIN')
      .set('x-test-company', 'tenant-a')
      .send({
        contactEmail: 'accounts@tenant-a.test',
        footerNote: 'x'.repeat(500),
        payslipTemplate: { logoAlignment: 'right', showFooter: false },
      });

    expect(response.status).toBe(200);
    expect(response.body.branding.contactEmail).toBe('accounts@tenant-a.test');
    expect(response.body.branding.footerNote).toHaveLength(500);
    expect(prisma.company.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tenant-a' },
      data: expect.objectContaining({
        contactEmail: 'accounts@tenant-a.test',
        footerNote: 'x'.repeat(500),
        payslipTemplate: { tagline: 'People first', logoAlignment: 'right', showFooter: false },
      }),
    }));
  });
});
