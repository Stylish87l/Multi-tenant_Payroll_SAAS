import prisma, { Prisma } from '../config/db.js';
import logger from '../config/logger.js';
import { calculateSSNIT } from '../utils/ssnitCalculator.js';
import { calculatePAYE } from '../utils/payeCalculator.js';
import { writeAudit } from './auditService.js';
import { badInput, conflict } from '../utils/appError.js';

/**
 * Single implementation of "create a DRAFT payroll run".
 *
 * This logic previously existed twice - controllers/payrollController.js (REST)
 * and Mutation.runPayroll (GraphQL) - and the copies had already drifted apart
 * (different role lists, different future-month rules). Both entry points now call this.
 *
 * Money: all aggregation uses Prisma.Decimal (decimal.js), never JS floats,
 * and every stored amount is rounded to 2 decimal places (pesewas).
 */
const D = (v) => new Prisma.Decimal(v ?? 0);
const round2 = (d) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Accepts YYYY-MM or YYYY-MM-DD, returns the canonical first-of-month string YYYY-MM-01. */
export const normalizeMonth = (month) => {
  const str = String(month ?? '');
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(\d{2}))?$/.exec(str);
  if (!m) throw badInput('Invalid month format. Expected YYYY-MM or YYYY-MM-DD.');
  return `${m[1]}-${m[2]}-01`;
};

export const createDraftPayrollRun = async ({ companyId, month, actor }) => {
  if (!companyId) throw badInput('companyId is required to run payroll.');

  const normalizedMonth = normalizeMonth(month);
  const [year, monthIndex] = normalizedMonth.split('-').map(Number);
  const now = new Date();
  if (Date.UTC(year, monthIndex - 1, 1) > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) {
    throw badInput('Payroll cannot be processed for future months.');
  }

  const existing = await prisma.payrollRun.findFirst({ where: { companyId, month: normalizedMonth } });
  if (existing) throw conflict(`Payroll for ${normalizedMonth.slice(0, 7)} already exists for this company.`);

  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true, basicSalary: true, housingAllowance: true, transportAllowance: true, otherAllowance: true,
      isMarried: true, hasResponsibility: true, childrenCount: true, isDisabled: true, age: true, agedDependentsCount: true,
    },
  });
  if (!employees.length) throw badInput('No active employees found for this company.');

  const items = [];
  for (const emp of employees) {
    const basic = D(emp.basicSalary);
    const allowances = D(emp.housingAllowance).plus(D(emp.transportAllowance)).plus(D(emp.otherAllowance));
    const gross = basic.plus(allowances);

    // eslint-disable-next-line no-await-in-loop
    const ssnit = await calculateSSNIT(basic.toNumber(), allowances.toNumber(), companyId, year, normalizedMonth);
    const ssnitEmployee = D(ssnit.employeeDeduction);
    const assessable = gross.minus(ssnitEmployee);

    // eslint-disable-next-line no-await-in-loop
    const paye = await calculatePAYE(
      assessable.toNumber(),
      {
        isMarried: emp.isMarried,
        hasResponsibility: emp.hasResponsibility,
        childrenCount: emp.childrenCount,
        isDisabled: emp.isDisabled,
        age: emp.age,
        agedDependentsCount: emp.agedDependentsCount,
      },
      companyId,
      0,
      0,
      basic.toNumber(),
      year,
      normalizedMonth
    );

    const payeTax = D(paye.totalTax);
    const netPay = round2(gross.minus(ssnitEmployee).minus(payeTax));
    // Never persist a payroll item that cannot be disbursed or reconciled safely.
    // A zero/negative result must be reviewed as an input/configuration error.
    if (!netPay.isFinite() || netPay.lte(0)) {
      logger.error('Payroll blocked: non-positive net pay', {
        employeeId: emp.id,
        companyId,
        netPay: netPay.toString(),
      });
      throw badInput(`Payroll cannot be created: employee ${emp.id} has non-positive net pay. Review salary, deductions and statutory configuration.`);
    }

    items.push({
      employeeId: emp.id,
      grossSalary: round2(gross),
      taxableIncome: round2(D(paye.taxableIncome)),
      ssnitEmployee: round2(ssnitEmployee),
      ssnitEmployer: round2(D(ssnit.employerContribution)),
      ssnitTier1: round2(D(ssnit.remittance.tier1)),
      ssnitTier2: round2(D(ssnit.remittance.tier2)),
      payeTax: round2(payeTax),
      netPay: round2(netPay),
    });
  }

  try {
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: { companyId, month: normalizedMonth, status: 'DRAFT', runType: 'REGULAR', processedById: actor?.userId || null },
      });
      await tx.payrollItem.createMany({ data: items.map((item) => ({ ...item, payrollRunId: created.id })) });
      await writeAudit(tx, {
        actor,
        companyId,
        action: 'PAYROLL_RUN_CREATED',
        resourceType: 'PayrollRun',
        resourceId: created.id,
        details: { runId: created.id, month: normalizedMonth, employeeCount: items.length },
      });
      return created;
    });
    logger.info(`Payroll Draft Created: ${run.id}`, { user: actor?.userId, companyId });
    return run;
  } catch (err) {
    // Two concurrent requests can both pass the existence check; the unique (companyId, month) index decides.
    if (err.code === 'P2002') throw conflict(`Payroll for ${normalizedMonth.slice(0, 7)} already exists for this company.`);
    throw err;
  }
};
