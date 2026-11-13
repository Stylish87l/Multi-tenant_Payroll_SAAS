import logger from '../config/logger.js';
import { trace } from '@opentelemetry/api';
import { loadTaxConfig } from './taxConfig.js';

// Built-in fallback only. Real rates live in the TaxConfig table (see prisma/seed.js).
const DEFAULT_CONFIG = {
  maxEarnings: BigInt(69000),
  employeeRate: 5.5, // %
  employerRate: 13,  // %
  tier1Rate: 13.5,   // %
  tier2Rate: 5,      // %
  minContributionBase: BigInt(490),
};

const toBigInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? BigInt(Math.round(n)) : fallback;
};

/**
 * Calculates statutory SSNIT deductions and remittances.
 * Uses BigInt for base calculations to avoid floating point errors.
 * Works in pesewas (multiply by 100) to handle decimals safely.
 *
 * @param {number} year payroll year; selects the TaxConfig row (defaults to the current year)
 */
export const calculateSSNIT = async (
  basicSalary,
  allowances = 0,
  companyId = null,
  year = new Date().getUTCFullYear()
) => {
  const tracer = trace.getTracer('payroll-service');
  return await tracer.startActiveSpan('calculateSSNIT', async (span) => {
    try {
      // 1. Config Loading (tenant-specific overrides win over global; see utils/taxConfig.js)
      const stored = await loadTaxConfig({ type: 'SSNIT', companyId, year });
      if (!stored) {
        throw new Error(`SSNIT configuration for ${year} is missing. Payroll is blocked until an approved statutory configuration is installed.`);
      }
      const required = ['maxEarnings', 'minContributionBase', 'employeeRate', 'employerRate', 'tier1Rate', 'tier2Rate'];
      const missing = required.filter((key) => stored[key] === undefined || stored[key] === null);
      if (missing.length) {
        throw new Error(`SSNIT configuration for ${year} is incomplete: ${missing.join(', ')}.`);
      }
      const config = {
        ...stored,
        maxEarnings: toBigInt(stored.maxEarnings, DEFAULT_CONFIG.maxEarnings),
        minContributionBase: toBigInt(stored.minContributionBase, DEFAULT_CONFIG.minContributionBase),
      };

      // 2. Base Calculation in pesewas
      const salaryInPesewas = BigInt(Math.round((Number(basicSalary) + Number(allowances)) * 100));
      const maxInPesewas = config.maxEarnings * 100n;
      const minInPesewas = config.minContributionBase * 100n;

      let effectiveBase = salaryInPesewas;
      if (effectiveBase > maxInPesewas) effectiveBase = maxInPesewas;
      if (effectiveBase < minInPesewas) effectiveBase = minInPesewas;

      // 3. Deduction Logic
      const calcRate = (base, rate) =>
        // Multiply by rate*100 to preserve precision, then divide by 10000n
        Number((base * BigInt(Math.round(rate * 100))) / 10000n) / 100;

      const employeeDeduction = calcRate(effectiveBase, config.employeeRate);
      const employerContribution = calcRate(effectiveBase, config.employerRate);
      const remittance = {
        tier1: calcRate(effectiveBase, config.tier1Rate),
        tier2: calcRate(effectiveBase, config.tier2Rate),
      };
      const total = Number((employeeDeduction + employerContribution).toFixed(2));

      // 4. Trace
      span.setAttributes({
        'payroll.gross': Number(salaryInPesewas) / 100,
        'payroll.employee_deduction': employeeDeduction,
        'payroll.employer_contribution': employerContribution,
        'payroll.total_contribution': total,
      });

      return { employeeDeduction, employerContribution, total, remittance };
    } catch (error) {
      logger.error('SSNIT Calculation Critical Failure', { error: error.message, companyId, stack: error.stack });
      throw error;
    } finally {
      span.end();
    }
  });
};
