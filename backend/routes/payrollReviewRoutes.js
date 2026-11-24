import express from 'express';
import rateLimit from 'express-rate-limit';
import rbac from '../middleware/rbac.js';
import companyContext from '../middleware/companyContext.js';
import {
  createPayrollReview,
  listPayrollReviews,
  getPayrollReview,
  recordPayrollFindingDecision,
} from '../controllers/payrollReviewController.js';

const router = express.Router({ mergeParams: true });
const reviewCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payroll reviews. Please try again later.' },
});
router.use(companyContext);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']));

router.get('/', listPayrollReviews);
router.post('/payroll-runs/:payrollRunId', reviewCreationLimiter, createPayrollReview);
router.get('/:reviewId', getPayrollReview);
router.patch('/:reviewId/findings/:findingId', recordPayrollFindingDecision);

export default router;
