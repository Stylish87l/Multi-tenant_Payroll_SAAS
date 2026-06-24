import { z } from 'zod';

/**
 * Modern Employee Schema (2026 Ghana Compliance)
 * Validates core data with strict rules for SSNIT, GRA, and NIA (Ghana Card).
 * Optimized for scalability, maintainability, and bug prevention.
 */

// Helper: Safe number parsing (handles strings, nulls, undefined)
const toNumber = (val) => {
  if (val === '' || val === null || val === undefined) return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
};

const employeeSchema = z.object({
  // Identity
  name: z.string().min(2, 'Name must be at least 2 characters').trim(),
  email: z.string().email('Invalid email format').transform((val) => val.toLowerCase().trim()),

  // NIA Standard: GHA-XXXXXXXXX-X
  ghanaCardPin: z.string().regex(/^GHA-\d{9}-\d$/, 'Invalid Ghana Card PIN (GHA-XXXXXXXXX-X)'),

  // SSNIT: Exactly 13 alphanumeric characters
  ssnitNumber: z.string().length(13, 'SSNIT must be exactly 13 characters').transform((val) => val.toUpperCase()),

  position: z.string().min(2, 'Position required').trim(),

  // Financials
  basicSalary: z.preprocess(toNumber,
    z.number().positive('Basic salary must be positive').max(1_000_000)
  ),
  housingAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),
  transportAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),
  otherAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),

  // Tax Relief (2026 GRA Rules)
  isMarried: z.boolean().default(false),
  hasResponsibility: z.boolean().default(false),
  childrenCount: z.preprocess(toNumber,
    z.number().int().min(0).max(3, 'GRA caps child relief at 3 children').default(0)
  ),
  age: z.preprocess(toNumber, z.number().int().min(18).max(70).default(30)),
  isDisabled: z.boolean().default(false),
  agedDependentsCount: z.preprocess(toNumber,
    z.number().int().min(0).max(2, 'Max 2 aged dependents for relief').default(0)
  ),

  // Banking
  bankName: z.string().min(2, 'Bank name required').trim(),
  bankAccount: z.string().regex(/^\d{5,20}$/, 'Account number must be 5-20 digits'),

  isActive: z.boolean().default(true),
})
// Guard: Prevent misuse of disabled flag with zero/negative salary
.refine((data) => !(data.isDisabled && data.basicSalary <= 0), {
  message: 'Disabled status cannot be assigned to records without active income.',
  path: ['isDisabled'],
})
// Normalization: Ensure Ghana Card is always uppercase before saving to DB
.transform((data) => ({
  ...data,
  ghanaCardPin: data.ghanaCardPin.toUpperCase(),
}))
.strict(); // Disallow unknown fields

export default employeeSchema;
