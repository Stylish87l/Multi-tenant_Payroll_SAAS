import prisma from '../config/db.js'; 
import logger from '../config/logger.js';
import { trace } from '@opentelemetry/api';

// Default 2026 Config (Updated for the GHS 69,000 cap)
const DEFAULT_CONFIG = {
  maxEarnings: BigInt(69000), 
  employeeRate: 5.5, // %
  employerRate: 13,  // %
  tier1Rate: 13.5,   // %
  tier2Rate: 5,      // %
  minContributionBase: BigInt(490), // Based on 2026 min wage floor
};

/**
 * Calculates statutory SSNIT deductions and remittances.
 * Uses BigInt for base calculations to avoid floating point errors.
 * Works in pesewas (multiply by 100) to handle decimals safely.
 */
export const calculateSSNIT = async (basicSalary, allowances = 0, companyId = null) => {
  const tracer = trace.getTracer('payroll-service');
  return await tracer.startActiveSpan('calculateSSNIT', async (span) => {
    try {
      // 1. Config Loading (Tenant-specific overrides prioritized)
      let config = DEFAULT_CONFIG;
      const dbConfig = await prisma.taxConfig.findFirst({
        where: { 
          type: 'SSNIT', 
          year: 2026, 
          OR: [{ companyId }, { companyId: null }] 
        },
        orderBy: { companyId: 'desc' }, // Prefer company-specific config
      });

      if (dbConfig?.config) {
        const parsed = typeof dbConfig.config === 'string' ? JSON.parse(dbConfig.config) : dbConfig.config;
        config = {
          ...DEFAULT_CONFIG,
          ...parsed,
          maxEarnings: BigInt(parsed.maxEarnings || DEFAULT_CONFIG.maxEarnings),
          minContributionBase: BigInt(parsed.minContributionBase || DEFAULT_CONFIG.minContributionBase),
        };
      }

      // 2. Base Calculation in pesewas
      const salaryInPesewas = BigInt(Math.round((Number(basicSalary) + Number(allowances)) * 100));
      const maxInPesewas = config.maxEarnings * 100n;
      const minInPesewas = config.minContributionBase * 100n;

      // Cap and Floor logic
      let effectiveBase = salaryInPesewas;
      if (effectiveBase > maxInPesewas) effectiveBase = maxInPesewas;
      if (effectiveBase < minInPesewas) effectiveBase = minInPesewas;

      // 3. Deduction Logic
      const calcRate = (base, rate) => {
        // Multiply by rate*100 to preserve precision, then divide by 10000n
        return Number((base * BigInt(Math.round(rate * 100))) / 10000n) / 100;
      };

      const employeeDeduction = calcRate(effectiveBase, config.employeeRate);
      const employerContribution = calcRate(effectiveBase, config.employerRate);
      
      const remittance = {
        tier1: calcRate(effectiveBase, config.tier1Rate),
        tier2: calcRate(effectiveBase, config.tier2Rate),
      };

      const total = Number((employeeDeduction + employerContribution).toFixed(2));

      // 4. Trace & Log
      span.setAttributes({
        "payroll.gross": Number(salaryInPesewas) / 100,
        "payroll.employee_deduction": employeeDeduction,
        "payroll.employer_contribution": employerContribution,
        "payroll.total_contribution": total,
      });

      return { 
        employeeDeduction, 
        employerContribution, 
        total, 
        remittance 
      };

    } catch (error) {
      logger.error('SSNIT Calculation Critical Failure', { 
        error: error.message, 
        companyId,
        stack: error.stack 
      });
      throw error;
    } finally {
      span.end();
    }
  });
};
