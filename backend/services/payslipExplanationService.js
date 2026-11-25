const money = (value) => Number(value ?? 0).toFixed(2);

const hasEarningsSnapshot = (item) => item.basicSalarySnapshot !== null
  && item.basicSalarySnapshot !== undefined
  && item.housingAllowanceSnapshot !== null
  && item.housingAllowanceSnapshot !== undefined
  && item.transportAllowanceSnapshot !== null
  && item.transportAllowanceSnapshot !== undefined
  && item.otherAllowanceSnapshot !== null
  && item.otherAllowanceSnapshot !== undefined;

/**
 * Explain only immutable amounts saved on a finalized payroll item.
 * This module deliberately does not calculate PAYE/SSNIT or consult current tax settings.
 */
export const buildPayslipExplanation = (item) => {
  if (!item || item.payrollRun?.status !== 'FINALIZED') {
    throw new Error('A finalized payslip is required for an explanation.');
  }

  const period = String(item.payrollRun.month || '').slice(0, 7);
  const taxSnapshot = item.payrollRun.taxConfigSnapshot;
  const historicalTaxAvailable = Boolean(taxSnapshot?.PAYE && taxSnapshot?.SSNIT);
  const earningsAvailable = hasEarningsSnapshot(item);
  const employeeSsnit = money(item.ssnitEmployee);
  const paye = money(item.payeTax);
  const gross = money(item.grossSalary);
  const net = money(item.netPay);
  const totalDeductions = money(Number(item.ssnitEmployee || 0) + Number(item.payeTax || 0));

  const earnings = earningsAvailable ? [
    { label: 'Basic salary', amountGhs: money(item.basicSalarySnapshot) },
    { label: 'Housing allowance', amountGhs: money(item.housingAllowanceSnapshot) },
    { label: 'Transport allowance', amountGhs: money(item.transportAllowanceSnapshot) },
    { label: 'Other allowance', amountGhs: money(item.otherAllowanceSnapshot) },
  ] : null;

  const notes = [
    'This explanation uses the amounts and payroll snapshots saved when this payroll was finalized. It does not recalculate statutory deductions or use today’s tax settings.',
    'Employer SSNIT is paid by the company separately; it is not deducted from your take-home pay.',
  ];

  if (!earningsAvailable) {
    notes.push('The historical allowance breakdown was not saved for this older payroll record. It cannot safely be reconstructed from your current employee profile.');
  }
  if (!historicalTaxAvailable) {
    notes.push('The historical tax-configuration snapshot is unavailable for this payroll record. Current tax settings have not been substituted.');
  }
  if (!item.reliefInputsSnapshot) {
    notes.push('The personal tax-relief input snapshot is unavailable, so this explanation cannot identify which relief inputs were applied at the time.');
  }

  const paymentStatus = item.paymentStatus || 'PENDING';
  if (paymentStatus === 'PAID') notes.push('The payroll record marks this payment as paid.');
  else if (paymentStatus === 'SENT') notes.push('The payment has been sent according to the payroll record; check with your employer or bank if it has not arrived.');
  else if (paymentStatus === 'FAILED') notes.push('The payment is marked as failed. Contact your payroll administrator for follow-up.');
  else notes.push('The payroll record does not yet mark this payment as paid.');

  return {
    period,
    grossPayGhs: gross,
    earnings,
    employeeDeductions: [
      { label: 'Employee SSNIT contribution', amountGhs: employeeSsnit },
      { label: 'PAYE income tax', amountGhs: paye },
    ],
    totalEmployeeDeductionsGhs: totalDeductions,
    taxableIncomeGhs: money(item.taxableIncome),
    employerContributions: [
      { label: 'Employer SSNIT contribution', amountGhs: money(item.ssnitEmployer) },
      { label: 'SSNIT Tier 1 remittance', amountGhs: money(item.ssnitTier1) },
      { label: 'SSNIT Tier 2 remittance', amountGhs: money(item.ssnitTier2) },
    ],
    netPayGhs: net,
    paymentStatus,
    taxContext: {
      historicalSnapshotAvailable: historicalTaxAvailable,
      taxYear: Number.isInteger(taxSnapshot?.year) ? taxSnapshot.year : null,
      effectiveAt: typeof taxSnapshot?.effectiveAt === 'string' ? taxSnapshot.effectiveAt : null,
      reliefInputsSnapshotAvailable: Boolean(item.reliefInputsSnapshot),
    },
    notes,
  };
};
