import prisma from '../config/db.js';
import logger from '../config/logger.js';
import notificationSchema from '../schemas/notificationSchema.js';
import { sendTransactionalEmail } from './emailService.js';
import { forbidden, zodToAppError } from '../utils/appError.js';

/**
 * Single notification pipeline for REST and GraphQL.
 *
 * Previously: (a) Mutation.sendNotification only inserted a row (never delivered it) and had NO
 * tenant check - an ADMIN could notify any user, in any company, by id; (b) the REST controller
 * had the check but GraphQL did not; (c) an unused second service (Twilio/Handlebars/BullMQ,
 * crashing at import without EMAIL_* env) duplicated delivery. All replaced by this module.
 */
const DEFAULT_SUBJECTS = {
  INVITE: 'You have been invited to Paylio',
  PAYSLIP: 'Your payslip is ready',
  ALERT: 'Paylio Alert',
  APPROVAL: 'Approval Required',
  SYSTEM: 'System Notification',
  REMINDER: 'Reminder from Paylio',
};

const setStatus = (id, status, extra = {}) =>
  prisma.notification.update({ where: { id }, data: { status, ...extra } });

export async function dispatchNotification(notif) {
  try {
    const user = await prisma.user.findUnique({ where: { id: notif.userId }, select: { email: true } });
    if (!user) {
      logger.warn('Notification dispatch: recipient no longer exists', { id: notif.id });
      return await setStatus(notif.id, 'FAILED');
    }

    switch (notif.channel) {
      case 'EMAIL': {
        if (!user.email) throw new Error('Recipient has no email address on file');
        const result = await sendTransactionalEmail({
          to: user.email,
          subject: notif.content?.subject || DEFAULT_SUBJECTS[notif.type] || 'Notification from Paylio',
          body: notif.content?.body || '',
        });
        // Transport not configured: do NOT claim delivery.
        if (result?.skipped) return await setStatus(notif.id, 'FAILED');
        break;
      }
      case 'SMS':
        // No phone-number field exists on User/Employee yet, so there is nothing to send to.
        logger.warn('SMS dispatch skipped: no phone number modelled', { id: notif.id });
        return await setStatus(notif.id, 'FAILED');
      case 'PUSH':
        logger.warn('PUSH dispatch skipped: no push provider configured', { id: notif.id });
        return await setStatus(notif.id, 'FAILED');
      default:
        logger.warn('Unsupported channel', { channel: notif.channel, id: notif.id });
        return await setStatus(notif.id, 'FAILED');
    }

    await setStatus(notif.id, 'SENT', { sentAt: new Date() });
    logger.info('Notification Sent', { id: notif.id, channel: notif.channel, companyId: notif.companyId });
  } catch (err) {
    logger.error(`Channel Delivery Error [${notif.channel}]`, { id: notif.id, err: err.message, stack: err.stack });
    await setStatus(notif.id, 'FAILED').catch(() => {});
  }
  return null;
}

/**
 * @param {{ actor: {userId,companyId,role}, input: object }} params
 */
export const createNotification = async ({ actor, input }) => {
  // Callers may not set delivery status (it would let them forge "SENT").
  const { status: _ignored, ...rest } = input || {};

  let validated;
  try {
    validated = await notificationSchema.parseAsync(rest);
  } catch (err) {
    if (err?.issues) throw zodToAppError(err);
    throw err;
  }

  const recipient = await prisma.user.findUnique({ where: { id: validated.userId }, select: { companyId: true } });
  // Same message for "missing" and "other tenant": don't reveal which user ids exist.
  if (!recipient || (actor.role !== 'SUPER_ADMIN' && recipient.companyId !== actor.companyId)) {
    logger.warn('Cross-tenant or unknown notification target blocked', { attemptedBy: actor.userId, targetUserId: validated.userId });
    throw forbidden('Recipient is not in your organization.');
  }

  const notification = await prisma.notification.create({
    data: { ...validated, companyId: recipient.companyId },
  });

  dispatchNotification(notification).catch((err) =>
    logger.error('Async Dispatch Error', { id: notification.id, err: err.message })
  );
  return notification;
};
