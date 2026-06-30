import nodemailer from 'nodemailer';
import { z } from 'zod';
import logger from '../config/logger.js';

/**
 * Minimal, standalone email transport for transactional emails (invites,
 * password resets, etc.) that don't go through the full template/queue
 * pipeline in notificationService.js.
 *
 * This file was missing from the repo entirely, which crashed the whole
 * container on boot:
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '/app/services/emailService.js' imported from /app/routes/users.js
 * Node's ESM loader resolves and validates ALL static imports at module
 * load time, before any route handler runs - so a missing import in a
 * route file that's merely *imported* by server.js (even if that route is
 * never hit) is enough to crash the entire process before it can bind to
 * a port. This is why Railway showed a crash loop rather than a normal
 * 404 for the affected endpoint.
 */

// Validate only the env vars this module actually needs. Intentionally
// lenient (not throwing at import time) so a missing SMTP config doesn't
// crash the whole server the same way the missing file just did - email
// delivery failures here are recoverable; a crashed process is not.
const envSchema = z.object({
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
});

const env = envSchema.parse(process.env);

let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;

  if (!env.EMAIL_HOST || !env.EMAIL_USER || !env.EMAIL_PASS) {
    logger.warn(
      'Email transport not configured (EMAIL_HOST/EMAIL_USER/EMAIL_PASS missing). ' +
      'Invite emails will be logged but not sent.'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT || 587,
    secure: env.EMAIL_PORT === 465,
    auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
  });
  return transporter;
};

/**
 * Sends an invite email with a secure activation link.
 * Used by routes/users.js's POST /invite endpoint.
 */
export const sendInviteEmail = async (to, name, inviteLink) => {
  const t = getTransporter();

  if (!t) {
    // Degrade gracefully: log the link so it's recoverable from logs in
    // dev/staging, but don't throw - the caller (routes/users.js) already
    // catches and logs mail errors without failing the whole invite flow.
    logger.warn('sendInviteEmail: no transporter configured, skipping send', {
      to,
      inviteLink,
    });
    return { skipped: true };
  }

  try {
    const info = await t.sendMail({
      from: env.EMAIL_FROM || 'no-reply@paylio.app',
      to,
      subject: 'You have been invited to Paylio',
      html: `
        <h2>Welcome to Paylio!</h2>
        <p>Hi ${name},</p>
        <p>You've been invited to join your organization's payroll workspace.</p>
        <p><a href="${inviteLink}">Click here to accept your invitation</a></p>
        <p>This link expires in 48 hours.</p>
      `,
    });
    logger.info('Invite email sent', { to, messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error('sendInviteEmail failed', { to, message: error.message });
    throw error;
  }
};

export default { sendInviteEmail };