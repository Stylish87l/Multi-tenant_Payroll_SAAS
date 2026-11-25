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
  const historicalTaxAvailable = Boolean(
    Array.isArray(taxSnapshot?.PAYE?.bands) && taxSnapshot.PAYE.bands.length > 0
    && taxSnapshot.PAYE.reliefs && typeof taxSnapshot.PAYE.reliefs === 'object'
    && ['maxEarnings', 'minContributionBase', 'employeeRate', 'employerRate', 'tier1Rate', 'tier2Rate']
      .every((key) => Number.isFinite(Number(taxSnapshot?.SSNIT?.[key]))),
  );
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
    'The saved SSNIT calculation uses basic salary as its contribution base; allowances are not part of that base.',
    'Employer SSNIT is paid by the company separately; it is not deducted from your take-home pay.',
    'Tier 1 and Tier 2 are the SSNIT remittance split recorded for this payroll. They are shown separately from the employee deduction and employer contribution, not added as extra deductions from your pay.',
    'PAYE is the income-tax amount recorded by payroll. The saved taxable-income, relief-input and historical tax-configuration snapshots provide context; this explanation does not recalculate the tax bands or relief amount.',
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

  const reliefInputs = item.reliefInputsSnapshot ? {
    familyReliefInput: Boolean(item.reliefInputsSnapshot.isMarried || item.reliefInputsSnapshot.hasResponsibility),
    childrenCount: Number(item.reliefInputsSnapshot.childrenCount || 0),
    disabilityReliefInput: Boolean(item.reliefInputsSnapshot.isDisabled),
    oldAgeReliefEligible: Number(item.reliefInputsSnapshot.age || 0) >= 60,
    agedDependentsCount: Number(item.reliefInputsSnapshot.agedDependentsCount || 0),
  } : null;

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
    ],
    ssnitRemittances: [
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
      reliefInputs,
    },
    notes,
  };
};
