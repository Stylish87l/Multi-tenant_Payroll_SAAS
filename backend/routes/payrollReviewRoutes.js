import express from 'express';
import rbac from '../middleware/rbac.js';
import companyContext from '../middleware/companyContext.js';
import {
  createPayrollReview,
  listPayrollReviews,
  getPayrollReview,
  recordPayrollFindingDecision,
} from '../controllers/payrollReviewController.js';

const router = express.Router({ mergeParams: true });
router.use(companyContext);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']));

router.get('/', listPayrollReviews);
router.post('/payroll-runs/:payrollRunId', createPayrollReview);
router.get('/:reviewId', getPayrollReview);
router.patch('/:reviewId/findings/:findingId', recordPayrollFindingDecision);

export default router;
