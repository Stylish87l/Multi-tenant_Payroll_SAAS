import express from 'express';
import { 
  runPayroll, 
  getPayrollRuns, 
  getPayrollDetails 
} from '../controllers/payrollController.js'; 
import validate from '../middleware/validate.js';
import payrollSchema from '../schemas/payrollSchema.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';

const router = express.Router();

// Apply authMiddleware globally across all payroll vectors to keep code DRY
router.use(authMiddleware);

/**
 * 1. GET ALL PAYROLL RUNS
 * FIXED (2026-07-05): Added ACCOUNTANT role to prevent 403 authorization failures 
 * when accessing the main dashboard tracking list linked in the frontend sidebar config.
 */
router.get(
  '/', 
  rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'HR']), 
  getPayrollRuns
);

/**
 * 2. GET SPECIFIC RUN DETAILS
 * SECURITY FIX (2026-07-06): Removed 'HR' role from granular details visibility.
 * HR handles employee records and contract variables; viewing complete, calculated 
 * net disbursement sheets, bank breakdowns, and tax tallies violates data privacy 
 * and standard segregation of financial duties.
 */
router.get(
  '/:id', 
  rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), 
  getPayrollDetails
);

/**
 * 3. POST TO RUN A NEW PAYROLL
 * SECURITY FIX (2026-07-06): Re-aligned targeting vectors. Running a financial 
 * calculation engine is strictly the domain of an ACCOUNTANT (creator/initiator) 
 * or an ADMIN (system override), never HR.
 */
router.post(
  '/run', 
  rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), 
  validate({ body: payrollSchema }), 
  runPayroll
);

export default router;