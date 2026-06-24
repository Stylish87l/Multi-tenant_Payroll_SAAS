import prisma from '../config/db.js';
import { calculateSSNIT } from '../utils/ssnitCalculator.js';
import { calculatePAYE } from '../utils/payeCalculator.js';
import logger from '../config/logger.js';

export const runPayroll = async (req, res) => {
  try {
    const { month } = req.body; // Validation handled by middleware

    // 1. Optimized Employee Fetch
    const employees = await prisma.employee.findMany({
      where: req.userRole === 'SUPER_ADMIN' ? {} : { companyId: req.companyId, isActive: true },
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
        agedDependentsCount: true 
      },
    });

    if (!employees.length) return res.status(400).json({ error: 'No active employees found' });

    // 2. Prevent Duplicate Runs
    const existing = await prisma.payrollRun.findFirst({ 
      where: req.userRole === 'SUPER_ADMIN' ? { month } : { companyId: req.companyId, month } 
    });
    if (existing) return res.status(400).json({ error: `Payroll for ${month} already exists.` });

    // 3. Calculation Engine & Transaction
    const result = await prisma.$transaction(async (tx) => {
      const payrollRun = await tx.payrollRun.create({ 
        data: { 
          companyId: req.userRole === 'SUPER_ADMIN' ? null : req.companyId, 
          month, 
          status: 'DRAFT',
          createdBy: req.userId 
        } 
      });

      const items = employees.map((emp) => {
        const totalAllowances = emp.housingAllowance + emp.transportAllowance + emp.otherAllowance;
        const grossSalary = emp.basicSalary + totalAllowances;
        const ssnit = calculateSSNIT(grossSalary);
        const taxableIncome = grossSalary - ssnit.employeeDeduction;

        const payeTax = calculatePAYE(taxableIncome, {
          isMarried: emp.isMarried,
          hasResponsibility: emp.hasResponsibility,
          childrenCount: emp.childrenCount,
          isDisabled: emp.isDisabled,
          age: emp.age,
          agedDependentsCount: emp.agedDependentsCount,
        });

        return {
          payrollRunId: payrollRun.id,
          employeeId: emp.id,
          grossSalary,
          taxableIncome,
          ssnitEmployee: ssnit.employeeDeduction,
          ssnitEmployer: ssnit.employerContribution,
          ssnitTier1: ssnit.remittance.tier1,
          ssnitTier2: ssnit.remittance.tier2,
          payeTax,
          netPay: grossSalary - ssnit.employeeDeduction - payeTax,
        };
      });

      await tx.payrollItem.createMany({ data: items });
      return payrollRun;
    });

    logger.info(`Payroll Draft Created: ${result.id}`, { user: req.userId });
    res.status(201).json({ message: 'Success', runId: result.id });

  } catch (error) {
    logger.error('Payroll Calculation Failed', { error: error.message });
    res.status(500).json({ error: 'Critical failure during payroll' });
  }
};

// ADD THESE TO YOUR EXISTING payrollController.js

export const getPayrollRuns = async (req, res) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: req.userRole === 'SUPER_ADMIN' ? {} : { companyId: req.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { items: true } }
      }
    });
    res.json(runs);
  } catch (error) {
    logger.error('Fetch Payroll Runs Failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch payroll history' });
  }
};

export const getPayrollDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        items: {
          include: { employee: { select: { firstName: true, lastName: true } } }
        }
      }
    });

    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    
    // Security check: Ensure user belongs to the company they are viewing
    if (req.userRole !== 'SUPER_ADMIN' && run.companyId !== req.companyId) {
      return res.status(403).json({ error: 'Unauthorized access to this payroll data' });
    }

    res.json(run);
  } catch (error) {
    logger.error('Fetch Payroll Details Failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch payroll details' });
  }
};