import prisma from '../config/db.js';
import { z } from 'zod';
import { reviewPayrollRun } from '../services/payrollAnomalyService.js';
import { actorFromReq, writeAudit } from '../services/auditService.js';
import { badInput, notFound } from '../utils/appError.js';

const decisionSchema = z.object({
  decision: z.enum(['CONFIRMED', 'DISMISSED', 'NEEDS_INVESTIGATION', 'RESOLVED']),
  comment: z.string().trim().max(2000).optional(),
}).strict();

export const createPayrollReview = async (req, res, next) => {
  try {
    const review = await reviewPayrollRun({
      companyId: req.reviewCompanyId,
      payrollRunId: req.params.payrollRunId,
      actor: actorFromReq(req),
    });
    return res.status(201).json(review);
  } catch (error) {
    return next(error);
  }
};

export const listPayrollReviews = async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const where = { companyId: req.reviewCompanyId };
    const [items, total] = await Promise.all([
      prisma.payrollReview.findMany({
        where, skip: (page - 1) * take, take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, payrollRunId: true, status: true, summary: true, provider: true,
          model: true, createdAt: true, updatedAt: true,
          _count: { select: { findings: true } },
          payrollRun: { select: { month: true, status: true } },
        },
      }),
      prisma.payrollReview.count({ where }),
    ]);
    return res.json({ items, total, page, limit: take, hasNextPage: page * take < total });
  } catch (error) {
    return next(error);
  }
};

export const getPayrollReview = async (req, res, next) => {
  try {
    const review = await prisma.payrollReview.findFirst({
      where: { id: req.params.reviewId, companyId: req.reviewCompanyId },
      include: {
        findings: {
          orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
          include: { actions: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, decision: true, comment: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } } } },
        },
        payrollRun: { select: { id: true, month: true, status: true } },
      },
    });
    if (!review) throw notFound('Payroll review not found.');
    return res.json(review);
  } catch (error) {
    return next(error);
  }
};

export const recordPayrollFindingDecision = async (req, res, next) => {
  try {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) throw badInput(parsed.error.issues.map((issue) => issue.message).join('; '));

    const { decision, comment } = parsed.data;
    const finding = await prisma.payrollReviewFinding.findFirst({
      where: {
        id: req.params.findingId,
        reviewId: req.params.reviewId,
        companyId: req.reviewCompanyId,
      },
      select: { id: true, status: true, reviewId: true },
    });
    if (!finding) throw notFound('Finding not found.');

    const statusByDecision = {
      CONFIRMED: 'CONFIRMED',
      DISMISSED: 'DISMISSED',
      NEEDS_INVESTIGATION: 'OPEN',
      RESOLVED: 'RESOLVED',
    };
    const actor = actorFromReq(req);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.payrollReviewFinding.update({
        where: { id: finding.id },
        data: { status: statusByDecision[decision] },
      });
      await tx.payrollReviewAction.create({
        data: {
          findingId: finding.id, companyId: req.reviewCompanyId,
          actorId: req.userId, decision, comment: comment || null,
        },
      });
      await writeAudit(tx, {
        actor, companyId: req.reviewCompanyId,
        action: 'PAYROLL_REVIEW_FINDING_DECIDED',
        resourceType: 'PayrollReviewFinding', resourceId: finding.id,
        details: { reviewId: finding.reviewId, decision, commentProvided: Boolean(comment) },
      });
      return updated;
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
