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
import { badInput, forbidden, notFound } from '../utils/appError.js';

const router = express.Router();
const USER_SELECT = { id: true, email: true, name: true, role: true, status: true, companyId: true, createdAt: true, updatedAt: true };

// Both direct provisioning and invitations create a PENDING identity and use the same
// one-time activation flow. No administrator ever sets, sees, or emails a user's password.
async function provisionUser(req, res, next, action) {
  try {
    const parsed = inviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(parsed.error);
    const { email, name, role } = parsed.data;
    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? parsed.data.companyId : req.companyId;
    if (!targetCompanyId) throw badInput('Select a company before provisioning a user.');

    const company = await prisma.company.findFirst({ where: { id: targetCompanyId, deletedAt: null }, select: { id: true } });
    if (!company) throw notFound('Company not found.');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      let user;
      if (existing) {
        if (existing.status !== 'PENDING' || existing.companyId !== targetCompanyId || existing.deletedAt) {
          throw badInput('An account with this email already exists.');
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
        actor: actorFromReq(req), companyId: targetCompanyId, action,
        resourceType: 'User', resourceId: user.id, details: { role, delivery: 'email_activation' },
      });
    });

    const inviteLink = `${String(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/accept-invite?token=${token}`;
    let emailSent = false;
    try {
      const result = await sendInviteEmail(email, name, inviteLink);
      emailSent = !result?.skipped;
    } catch (mailError) {
      logger.error('User activation email delivery failed', { error: mailError.message, action });
    }

    logger.info('User provisioned', { by: req.userId, targetCompanyId, role, emailSent, action });
    return res.status(201).json({
      message: emailSent ? 'Account provisioned and activation email sent.' : 'Account provisioned, but activation email could not be delivered. Retry using Invite.',
      emailSent,
    });
  } catch (error) {
    return next(error);
  }
}

// List users in the caller's tenant. SUPER_ADMIN must supply a tenant explicitly.
router.get('/', authMiddleware, rbac(['ADMIN']), async (req, res, next) => {
  try {
    const companyId = req.userRole === 'SUPER_ADMIN' ? req.query.companyId : req.companyId;
    if (!companyId) throw badInput('companyId is required for SUPER_ADMIN user management.');
    const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
    if (!company) throw notFound('Company not found.');
    const users = await prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: USER_SELECT,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return res.json({ users });
  } catch (error) { return next(error); }
});

// Direct account creation: creates the identity immediately in PENDING state;
// the user activates it via a short-lived, single-use email link.
router.post('/create', authMiddleware, rbac(['ADMIN']), (req, res, next) =>
  provisionUser(req, res, next, 'USER_ACCOUNT_CREATED')
);

// Invitation is retained as a separate workflow for existing onboarding processes.
router.post('/invite', authMiddleware, rbac(['ADMIN']), (req, res, next) =>
  provisionUser(req, res, next, 'USER_INVITED')
);

// Suspend/reactivate only within the caller's tenant. Self-suspension and privilege escalation are blocked.
router.patch('/:id/status', authMiddleware, rbac(['ADMIN']), async (req, res, next) => {
  try {
    const { status } = req.body ?? {};
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw badInput('Status must be ACTIVE or SUSPENDED.');
    if (req.params.id === req.userId) throw badInput('You cannot change your own account status.');
    const where = req.userRole === 'SUPER_ADMIN'
      ? { id: req.params.id, deletedAt: null }
      : { id: req.params.id, companyId: req.companyId, deletedAt: null };
    const target = await prisma.user.findFirst({ where, select: { id: true, role: true, companyId: true } });
    if (!target) throw notFound('User not found.');
    if (target.role === 'SUPER_ADMIN') throw forbidden('Platform administrator accounts cannot be managed here.');
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: target.id }, data: { status }, select: USER_SELECT });
      if (status === 'SUSPENDED') {
        await tx.refreshToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'account_suspended' },
        });
      }
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId: target.companyId,
        action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        resourceType: 'User', resourceId: target.id,
      });
      return user;
    });
    return res.json({ user: updated });
  } catch (error) { return next(error); }
});

// Public: invitees have no authenticated session yet. Token is single-use and expires after 48 hours.
router.post('/accept-invite', async (req, res, next) => {
  try {
    const parsed = acceptInviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(parsed.error);
    const { token, password } = parsed.data;
    const invite = await prisma.invite.findUnique({ where: { token }, include: { user: true } });
    if (!invite || invite.expiresAt < new Date() || invite.user.status !== 'PENDING' || invite.user.deletedAt) {
      throw badInput('Activation link is invalid or has expired.');
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: invite.userId }, data: { password: hashedPassword, status: 'ACTIVE' } });
      await tx.employee.updateMany({
        where: { email: invite.email, companyId: invite.companyId, userId: null },
        data: { userId: invite.userId },
      });
      await tx.invite.delete({ where: { id: invite.id } });
      await writeAudit(tx, {
        actor: { userId: invite.userId, companyId: invite.companyId, ip: req.ip, userAgent: req.get('User-Agent') },
        action: 'USER_INVITE_ACCEPTED', resourceType: 'User', resourceId: invite.userId,
      });
    });
    logger.info('User account activated', { userId: invite.userId });
    return res.json({ message: 'Account activated successfully. You can now log in.' });
  } catch (error) { return next(error); }
});

export default router;
