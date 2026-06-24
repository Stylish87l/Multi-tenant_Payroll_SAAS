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

const notificationSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),

  type: z.enum(['INVITE', 'PAYSLIP', 'ALERT', 'APPROVAL'], {
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
/**
 * Channel-Specific Compliance
 * SMS characters are expensive; enforce 160-char limit for Ghana SMS gateway.
 */
.refine((data) => !(data.channel === 'SMS' && data.content.body.length > 160), {
  message: 'SMS content exceeds the 160-character limit for a single segment.',
  path: ['content.body'],
})
/**
 * Normalization
 * Automatically timestamps the "sentAt" field if status is created as SENT.
 */
.transform((data) => ({
  ...data,
  sentAt: data.status === 'SENT' ? new Date() : null,
}))
.strict(); // Disallow unknown fields

export default notificationSchema;
