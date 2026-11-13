import prisma from '../config/db.js';

/**
 * Tax config loader shared by the SSNIT and PAYE calculators.
 *
 * FIXED (critical): the calculators used `orderBy: { companyId: 'desc' }` to
 * "prefer the company-specific config". In PostgreSQL, DESC sorts NULLs FIRST,
 * so the GLOBAL row always won and tenant overrides were never applied.
 * `nulls: 'last'` makes company-specific rows win as intended.
 *
 * Also: the year was hard-coded to 2026, so from 2027 the DB config was never
 * found. We require configuration for the exact payroll year
 * (exact year first, then company-specific within that year).
 *
 * A 60s in-memory cache removes two DB round-trips per employee per payroll run.
 */
const TTL_MS = 60_000;
const cache = new Map();

export const invalidateTaxConfigCache = () => cache.clear();

export const loadTaxConfig = async ({ type, companyId = null, year }) => {
  const key = `${type}:${year}:${companyId ?? 'global'}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const row = await prisma.taxConfig.findFirst({
    where: { type, year, OR: [{ companyId: companyId ?? null }, { companyId: null }] },
    orderBy: [{ year: 'desc' }, { companyId: { sort: 'desc', nulls: 'last' } }],
  });

  let value = null;
  if (row?.config) {
    const parsed = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    value = { ...parsed, __year: row.year, __scope: row.companyId ? 'company' : 'global' };
  }
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
};
