import express from 'express';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';

const router = express.Router();
router.use(authMiddleware);

/**
 * 1. Individual Payslip Data
 * Scoped by Tenant and Employee ID for security.
 */
router.get('/payslip/:itemId', rbac(['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE']), async (req, res) => {
  const { itemId } = req.params;
  try {
    const where = {
      id: itemId,
      payrollRun: req.userRole !== 'SUPER_ADMIN' ? { companyId: req.companyId } : {}
    };

    if (req.userRole === 'EMPLOYEE') {
      where.employee = { userId: req.userId };
    }

    const item = await prisma.payrollItem.findFirst({
      where,
      select: {
        grossSalary: true,
        taxableIncome: true,
        ssnitEmployee: true,
        payeTax: true,
        netPay: true,
        employee: {
          select: {
            name: true,
            ssnitNumber: true,
            ghanaCardPin: true,
            position: true
          }
        },
        payrollRun: { select: { month: true } }
      },
    });

    if (!item) return res.status(404).json({ error: 'Payslip not found or access denied' });
    res.json(item);
  } catch (error) {
    logger.error('Payslip Fetch Error', { itemId, userId: req.userId, error: error.message });
    res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

/**
 * 2. GRA Schedule (Monthly Tax Return Compliance)
 */
router.get('/gra-schedule/:runId', rbac(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const { runId } = req.params;
  const { format = 'json' } = req.query;

  try {
    const items = await prisma.payrollItem.findMany({
      where: {
        payrollRunId: runId,
        payrollRun: req.userRole !== 'SUPER_ADMIN' ? { companyId: req.companyId } : {}
      },
      select: {
        employee: { select: { ghanaCardPin: true, name: true } },
        taxableIncome: true,
        payeTax: true,
        payrollRun: { select: { month: true } }
      },
    });

    if (!items.length) return res.status(404).json({ error: 'No records found' });

    const schedule = items.map((item, i) => ({
      serialNo: i + 1,
      tin: item.employee.ghanaCardPin,
      name: item.employee.name,
      assessableIncome: item.taxableIncome.toFixed(2),
      payeTax: item.payeTax.toFixed(2),
    }));

    // FIXED (2026-07-10): `sum + item.payeTax` where item.payeTax is a
    // Prisma Decimal instance. decimal.js's valueOf()/toJSON() deliberately
    // return a STRING (to prevent exactly this kind of silent bug) - so
    // `0 + Decimal` does NOT add, it string-concatenates every payeTax
    // value together into one garbage string. Wrapping in Number() forces
    // correct numeric coercion, matching CLAUDE.md's Decimal-safety rule.
    const totalTax = items.reduce((sum, item) => sum + Number(item.payeTax), 0);

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('GRA Schedule');
      
      sheet.columns = [
        { header: 'S/N', key: 'serialNo', width: 10 },
        { header: 'TIN (Ghana Card)', key: 'tin', width: 25 },
        { header: 'Employee Name', key: 'name', width: 30 },
        { header: 'Assessable Income (GHS)', key: 'assessableIncome', width: 20 },
        { header: 'PAYE Tax (GHS)', key: 'payeTax', width: 20 },
      ];

      sheet.addRows(schedule);
      sheet.addRow({ name: 'TOTAL', payeTax: totalTax.toFixed(2) });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`GRA_Schedule_${runId}.xlsx`);
      return await workbook.xlsx.write(res).then(() => res.end());
    }

    res.json({ schedule, totalTax: totalTax.toFixed(2) });
  } catch (error) {
    logger.error('GRA Export Error', { runId, error: error.message });
    res.status(500).json({ error: 'Failed to generate GRA schedule' });
  }
});

/**
 * 3. SSNIT Schedule (Tier 1 & 2 Compliance)
 */
router.get('/ssnit-schedule/:runId', rbac(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const { runId } = req.params;
  const { format = 'json' } = req.query;

  try {
    const items = await prisma.payrollItem.findMany({
      where: {
        payrollRunId: runId,
        payrollRun: req.userRole !== 'SUPER_ADMIN' ? { companyId: req.companyId } : {}
      },
      select: {
        employee: { select: { ssnitNumber: true, name: true } },
        grossSalary: true,
        ssnitEmployee: true,
        ssnitEmployer: true,
        payrollRun: { select: { month: true } }
      }
    });

    if (!items.length) return res.status(404).json({ error: 'No records found' });

    // FIXED (2026-07-10): same Decimal `+` bug as the GRA route above, but
    // worse here - `item.ssnitEmployee + item.ssnitEmployer` string-concats
    // into e.g. "12.3456.78", and calling `.toFixed(2)` on that STRING
    // throws `TypeError: ...toFixed is not a function`, crashing this
    // entire route (both JSON and CSV format) for every request.
    const ssnitData = items.map((item, i) => ({
      serialNo: i + 1,
      ssnitNumber: item.employee.ssnitNumber,
      name: item.employee.name,
      grossSalary: item.grossSalary.toFixed(2),
      employeeContribution: item.ssnitEmployee.toFixed(2),
      employerContribution: item.ssnitEmployer.toFixed(2),
      total: (Number(item.ssnitEmployee) + Number(item.ssnitEmployer)).toFixed(2),
    }));

    if (format === 'csv') {
      const parser = new Parser();
      res.setHeader('Content-Type', 'text/csv');
      res.attachment(`SSNIT_${runId}.csv`);
      return res.send(parser.parse(ssnitData));
    }

    res.json({ ssnitData });
  } catch (error) {
    logger.error('SSNIT Export Error', { runId, error: error.message });
    res.status(500).json({ error: 'Failed to generate SSNIT schedule' });
  }
});

export default router;