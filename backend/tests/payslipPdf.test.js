import { jest, describe, test, expect } from '@jest/globals';
import PDFDocument from 'pdfkit';

jest.unstable_mockModule('../config/db.js', () => ({ default: {} }));
jest.unstable_mockModule('../middleware/auth.js', () => ({ default: (_req, _res, next) => next() }));
jest.unstable_mockModule('../middleware/rbac.js', () => ({ default: () => (_req, _res, next) => next() }));
jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../utils/fetchLogo.js', () => ({ getLogoBuffer: jest.fn().mockResolvedValue(null) }));
jest.unstable_mockModule('../services/auditService.js', () => ({
  writeAuditSafe: jest.fn().mockResolvedValue(undefined),
  actorFromReq: jest.fn().mockReturnValue({ userId: 'test-user' }),
}));

const { generatePayslipPDF } = await import('../routes/payslips.js');

const extractPdfText = (pdf) => {
  const source = pdf.toString('latin1');
  const stream = source.match(/stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream/);
  if (!stream) return '';
  return [...stream[1].matchAll(/<([0-9a-f]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
    .join('')
    .replace(/\\s+/g, '')
    .toLowerCase();
};

const render = async (item) => {
  const doc = new PDFDocument({ margin: 48, size: 'A4', compress: false });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  generatePayslipPDF(doc, item, null);
  doc.end();
  return done;
};

const fixture = {
  grossSalary: 9700, basicSalarySnapshot: 8000, housingAllowanceSnapshot: 1000,
  transportAllowanceSnapshot: 500, otherAllowanceSnapshot: 200,
  ssnitEmployee: 550, ssnitEmployer: 1300, ssnitTier1: 1350, ssnitTier2: 500,
  payeTax: 1200, netPay: 7950, paymentStatus: 'PAID', paymentRef: 'PAY-123',
  employee: {
    id: 'employee-1', name: 'Test Employee', email: 'employee@example.test',
    position: 'Accountant', companyId: 'tenant-1', userId: 'user-1',
    ghanaCardPin: null, ssnitNumber: 'SSNIT-1',
  },
  payrollRun: {
    id: 'run-1', month: '2026-10-01', companyId: 'tenant-1',
    status: 'FINALIZED', processedAt: new Date('2026-10-31T12:00:00Z'),
    company: {
      id: 'tenant-1', name: 'Example Ltd', address: 'Accra, Ghana',
      contactEmail: 'payroll@example.test', contactPhone: '+233 20 000 0000',
      tin: null, logoUrl: null, themeColor: '#123456', footerNote: 'Confidential',
      payslipTemplate: { companyDisplayName: 'Example Group', logoAlignment: 'left', showFooter: true },
    },
  },
};

describe('employee payslip PDF', () => {
  test('renders a valid PDF from immutable payroll earnings and tenant branding', async () => {
    const pdf = await render(fixture);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    const content = extractPdfText(pdf);
    for (const label of [
      'EXAMPLE GROUP', 'EMPLOYEE PAYSLIP', 'Basic salary', 'Gross earnings',
      'Employee SSNIT contribution', 'PAYE income tax', 'Employer SSNIT contribution',
      'NET PAY', 'Payment reference', 'PAY-123',
    ]) {
      expect(content).toContain(label.replace(/\\s/g, '').toLowerCase());
    }
  });

  test('renders legacy payroll records without reading current employee salary fields', async () => {
    const legacy = {
      ...fixture,
      basicSalarySnapshot: null,
      housingAllowanceSnapshot: null,
      transportAllowanceSnapshot: null,
      otherAllowanceSnapshot: null,
    };
    const pdf = await render(legacy);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(extractPdfText(pdf)).toContain('Historical earnings split is unavailable for this legacy payroll record.'.replace(/\\s/g, '').toLowerCase());
  });
});
