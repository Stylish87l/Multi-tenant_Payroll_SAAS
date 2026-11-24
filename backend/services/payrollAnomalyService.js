import prisma from '../config/db.js';
import { badInput, notFound } from '../utils/appError.js';
import { explainPayrollFindings } from './aiReviewService.js';

const money = (value) => Number(value || 0);
const configuredThreshold = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const CHANGE_THRESHOLD_PERCENT = configuredThreshold('PAYROLL_REVIEW_CHANGE_PERCENT', 20);
const CHANGE_THRESHOLD_GHS = configuredThreshold('PAYROLL_REVIEW_CHANGE_ABSOLUTE_GHS', 100);
const pctChange = (current, previous) => previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / Math.abs(previous)) * 100;

/**
 * Deterministic review rules. These findings are advisory and never mutate a
 * payroll run, payroll item, tax calculation, employee record or payment.
 */
export const reviewPayrollRun = async ({ companyId, payrollRunId, actor }) => {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId, deletedAt: null },
    include: {
      items: {
        where: { deletedAt: null },
        include: {
          employee: {
            select: { id: true, isActive: true, deletedAt: true, bankName: true, bankCode: true, bankAccount: true },
          },
        },
      },
    },
  });
  if (!run) throw notFound('Payroll run not found for this company.');
  if (!run.items.length) throw badInput('This payroll run has no payroll items to review.');

  const previousRun = await prisma.payrollRun.findFirst({
    where: { companyId, deletedAt: null, status: 'FINALIZED', runType: run.runType, month: { lt: run.month } },
    orderBy: { month: 'desc' },
    include: { items: { where: { deletedAt: null }, select: { employeeId: true, grossSalary: true, netPay: true, payeTax: true, ssnitEmployee: true } } },
  });
  const previousByEmployee = new Map((previousRun?.items || []).map((item) => [item.employeeId, item]));
  const findings = [];
  const add = (finding) => findings.push({ ...finding, employeeId: finding.employeeId || null });

  const taxSnapshot = run.taxConfigSnapshot || {};
  for (const taxType of ['PAYE', 'SSNIT']) {
    if (!taxSnapshot[taxType]) {
      add({
        code: `MISSING_${taxType}_CONFIGURATION`,
        category: 'STATUTORY_CONFIGURATION',
        severity: 'CRITICAL',
        title: `Missing ${taxType} configuration snapshot`,
        description: `This payroll run does not contain a ${taxType} tax configuration snapshot.`,
        evidence: { taxType, payrollRunId: run.id },
        recommendation: 'Stop payroll approval and verify the effective statutory configuration for this payroll period.',
      });
    }
  }

  if (run.runType === 'REGULAR') {
    const activeEmployeeCount = await prisma.employee.count({
      where: { companyId, isActive: true, deletedAt: null, createdAt: { lte: run.createdAt } },
    });
    if (activeEmployeeCount > run.items.length) {
      add({
        code: 'ACTIVE_EMPLOYEES_MISSING_FROM_PAYROLL',
        category: 'EMPLOYEE_COVERAGE',
        severity: 'HIGH',
        title: 'Active employees missing from payroll',
        description: 'The regular payroll run contains fewer employees than the company currently has active employee records.',
        evidence: { activeEmployeeCount, payrollItemCount: run.items.length },
        recommendation: 'Reconcile the active employee roster against this payroll run and confirm any approved exclusions.',
      });
    }
  }

  const bankAccounts = new Map();
  for (const item of run.items) {
    const employee = item.employee;
    if (!employee || employee.deletedAt || !employee.isActive) {
      add({
        code: 'INACTIVE_EMPLOYEE_IN_PAYROLL', category: 'EMPLOYEE_STATUS', severity: 'HIGH',
        employeeId: item.employeeId, title: 'Inactive employee included',
        description: 'A payroll item belongs to an employee currently marked inactive or deleted.',
        evidence: { payrollRunId: run.id }, recommendation: 'Confirm the employee status and remove the item through the approved payroll correction workflow if it is not payable.',
      });
    }
    if (!employee?.bankAccount || !employee?.bankName) {
      add({
        code: 'MISSING_BANK_DETAILS', category: 'PAYMENT_READINESS', severity: 'MEDIUM',
        employeeId: item.employeeId, title: 'Bank details incomplete',
        description: 'The employee is missing a bank account number or bank name.',
        evidence: { hasBankName: Boolean(employee?.bankName), hasBankAccount: Boolean(employee?.bankAccount) },
        recommendation: 'Verify payment instructions with the employee using an approved secure channel before disbursement.',
      });
    } else {
      const key = [employee.bankName, employee.bankCode, String(employee.bankAccount).replace(/\s+/g, '').toLowerCase()].filter(Boolean).join(':').toLowerCase();
      if (!bankAccounts.has(key)) bankAccounts.set(key, []);
      bankAccounts.get(key).push(item.employeeId);
    }

    const previous = previousByEmployee.get(item.employeeId);
    if (previous) {
      for (const field of ['grossSalary', 'netPay']) {
        const before = money(previous[field]);
        const after = money(item[field]);
        const change = pctChange(after, before);
        if (Math.abs(change) >= CHANGE_THRESHOLD_PERCENT && Math.abs(after - before) >= CHANGE_THRESHOLD_GHS) {
          add({
            code: field === 'grossSalary' ? 'GROSS_PAY_CHANGE' : 'NET_PAY_CHANGE',
            category: 'PAY_VARIANCE', severity: Math.abs(change) >= 50 ? 'HIGH' : 'MEDIUM',
            employeeId: item.employeeId, title: `Unusual ${field === 'grossSalary' ? 'gross pay' : 'net pay'} movement`,
            description: `The employee's ${field === 'grossSalary' ? 'gross pay' : 'net pay'} changed by ${change.toFixed(1)}% compared with the previous finalized payroll.`,
            evidence: { previous: before, current: after, percentageChange: Number(change.toFixed(1)), previousRunMonth: previousRun.month },
            recommendation: 'Compare the change with approved salary changes, attendance, allowances and deductions before finalizing payroll.',
          });
        }
      }
    } else if (previousRun) {
      add({
        code: 'NEW_EMPLOYEE_IN_PAYROLL', category: 'EMPLOYEE_STATUS', severity: 'INFO',
        employeeId: item.employeeId, title: 'Employee has no prior finalized payroll',
        description: 'This employee does not appear in the previous finalized payroll run.',
        evidence: { previousRunMonth: previousRun?.month || null },
        recommendation: 'Confirm the employee start date and onboarding approval.',
      });
    }
  }

  for (const employeeIds of bankAccounts.values()) {
    if (employeeIds.length > 1) {
      add({
        code: 'DUPLICATE_BANK_ACCOUNT', category: 'PAYMENT_INTEGRITY', severity: 'HIGH',
        title: 'Bank account shared by multiple employees',
        description: 'More than one employee is configured with the same bank account number.',
        evidence: { affectedEmployeeCount: employeeIds.length, affectedEmployeeIds: employeeIds },
        recommendation: 'Verify whether this is an approved shared account or an incorrect payment instruction. Do not disclose account details in review comments.',
      });
    }
  }

  const priorItems = previousRun?.items || [];
  if (priorItems.length) {
    const totals = (items) => items.reduce((sum, item) => ({
      paye: sum.paye + money(item.payeTax),
      ssnit: sum.ssnit + money(item.ssnitEmployee),
    }), { paye: 0, ssnit: 0 });
    const currentTotals = totals(run.items);
    const priorTotals = totals(priorItems);
    for (const [label, current, previous] of [
      ['PAYE', currentTotals.paye, priorTotals.paye],
      ['employee SSNIT', currentTotals.ssnit, priorTotals.ssnit],
    ]) {
      const change = pctChange(current, previous);
      if (Math.abs(change) >= CHANGE_THRESHOLD_PERCENT && Math.abs(current - previous) >= CHANGE_THRESHOLD_GHS) {
        add({
          code: `STATUTORY_DEDUCTION_VARIANCE_${label === 'PAYE' ? 'PAYE' : 'SSNIT'}`,
          category: 'STATUTORY_DEDUCTIONS', severity: 'MEDIUM',
          title: `Unusual ${label} total movement`,
          description: `The total ${label} deduction changed by ${change.toFixed(1)}% compared with the previous finalized payroll.`,
          evidence: { previous: previous, current, percentageChange: Number(change.toFixed(1)), previousRunMonth: previousRun.month },
          recommendation: 'Reconcile employee-level taxable pay, contribution inputs and the effective tax configuration for both periods.',
        });
      }
    }
  }

  const ai = await explainPayrollFindings(findings);
  const explanationByCode = new Map(ai.explanations.map((item) => [item.code, item.explanation.slice(0, 2000)]));
  const created = await prisma.$transaction(async (tx) => {
    const review = await tx.payrollReview.create({
      data: {
        companyId, payrollRunId, requestedById: actor?.userId || null,
        status: 'COMPLETED', summary: ai.summary,
        provider: ai.provider, model: ai.model,
        findings: {
          create: findings.map((finding) => ({
            companyId, employeeId: finding.employeeId, code: finding.code,
            category: finding.category, severity: finding.severity, title: finding.title,
            description: finding.description, evidence: finding.evidence,
            recommendation: finding.recommendation,
            aiExplanation: explanationByCode.get(finding.code) || null,
          })),
        },
      },
      include: { findings: { orderBy: { createdAt: 'asc' } } },
    });
    const { writeAudit } = await import('./auditService.js');
    await writeAudit(tx, {
      actor, companyId, action: 'PAYROLL_REVIEW_CREATED',
      resourceType: 'PayrollReview', resourceId: review.id,
      details: { payrollRunId, findingCount: findings.length, aiProvider: ai.provider },
    });
    return review;
  });
  const severityRank = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
  created.findings.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || a.createdAt - b.createdAt);
  return created;
};
