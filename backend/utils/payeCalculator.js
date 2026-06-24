import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { trace } from '@opentelemetry/api';

// Default 2026 GRA Monthly Tax Bands
const DEFAULT_BANDS = [
  { limit: 490, rate: 0.00 },
  { limit: 110, rate: 0.05 },
  { limit: 130, rate: 0.10 },
  { limit: 3167, rate: 0.175 },
  { limit: 16000, rate: 0.25 },
  { limit: 30520, rate: 0.30 },
  { limit: null, rate: 0.35 }, // null represents 'over'
];

const DEFAULT_RELIEFS = {
  marriage: 1200,       // Annual
  child: 600,           // Annual (Max 3)
  oldAge: 1500,         // Annual (60+)
  agedDependent: 1000,  // Annual (Max 2)
  disabilityRate: 0.25  // 25% of Assessable Income
};

/**
 * Modern PAYE Calculator (2026 Ghana Rules)
 */
export const calculatePAYE = async (
  assessableIncome,
  employeeData = {},
  companyId = null,
  bonus = 0,
  ytdBonus = 0
) => {
  const tracer = trace.getTracer('payroll-service');
  return await tracer.startActiveSpan('calculatePAYE', async (span) => {
    try {
      // 1. Fetch Tax Configuration (Tenant-specific overrides prioritized)
      let bands = DEFAULT_BANDS;
      let reliefs = DEFAULT_RELIEFS;

      const dbConfig = await prisma.taxConfig.findFirst({
        where: { type: 'PAYE', year: 2026, OR: [{ companyId }, { companyId: null }] },
        orderBy: { companyId: 'desc' },
      });

      if (dbConfig?.config) {
        const parsed = typeof dbConfig.config === 'string' ? JSON.parse(dbConfig.config) : dbConfig.config;
        bands = parsed.bands || DEFAULT_BANDS;
        reliefs = parsed.reliefs || DEFAULT_RELIEFS;
      }

      // 2. Calculate Reliefs (Annualized → Monthly)
      let annualRelief = 0;
      if (employeeData.isMarried || employeeData.hasResponsibility) annualRelief += reliefs.marriage;

      const children = Math.min(employeeData.childrenCount || 0, 3);
      annualRelief += children * reliefs.child;

      if (employeeData.age >= 60) annualRelief += reliefs.oldAge;

      const dependents = Math.min(employeeData.agedDependentsCount || 0, 2);
      annualRelief += dependents * reliefs.agedDependent;

      let monthlyRelief = annualRelief / 12;

      // Disability Relief: 25% of Assessable Income
      if (employeeData.isDisabled) {
        monthlyRelief += assessableIncome * reliefs.disabilityRate;
      }

      // 3. Bonus Tax Logic (GRA 15% Rule)
      let bonusTax = 0;
      let excessBonusToTaxable = 0;
      if (bonus > 0) {
        const annualBasicEstimate = assessableIncome * 12;
        const bonusThreshold = annualBasicEstimate * 0.15;

        if (ytdBonus + bonus <= bonusThreshold) {
          bonusTax = bonus * 0.05; // Final tax on qualifying bonus
        } else {
          const qualifyingPart = Math.max(0, bonusThreshold - ytdBonus);
          const excessPart = bonus - qualifyingPart;
          bonusTax = qualifyingPart * 0.05;
          excessBonusToTaxable = excessPart; // Excess added to normal income
        }
      }

      // 4. Calculate Taxable Income
      const taxableIncome = Math.max(0, assessableIncome + excessBonusToTaxable - monthlyRelief);

      // 5. Graduated Band Calculation (BigInt Precision in pesewas)
      let remainingToTax = BigInt(Math.round(taxableIncome * 100));
      let totalPayePesewas = 0n;

      for (const band of bands) {
        if (remainingToTax <= 0n) break;

        let taxableInThisBand;
        if (band.limit === null) {
          taxableInThisBand = remainingToTax;
        } else {
          const bandLimitPesewas = BigInt(Math.round(band.limit * 100));
          taxableInThisBand = remainingToTax > bandLimitPesewas ? bandLimitPesewas : remainingToTax;
        }

        const rateScaled = BigInt(Math.round(band.rate * 1000));
        totalPayePesewas += (taxableInThisBand * rateScaled) / 1000n;

        if (band.limit !== null) {
          remainingToTax -= BigInt(Math.round(band.limit * 100));
        }
      }

      const monthlyPAYE = Number(totalPayePesewas) / 100;
      const finalTax = Number((monthlyPAYE + bonusTax).toFixed(2));

      // 6. Telemetry
      span.setAttributes({
        "tax.chargeable": taxableIncome,
        "tax.paye": monthlyPAYE,
        "tax.bonus": bonusTax,
        "tax.total": finalTax,
      });

      return {
        assessableIncome,
        monthlyRelief,
        taxableIncome,
        payeTax: monthlyPAYE,
        bonusTax,
        totalTax: finalTax,
      };

    } catch (error) {
      logger.error('PAYE Calc Error', { companyId, stack: error.stack });
      throw error;
    } finally {
      span.end();
    }
  });
};
