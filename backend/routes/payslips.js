import express from 'express';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { getLogoBuffer } from '../utils/fetchLogo.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';

const router = express.Router();
router.use(authMiddleware);

const COMPANY_SELECT = {
  id: true, name: true, address: true, contactEmail: true, contactPhone: true,
  tin: true, logoUrl: true, themeColor: true, footerNote: true, payslipTemplate: true,
};
const ITEM_SELECT = {
  id: true, grossSalary: true, basicSalarySnapshot: true,
  housingAllowanceSnapshot: true, transportAllowanceSnapshot: true, otherAllowanceSnapshot: true,
  taxableIncome: true, ssnitEmployee: true, ssnitEmployer: true, ssnitTier1: true, ssnitTier2: true,
  payeTax: true, netPay: true, paymentStatus: true, paymentRef: true,
  employee: {
    select: {
      id: true, companyId: true, name: true, email: true, position: true,
      ghanaCardPin: true, ssnitNumber: true, userId: true,
    },
  },
  payrollRun: {
    select: {
      id: true, month: true, companyId: true, status: true, processedAt: true,
      company: { select: COMPANY_SELECT },
    },
  },
};

const safeName = (name) => String(name || 'employee').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50) || 'employee';
const money = (value) => Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const templateFor = (company) => company.payslipTemplate && typeof company.payslipTemplate === 'object' ? company.payslipTemplate : {};

const addSection = (doc, title) => {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(title.toUpperCase());
  doc.moveDown(0.35);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
  doc.moveDown(0.35);
};
const addRow = (doc, label, amount, emphasis = false) => {
  const y = doc.y;
  doc.font(emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#1e293b');
  doc.text(label, 50, y, { width: 340 });
  doc.text(money(amount), 405, y, { width: 140, align: 'right' });
  doc.y = y + 17;
};
const addTextRow = (doc, label, value) => {
  const y = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor('#334155').text(label, 50, y, { width: 130 });
  doc.font('Helvetica-Bold').text(value || '—', 185, y, { width: 350 });
  doc.y = y + 16;
};

const generatePayslipPDF = (doc, item, logo) => {
  const { employee, payrollRun } = item;
  const company = payrollRun.company;
  const template = templateFor(company);
  const displayName = template.companyDisplayName || company.name;
  const alignment = ['left', 'center', 'right'].includes(template.logoAlignment) ? template.logoAlignment : 'center';
  const logoX = alignment === 'left' ? 50 : alignment === 'right' ? 445 : (doc.page.width - 100) / 2;

  if (logo) {
    try {
      doc.image(logo, logoX, doc.y, { fit: [100, 48] });
      doc.y += 56;
    } catch (error) {
      logger.warn('Payslip logo could not be rendered', { companyId: company.id, error: error.message });
    }
  }

  doc.font('Helvetica-Bold').fontSize(17).fillColor(company.themeColor || '#172554')
    .text(displayName.toUpperCase(), 48, doc.y, { width: 500, align: alignment });
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
  if (company.address) doc.text(company.address, 48, doc.y, { width: 500, align: alignment });
  const contacts = [company.contactEmail, company.contactPhone, company.tin ? `TIN: ${company.tin}` : null].filter(Boolean).join('  |  ');
  if (contacts) doc.text(contacts, 48, doc.y, { width: 500, align: alignment });
  if (template.tagline) doc.font('Helvetica-Oblique').text(template.tagline, 48, doc.y, { width: 500, align: alignment });

  doc.moveDown(0.8);
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('EMPLOYEE PAYSLIP', { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#64748b')
    .text(`Pay period: ${String(payrollRun.month).slice(0, 7)}${payrollRun.status === 'DRAFT' ? '  •  DRAFT' : ''}`, { align: 'center' });
  doc.moveDown(0.8);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.55);

  addSection(doc, 'Employee information');
  addTextRow(doc, 'Employee name', employee.name);
  addTextRow(doc, 'Employee ID', employee.id);
  addTextRow(doc, 'Position', employee.position);
  addTextRow(doc, 'Email', employee.email);
  addTextRow(doc, 'SSNIT number', employee.ssnitNumber);
  addTextRow(doc, 'Ghana Card PIN', employee.ghanaCardPin);

  addSection(doc, 'Earnings (GHS)');
  const snapshotsAvailable = item.basicSalarySnapshot !== null && item.basicSalarySnapshot !== undefined;
  if (snapshotsAvailable) {
    addRow(doc, 'Basic salary', item.basicSalarySnapshot);
    addRow(doc, 'Housing allowance', item.housingAllowanceSnapshot);
    addRow(doc, 'Transport allowance', item.transportAllowanceSnapshot);
    addRow(doc, 'Other allowance', item.otherAllowanceSnapshot);
  } else {
    // Legacy payroll rows do not contain an immutable allowance breakdown. Never substitute
    // the employee's current salary/allowances for the values used when this run was calculated.
    addRow(doc, 'Gross earnings (historical total; legacy record)', item.grossSalary);
  }
  addRow(doc, 'Gross earnings', item.grossSalary, true);

  addSection(doc, 'Employee deductions (GHS)');
  addRow(doc, 'Employee SSNIT contribution', item.ssnitEmployee);
  addRow(doc, 'PAYE income tax', item.payeTax);
  addRow(doc, 'Total deductions', Number(item.ssnitEmployee) + Number(item.payeTax), true);

  addSection(doc, 'Employer contributions (not deducted from net pay)');
  addRow(doc, 'Employer SSNIT contribution', item.ssnitEmployer);

  doc.moveDown(0.4);
  doc.roundedRect(48, doc.y, 499, 48, 6).fillAndStroke('#eff6ff', '#bfdbfe');
  const netY = doc.y + 10;
  doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10).text('NET PAY', 62, netY);
  doc.fontSize(16).text(`GHS ${money(item.netPay)}`, 300, netY - 2, { width: 232, align: 'right' });
  doc.y += 61;

  addSection(doc, 'Payment information');
  addTextRow(doc, 'Payment status', String(item.paymentStatus || 'PENDING').replaceAll('_', ' '));
  addTextRow(doc, 'Payment reference', item.paymentRef);
  addTextRow(doc, 'Payroll finalized', payrollRun.processedAt ? new Date(payrollRun.processedAt).toLocaleDateString('en-GH') : 'Not finalized');

  if (template.showFooter !== false) {
    const footer = company.footerNote || 'This is an electronically generated payslip and does not require a signature.';
    const footerY = Math.min(doc.y + 12, doc.page.height - 62);
    doc.moveTo(48, footerY).lineTo(547, footerY).strokeColor('#cbd5e1').stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b')
      .text(footer, 48, footerY + 8, { width: 499, align: 'center' });
  }
};

const findPayslip = async (req, itemId) => {
  const where = {
    id: itemId,
    ...(req.userRole === 'SUPER_ADMIN' ? {} : { payrollRun: { companyId: req.companyId } }),
  };
  if (req.userRole === 'EMPLOYEE') {
    where.employee = { userId: req.userId };
    where.payrollRun = { companyId: req.companyId, status: 'FINALIZED' };
  }
  const item = await prisma.payrollItem.findFirst({ where, select: ITEM_SELECT });
  if (!item) return null;
  // Protect against inconsistent legacy relations as well as cross-tenant identifiers.
  if (item.employee.companyId !== item.payrollRun.companyId) return null;
  return item;
};

// Individual PDF: employees can download only their own finalized payslip.
router.get('/item/:itemId/pdf', rbac(['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE']), async (req, res) => {
  const { itemId } = req.params;
  try {
    const item = await findPayslip(req, itemId);
    if (!item) return res.status(404).json({ error: 'Payslip not found or access denied' });

    const logo = await getLogoBuffer(item.payrollRun.company.logoUrl);
    const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${safeName(item.employee.name)}_${safeName(item.payrollRun.month)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    generatePayslipPDF(doc, item, logo);
    doc.end();

    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId: item.payrollRun.companyId,
      action: 'PAYSLIP_EXPORTED', resourceType: 'PayrollItem', resourceId: item.id,
      details: { payrollRunId: item.payrollRun.id, paymentStatus: item.paymentStatus },
    });
    return undefined;
  } catch (error) {
    logger.error('Single Payslip Error', { itemId, role: req.userRole, stack: error.stack });
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate PDF' });
    return res.end();
  }
});

