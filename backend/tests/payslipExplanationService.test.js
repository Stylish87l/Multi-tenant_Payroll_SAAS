import { describe, expect, it } from '@jest/globals';
import { buildPayslipExplanation } from '../services/payslipExplanationService.js';

const finalizedItem = {
  grossSalary: 9700,
  basicSalarySnapshot: 8000,
  housingAllowanceSnapshot: 1000,
  transportAllowanceSnapshot: 500,
  otherAllowanceSnapshot: 200,
  taxableIncome: 8150,
  ssnitEmployee: 550,
  ssnitEmployer: 1300,
  ssnitTier1: 1350,
  ssnitTier2: 500,
  payeTax: 1200,
  netPay: 7950,
  paymentStatus: 'PAID',
  reliefInputsSnapshot: { isMarried: false, childrenCount: 0 },
  payrollRun: {
    month: '2026-10-01',
    status: 'FINALIZED',
    taxConfigSnapshot: {
      year: 2026,
      effectiveAt: '2026-10-01',
      PAYE: { bands: [{ limit: 500, rate: 0.05 }], reliefs: {} },
      SSNIT: { employeeRate: 0.055, employerRate: 0.13 },
    },
  },
};

describe('deterministic employee payslip explanation', () => {
  it('explains the saved payroll amounts and keeps employer SSNIT separate', () => {
    const result = buildPayslipExplanation(finalizedItem);
    expect(result.period).toBe('2026-10');
    expect(result.earnings).toEqual([
      { label: 'Basic salary', amountGhs: '8000.00' },
      { label: 'Housing allowance', amountGhs: '1000.00' },
      { label: 'Transport allowance', amountGhs: '500.00' },
      { label: 'Other allowance', amountGhs: '200.00' },
    ]);
    expect(result.employeeDeductions).toEqual([
      { label: 'Employee SSNIT contribution', amountGhs: '550.00' },
      { label: 'PAYE income tax', amountGhs: '1200.00' },
    ]);
    expect(result.totalEmployeeDeductionsGhs).toBe('1750.00');
    expect(result.employerContributions).toEqual([
      { label: 'Employer SSNIT contribution', amountGhs: '1300.00' },
    ]);
    expect(result.ssnitRemittances).toEqual([
      { label: 'SSNIT Tier 1 remittance', amountGhs: '1350.00' },
      { label: 'SSNIT Tier 2 remittance', amountGhs: '500.00' },
    ]);
    expect(result.notes.join(' ')).toContain('remittance split');
    expect(result.netPayGhs).toBe('7950.00');
    expect(result.taxContext).toEqual({
      historicalSnapshotAvailable: true,
      taxYear: 2026,
      effectiveAt: '2026-10-01',
      reliefInputsSnapshotAvailable: true,
    });
    expect(result.taxContext.reliefInputs).toEqual({
      familyReliefInput: false,
      childrenCount: 0,
      disabilityReliefInput: false,
      oldAgeReliefEligible: false,
      agedDependentsCount: 0,
    });
    expect(result.notes.join(' ')).toContain('does not recalculate statutory deductions');
    expect(JSON.stringify(result)).not.toContain('employeeId');
    expect(JSON.stringify(result)).not.toContain('companyId');
  });

  it('does not call an incomplete historical tax snapshot available', () => {
    const legacy = {
      ...finalizedItem,
      payrollRun: {
        ...finalizedItem.payrollRun,
        taxConfigSnapshot: { year: 2026, PAYE: { bands: [] }, SSNIT: {} },
      },
    };
    const result = buildPayslipExplanation(legacy);
    expect(result.taxContext.historicalSnapshotAvailable).toBe(false);
  });

  it('does not reconstruct missing historical snapshots from current profile data', () => {
    const legacy = {
      ...finalizedItem,
      basicSalarySnapshot: null,
      housingAllowanceSnapshot: null,
      transportAllowanceSnapshot: null,
      otherAllowanceSnapshot: null,
      reliefInputsSnapshot: null,
      payrollRun: { ...finalizedItem.payrollRun, taxConfigSnapshot: null },
    };
    const result = buildPayslipExplanation(legacy);
    expect(result.earnings).toBeNull();
    expect(result.taxContext.historicalSnapshotAvailable).toBe(false);
    expect(result.taxContext.reliefInputsSnapshotAvailable).toBe(false);
    expect(result.taxContext.reliefInputs).toBeNull();
    expect(result.notes.join(' ')).toContain('cannot safely be reconstructed');
    expect(result.notes.join(' ')).toContain('Current tax settings have not been substituted');
  });

  it('refuses to explain draft or missing payroll items', () => {
    expect(() => buildPayslipExplanation({
      ...finalizedItem,
      payrollRun: { ...finalizedItem.payrollRun, status: 'DRAFT' },
    })).toThrow('A finalized payslip is required');
    expect(() => buildPayslipExplanation(null)).toThrow('A finalized payslip is required');
  });
});
