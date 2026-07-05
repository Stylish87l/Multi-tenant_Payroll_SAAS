import prisma from '../config/db.js';
import { calculateSSNIT } from '../utils/ssnitCalculator.js';
import { calculatePAYE } from '../utils/payeCalculator.js';
import logger from '../config/logger.js';

export const runPayroll = async (req, res) => {
  try {
    const { month } = req.body;

    // FIXED: companyId: null for SUPER_ADMIN violated the schema
    // (PayrollRun.companyId is non-nullable) and threw on every
    // SUPER_ADMIN run. SUPER_ADMIN must now explicitly target a tenant.
    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? req.body.companyId : req.companyId;
    if (!targetCompanyId) {
      return res.status(400).json({ error: 'companyId is required for SUPER_ADMIN payroll runs.' });
    }

    if (!month) {
      return res.status(400).json({ error: 'Month parameter is required.' });
    }

    const existing = await prisma.payrollRun.findFirst({
      where: { companyId: targetCompanyId, month },
    });
    if (existing) {
      return res.status(400).json({ error: `Payroll for ${month} already exists for this company.` });
    }

    const employees = await prisma.employee.findMany({
      where: { companyId: targetCompanyId, isActive: true },
      select: {
        id: true,
        basicSalary: true,
        housingAllowance: true,
        transportAllowance: true,
        otherAllowance: true,
        isMarried: true,
        hasResponsibility: true,
        childrenCount: true,
        isDisabled: true,
        age: true,
        agedDependentsCount: true,
      },
    });

    if (!employees.length) {
      return res.status(400).json({ error: 'No active employees found for this company.' });
    }

    // FIXED (Decimal correctness): basicSalary/housingAllowance/etc are
    // Prisma Decimal (decimal.js) columns, not JS numbers - the native `+`
    // operator does string concatenation on them (Decimal.valueOf()
    // returns a string), silently corrupting every gross salary. Every
    // value is now explicitly coerced with Number() before arithmetic.
    //
    // FIXED (missing await): calculateSSNIT/calculatePAYE are both async.
    // Calling them without await assigned unresolved Promises to
    // ssnit/payeTax, corrupting every downstream field with NaN/undefined.
    const items = [];
    for (const emp of employees) {
      const basicSalary = Number(emp.basicSalary);
      const totalAllowances =
        Number(emp.housingAllowance) + Number(emp.transportAllowance) + Number(emp.otherAllowance);
      const grossSalary = basicSalary + totalAllowances;

      // eslint-disable-next-line no-await-in-loop
      const ssnit = await calculateSSNIT(basicSalary, totalAllowances, targetCompanyId);
      const assessableIncome = grossSalary - ssnit.employeeDeduction;

      // eslint-disable-next-line no-await-in-loop
      const paye = await calculatePAYE(
        assessableIncome,
        {
          isMarried: emp.isMarried,
          hasResponsibility: emp.hasResponsibility,
          childrenCount: emp.childrenCount,
          isDisabled: emp.isDisabled,
          age: emp.age,
          agedDependentsCount: emp.agedDependentsCount,
        },
        targetCompanyId
      );

      items.push({
        employeeId: emp.id,
        grossSalary,
        taxableIncome: paye.taxableIncome,
        ssnitEmployee: ssnit.employeeDeduction,
        ssnitEmployer: ssnit.employerContribution,
        ssnitTier1: ssnit.remittance.tier1,
        ssnitTier2: ssnit.remittance.tier2,
        payeTax: paye.totalTax,
        netPay: grossSalary - ssnit.employeeDeduction - paye.totalTax,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payrollRun = await tx.payrollRun.create({
        data: {
          companyId: targetCompanyId,
          month,
          status: 'DRAFT',
          runType: 'REGULAR',
          // FIXED: PayrollRun has no `createdBy` field - only
          // `processedById`. The old code threw "Unknown argument
          // `createdBy`" on every single run.
          processedById: req.userId || null,
        },
      });

      await tx.payrollItem.createMany({
        data: items.map((item) => ({ ...item, payrollRunId: payrollRun.id })),
      });

      // CLAUDE.md audit-trail rule compliance
      await tx.auditLog.create({
        data: {
          userId: req.userId || null,
          action: 'PAYROLL_RUN_CREATED',
          details: { 
            runId: payrollRun.id, 
            companyId: targetCompanyId, 
            month, 
            employeeCount: items.length 
          },
          resourceId: payrollRun.id,
          resourceType: 'PayrollRun',
        },
      });

      return payrollRun;
    });

    logger.info(`Payroll Draft Created: ${result.id}`, { user: req.userId });
    return res.status(201).json({ message: 'Success', runId: result.id });

  } catch (error) {
    logger.error('Payroll Calculation Failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Critical failure during payroll execution.' });
  }
};

export const getPayrollRuns = async (req, res) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: req.userRole === 'SUPER_ADMIN' ? {} : { companyId: req.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { items: true } }
      }
    });
    return res.json(runs);
  } catch (error) {
    logger.error('Fetch Payroll Runs Failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch payroll history.' });
  }
};

export const getPayrollDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        items: {
          // FIXED: Employee model has `name`, not `firstName`/`lastName`
          include: { employee: { select: { name: true } } }
        }
      }
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found.' });
    }

    // Tenant isolation security check
    if (req.userRole !== 'SUPER_ADMIN' && run.companyId !== req.companyId) {
      logger.warn('Unauthorized multi-tenant payroll access attempt prevented', {
        userId: req.userId,
        runId: id,
        expectedCompany: run.companyId,
        actualCompany: req.companyId
      });
      return res.status(403).json({ error: 'Unauthorized access to this payroll data.' });
    }

    return res.json(run);
  } catch (error) {
    logger.error('Fetch Payroll Details Failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch payroll details.' });
  }
};