import prisma from '../config/db.js';
import notificationSchema from '../schemas/notificationSchema.js';
import logger from '../config/logger.js';
// import { sendEmail } from '../services/emailService.js';
// import { sendSMS } from '../services/smsService.js';

/**
 * Send Notification
 * Creates a record and triggers the external delivery provider.
 */
export const sendNotification = async (req, res, next) => {
  try {
    // 1. Validate against the Modern Schema
    const validatedData = await notificationSchema.parseAsync(req.body);

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
 * Dispatcher Logic
 * Switches between channels based on the schema-validated input.
 */
async function dispatchNotification(notif) {
  try {
    switch (notif.channel) {
      case 'EMAIL':
        // await sendEmail(notif.userId, notif.content?.subject, notif.content?.body);
        break;
      case 'SMS':
        // await sendSMS(notif.userId, notif.content?.body);
        break;
      case 'PUSH':
        // logic for Firebase/OneSignal
        break;
      default:
        logger.warn('Unsupported channel', { channel: notif.channel, id: notif.id });
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
