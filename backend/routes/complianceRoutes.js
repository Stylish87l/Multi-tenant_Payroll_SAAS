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
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']));

router.get('/notices', readLimiter, async (req, res, next) => {
  try {
    const notices = await prisma.complianceNotice.findMany({
      orderBy: { detectedAt: 'desc' },
      take: 100,
      include: {
        source: { select: { name: true, authority: true, topic: true, url: true } },
        assessments: {
          where: { companyId: req.reviewCompanyId },
          take: 1,
          select: {
            id: true, summary: true, impactAreas: true, proposedActions: true,
            status: true, createdAt: true,
          },
        },
      },
    });
    return res.json({
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

router.post('/notices/:noticeId/assessments', draftLimiter, async (req, res, next) => {
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

export default router;
