import prisma from '../config/db.js';
import notificationSchema from '../schemas/notificationSchema.js';
import logger from '../config/logger.js';
import { sendTransactionalEmail } from '../services/emailService.js';

/**
 * Send Notification
 * Creates a record and triggers the external delivery provider.
 */
export const sendNotification = async (req, res, next) => {
  try {
    // 1. Validate against the Modern Schema
    const validatedData = await notificationSchema.parseAsync(req.body);

    // FIXED: Previously nothing verified that validatedData.userId belongs
    // to the caller's tenant - an ADMIN/HR at Company A could target any
    // userId in the system and the notification would be created and
    // (once dispatch is wired up, below) delivered cross-tenant. This
    // mirrors the same tenant-ownership check already used in
    // routes/payslips.js and routes/tenantBranding.js. SUPER_ADMIN is
    // exempt, matching every other cross-tenant-capable route.
    if (req.userRole !== 'SUPER_ADMIN') {
      const recipient = await prisma.user.findUnique({
        where: { id: validatedData.userId },
        select: { companyId: true },
      });
      if (!recipient || recipient.companyId !== req.companyId) {
        logger.warn('Cross-tenant notification target blocked', {
          attemptedBy: req.userId,
          callerCompany: req.companyId,
          targetUserId: validatedData.userId,
        });
        return res.status(403).json({ error: 'Access denied: recipient is not in your organization.' });
      }
    }

    // 2. Save to Database (Audit Trail)
    const notification = await prisma.notification.create({
      data: {
        ...validatedData,
        companyId: req.companyId, // Scope to tenant
      },
    });

    // 3. Trigger External Delivery (Async, non-blocking)
    dispatchNotification(notification).catch((err) => {
      logger.error('Async Dispatch Error', {
        id: notification.id,
        channel: notification.channel,
        err: err.message,
      });
    });

    res.status(201).json({
      message: `Notification queued via ${notification.channel}`,
      notificationId: notification.id,
    });
  } catch (error) {
    logger.error('Notification Dispatch Failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.companyId,
      userId: req.userId,
    });
    next(error);
  }
};

/**
 * Human-readable default subject per notification type, used when the
 * caller didn't supply content.subject (notificationSchema.js allows
 * subject to be omitted).
 */
const DEFAULT_SUBJECTS = {
  INVITE: 'You have been invited to Paylio',
  PAYSLIP: 'Your payslip is ready',
  ALERT: 'Paylio Alert',
  APPROVAL: 'Approval Required',
  SYSTEM: 'System Notification',
  REMINDER: 'Reminder from Paylio',
};

/**
 * Dispatcher Logic
 * Switches between channels based on the schema-validated input.
 *
 * FIXED (critical): every case in this switch was previously commented
 * out (`// await sendEmail(...)`), yet the function unconditionally
 * updated the notification's status to SENT afterward regardless of
 * channel. This violates CLAUDE.md's "no stub resolvers in production"
 * rule and meant every notification created through this controller -
 * payslip alerts, invites-via-notification, reminders - was silently
 * discarded while the DB record claimed successful delivery. EMAIL is now
 * wired to services/emailService.js's real transporter. SMS/PUSH remain
 * genuinely unimplemented (see inline notes on why), but now say so
 * honestly via a FAILED status and a clear log line instead of lying.
 */
async function dispatchNotification(notif) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: notif.userId },
      select: { email: true, name: true },
    });

    if (!user) {
      logger.warn('Notification dispatch: recipient user no longer exists', { id: notif.id, userId: notif.userId });
      await prisma.notification.update({ where: { id: notif.id }, data: { status: 'FAILED' } });
      return;
    }

    switch (notif.channel) {
      case 'EMAIL': {
        if (!user.email) {
          throw new Error('Recipient has no email address on file');
        }
        await sendTransactionalEmail({
          to: user.email,
          subject: notif.content?.subject || DEFAULT_SUBJECTS[notif.type] || 'Notification from Paylio',
          body: notif.content?.body || '',
        });
        break;
      }

      case 'SMS': {
        // NOT YET IMPLEMENTED: neither the User nor Employee Prisma model
        // has a phone number field, so there is currently no data source
        // to send an SMS to. services/notificationService.js already has
        // a working Twilio client wired up and ready - once a phone field
        // is added to the schema, route through that instead of failing
        // here. Failing loudly (rather than silently marking SENT) so
        // this gap is visible in the notifications list, not hidden.
        logger.warn('SMS dispatch skipped: no phone number field modeled on User/Employee', {
          id: notif.id,
          userId: notif.userId,
        });
        await prisma.notification.update({ where: { id: notif.id }, data: { status: 'FAILED' } });
        return;
      }

      case 'PUSH': {
        // NOT YET IMPLEMENTED: no push provider (Firebase/OneSignal) is
        // configured or credentialed in this codebase yet.
        logger.warn('PUSH dispatch skipped: no push provider configured', { id: notif.id, userId: notif.userId });
        await prisma.notification.update({ where: { id: notif.id }, data: { status: 'FAILED' } });
        return;
      }

      default:
        logger.warn('Unsupported channel', { channel: notif.channel, id: notif.id });
        await prisma.notification.update({ where: { id: notif.id }, data: { status: 'FAILED' } });
        return;
    }

    // Update status to SENT
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    logger.info('Notification Sent', {
      id: notif.id,
      channel: notif.channel,
      userId: notif.userId,
      companyId: notif.companyId,
    });
  } catch (err) {
    logger.error(`Channel Delivery Error [${notif.channel}]`, {
      id: notif.id,
      err: err.message,
      stack: err.stack,
    });
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: 'FAILED' },
    });
  }
}

/**
 * Get User Notifications
 * Fetches unexpired alerts for the logged-in user.
 */
export const getMyNotifications = async (req, res, next) => {
  try {
    const list = await prisma.notification.findMany({
      where: {
        userId: req.userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ notifications: list });
  } catch (error) {
    logger.error('Notification Fetch Error', {
      userId: req.userId,
      companyId: req.companyId,
      stack: error.stack,
    });
    next(error);
  }
};
