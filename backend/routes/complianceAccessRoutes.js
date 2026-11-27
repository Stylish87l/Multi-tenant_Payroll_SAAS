import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import { sendInviteEmail } from '../services/emailService.js';
import { actorFromReq, writeAudit } from '../services/auditService.js';
import { badInput, notFound } from '../utils/appError.js';

const router = express.Router();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const specialistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(100),
  companyId: z.string().uuid(),
}).strict();

router.use(authMiddleware);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

router.get('/my-companies', async (req, res, next) => {
  try {
    if (req.userRole !== 'COMPLIANCE_SPECIALIST') return res.status(403).json({ error: 'Specialist access required.' });
    const grants = await prisma.complianceSpecialistAccess.findMany({
      where: { userId: req.userId, revokedAt: null, company: { is: { deletedAt: null } } },
      orderBy: { company: { name: 'asc' } },
      select: { company: { select: { id: true, name: true } } },
    });
    return res.json({ companies: grants.map((grant) => grant.company) });
  } catch (error) { return next(error); }
});

router.use(rbac(['SUPER_ADMIN']));

router.get('/specialists', async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const specialists = await prisma.user.findMany({
      where: { role: 'COMPLIANCE_SPECIALIST', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, name: true, email: true, status: true, companyId: true, createdAt: true,
        complianceSpecialistAccess: {
          orderBy: { grantedAt: 'desc' },
          select: {
            id: true, companyId: true, grantedAt: true, revokedAt: true,
            company: { select: { name: true } },
          },
        },
      },
    });
    return res.json({ specialists });
  } catch (error) { return next(error); }
});

router.post('/specialists', async (req, res, next) => {
  try {
    const parsed = specialistSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Provide a valid specialist name, email and initial company.' });
    const { email, name, companyId } = parsed.data;
    const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
    if (!company) throw notFound('Company not found.');
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw badInput('An account with this email already exists.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, name, companyId, role: 'COMPLIANCE_SPECIALIST', status: 'PENDING', password: placeholderHash },
        select: { id: true, email: true, name: true, role: true, status: true, companyId: true },
      });
      await tx.invite.create({
        data: { token: hashToken(token), email, role: 'COMPLIANCE_SPECIALIST', expiresAt, companyId, userId: created.id },
      });
      await tx.complianceSpecialistAccess.create({
        data: { userId: created.id, companyId, grantedById: req.userId },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId, action: 'COMPLIANCE_SPECIALIST_INVITED',
        resourceType: 'User', resourceId: created.id, details: { role: 'COMPLIANCE_SPECIALIST' },
      });
      return created;
    });

    const inviteLink = `${String(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/accept-invite?token=${token}`;
    let emailSent = false;
    try {
      const result = await sendInviteEmail(email, name, inviteLink);
      emailSent = !result?.skipped;
    } catch (mailError) {
      req.log?.error?.({ message: mailError.message }, 'Specialist activation email failed');
    }
    return res.status(201).json({ user, emailSent, message: emailSent ? 'Specialist invited and activation email sent.' : 'Specialist created; activation email delivery failed.' });
  } catch (error) { return next(error); }
});

router.get('/specialists/:userId/companies', async (req, res, next) => {
  try {
    const specialist = await prisma.user.findFirst({
      where: { id: req.params.userId, role: 'COMPLIANCE_SPECIALIST', deletedAt: null },
      select: { id: true },
    });
    if (!specialist) throw notFound('Compliance specialist not found.');
    const grants = await prisma.complianceSpecialistAccess.findMany({
      where: { userId: specialist.id },
      orderBy: { grantedAt: 'desc' },
      include: { company: { select: { id: true, name: true } } },
    });
    return res.json({ grants });
  } catch (error) { return next(error); }
});

router.put('/specialists/:userId/companies/:companyId', async (req, res, next) => {
  try {
    const specialist = await prisma.user.findFirst({
      where: { id: req.params.userId, role: 'COMPLIANCE_SPECIALIST', status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!specialist) throw notFound('Active compliance specialist not found.');
    const company = await prisma.company.findFirst({ where: { id: req.params.companyId, deletedAt: null }, select: { id: true } });
    if (!company) throw notFound('Company not found.');
    const grant = await prisma.$transaction(async (tx) => {
      const result = await tx.complianceSpecialistAccess.upsert({
        where: { userId_companyId: { userId: specialist.id, companyId: company.id } },
        create: { userId: specialist.id, companyId: company.id, grantedById: req.userId },
        update: { grantedById: req.userId, grantedAt: new Date(), revokedAt: null },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId: company.id, action: 'COMPLIANCE_SPECIALIST_ACCESS_GRANTED',
        resourceType: 'ComplianceSpecialistAccess', resourceId: result.id,
        details: { specialistUserId: specialist.id },
      });
      return result;
    });
    return res.json({ grant });
  } catch (error) { return next(error); }
});

router.delete('/specialists/:userId/companies/:companyId', async (req, res, next) => {
  try {
    const grant = await prisma.complianceSpecialistAccess.findFirst({
      where: { userId: req.params.userId, companyId: req.params.companyId, revokedAt: null },
      select: { id: true },
    });
    if (!grant) throw notFound('Active specialist grant not found.');
    await prisma.$transaction(async (tx) => {
      await tx.complianceSpecialistAccess.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      await writeAudit(tx, {
        actor: actorFromReq(req), companyId: req.params.companyId,
        action: 'COMPLIANCE_SPECIALIST_ACCESS_REVOKED',
        resourceType: 'ComplianceSpecialistAccess', resourceId: grant.id,
        details: { specialistUserId: req.params.userId },
      });
    });
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

export default router;
