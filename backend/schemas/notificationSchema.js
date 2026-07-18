import { z } from 'zod';

/**
 * Modern Notification Schema - Compliant & Expirable
 * Validates multi-channel alerts (Payslips, Invites, Approvals).
 * Optimized for scalability, maintainability, and bug prevention.
 */

// Helper: Safe date parsing
const toDate = (arg) => {
  if (!arg) return undefined;
  if (arg instanceof Date) return arg;
  if (typeof arg === 'string') {
    const parsed = new Date(arg);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

// Base Object Definition allowing pure metadata inspection via .shape in other modules
export const baseNotificationObject = z.object({
  userId: z.string().uuid('Invalid user ID'),

  // FIXED (2026-07-10): Prisma's NotificationType enum (schema.prisma) and
  // typeDefs.js's GraphQL NotificationType enum have included SYSTEM and
  // REMINDER since migration 20260214142756_init_payroll_tables - this Zod
  // enum was never updated to match. Since this exact schema backs BOTH
  // the REST notificationController.js path AND Mutation.sendNotification
  // (that consolidation was itself a prior fix, specifically to prevent
  // validation from drifting between entry points), a caller sending a
  // perfectly legal SYSTEM/REMINDER notification via either path was
  // rejected with "Unsupported notification category" - a false negative
  // caused by the validator lagging behind the DB/GraphQL contract it's
  // supposed to enforce.
  type: z.enum(['INVITE', 'PAYSLIP', 'ALERT', 'APPROVAL', 'SYSTEM', 'REMINDER'], {
    errorMap: () => ({ message: 'Unsupported notification category' }),
  }),

  channel: z.enum(['EMAIL', 'SMS', 'PUSH']).default('EMAIL'),

  status: z.enum(['PENDING', 'SENT', 'FAILED', 'DELIVERED']).default('PENDING'),

  content: z.object({
    subject: z.string().min(5, 'Subject must be at least 5 characters').optional(),
    body: z.string().min(10, 'Body must be at least 10 characters'),
    link: z.string().url('Invalid link').optional(),
    metadata: z.record(z.any()).optional(), // Extensible for GraphQL/Custom triggers
  }),

  // Expiry Bypass Security
  expiresAt: z.preprocess(toDate, z.date().optional()).refine((val) => {
    if (!val) return true;
    // Must be at least 5 minutes in the future
    return val.getTime() > Date.now() + 5 * 60 * 1000;
  }, { message: 'Expiration must be at least 5 minutes in the future' }),
})
.strict(); // Disallow unknown fields safely while still exposed as a ZodObject instance

const notificationSchema = baseNotificationObject
  .refine((data) => !(data.channel === 'SMS' && data.content?.body?.length > 160), {
    message: 'SMS content exceeds the 160-character limit for a single segment.',
    path: ['content', 'body'],
  })
  .transform((data) => ({
    ...data,
    sentAt: data.status === 'SENT' ? new Date() : null,
  }));

export default notificationSchema;