import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/db.js';
import authMiddleware from '../../middleware/auth.js';
import rbac from '../../middleware/rbac.js';
import logger from '../../config/logger.js';
import { sendInviteEmail } from '../../services/emailService.js';

const router = express.Router();

// 1. Invite User (Admin Only)
router.post('/invite', authMiddleware, rbac(['ADMIN']), async (req, res) => {
  const { email, name, role = 'EMPLOYEE' } = req.body;
  try {
    if (!email || !name) {
      return res.status(400).json({ error: 'Email and Name are required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Check if user already exists
      const existingUser = await tx.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existingUser) throw new Error('USER_EXISTS');

      // Create the User shell
      const user = await tx.user.create({
        data: { 
          email: email.toLowerCase(), 
          name, 
          role, 
          companyId: req.companyId, 
          status: 'PENDING' 
        },
      });

      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

      await tx.invite.create({
        data: { 
          token, 
          email: email.toLowerCase(), 
          role, 
          expiresAt, 
          companyId: req.companyId, 
          userId: user.id 
        },
      });

      return { user, token };
    });

    const inviteLink = `${process.env.FRONTEND_URL}/accept-invite?token=${result.token}`;
    
    // Attempt to send email, but don't crash if it fails
    try {
      await sendInviteEmail(email, name, inviteLink);
    } catch (mailError) {
      logger.error('Mail Delivery Failed', { email, error: mailError.message });
      // Optionally return the link in dev mode
    }

    logger.info(`Invitation sent to ${email} by Admin: ${req.userId}`);
    res.status(201).json({ message: 'Invitation sent successfully' });
  } catch (error) {
    if (error.message === 'USER_EXISTS') {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    logger.error('Invite Error', { companyId: req.companyId, stack: error.stack });
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// 2. Accept Invite (Public Route)
router.post('/accept-invite', async (req, res) => {
  const { token, password } = req.body;
  try {
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
    }

    // Find valid, non-expired invite
    const invite = await prisma.invite.findUnique({ 
      where: { token }, 
      include: { user: true } 
    });

    if (!invite || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation link is invalid or has expired' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      // 1. Update user to ACTIVE and set password
      await tx.user.update({ 
        where: { id: invite.userId }, 
        data: { 
          password: hashedPassword, 
          status: 'ACTIVE' 
        } 
      });

      // 2. Link User to Employee profile if exists
      await tx.employee.updateMany({
        where: { email: invite.email, companyId: invite.companyId },
        data: { userId: invite.userId }
      });

      // 3. Delete the used invite (One-time use)
      await tx.invite.delete({ where: { id: invite.id } });
    });

    logger.info(`Invite accepted and account activated for: ${invite.email}`);
    res.json({ message: 'Account activated successfully. You can now log in.' });
  } catch (error) {
    logger.error('Accept Invite Error', { token, stack: error.stack });
    res.status(500).json({ error: 'Activation failed. Please contact your administrator.' });
  }
});

export default router;
    res.json({ message: 'Invitation sent successfully' });