import express from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';

const router = express.Router();

const brandingSchema = z.object({
  themeColor: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'themeColor must be a valid hex color, e.g. #4B6EF5').optional().nullable(),
  logoUrl: z.string().url('logoUrl must be a valid URL')
    .refine((val) => val.startsWith('https://'), {
      message: 'logoUrl must use https:// - insecure or non-http(s) URLs (including file:// or data: schemes) are not permitted',
    })
    .optional().nullable(),
  footerNote: z.string().max(300, 'footerNote must be 300 characters or fewer').optional().nullable(),
  payslipTemplate: z.record(z.any()).optional().nullable(),
}).strict();

const denyCrossTenant = (req, companyId, verb) => {
  if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
    logger.warn(`Cross-tenant branding ${verb} attempt intercepted`, {
      attemptedBy: req.userId, userRole: req.userRole, userCompany: req.companyId, targetCompany: companyId,
    });
    return true;
  }
  return false;
};

router.get('/:companyId/branding', authMiddleware, rbac(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  const { companyId } = req.params;
  try {
    if (denyCrossTenant(req, companyId, 'read')) {
      return res.status(403).json({ error: 'Access denied: You can only view your own company branding.' });
    }
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, themeColor: true, logoUrl: true, footerNote: true, payslipTemplate: true },
    });
    if (!company) return res.status(404).json({ error: 'Target company profile not found.' });
    return res.json({ branding: company });
  } catch (error) {
    logger.error('Branding Fetch Failure', { error: error.message, companyId, userId: req.userId });
    return res.status(500).json({ error: 'Failed to fetch branding settings.' });
  }
});

router.put('/:companyId/branding', authMiddleware, rbac(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  const { companyId } = req.params;
  try {
    if (denyCrossTenant(req, companyId, 'modification')) {
      return res.status(403).json({ error: 'Access denied: You can only update your own company branding.' });
    }

    const parsed = brandingSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const errors = parsed.error.issues.reduce((acc, issue) => {
        acc[issue.path.join('.') || '_global'] = issue.message;
        return acc;
      }, {});
      return res.status(400).json({ errors });
    }

    const { themeColor, logoUrl, footerNote, payslipTemplate } = parsed.data;
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(themeColor !== undefined && { themeColor }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(footerNote !== undefined && { footerNote }),
        ...(payslipTemplate !== undefined && { payslipTemplate }),
      },
    });

    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId, action: 'TENANT_BRANDING_UPDATED',
      resourceType: 'Company', resourceId: companyId, details: { changedFields: Object.keys(parsed.data) },
    });

    return res.json({
      message: 'Branding updated successfully',
      branding: {
        themeColor: company.themeColor, logoUrl: company.logoUrl,
        footerNote: company.footerNote, payslipTemplate: company.payslipTemplate,
      },
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Target company profile not found.' });
    logger.error('Branding Update Failure', { error: error.message, companyId, userId: req.userId });
    return res.status(500).json({ error: 'Failed to update branding settings.' });
  }
});

export default router;
