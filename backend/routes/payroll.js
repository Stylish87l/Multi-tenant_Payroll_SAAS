import express from 'express';
// Add getPayrollRuns and getPayrollDetails to your controller imports
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

// 1. GET all payroll runs (This fixes the 404 on the main Payroll tab)
router.get(
  '/', 
  authMiddleware, 
  rbac(['ADMIN', 'HR', 'SUPER_ADMIN']), 
  getPayrollRuns
);

// 2. GET specific run details
router.get(
  '/:id', 
  authMiddleware, 
  rbac(['ADMIN', 'HR', 'SUPER_ADMIN']), 
  getPayrollDetails
);

// 3. POST to run a new payroll
router.post(
  '/run', 
  authMiddleware, 
  rbac(['ADMIN', 'HR']), 
  validate({ body: payrollSchema }), 
  runPayroll
);

export default router;