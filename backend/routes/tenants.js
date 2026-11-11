import express from 'express';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { tenantSchema } from '../schemas/authSchema.js';
import { writeAudit, actorFromReq } from '../services/auditService.js';
import { conflict } from '../utils/appError.js';

const router = express.Router();

/**
 * Tenant Creation - SUPER_ADMIN only.
 * FIXED: was rbac(['ADMIN']); SUPER_ADMIN inherits ADMIN, so every tenant ADMIN could also create
 * brand-new companies. Registering a tenant is a platform-level action.
 */
router.post('/create', authMiddleware, rbac(['SUPER_ADMIN']), async (req, res, next) => {
  try {
    const parsed = tenantSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(parsed.error);
    const { name, tin, address } = parsed.data;

    const company = await prisma.$transaction(async (tx) => {
      if (await tx.company.findUnique({ where: { tin } })) throw conflict('A company with this TIN already exists.');
      const created = await tx.company.create({ data: { name, tin, address: address || null, createdBy: req.userId } });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: created.id,
        action: 'TENANT_CREATED',
        resourceType: 'Company',
        resourceId: created.id,
        details: { name, tin },
      });
      return created;
    });

    logger.info(`New Tenant Registered: ${company.name} (ID: ${company.id})`, { by: req.userId });
    return res.status(201).json({ message: 'Tenant created successfully', company });
  } catch (error) {
    return next(error); // P2002 race on TIN -> 409 via errorHandler
  }
});

export default router;
