import express from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';

const router = express.Router();

const brandingSchema = z.object({
  themeColor: z
    .string()
    .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'themeColor must be a valid hex color, e.g. #4B6EF5')
    .optional()
    .nullable(),

  logoUrl: z
    .string()
    .url('logoUrl must be a valid URL')
    .refine((val) => val.startsWith('https://'), {
      message: 'logoUrl must use https:// - insecure or non-http(s) URLs (including file:// or data: schemes) are not permitted',
    })
    .optional()
    .nullable(),

  footerNote: z.string().max(300, 'footerNote must be 300 characters or fewer').optional().nullable(),

  payslipTemplate: z.record(z.any()).optional().nullable(),
}).strict();

/**
 * NEW (2026-07-10): Fetch Tenant Branding
 * Needed so the frontend Branding page can load current values into the
 * edit form. Mirrors the exact same RBAC and tenant-isolation checks as
 * the PUT route below - a non-SUPER_ADMIN caller can only ever read their
 * OWN company's branding record, never another tenant's.
 */
router.get('/:companyId/branding', authMiddleware, rbac(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  const { companyId } = req.params;

  try {
    if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
      logger.warn('Cross-tenant branding read attempt intercepted', {
        attemptedBy: req.userId,
        userRole: req.userRole,
        userCompany: req.companyId,
        targetCompany: companyId,
      });
      return res.status(403).json({ error: 'Access denied: You can only view your own company branding.' });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        themeColor: true,
        logoUrl: true,
        footerNote: true,
        payslipTemplate: true,
      },
    });

    if (!company) {
      return res.status(404).json({ error: 'Target company profile not found.' });
    }

    return res.json({ branding: company });
  } catch (error) {
    logger.error('Branding Fetch Failure', {
      error: error.message,
      companyId,
      userId: req.userId,
    });
    return res.status(500).json({ error: 'Failed to fetch branding settings.' });
  }
});

/**
 * Update Tenant Branding
 * FIX: Included 'SUPER_ADMIN' inside the RBAC list to align with internal multi-tenant bypass checks
 */
router.put('/:companyId/branding', authMiddleware, rbac(['SUPER_ADMIN', 'ADMIN']), async (req, res) => {
  const { companyId } = req.params;

  try {
    // 1. Secure Multi-Tenant Context Enforcer
    if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
      logger.warn('Cross-tenant branding modification attempt intercepted', {
        attemptedBy: req.userId,
        userRole: req.userRole,
        userCompany: req.companyId,
        targetCompany: companyId
      });
      return res.status(403).json({ error: 'Access denied: You can only update your own company branding.' });
    }

    // 2. Validate Payload Shape
    const parsed = brandingSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.reduce((acc, issue) => {
        acc[issue.path.join('.') || '_global'] = issue.message;
        return acc;
      }, {});
      logger.warn('Branding Update Validation Failed', { companyId, errors, userId: req.userId });
      return res.status(400).json({ errors });
    }

    const { themeColor, logoUrl, footerNote, payslipTemplate } = parsed.data;

    // 3. Isolated Update Execution
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(themeColor !== undefined && { themeColor }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(footerNote !== undefined && { footerNote }),
        ...(payslipTemplate !== undefined && { payslipTemplate }),
      },
    });

    logger.info(`Branding Updated for company ${companyId}`, { updatedBy: req.userId, role: req.userRole });

    return res.json({
      message: 'Branding updated successfully',
      branding: {
        themeColor: company.themeColor,
        logoUrl: company.logoUrl,
        footerNote: company.footerNote,
        payslipTemplate: company.payslipTemplate
      }
    });

  } catch (error) {
    // Gracefully handle situations where a bad companyId string doesn't match database records
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Target company profile not found.' });
    }

    logger.error('Branding Update Failure', { 
      error: error.message, 
      companyId, 
      userId: req.userId 
    });
    
    return res.status(500).json({ error: 'Failed to update branding settings.' });
  }
});

export default router;