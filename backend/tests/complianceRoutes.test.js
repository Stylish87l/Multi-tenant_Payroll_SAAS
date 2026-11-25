import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  complianceNotice: { findMany: jest.fn(), findUnique: jest.fn() },
  complianceAssessment: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
const writeAudit = jest.fn();
const actorFromReq = jest.fn(() => ({ userId: 'user-1' }));
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.userId = 'user-1';
    req.companyId = 'tenant-a';
    req.userRole = 'ADMIN';
    next();
  },
}));
jest.unstable_mockModule('../middleware/companyContext.js', () => ({
  default: (req, _res, next) => { req.reviewCompanyId = req.params.companyId; next(); },
}));
jest.unstable_mockModule('../middleware/rbac.js', () => ({
  default: jest.fn(() => (_req, _res, next) => next()),
}));
jest.unstable_mockModule('../services/auditService.js', () => ({ writeAudit, actorFromReq }));

const { default: complianceRoutes } = await import('../routes/complianceRoutes.js');
const app = express();
app.use(express.json());
app.use('/api/companies/:companyId/compliance', complianceRoutes);

describe('company compliance notice and draft assessment routes', () => {
  beforeEach(() => {
    prisma.complianceNotice.findMany.mockReset();
    prisma.complianceNotice.findUnique.mockReset();
    prisma.complianceAssessment.findFirst.mockReset();
    prisma.$transaction.mockReset();
    writeAudit.mockReset();
    actorFromReq.mockClear();
  });
  afterEach(() => jest.clearAllMocks());

  it('returns notices with only this company assessment and no-store headers', async () => {
    prisma.complianceNotice.findMany.mockResolvedValue([{
      id: 'notice-1',
      title: 'GRA PAYE update',
      url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/',
      excerpt: 'Official published content',
      status: 'NEW',
      detectedAt: new Date('2026-11-25T00:00:00.000Z'),
      source: { name: 'GRA PAYE', authority: 'GRA', topic: 'PAYE', url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/' },
      assessments: [{ id: 'assessment-1', summary: 'Review the new rates', impactAreas: ['PAYE'], proposedActions: ['Compare effective dates'], status: 'DRAFT' }],
    }]);
    const response = await request(app).get('/api/companies/tenant-a/compliance/notices');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.notices[0].assessment.id).toBe('assessment-1');
    expect(prisma.complianceNotice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        assessments: expect.objectContaining({ where: { companyId: 'tenant-a' }, take: 1 }),
      }),
    }));
  });

  it('creates an auditable draft assessment without touching TaxConfig', async () => {
    prisma.complianceNotice.findUnique.mockResolvedValue({ id: 'notice-1', title: 'GRA PAYE update' });
    prisma.complianceAssessment.findFirst.mockResolvedValue(null);
    const tx = { complianceAssessment: { create: jest.fn().mockResolvedValue({ id: 'assessment-1', status: 'DRAFT' }) } };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    const response = await request(app).post('/api/companies/tenant-a/compliance/notices/notice-1/assessments').send({
      summary: 'Review the new PAYE rates and effective date against payroll configuration.',
      impactAreas: ['PAYE', 'PAYROLL_PROCESS', 'PAYE'],
      proposedActions: ['Compare the official effective date with current configuration.', 'Prepare impact scenarios for a qualified specialist.'],
    });
    expect(response.status).toBe(201);
    expect(response.body.assessment.status).toBe('DRAFT');
    expect(tx.complianceAssessment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        noticeId: 'notice-1',
        companyId: 'tenant-a',
        createdById: 'user-1',
        impactAreas: ['PAYE', 'PAYROLL_PROCESS'],
        status: 'DRAFT',
      }),
    });
    expect(writeAudit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'COMPLIANCE_ASSESSMENT_DRAFTED',
      companyId: 'tenant-a',
      resourceId: 'assessment-1',
    }));
  });

  it('rejects incomplete draft assessments', async () => {
    const response = await request(app).post('/api/companies/tenant-a/compliance/notices/notice-1/assessments').send({
      summary: 'Too short',
      impactAreas: [],
      proposedActions: [],
    });
    expect(response.status).toBe(400);
    expect(prisma.complianceNotice.findUnique).not.toHaveBeenCalled();
  });

  it('prevents duplicate assessments for the same notice and company', async () => {
    prisma.complianceNotice.findUnique.mockResolvedValue({ id: 'notice-1', title: 'GRA PAYE update' });
    prisma.complianceAssessment.findFirst.mockResolvedValue({ id: 'assessment-existing' });
    const response = await request(app).post('/api/companies/tenant-a/compliance/notices/notice-1/assessments').send({
      summary: 'Review the official statutory notice and assess possible payroll impact.',
      impactAreas: ['PAYE'],
      proposedActions: ['Compare the notice effective date to current statutory configuration.'],
    });
    expect(response.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
