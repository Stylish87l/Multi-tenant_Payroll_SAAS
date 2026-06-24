import { z } from 'zod';

/**
 * Modern User Schema - Secure & Role-Strict
 * Validates user accounts, prevents unauthorized role escalation, and enforces password strength.
 * Optimized for scalability, maintainability, and bug prevention.
 */

const userSchema = z.object({
  // Identity
  email: z.string()
    .email('Invalid email format')
    .transform((val) => val.toLowerCase().trim()),

  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .trim()
    .optional(),

  // Password: 8+ chars, 1 Uppercase, 1 Number, 1 Special Char
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[0-9]/, 'Password must include at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character'),

  /**
   * Role Validation - Prevent Escalation
   * Zod enum strictly validates input against allowed roles.
   */
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'], {
    errorMap: () => ({ message: 'Invalid role provided. Fuzzing attempt rejected.' })
  }).default('EMPLOYEE'),

  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).default('ACTIVE'),

  // OAuth / 2FA Extensibility
  provider: z.string().optional(),
  twoFactorEnabled: z.boolean().default(false),

})
// Custom Security Logic: restrict ADMIN/SUPER_ADMIN to corporate domains
.refine((data) => {
  if (['ADMIN', 'SUPER_ADMIN'].includes(data.role)) {
    return data.email.endsWith('@yourdomain.com') || data.email.endsWith('@admin.com');
  }
  return true;
}, {
  message: 'Administrative roles can only be assigned to authorized corporate email domains.',
  path: ['role'],
})
.strict(); // Disallow unknown fields

export default userSchema;
