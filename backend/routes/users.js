import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { sendInviteEmail } from '../services/emailService.js';
import { inviteSchema, acceptInviteSchema } from '../schemas/authSchema.js';
import { writeAudit, actorFromReq } from '../services/auditService.js';
import { badInput } from '../utils/appError.js';

const router = express.Router();

/**
 * 1. Invite User (Admin only).
 *
 * FIXED (critical, 3 bugs):
 *  - `role` came straight from the body: any tenant ADMIN could invite a SUPER_ADMIN. Now validated
 *    against INVITABLE_ROLES (authSchema.js).
 *  - User.password is NOT NULL, but the invite created the user without one, so EVERY invite threw a
 *    Prisma error. A random, unusable bcrypt hash is stored until the invitee sets a real password.
 *  - A PENDING user whose invite expired could never be re-invited ("USER_EXISTS"). Re-inviting
 *    a still-PENDING user in the same company now issues a fresh invite.
 */
router.post('/invite', authMiddleware, rbac(['ADMIN']), async (req, res, next) => {
  try {
    const parsed = inviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(parsed.error);
    const { email, name, role } = parsed.data;

    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? parsed.data.companyId : req.companyId;
    if (!targetCompanyId) {
      throw badInput(req.userRole === 'SUPER_ADMIN' ? 'companyId is required when inviting as SUPER_ADMIN.' : 'Company context missing.');
    }

    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      let user;

      if (existing) {
        if (existing.status !== 'PENDING' || existing.companyId !== targetCompanyId) {
          throw badInput('User with this email already exists');
        }
        await tx.invite.deleteMany({ where: { userId: existing.id } });
        user = await tx.user.update({ where: { id: existing.id }, data: { name, role } });
      } else {
        user = await tx.user.create({
          data: { email, name, role, companyId: targetCompanyId, status: 'PENDING', password: placeholderHash },
        });
      }

      await tx.invite.create({ data: { token, email, role, expiresAt, companyId: targetCompanyId, userId: user.id } });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: targetCompanyId,
        action: 'USER_INVITED',
        resourceType: 'User',
        resourceId: user.id,
        details: { role },
      });
    });

    const inviteLink = `${String(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/accept-invite?token=${token}`;
    let emailSent = false;
    try {
      const result = await sendInviteEmail(email, name, inviteLink);
      emailSent = !result?.skipped;
    } catch (mailError) {
      logger.error('Mail Delivery Failed', { error: mailError.message });
    }

    logger.info('Invitation created', { by: req.userId, targetCompanyId, emailSent });
    return res.status(201).json({
      message: emailSent ? 'Invitation sent successfully' : 'Invitation created, but the email could not be delivered.',
      emailSent,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 2. Accept Invite (public - the invitee has no session yet).
 * FIXED: server.js previously mounted this router behind authMiddleware, so this route could
 * never be reached by anyone without a token. Also: suspended accounts could be re-activated by
 * accepting an old invite; passwords were only length-checked; the raw token was written to logs.
 */
router.post('/accept-invite', async (req, res, next) => {
  try {
    const parsed = acceptInviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(parsed.error);
    const { token, password } = parsed.data;

    const invite = await prisma.invite.findUnique({ where: { token }, include: { user: true } });
    if (!invite || invite.expiresAt < new Date() || invite.user.status !== 'PENDING') {
      throw badInput('Invitation link is invalid or has expired');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: invite.userId }, data: { password: hashedPassword, status: 'ACTIVE' } });
      await tx.employee.updateMany({
        where: { email: invite.email, companyId: invite.companyId, userId: null },
        data: { userId: invite.userId },
      });
      await tx.invite.delete({ where: { id: invite.id } }); // one-time use
      await writeAudit(tx, {
        actor: { userId: invite.userId, companyId: invite.companyId, ip: req.ip, userAgent: req.get('User-Agent') },
        action: 'USER_INVITE_ACCEPTED',
        resourceType: 'User',
        resourceId: invite.userId,
      });
    });

    logger.info('Invite accepted and account activated', { userId: invite.userId });
    return res.json({ message: 'Account activated successfully. You can now log in.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
