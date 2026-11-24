import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { createDraftPayrollRun } from '../services/payrollService.js';
import { actorFromReq } from '../services/auditService.js';
import { badInput, forbidden, notFound } from '../utils/appError.js';

const resolvePayrollCompanyId = async (req, requestedCompanyId) => {
  const companyId = req.userRole === 'SUPER_ADMIN' ? requestedCompanyId : req.companyId;
  if (!companyId) throw forbidden('Select a company before accessing payroll.');
  if (req.userRole !== 'SUPER_ADMIN' && requestedCompanyId && requestedCompanyId !== req.companyId) {
    throw forbidden('You do not have access to this company.');
  }
  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
  if (!company) throw notFound('Company not found or inactive.');
  return companyId;
};

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
    const companyId = await resolvePayrollCompanyId(req, req.query.companyId);
    const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = (Math.max(Number(req.query.page) || 1, 1) - 1) * take;
    const runs = await prisma.payrollRun.findMany({
      where: { companyId, deletedAt: null },
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
    const companyId = await resolvePayrollCompanyId(req, req.query.companyId);
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, companyId, deletedAt: null },
      include: { items: { include: { employee: { select: { name: true } } } } },
    });
    if (!run) throw notFound('Payroll run not found.');
    return res.json(run);
  } catch (error) {
    return next(error);
  }
};
