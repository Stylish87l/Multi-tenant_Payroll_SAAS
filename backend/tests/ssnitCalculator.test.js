import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const findFirst = jest.fn();
jest.unstable_mockModule('../utils/taxConfig.js', () => ({
  loadTaxConfig: jest.fn().mockResolvedValue({
    maxEarnings: 69000,
    minContributionBase: 587.8,
    employeeRate: 5.5,
    employerRate: 13,
    tier1Rate: 13.5,
    tier2Rate: 5,
  }),
}));

const { calculateSSNIT } = await import('../utils/ssnitCalculator.js');
const { loadTaxConfig } = await import('../utils/taxConfig.js');

describe('calculateSSNIT', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calculates contributions from basic salary only, excluding allowances', async () => {
    const result = await calculateSSNIT(1000, 900, 'company-1', 2026, '2026-09-01');

    expect(result.employeeDeduction).toBe(55);
    expect(result.employerContribution).toBe(130);
    expect(result.remittance.tier1).toBe(135);
    expect(result.remittance.tier2).toBe(50);
    expect(loadTaxConfig).toHaveBeenCalledWith({
      type: 'SSNIT',
      companyId: 'company-1',
      year: 2026,
      effectiveAt: '2026-09-01',
    });
  });

  test('applies the published minimum insurable earnings floor', async () => {
    const result = await calculateSSNIT(100, 0, null, 2026, '2026-01-01');

    expect(result.employeeDeduction).toBe(32.32);
    expect(result.employerContribution).toBe(76.41);
  });
});
