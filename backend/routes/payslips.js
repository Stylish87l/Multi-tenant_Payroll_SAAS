import express from 'express';
import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { getLogoBuffer } from '../utils/fetchLogo.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';
import { buildPayslipItemWhere, hasConsistentPayslipTenant } from '../utils/payslipAccess.js';
import { buildPayslipExplanation } from '../services/payslipExplanationService.js';

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
      ssnitNumber: true, bankName: true, bankAccount: true, userId: true,
    },
  },
  payrollRun: {
    select: {
      id: true, month: true, companyId: true, status: true, processedAt: true,
      company: { select: COMPANY_SELECT },
    },
  },
};

const EXPLANATION_SELECT = {
  id: true, grossSalary: true, basicSalarySnapshot: true,
  housingAllowanceSnapshot: true, transportAllowanceSnapshot: true, otherAllowanceSnapshot: true,
  taxableIncome: true, ssnitEmployee: true, ssnitEmployer: true, ssnitTier1: true, ssnitTier2: true,
  payeTax: true, netPay: true, paymentStatus: true, reliefInputsSnapshot: true,
  employee: { select: { companyId: true } },
  payrollRun: { select: { id: true, month: true, companyId: true, status: true, taxConfigSnapshot: true } },
};

const INDIVIDUAL_PAYSLIP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'EMPLOYEE'];
const safeName = (name) => String(name || 'employee').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50) || 'employee';
const money = (value) => Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const templateFor = (company) => company.payslipTemplate && typeof company.payslipTemplate === 'object' ? company.payslipTemplate : {};

