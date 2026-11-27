import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import companyContext from '../middleware/companyContext.js';
import { actorFromReq, writeAudit } from '../services/auditService.js';

const router = express.Router({ mergeParams: true });
const noStore = (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
});
const draftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
});
const assessmentSchema = z.object({
  summary: z.string().trim().min(30).max(3000),
  impactAreas: z.array(z.enum(['PAYE', 'SSNIT', 'ALLOWANCES', 'PAYROLL_PROCESS', 'EMPLOYEE_DATA', 'OTHER'])).min(1).max(6),
  proposedActions: z.array(z.string().trim().min(10).max(500)).min(1).max(8),
}).strict();

router.use(authMiddleware);
router.use(noStore);
router.use(companyContext);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'COMPLIANCE_SPECIALIST']));

router.get('/notices', readLimiter, async (req, res, next) => {
  try {
    const [notices, sources] = await Promise.all([
      prisma.complianceNotice.findMany({
        orderBy: { detectedAt: 'desc' },
        take: 100,
        include: {
          source: { select: { name: true, authority: true, topic: true, url: true } },
          assessments: {
            where: { companyId: req.reviewCompanyId },
            take: 1,
            select: {
              id: true, summary: true, impactAreas: true, proposedActions: true,
              status: true, createdAt: true, submittedAt: true, reviewedAt: true,
              reviews: { orderBy: { createdAt: 'desc' }, take: 5, select: {
                decision: true, rationale: true, createdAt: true,
                reviewer: { select: { id: true, name: true, email: true } },
              } },
            },
          },
        },
      }),
      prisma.complianceSource.findMany({
        where: { active: true },
        orderBy: [{ authority: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, authority: true, topic: true, url: true, lastCheckedAt: true, lastStatus: true, lastError: true },
      }),
    ]);
    return res.json({
      sources,
      notices: notices.map((notice) => ({
        id: notice.id,
        title: notice.title,
        url: notice.url,
        excerpt: notice.excerpt,
        status: notice.status,
        detectedAt: notice.detectedAt,
        source: notice.source,
        assessment: notice.assessments[0] || null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/notices/:noticeId/assessments', rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), draftLimiter, async (req, res, next) => {
  try {
    const parsed = assessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Provide a summary, at least one impact area, and one proposed action.',
        details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
    }

    const notice = await prisma.complianceNotice.findUnique({
      where: { id: req.params.noticeId },
      select: { id: true, title: true },
    });
    if (!notice) return res.status(404).json({ error: 'Compliance notice not found.' });

    const existing = await prisma.complianceAssessment.findFirst({
      where: { noticeId: notice.id, companyId: req.reviewCompanyId },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: 'A draft assessment already exists for this notice and company.' });

    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.complianceAssessment.create({
        data: {
          noticeId: notice.id,
          companyId: req.reviewCompanyId,
          createdById: req.userId,
          summary: parsed.data.summary,
          impactAreas: [...new Set(parsed.data.impactAreas)],
          proposedActions: parsed.data.proposedActions,
          status: 'DRAFT',
        },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: req.reviewCompanyId,
        action: 'COMPLIANCE_ASSESSMENT_DRAFTED',
        resourceType: 'ComplianceAssessment',
        resourceId: created.id,
        details: { noticeId: notice.id, impactAreas: [...new Set(parsed.data.impactAreas)] },
      });
      return created;
    });
    return res.status(201).json({ assessment });
  } catch (error) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'A draft assessment already exists for this notice and company.' });
    return next(error);
  }
});


const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const reviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

router.post('/assessments/:assessmentId/submit', rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), submitLimiter, async (req, res, next) => {
  try {
    const assessment = await prisma.complianceAssessment.findFirst({
      where: { id: req.params.assessmentId, companyId: req.reviewCompanyId },
      select: { id: true, status: true, createdById: true },
    });
    if (!assessment) return res.status(404).json({ error: 'Compliance assessment not found.' });
    if (!['DRAFT', 'REJECTED'].includes(assessment.status)) {
      return res.status(409).json({ error: 'Only draft or rejected assessments can be submitted.' });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.complianceAssessment.updateMany({
        where: { id: assessment.id, companyId: req.reviewCompanyId, status: assessment.status },
        data: { status: 'SUBMITTED', submittedAt: new Date(), reviewedAt: null },
      });
      if (changed.count !== 1) return null;
      const result = await tx.complianceAssessment.findFirst({ where: { id: assessment.id, companyId: req.reviewCompanyId } });
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId: req.reviewCompanyId,
        action: 'COMPLIANCE_ASSESSMENT_SUBMITTED', resourceType: 'ComplianceAssessment',
        resourceId: assessment.id,
      });
      return result;
    });
    if (!updated) return res.status(409).json({ error: 'Assessment status changed. Refresh and try again.' });
    return res.json({ assessment: updated });
  } catch (error) { return next(error); }
});

const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rationale: z.string().trim().min(30).max(3000),
}).strict();

router.patch('/assessments/:assessmentId/review', rbac(['SUPER_ADMIN', 'COMPLIANCE_SPECIALIST']), reviewLimiter, async (req, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({
      error: 'Provide an approval or rejection decision and a rationale of at least 30 characters.',
      details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
    const assessment = await prisma.complianceAssessment.findFirst({
      where: { id: req.params.assessmentId, companyId: req.reviewCompanyId },
      select: { id: true, status: true, createdById: true },
    });
    if (!assessment) return res.status(404).json({ error: 'Compliance assessment not found.' });
    if (assessment.status !== 'SUBMITTED') return res.status(409).json({ error: 'Only submitted assessments can be reviewed.' });
    if (assessment.createdById === req.userId) return res.status(403).json({ error: 'You cannot review your own assessment.' });

    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.complianceAssessment.updateMany({
        where: { id: assessment.id, companyId: req.reviewCompanyId, status: 'SUBMITTED' },
        data: {
          status: parsed.data.decision,
          reviewedAt: new Date(),
        },
      });
      if (changed.count !== 1) return null;
      const review = await tx.complianceAssessmentReview.create({
        data: {
          assessmentId: assessment.id,
          companyId: req.reviewCompanyId,
          reviewerId: req.userId,
          decision: parsed.data.decision,
          rationale: parsed.data.rationale,
        },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId: req.reviewCompanyId,
        action: parsed.data.decision === 'APPROVED' ? 'COMPLIANCE_ASSESSMENT_APPROVED' : 'COMPLIANCE_ASSESSMENT_REJECTED',
        resourceType: 'ComplianceAssessment', resourceId: assessment.id,
        details: { reviewId: review.id, decision: parsed.data.decision },
      });
      return review;
    });
    if (!result) return res.status(409).json({ error: 'Assessment was already reviewed. Refresh and try again.' });
    return res.json({ review: result, status: parsed.data.decision, configurationChanged: false });
  } catch (error) { return next(error); }
});

export default router;
