import logger from '../config/logger.js';
import { trace } from '@opentelemetry/api';
import { loadTaxConfig } from './taxConfig.js';

// Bracket WIDTHS (not cumulative thresholds). Built-in fallback only - real bands live in TaxConfig.
const DEFAULT_BANDS = [
  { limit: 490, rate: 0.00 },
  { limit: 110, rate: 0.05 },
  { limit: 130, rate: 0.10 },
  { limit: 3170, rate: 0.175 },
  { limit: 12100, rate: 0.25 },
  { limit: 14520, rate: 0.30 },
  { limit: null, rate: 0.35 },
];

const DEFAULT_RELIEFS = {
  marriage: 1200,
  child: 600,
  oldAge: 1500,
  agedDependent: 1000,
  disabilityRate: 0.25,
};

/**
 * PAYE Calculator (Ghana)
 * @param {number} year payroll year; selects the TaxConfig row (defaults to the current year)
 */
export const calculatePAYE = async (
  assessableIncome,
  employeeData = {},
  companyId = null,
  bonus = 0,
  ytdBonus = 0,
  basicSalary = null,
  year = new Date().getUTCFullYear()
) => {
  const tracer = trace.getTracer('payroll-service');
  return await tracer.startActiveSpan('calculatePAYE', async (span) => {
    try {
      // 1. Tax configuration (tenant override > global; see utils/taxConfig.js)
      const stored = await loadTaxConfig({ type: 'PAYE', companyId, year });
      if (!stored || !Array.isArray(stored.bands) || stored.bands.length === 0 || !stored.reliefs) {
        throw new Error(`PAYE configuration for ${year} is missing or incomplete. Payroll is blocked until an approved statutory configuration is installed.`);
      }
      const bands = stored.bands;
      const reliefs = stored.reliefs;

      // 2. Reliefs (annualised -> monthly)
      let annualRelief = 0;
      if (employeeData.isMarried || employeeData.hasResponsibility) annualRelief += reliefs.marriage;

      const children = Math.min(employeeData.childrenCount || 0, 3);
      annualRelief += children * reliefs.child;

      if (employeeData.age >= 60) annualRelief += reliefs.oldAge;

      const dependents = Math.min(employeeData.agedDependentsCount || 0, 2);
      annualRelief += dependents * reliefs.agedDependent;

      let monthlyRelief = annualRelief / 12;

      if (employeeData.isDisabled) {
        monthlyRelief += assessableIncome * reliefs.disabilityRate;
      }

      // 3. Bonus tax (GRA 15% rule)
      let bonusTax = 0;
      let excessBonusToTaxable = 0;
      if (bonus > 0) {
        if (basicSalary == null) {
          logger.warn(
            'calculatePAYE: bonus provided without basicSalary - bonus threshold ' +
            'is falling back to assessableIncome, which may not match GRA rules.',
            { companyId }
          );
        }
        const monthlyBasicForBonusCalc = basicSalary != null ? Number(basicSalary) : assessableIncome;
        const bonusThreshold = monthlyBasicForBonusCalc * 12 * 0.15;

        if (ytdBonus + bonus <= bonusThreshold) {
          bonusTax = bonus * 0.05;
        } else {
          const qualifyingPart = Math.max(0, bonusThreshold - ytdBonus);
          bonusTax = qualifyingPart * 0.05;
          excessBonusToTaxable = bonus - qualifyingPart;
        }
      }

      // 4. Taxable income
      const taxableIncome = Math.max(0, assessableIncome + excessBonusToTaxable - monthlyRelief);

      // 5. Graduated bands (BigInt precision in pesewas)
      let remainingToTax = BigInt(Math.round(taxableIncome * 100));
      let totalPayePesewas = 0n;

      for (const band of bands) {
        if (remainingToTax <= 0n) break;

        let taxableInThisBand;
        if (band.limit === null) {
          taxableInThisBand = remainingToTax;
          remainingToTax = 0n;
        } else {
          const bandLimitPesewas = BigInt(Math.round(band.limit * 100));
          taxableInThisBand = remainingToTax > bandLimitPesewas ? bandLimitPesewas : remainingToTax;
          remainingToTax -= taxableInThisBand;
        }

        const rateScaled = BigInt(Math.round(band.rate * 1000));
        totalPayePesewas += (taxableInThisBand * rateScaled) / 1000n;
      }

      const monthlyPAYE = Number(totalPayePesewas) / 100;
      const finalTax = Number((monthlyPAYE + bonusTax).toFixed(2));

      span.setAttributes({
        'tax.chargeable': taxableIncome,
        'tax.paye': monthlyPAYE,
        'tax.bonus': bonusTax,
        'tax.total': finalTax,
      });

      return { assessableIncome, monthlyRelief, taxableIncome, payeTax: monthlyPAYE, bonusTax, totalTax: finalTax };
    } catch (error) {
      logger.error('PAYE Calc Error', { companyId, stack: error.stack });
      throw error;
    } finally {
      span.end();
    }
  });
};