export const generatePayslipPDF = (doc, item, logo) => {
  const { employee, payrollRun } = item;
  const company = payrollRun.company;
  const template = templateFor(company);
  const accent = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(company.themeColor || '') ? company.themeColor : '#253B80';
  const displayName = template.companyDisplayName || company.name;
  const alignment = ['left', 'center', 'right'].includes(template.logoAlignment) ? template.logoAlignment : 'left';
  const pageLeft = 48;
  const contentWidth = 499;
  const right = pageLeft + contentWidth;
  const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const maskIdentifier = (value) => {
    const raw = String(value || '').replace(/\s+/g, '');
    return raw ? '*'.repeat(Math.max(4, raw.length - 4)) + raw.slice(-4) : '—';
  };
  const addSection = (title, subtitle = '') => {
    doc.moveDown(0.35);
    const y = doc.y;
    doc.roundedRect(pageLeft, y, contentWidth, 22, 4).fill('#F1F5F9');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155').text(title.toUpperCase(), pageLeft + 10, y + 7, { width: subtitle ? 300 : contentWidth - 20 });
    if (subtitle) doc.font('Helvetica').fontSize(7).fillColor('#64748B').text(subtitle, pageLeft + 310, y + 7, { width: contentWidth - 320, align: 'right' });
    doc.y = y + 30;
  };
  const addMoneyRow = (label, amount, emphasis = false) => {
    const y = doc.y;
    doc.font(emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(emphasis ? '#0F172A' : '#334155').text(label, pageLeft + 10, y, { width: 330 });
    doc.font(emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#0F172A').text(money(amount), pageLeft + 350, y, { width: 139, align: 'right' });
    doc.y = y + 17;
  };
  const addInfoRow = (label, value, x, y, width = 235) => {
    doc.font('Helvetica').fontSize(7).fillColor('#64748B').text(label.toUpperCase(), x, y, { width });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1E293B').text(value || '—', x, y + 11, { width, height: 24, ellipsis: true });
  };

  doc.roundedRect(pageLeft, 42, contentWidth, 7, 3).fill(accent);
  let headerY = 62;
  if (logo) {
    try {
      const logoX = alignment === 'left' ? pageLeft : alignment === 'right' ? right - 92 : pageLeft + (contentWidth - 92) / 2;
      doc.image(logo, logoX, headerY, { fit: [92, 44] });
      headerY += 51;
    } catch (error) {
      logger.warn('Payslip logo could not be rendered', { companyId: company.id, error: error.message });
    }
  }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(accent).text(displayName.toUpperCase(), pageLeft, headerY, { width: contentWidth, align: alignment });
  headerY = doc.y + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748B');
  if (company.address) { doc.text(company.address, pageLeft, headerY, { width: contentWidth, align: alignment }); headerY = doc.y + 1; }
  const contacts = [company.contactEmail, company.contactPhone, company.tin ? 'TIN ' + company.tin : null].filter(Boolean).join('  •  ');
  if (contacts) { doc.text(contacts, pageLeft, headerY, { width: contentWidth, align: alignment }); headerY = doc.y + 1; }
  if (template.tagline) { doc.font('Helvetica-Oblique').text(template.tagline, pageLeft, headerY, { width: contentWidth, align: alignment }); headerY = doc.y + 1; }
  doc.y = Math.max(doc.y, headerY) + 12;

  doc.roundedRect(pageLeft, doc.y, contentWidth, 48, 6).fill('#F8FAFC').stroke('#E2E8F0');
  const titleY = doc.y + 9;
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#0F172A').text('PAYSLIP', pageLeft + 12, titleY);
  doc.font('Helvetica').fontSize(8).fillColor('#64748B').text('PAY PERIOD  ' + String(payrollRun.month).slice(0, 7), pageLeft + 12, titleY + 20);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(payrollRun.status === 'FINALIZED' ? '#047857' : '#B45309').text(payrollRun.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT', pageLeft + 390, titleY + 8, { width: 96, align: 'right' });
  doc.y += 61;

  addSection('Employee details');
  const infoY = doc.y;
  addInfoRow('Employee name', employee.name, pageLeft + 10, infoY);
  addInfoRow('Employee number', employee.id, pageLeft + 260, infoY);
  addInfoRow('Position', employee.position, pageLeft + 10, infoY + 31);
  addInfoRow('Email', employee.email, pageLeft + 260, infoY + 31);
  addInfoRow('SSNIT number', maskIdentifier(employee.ssnitNumber), pageLeft + 10, infoY + 62);
  doc.y = infoY + 88;

  addSection('Earnings', 'AMOUNTS IN GHS');
  const snapshotsAvailable = item.basicSalarySnapshot !== null && item.basicSalarySnapshot !== undefined;
  if (snapshotsAvailable) {
    addMoneyRow('Basic salary', item.basicSalarySnapshot);
    addMoneyRow('Housing allowance', item.housingAllowanceSnapshot);
    addMoneyRow('Transport allowance', item.transportAllowanceSnapshot);
    addMoneyRow('Other allowance', item.otherAllowanceSnapshot);
  } else {
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#64748B').text('Historical earnings breakdown is unavailable for this legacy payroll record.', pageLeft + 10, doc.y);
    doc.moveDown(0.8);
  }
  addMoneyRow('Gross earnings', item.grossSalary, true);

  addSection('Employee deductions', 'SUBTRACTED FROM GROSS PAY');
  addMoneyRow('Employee SSNIT contribution', item.ssnitEmployee);
  addMoneyRow('PAYE income tax', item.payeTax);
  addMoneyRow('Total deductions', Number(item.ssnitEmployee) + Number(item.payeTax), true);

  addSection('Employer contributions', 'PAID BY EMPLOYER');
  addMoneyRow('Employer SSNIT contribution', item.ssnitEmployer);

  doc.moveDown(0.45);
  const netTop = doc.y;
  doc.roundedRect(pageLeft, netTop, contentWidth, 58, 7).fill(accent);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#DBEAFE').text('TAKE-HOME PAY', pageLeft + 14, netTop + 11);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text('GHS ' + money(item.netPay), pageLeft + 14, netTop + 26, { width: contentWidth - 28, align: 'right' });
  doc.y = netTop + 70;

  addSection('Payment information');
  const paymentY = doc.y;
  addInfoRow('Payment status', String(item.paymentStatus || 'PENDING').replaceAll('_', ' '), pageLeft + 10, paymentY);
  addInfoRow('Payment reference', item.paymentRef, pageLeft + 260, paymentY);
  addInfoRow('Bank', employee.bankName, pageLeft + 10, paymentY + 31);
  addInfoRow('Account ending', maskIdentifier(employee.bankAccount), pageLeft + 260, paymentY + 31);
  doc.y = paymentY + 62;
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#64748B').text('Masked bank details reflect the current employee profile, not necessarily the historical payout destination.', pageLeft + 10, doc.y, { width: contentWidth - 20 });
  doc.y += 13;
  doc.font('Helvetica').fontSize(7).fillColor('#64748B').text('Payroll finalized: ' + formatDate(payrollRun.processedAt), pageLeft + 10, doc.y);
  doc.y += 10;

  if (template.showFooter !== false) {
    const footer = company.footerNote || 'This is an electronically generated payslip and does not require a signature.';
    const footerY = Math.min(doc.y + 7, doc.page.height - 54);
    doc.moveTo(pageLeft, footerY).lineTo(right, footerY).strokeColor('#E2E8F0').lineWidth(0.7).stroke();
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#64748B').text(footer, pageLeft + 8, footerY + 8, { width: contentWidth - 16, align: 'center' });
  }
};

const findPayslip = async (req, itemId) => {
  const where = buildPayslipItemWhere({
    userRole: req.userRole, companyId: req.companyId, userId: req.userId,
  }, itemId);
  where.deletedAt = null;
  where.payrollRun = { ...(where.payrollRun || {}), status: 'FINALIZED', deletedAt: null };
  const item = await prisma.payrollItem.findFirst({ where, select: ITEM_SELECT });
  return hasConsistentPayslipTenant(item) ? item : null;
};


// Employee self-service explanation. This endpoint intentionally selects no employee PII.
const noStorePayslipResponse = (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};
router.get('/item/:itemId/explanation', noStorePayslipResponse, rbac(['EMPLOYEE']), async (req, res) => {
  if (req.userRole !== 'EMPLOYEE') return res.status(403).json({ error: 'Employee access only.' });
  try {
    const where = buildPayslipItemWhere({
      userRole: req.userRole, companyId: req.companyId, userId: req.userId,
    }, req.params.itemId);
    where.deletedAt = null;
    where.payrollRun = { ...(where.payrollRun || {}), status: 'FINALIZED', deletedAt: null };
    const item = await prisma.payrollItem.findFirst({ where, select: EXPLANATION_SELECT });
    if (!hasConsistentPayslipTenant(item)) {
      return res.status(404).json({ error: 'Payslip not found or access denied.' });
    }

    const explanation = buildPayslipExplanation(item);
    await writeAuditSafe(prisma, {
      actor: actorFromReq(req),
      companyId: item.payrollRun.companyId,
      action: 'PAYSLIP_EXPLAINED',
      resourceType: 'PayrollItem',
      resourceId: item.id,
      details: { payrollRunId: item.payrollRun.id, period: explanation.period },
    });
    return res.json({ explanation });
  } catch (error) {
    logger.error('Employee payslip explanation failed', {
      userId: req.userId, companyId: req.companyId, message: error.message,
    });
    return res.status(500).json({ error: 'Unable to explain this payslip.' });
  }
});

router.get('/mine', rbac(['EMPLOYEE']), async (req, res) => {
  if (req.userRole !== 'EMPLOYEE') return res.status(403).json({ error: 'Employee access only.' });
  try {
    const items = await prisma.payrollItem.findMany({
      where: {
        employee: { userId: req.userId, companyId: req.companyId },
        deletedAt: null,
        payrollRun: { companyId: req.companyId, status: 'FINALIZED', deletedAt: null },
      },
      select: {
        id: true, netPay: true, paymentStatus: true, paymentRef: true,
        payrollRun: { select: { month: true } },
      },
      orderBy: { payrollRun: { month: 'desc' } },
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ payslips: items.map((item) => ({
      id: item.id, month: item.payrollRun.month, netPay: item.netPay,
      paymentStatus: item.paymentStatus, paymentRef: item.paymentRef,
    })) });
  } catch (error) {
    logger.error('Employee payslip list failed', { userId: req.userId, companyId: req.companyId, message: error.message });
    return res.status(500).json({ error: 'Unable to load payslips.' });
  }
});

// Individual PDF: employees can download only their own finalized payslip.
router.get('/item/:itemId/pdf', rbac(INDIVIDUAL_PAYSLIP_ROLES), async (req, res) => {
  const { itemId } = req.params;
  // RBAC expands hierarchical roles (so HR inherits EMPLOYEE). Payslip access is
  // intentionally limited to these exact roles; HR must not inherit employee self-service.
  if (!INDIVIDUAL_PAYSLIP_ROLES.includes(req.userRole)) {
    return res.status(403).json({ error: 'Access denied: payslip access is not available for this role.' });
  }
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
    const runStatus = await prisma.payrollRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (runStatus?.status !== 'FINALIZED') return res.status(409).json({ error: 'Payslips are available only after payroll is finalized.' });
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
    archive = new ZipArchive({ zlib: { level: 5 } });
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
