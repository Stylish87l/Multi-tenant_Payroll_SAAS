import { z } from 'zod';

/**
 * Auth-related input schemas. Replaces the previous (never imported) userSchema.js,
 * whose password rules are preserved here and are now actually enforced - register,
 * accept-invite and the seed script previously accepted any 8-character password.
 */
const email = z.string().trim().toLowerCase().email('Invalid email format').max(254);

// bcrypt silently truncates input beyond 72 bytes, so cap it.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
  .regex(/[0-9]/, 'Password must include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character');

export const registerSchema = z.object({
  email,
  password: passwordSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  companyName: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120),
}).strict();

/**
 * SUPER_ADMIN is intentionally NOT invitable. Previously `role` was taken
 * straight from the request body, so any tenant ADMIN could mint a SUPER_ADMIN.
 */
export const INVITABLE_ROLES = ['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'];

export const inviteSchema = z.object({
  email,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  role: z.enum(INVITABLE_ROLES, { errorMap: () => ({ message: 'Invalid role' }) }).default('EMPLOYEE'),
  companyId: z.string().uuid().optional(),
}).strict();

export const acceptInviteSchema = z.object({
  token: z.string().min(32).max(200),
  password: passwordSchema,
}).strict();

export const tenantSchema = z.object({
  name: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120),
  tin: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{5,20}$/, 'TIN must be 5-20 letters, digits or dashes'),
  address: z.string().trim().max(300).optional(),
}).strict();
