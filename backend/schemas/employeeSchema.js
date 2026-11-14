import { z } from 'zod';

/**
 * Modern Employee Schema (2026 Ghana Compliance)
 *
 * FIXED (critical): routes/employees.js's PUT handler calls
 * `employeeSchema.partial().parse(req.body)`. The PREVIOUS version of this
 * file exported `baseEmployeeObject.refine(...).transform(...)` as the
 * default - `.refine()`/`.transform()` wrap a ZodObject inside a
 * ZodEffects instance, and ZodEffects has NO `.partial()` method. Every
 * single employee update via REST therefore threw
 * `TypeError: employeeSchema.partial is not a function` at runtime - a
 * 100% failure rate on `PUT /api/employees/:id`, always, regardless of
 * payload. (The file even exported `baseEmployeeObject` separately with a
 * comment explaining this exact trap - but the route imported the wrong
 * one.)
 *
 * FIX: keep the exported default schema a plain ZodObject (no
 * `.refine()`/`.transform()` at the object level) so `.partial()` works
 * directly wherever it's called - REST create, REST update, and GraphQL
 * resolvers all import this same object. Per-field normalization
 * (uppercasing Ghana Card PIN / SSNIT, lowercasing email) is done via
 * `z.preprocess()` on the individual fields instead, which composes fine
 * with `.partial()`. The one cross-field business rule that previously
 * lived in `.refine()` (disabled status requires positive salary) is now
 * `validateEmployeeBusinessRules()`, called explicitly by callers after
 * `.parse()`/`.partial().parse()` succeeds - a manual check composes with
 * partial updates correctly, whereas a schema-level `.refine()` cannot
 * (a partial update may not include `basicSalary` at all).
 *
 * ALSO FIXED: `ghanaCardPin`, `ssnitNumber`, `bankName`, and `bankAccount`
 * were previously REQUIRED here, but neither the GraphQL `EmployeeInput`
 * type nor the actual Employees.jsx form (no `required` attribute on any
 * of these four fields) treat them as mandatory - onboarding frequently
 * precedes card/bank verification. Requiring them here silently broke
 * every "create employee without a Ghana Card yet" flow the UI already
 * allows. They're now optional but still format-validated whenever a
 * value IS provided.
 */

// Helper: Safe number parsing (handles strings, nulls, undefined)
const toNumber = (val) => {
  if (val === '' || val === null || val === undefined) return undefined;
  const num = Number(val);
  return Number.isNaN(num) ? undefined : num;
};

// Helper: trim + uppercase, but pass `undefined`/empty through as
// `undefined` so `.optional()` treats "not provided" and "empty string"
// identically instead of trying to validate "" against a regex.
const toUpperOrUndefined = (val) => {
  if (typeof val !== 'string') return val === '' ? undefined : val;
  const trimmed = val.trim();
  return trimmed === '' ? undefined : trimmed.toUpperCase();
};

const employeeSchema = z
  .object({
    // Identity
    name: z.string().min(2, 'Name must be at least 2 characters').trim(),
    email: z
      .string()
      .email('Invalid email format')
      .transform((val) => val.toLowerCase().trim()),

    // NIA Standard: GHA-XXXXXXXXX-X (optional - may be added post-onboarding)
    ghanaCardPin: z.preprocess(
      toUpperOrUndefined,
      z
        .string()
        .regex(/^GHA-\d{9}-\d$/, 'Invalid Ghana Card PIN (GHA-XXXXXXXXX-X)')
        .optional()
    ),

    // SSNIT: Exactly 13 alphanumeric characters (optional - may be added post-onboarding)
    ssnitNumber: z.preprocess(
      toUpperOrUndefined,
      z.string().length(13, 'SSNIT must be exactly 13 characters').optional()
    ),

    position: z.string().min(2, 'Position required').trim(),

    // Financials
    basicSalary: z.preprocess(
      toNumber,
      z.number().positive('Basic salary must be positive').max(1_000_000)
    ),
    housingAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),
    transportAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),
    otherAllowance: z.preprocess(toNumber, z.number().nonnegative().default(0)),

    // Tax Relief (2026 GRA Rules)
    isMarried: z.boolean().default(false),
    hasResponsibility: z.boolean().default(false),
    childrenCount: z.preprocess(
      toNumber,
      z.number().int().min(0).max(3, 'GRA caps child relief at 3 children').default(0)
    ),
    age: z.preprocess(toNumber, z.number().int().min(18).max(70).default(30)),
    isDisabled: z.boolean().default(false),
    agedDependentsCount: z.preprocess(
      toNumber,
      z.number().int().min(0).max(2, 'Max 2 aged dependents for relief').default(0)
    ),

    // Banking (optional - may be added post-onboarding)
    bankName: z.string().trim().min(2, 'Bank name must be at least 2 characters').optional(),
    bankCode: z.string().trim().min(2, 'Bank code must be at least 2 characters').max(20).optional(),
    bankAccount: z
      .string()
      .regex(/^\d{5,20}$/, 'Account number must be 5-20 digits')
      .optional(),

    isActive: z.boolean().default(true),
  })
  .strict(); // Disallow unknown fields

/**
 * Cross-field business rules that can't live in the schema itself because
 * they need to compose safely with `.partial()` (a partial update payload
 * may legitimately omit `basicSalary` or `isDisabled` entirely - a
 * schema-level `.refine()` would incorrectly fail those partial payloads).
 *
 * @param {object} data - already-parsed data (full or partial)
 * @param {object} [existing] - the current DB record, required to validate
 *   partial updates that only touch one side of the rule (e.g. PATCHing
 *   `isDisabled: true` without resending `basicSalary`).
 * @returns {string|null} error message, or null if valid
 */
export const validateEmployeeBusinessRules = (data, existing = null) => {
  const isDisabled = data.isDisabled ?? existing?.isDisabled ?? false;
  const basicSalary = data.basicSalary ?? existing?.basicSalary ?? null;

  if (isDisabled && basicSalary !== null && Number(basicSalary) <= 0) {
    return 'Disabled status cannot be assigned to records without active income.';
  }

  return null;
};

export default employeeSchema;
