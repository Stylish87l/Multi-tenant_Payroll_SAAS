import express from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';
import { mergePayslipTemplate } from '../utils/payslipBranding.js';

const router = express.Router();

const templateSchema = z.object({
  tagline: z.string().max(120).optional().nullable(),
  companyDisplayName: z.string().trim().min(1).max(120).optional().nullable(),
  logoAlignment: z.enum(['left', 'center', 'right']).optional(),
  showFooter: z.boolean().optional(),
}).strict();

const brandingSchema = z.object({
  themeColor: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).optional().nullable(),
  logoUrl: z.string().url().refine((val) => val.startsWith('https://'), {
    message: 'logoUrl must use https://',
  }).optional().nullable(),
  logoDataUrl: z.string().max(700000).optional().nullable(),
  footerNote: z.string().max(500).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  contactEmail: z.string().email().max(254).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  payslipTemplate: templateSchema.optional().nullable(),
}).strict();

const parseUploadedLogo = (dataUrl) => {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('Logo must be a PNG or JPEG image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 512 * 1024) throw new Error('Logo image must be 512 KB or smaller.');
  const isPng = match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) throw new Error('Logo file contents do not match the declared image type.');
  return dataUrl;
};

const denyCrossTenant = (req, companyId, verb) => {
  if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
    logger.warn(`Cross-tenant branding ${verb} attempt intercepted`, {
      attemptedBy: req.userId, userRole: req.userRole, userCompany: req.companyId, targetCompany: companyId,
    });
    return true;
  }
  return false;
};

const companySelect = {
  id: true, name: true, address: true, contactEmail: true, contactPhone: true,
  themeColor: true, logoUrl: true, footerNote: true, payslipTemplate: true,
};

router.get('/:companyId/branding', authMiddleware, rbac(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  const { companyId } = req.params;
  try {
    if (denyCrossTenant(req, companyId, 'read')) {
      return res.status(403).json({ error: 'Access denied: You can only view your own company branding.' });
    }
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: companySelect });
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

    const { logoDataUrl, payslipTemplate, ...fields } = parsed.data;
    let logoUrl = fields.logoUrl;
    if (logoDataUrl !== undefined) {
      try {
        logoUrl = parseUploadedLogo(logoDataUrl);
      } catch (error) {
        return res.status(400).json({ errors: { logoDataUrl: error.message } });
      }
    }

    const current = await prisma.company.findUnique({ where: { id: companyId }, select: { payslipTemplate: true } });
    if (!current) return res.status(404).json({ error: 'Target company profile not found.' });
    const nextTemplate = payslipTemplate === undefined
      ? undefined : mergePayslipTemplate(current.payslipTemplate, payslipTemplate);

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(fields.themeColor !== undefined && { themeColor: fields.themeColor }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(fields.footerNote !== undefined && { footerNote: fields.footerNote }),
        ...(fields.address !== undefined && { address: fields.address }),
        ...(fields.contactEmail !== undefined && { contactEmail: fields.contactEmail }),
        ...(fields.contactPhone !== undefined && { contactPhone: fields.contactPhone }),
        ...(nextTemplate !== undefined && { payslipTemplate: nextTemplate }),
      },
      select: companySelect,
    });

    await writeAuditSafe(prisma, {
      actor: actorFromReq(req), companyId, action: 'TENANT_BRANDING_UPDATED',
      resourceType: 'Company', resourceId: companyId,
      details: { changedFields: [...Object.keys(fields), ...(logoDataUrl !== undefined ? ['logoUpload'] : []), ...(payslipTemplate !== undefined ? ['payslipTemplate'] : [])] },
    });

    return res.json({ message: 'Branding updated successfully', branding: company });
  } catch (error) {
    logger.error('Branding Update Failure', { error: error.message, companyId, userId: req.userId });
    return res.status(500).json({ error: 'Failed to update branding settings.' });
  }
});

export default router;