// Bulk PDF export remains tenant-scoped and is limited to one payroll run.
router.get('/bulk/:runId/pdf', rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const { runId } = req.params;
  let archive;
  try {
    const run = await prisma.payrollRun.findFirst({
      where: req.userRole === 'SUPER_ADMIN' ? { id: runId } : { id: runId, companyId: req.companyId },
      select: { id: true, companyId: true },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found or access denied' });
    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: runId },
      select: ITEM_SELECT,
      orderBy: { employee: { name: 'asc' } },
    });
    if (!items.length) return res.status(404).json({ error: 'No records found for this payroll run' });
    if (items.some((item) => item.payrollRun.companyId !== run.companyId || item.employee.companyId !== run.companyId)) {
      logger.error('Cross-tenant relationship mismatch prevented in bulk payslip export', { runId, companyId: run.companyId });
      return res.status(403).json({ error: 'Access denied: tenant mismatch' });
    }

    const logo = await getLogoBuffer(items[0].payrollRun.company.logoUrl);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="bulk_payslips_${safeName(runId)}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => logger.error('Payslip archive error', { runId, message: err.message }));
    archive.pipe(res);

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 48, size: 'A4' });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          archive.append(Buffer.concat(chunks), {
            name: `payslip_${String(index + 1).padStart(3, '0')}_${safeName(item.employee.name)}.pdf`,
          });
          resolve();
        });
        doc.on('error', reject);
        generatePayslipPDF(doc, item, logo);
        doc.end();
      });
    }
    await archive.finalize();
    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId: run.companyId,
      action: 'PAYSLIPS_BULK_EXPORTED', resourceType: 'PayrollRun', resourceId: runId,
      details: { count: items.length },
    });
    return undefined;
  } catch (error) {
    logger.error('Bulk Payslips Error', { runId, role: req.userRole, stack: error.stack });
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate zip archive' });
    archive?.abort();
    return res.end();
  }
});

export default router;
