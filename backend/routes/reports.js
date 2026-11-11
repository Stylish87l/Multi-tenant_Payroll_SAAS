import express from 'express';
import ExcelJS from 'exceljs';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { toCsv } from '../utils/csv.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';

const router = express.Router();
router.use(authMiddleware);

const tenantRun = (req) => (req.userRole !== 'SUPER_ADMIN' ? { companyId: req.companyId } : {});

/** 1. Individual payslip data - scoped by tenant; employees see only their own FINALIZED payslips. */
router.get('/payslip/:itemId', rbac(['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE']), async (req, res) => {
  const { itemId } = req.params;
  try {
    const where = { id: itemId, payrollRun: tenantRun(req) };
    if (req.userRole === 'EMPLOYEE') {
      where.employee = { userId: req.userId };
      where.payrollRun = { ...tenantRun(req), status: 'FINALIZED' };
    }

    const item = await prisma.payrollItem.findFirst({
      where,
      select: {
        grossSalary: true, taxableIncome: true, ssnitEmployee: true, payeTax: true, netPay: true,
        employee: { select: { name: true, ssnitNumber: true, ghanaCardPin: true, position: true } },
        payrollRun: { select: { month: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Payslip not found or access denied' });
    return res.json(item);
  } catch (error) {
    logger.error('Payslip Fetch Error', { itemId, userId: req.userId, error: error.message });
    return res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

/** 2. GRA schedule (monthly PAYE return) */
router.get('/gra-schedule/:runId', rbac(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const { runId } = req.params;
  const { format = 'json' } = req.query;
  try {
    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: runId, payrollRun: tenantRun(req) },
      select: {
        employee: { select: { ghanaCardPin: true, name: true } },
        taxableIncome: true,
        payeTax: true,
        payrollRun: { select: { month: true, companyId: true } },
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
    // Number() is required: Prisma Decimal `+` string-concatenates instead of adding.
    const totalTax = items.reduce((sum, item) => sum + Number(item.payeTax), 0);

    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId: items[0].payrollRun.companyId, action: 'REPORT_GRA_EXPORTED',
      resourceType: 'PayrollRun', resourceId: runId, details: { format, rows: items.length },
    });

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
      await workbook.xlsx.write(res);
      return res.end();
    }

    return res.json({ schedule, totalTax: totalTax.toFixed(2) });
  } catch (error) {
    logger.error('GRA Export Error', { runId, error: error.message });
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate GRA schedule' });
    return res.end();
  }
});

/** 3. SSNIT schedule (Tier 1 & 2) */
router.get('/ssnit-schedule/:runId', rbac(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const { runId } = req.params;
  const { format = 'json' } = req.query;
  try {
    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: runId, payrollRun: tenantRun(req) },
      select: {
        employee: { select: { ssnitNumber: true, name: true } },
        grossSalary: true, ssnitEmployee: true, ssnitEmployer: true,
        payrollRun: { select: { month: true, companyId: true } },
      },
    });
    if (!items.length) return res.status(404).json({ error: 'No records found' });

    const ssnitData = items.map((item, i) => ({
      serialNo: i + 1,
      ssnitNumber: item.employee.ssnitNumber,
      name: item.employee.name,
      grossSalary: item.grossSalary.toFixed(2),
      employeeContribution: item.ssnitEmployee.toFixed(2),
      employerContribution: item.ssnitEmployer.toFixed(2),
      total: (Number(item.ssnitEmployee) + Number(item.ssnitEmployer)).toFixed(2),
    }));

    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId: items[0].payrollRun.companyId, action: 'REPORT_SSNIT_EXPORTED',
      resourceType: 'PayrollRun', resourceId: runId, details: { format, rows: items.length },
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(`SSNIT_${runId}.csv`);
      return res.send(toCsv(ssnitData, ['serialNo', 'ssnitNumber', 'name', 'grossSalary', 'employeeContribution', 'employerContribution', 'total']));
    }
    return res.json({ ssnitData });
  } catch (error) {
    logger.error('SSNIT Export Error', { runId, error: error.message });
    return res.status(500).json({ error: 'Failed to generate SSNIT schedule' });
  }
});

export default router;
