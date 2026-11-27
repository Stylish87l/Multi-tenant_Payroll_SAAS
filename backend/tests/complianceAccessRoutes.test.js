import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = { user: { findMany: jest.fn() } };
let testRole = 'SUPER_ADMIN';
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = 'platform-admin';
    req.userRole = testRole;
    next();
  },
}));
jest.unstable_mockModule('../middleware/rbac.js', () => ({
  default: jest.fn(() => (_req, _res, next) => next()),
}));
jest.unstable_mockModule('../services/emailService.js', () => ({ sendInviteEmail: jest.fn() }));
jest.unstable_mockModule('../services/auditService.js', () => ({
  actorFromReq: jest.fn(() => ({ userId: 'platform-admin' })),
  writeAudit: jest.fn(),
}));

const { default: complianceAccessRoutes } = await import('../routes/complianceAccessRoutes.js');
const app = express();
app.use(express.json());
app.use('/api/compliance-access', complianceAccessRoutes);

describe('compliance specialist administration directory', () => {
  beforeEach(() => {
    testRole = 'SUPER_ADMIN';
    prisma.user.findMany.mockReset();
  });

  it('returns a bounded directory with company grants and no sensitive user fields', async () => {
    prisma.user.findMany.mockResolvedValue([{
      id: 'specialist-1',
      name: 'Qualified Reviewer',
      email: 'reviewer@example.com',
      status: 'ACTIVE',
      companyId: 'company-1',
      createdAt: new Date('2026-11-27T00:00:00.000Z'),
      complianceSpecialistAccess: [{
        id: 'grant-1',
        companyId: 'company-1',
        grantedAt: new Date('2026-11-27T00:00:00.000Z'),
        revokedAt: null,
        company: { name: 'Example Company' },
      }],
    }]);

    const response = await request(app).get('/api/compliance-access/specialists?limit=500');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.specialists[0]).toMatchObject({
      id: 'specialist-1',
      name: 'Qualified Reviewer',
      email: 'reviewer@example.com',
      status: 'ACTIVE',
      complianceSpecialistAccess: [{ companyId: 'company-1', company: { name: 'Example Company' } }],
    });
    expect(response.body.specialists[0]).not.toHaveProperty('password');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'COMPLIANCE_SPECIALIST', deletedAt: null },
      take: 100,
      select: expect.objectContaining({
        id: true,
        email: true,
        complianceSpecialistAccess: expect.any(Object),
      }),
    }));
  });
});
