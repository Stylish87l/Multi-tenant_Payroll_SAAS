import { z } from 'zod';

/**
 * Client-side mirror of backend/schemas/employeeSchema.js (CLAUDE.md: validate with Zod on BOTH sides).
 * The server remains the source of truth; this gives instant, field-level feedback.
 */
const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};
const upperOrUndefined = (v) => {
  if (typeof v !== 'string') return emptyToUndefined(v);
  const t = v.trim();
  return t === '' ? undefined : t.toUpperCase();
};

export const employeeFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Invalid email format'),
  position: z.string().trim().min(2, 'Position is required'),
  basicSalary: z.preprocess(toNumber, z.number({ required_error: 'Basic salary is required', invalid_type_error: 'Basic salary must be a number' }).positive('Basic salary must be positive').max(1_000_000)),
  housingAllowance: z.preprocess(toNumber, z.number().nonnegative('Allowance cannot be negative').default(0)),
  transportAllowance: z.preprocess(toNumber, z.number().nonnegative('Allowance cannot be negative').default(0)),
  otherAllowance: z.preprocess(toNumber, z.number().nonnegative('Allowance cannot be negative').default(0)),
  ssnitNumber: z.preprocess(upperOrUndefined, z.string().length(13, 'SSNIT must be exactly 13 characters').optional()),
  ghanaCardPin: z.preprocess(upperOrUndefined, z.string().regex(/^GHA-\d{9}-\d$/, 'Invalid Ghana Card PIN (GHA-XXXXXXXXX-X)').optional()),
  bankName: z.preprocess(emptyToUndefined, z.string().trim().min(2, 'Bank name must be at least 2 characters').optional()),
  bankAccount: z.preprocess(emptyToUndefined, z.string().regex(/^\d{5,20}$/, 'Account number must be 5-20 digits').optional()),
  age: z.preprocess(toNumber, z.number().int().min(18, 'Age must be between 18 and 70').max(70, 'Age must be between 18 and 70').default(30)),
  childrenCount: z.preprocess(toNumber, z.number().int().min(0).max(3, 'Child relief is capped at 3 (GRA)').default(0)),
  agedDependentsCount: z.preprocess(toNumber, z.number().int().min(0).max(2, 'Aged dependent relief is capped at 2').default(0)),
  isMarried: z.boolean().default(false),
  hasResponsibility: z.boolean().default(false),
  isDisabled: z.boolean().default(false),
});
