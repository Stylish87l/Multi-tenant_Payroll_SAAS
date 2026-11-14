import nodemailer from 'nodemailer';
import { z } from 'zod';
import logger from '../config/logger.js';

/**
 * Minimal, standalone email transport for transactional emails (invites,
 * password resets, generic notifications) that don't go through the full
 * template/queue pipeline in notificationService.js.
 *
 * This file was originally missing from the repo entirely, which crashed
 * the whole container on boot. See the original comment history for
 * details - retained below for context.
 */

// Validate only the env vars this module actually needs. Intentionally
// lenient (not throwing at import time) so a missing SMTP config doesn't
// crash the whole server the same way the missing file used to - email
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
      'Transactional emails will be logged but not sent.'
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
 * Minimal HTML-escaping so plain-text notification bodies can't break the
 * surrounding markup or inject arbitrary HTML when rendered in an email
 * client. Not a substitute for a real templating engine, but enough for
 * "wrap this trusted-ish string in a <p> tag" use.
 */
const escapeHtml = (str = '') =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * NEW: Generic transactional email sender.
 *
 * Used by controllers/notificationController.js's dispatchNotification()
 * so that EMAIL-channel notifications (payslip alerts, approvals, system
 * messages, reminders) are actually delivered instead of being a no-op
 * that silently marks itself SENT. Deliberately separate from
 * services/notificationService.js's sendInvite/sendPayslipAlert helpers,
 * which are template-bound to exactly two notification kinds - this
 * function accepts pre-composed subject/body content (already validated
 * by schemas/notificationSchema.js) for any notification type.
 *
 * @param {{ to: string, subject: string, body: string }} params
 * @returns {Promise<{ skipped: true } | import('nodemailer').SentMessageInfo>}
 */
export const sendTransactionalEmail = async ({ to, subject, body }) => {
  const t = getTransporter();

  if (!t) {
    logger.warn('sendTransactionalEmail: no transporter configured, skipping send', { to, subject });
    return { skipped: true };
  }

  if (!to) {
    throw new Error('sendTransactionalEmail: recipient email address is required');
  }

  try {
    const info = await t.sendMail({
      from: env.EMAIL_FROM || 'no-reply@paylio.app',
      to,
      subject: subject || 'Notification from Paylio',
      text: body,
      html: `<div style="font-family: Inter, system-ui, sans-serif; color: #0f172a; line-height: 1.5;">
        <p>${escapeHtml(body).replace(/\n/g, '<br/>')}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 11px; color: #94a3b8;">This is an automated message from Paylio. Please do not reply directly to this email.</p>
      </div>`,
    });
    logger.info('Transactional email sent', { to, messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error('sendTransactionalEmail failed', { to, message: error.message });
    throw error;
  }
};

/**
 * Sends an invite email with a secure activation link.
 * Used by routes/users.js's POST /invite endpoint.
 */
export const sendInviteEmail = async (to, name, inviteLink) => {
  const t = getTransporter();

  if (!t) {
    // Never log invitation links: the query token is a one-time bearer credential.
    logger.warn('sendInviteEmail: no transporter configured, skipping send', { to });
    return { skipped: true };
  }

  try {
    const info = await t.sendMail({
      from: env.EMAIL_FROM || 'no-reply@paylio.app',
      to,
      subject: 'You have been invited to Paylio',
      html: `
        <h2>Welcome to Paylio!</h2>
        <p>Hi ${escapeHtml(name)},</p>
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

export default { sendInviteEmail, sendTransactionalEmail };
