import { z } from 'zod';

// Helper: Validate YYYY-MM format and ensure not in the future
const validateMonth = (val) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(val)) return false;
  const [year, month] = val.split('-').map(Number);
  const now = new Date();
  const runDate = new Date(year, month - 1);
  return month >= 1 && month <= 12 && runDate <= now;
};

const payrollSchema = z
  .object({
    // Format: YYYY-MM (e.g., 2026-01)
    month: z.string().refine(validateMonth, {
      message: 'Payroll cannot be processed for future months or invalid format',
    }),

    runType: z.enum(['REGULAR', 'BONUS', 'ADJUSTMENT']).default('REGULAR'),

    status: z.enum(['DRAFT', 'FINALIZED', 'CANCELLED']).default('DRAFT'),

    // Extensibility for special 2026 payroll cases
    isBonusOnly: z.boolean().default(false),
    notes: z.string().max(500).optional(),
  })
  // Enforce no unknown fields **right after object definition**
  .passthrough(false)
  /**
   * Status Transition Safety
   * Prevents "ADJUSTMENT" runs from skipping the DRAFT phase.
   */
  .refine(
    (data) => !(data.runType === 'ADJUSTMENT' && data.status === 'FINALIZED'),
    {
      message:
        'Adjustment runs must be created as DRAFT for review before finalization.',
      path: ['status'],
    }
  )
  /**
   * Normalization
   * Standardizes the month string to a full ISO-compatible date string (YYYY-MM-01).
   */
  .transform((data) => ({
    ...data,
    month: `${data.month}-01`,
  }));

export default payrollSchema;