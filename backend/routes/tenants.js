import express from 'express';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * Tenant Creation (Admin Only)
 * Registers a new company/tenant in the system.
 */
router.post('/create', authMiddleware, rbac(['ADMIN']), async (req, res) => {
  const { name, tin, address } = req.body;

  try {
    // 1. Basic Validation
    if (!name || !tin) {
      return res.status(400).json({ error: 'Company name and TIN are required.' });
    }

    // 2. Validation: Ensure the TIN (Tax Identification Number) is unique
    const existingCompany = await prisma.company.findUnique({ where: { tin } });
    if (existingCompany) {
      return res.status(409).json({ error: 'A company with this TIN already exists.' });
    }

    // 3. Tenant Creation
    const company = await prisma.company.create({
      data: { 
        name: name.trim(),
        tin: tin.trim(),
        address: address?.trim() || null,
        createdBy: req.userId, // Audit trail: who created the tenant
      }
    });

    logger.info(`New Tenant Registered: ${company.name} (ID: ${company.id}) by User: ${req.userId}`);
    
    res.status(201).json({
      message: 'Tenant created successfully',
      company,
    });

  } catch (error) {
    logger.error('Tenant Creation Failure', { 
      error: error.message, 
      stack: error.stack,
      requestBody: { name, tin, address },
      userId: req.userId,
    });
    
    res.status(500).json({ error: 'Internal server error during tenant creation.' });
  }
});

export default router;
