import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const findFirst = jest.fn();
jest.unstable_mockModule('../config/db.js', () => ({
  default: { taxConfig: { findFirst } },
}));

const { loadTaxConfig, invalidateTaxConfigCache } = await import('../utils/taxConfig.js');

describe('loadTaxConfig', () => {
  beforeEach(() => {
    findFirst.mockReset();
    invalidateTaxConfigCache();
  });

  test('prefers a tenant configuration and filters by the payroll effective date', async () => {
    const row = {
      companyId: 'tenant-1',
      year: 2026,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      config: { bands: [{ limit: 588, rate: 0 }] },
    };
    findFirst.mockResolvedValueOnce(row);

    const result = await loadTaxConfig({
      type: 'PAYE',
      companyId: 'tenant-1',
      year: 2026,
      effectiveAt: '2026-09-01',
    });

    expect(result.bands).toEqual(row.config.bands);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      type: 'PAYE',
      year: 2026,
      effectiveFrom: { lte: new Date('2026-09-01T00:00:00.000Z') },
      companyId: 'tenant-1',
    });
  });

  test('falls back to global configuration for the same year and effective date', async () => {
    const globalRow = {
      companyId: null,
      year: 2026,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      config: { employeeRate: 5.5 },
    };
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(globalRow);

    const result = await loadTaxConfig({
      type: 'SSNIT',
      companyId: 'tenant-1',
      year: 2026,
      effectiveAt: '2026-01-01',
    });

    expect(result.employeeRate).toBe(5.5);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[1][0].where.companyId).toBeNull();
  });
});
