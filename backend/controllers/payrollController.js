import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { createDraftPayrollRun } from '../services/payrollService.js';
import { actorFromReq } from '../services/auditService.js';
import { badInput, notFound } from '../utils/appError.js';

export const runPayroll = async (req, res, next) => {
  try {
    const companyId = req.userRole === 'SUPER_ADMIN' ? req.body.companyId : req.companyId;
    if (!companyId) throw badInput('companyId is required for SUPER_ADMIN payroll runs.');

    const run = await createDraftPayrollRun({ companyId, month: req.body.month, actor: actorFromReq(req) });
    return res.status(201).json({ message: 'Success', runId: run.id });
  } catch (error) {
    return next(error);
  }
};

export const getPayrollRuns = async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = (Math.max(Number(req.query.page) || 1, 1) - 1) * take;
    const runs = await prisma.payrollRun.findMany({
      where: req.userRole === 'SUPER_ADMIN' ? {} : { companyId: req.companyId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { _count: { select: { items: true } } },
    });
    return res.json(runs);
  } catch (error) {
    logger.error('Fetch Payroll Runs Failed', { error: error.message });
    return next(error);
  }
};

export const getPayrollDetails = async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { employee: { select: { name: true } } } } },
    });
    if (!run) throw notFound('Payroll run not found.');

    if (req.userRole !== 'SUPER_ADMIN' && run.companyId !== req.companyId) {
      logger.warn('Unauthorized multi-tenant payroll access attempt prevented', {
        userId: req.userId, runId: req.params.id, actualCompany: req.companyId,
      });
      // 404 not 403: do not confirm the run exists in another tenant.
      throw notFound('Payroll run not found.');
    }
    return res.json(run);
  } catch (error) {
    return next(error);
  }
};
