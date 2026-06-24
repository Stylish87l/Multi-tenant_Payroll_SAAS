import express from 'express';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * Update Tenant Branding
 * Allows updating theme color, logo, and payslip template per tenant.
 */
router.put('/:companyId/branding', authMiddleware, rbac(['ADMIN']), async (req, res) => {
  const { companyId } = req.params;
  const { themeColor, logoUrl, payslipTemplate } = req.body;

  try {
    // 1. Double-check ownership (Managed by RBAC, but added here for critical safety)
    if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
      return res.status(403).json({ error: 'Access denied: You can only update your own company branding.' });
    }

    // 2. Perform Update
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        themeColor,
        logoUrl,
        // Ensure template is treated as a valid JSON object
        payslipTemplate: payslipTemplate ? JSON.parse(JSON.stringify(payslipTemplate)) : undefined,
      },
    });

    logger.info(`Branding Updated`, { companyId, updatedBy: req.userId });

    res.json({
      message: 'Branding updated successfully',
      branding: {
        themeColor: company.themeColor,
        logoUrl: company.logoUrl,
        payslipTemplate: company.payslipTemplate
      }
    });

  } catch (error) {
    logger.error('Branding Update Failure', { 
      error: error.message, 
      companyId, 
      userId: req.userId 
    });
    
    res.status(500).json({ error: 'Failed to update branding settings.' });
  }
});

export default router;