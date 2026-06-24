import express from 'express';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import { sendNotification, getMyNotifications } from '../controllers/notificationController.js';

const router = express.Router();

// Send a notification (ADMIN, HR, SUPER_ADMIN, etc.)
router.post('/', authMiddleware, rbac(['SUPER_ADMIN','ADMIN','HR']), sendNotification);

// Get my notifications (any logged-in user)
router.get('/me', authMiddleware, getMyNotifications);

export default router;
