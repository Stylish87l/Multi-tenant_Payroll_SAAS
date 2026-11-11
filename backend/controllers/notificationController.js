import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { createNotification } from '../services/notificationService.js';

export const sendNotification = async (req, res, next) => {
  try {
    const notification = await createNotification({
      actor: { userId: req.userId, companyId: req.companyId, role: req.userRole },
      input: req.body,
    });
    res.status(201).json({
      message: `Notification queued via ${notification.channel}`,
      notificationId: notification.id,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyNotifications = async (req, res, next) => {
  try {
    const list = await prisma.notification.findMany({
      where: {
        userId: req.userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ notifications: list });
  } catch (error) {
    logger.error('Notification Fetch Error', { userId: req.userId, stack: error.stack });
    next(error);
  }
};
