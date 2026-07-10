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
 * SECURITY FIX (2026-07-10): Removed 'HR' role. This endpoint returns
 * company-wide gross/net/tax totals per run - the exact same financial
 * data the '/:id' route below already restricts away from HR, and the
 * exact same data graphql/resolvers.js's PAYROLL_FINANCE_ROLES constant
 * has always restricted away from HR. Having REST allow HR here while
 * GraphQL denied it for the equivalent query was a live segregation-of-
 * duties gap: an HR user blocked in the React app (which calls GraphQL)
 * could still pull the same data by hitting the REST endpoint directly.
 * HR manages employee records, not disbursement figures - both entry
 * points now agree.
 */
router.get(
  '/', 
  rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']), 
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