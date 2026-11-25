import express from 'express';
import rateLimit from 'express-rate-limit';
import rbac from '../middleware/rbac.js';
import companyContext from '../middleware/companyContext.js';
import { askPaylioQuestion } from '../controllers/askPaylioController.js';

const router = express.Router({ mergeParams: true });
const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You have reached the Ask Paylio request limit. Try again shortly.' },
});

router.use(companyContext);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'HR']));
router.post('/', askLimiter, askPaylioQuestion);

export default router;
