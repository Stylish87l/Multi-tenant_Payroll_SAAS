import { askPaylio } from '../services/askPaylioService.js';
import { writeAuditSafe, actorFromReq } from '../services/auditService.js';

export const askPaylioQuestion = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > 500) {
      return res.status(400).json({ error: 'Enter a question of up to 500 characters.' });
    }

    const result = await askPaylio({
      companyId: req.reviewCompanyId,
      role: req.userRole,
      question,
    });
    if (result.forbidden) {
      return res.status(403).json({ error: 'Your role is not permitted to access this report.' });
    }

    await writeAuditSafe(null, {
      actor: actorFromReq(req),
      companyId: req.reviewCompanyId,
      action: 'ASK_PAYLIO_QUERY',
      resourceType: 'COMPANY_REPORT',
      resourceId: req.reviewCompanyId,
      details: { intent: result.intent || 'UNSUPPORTED', provider: result.provider },
    });
    return res.json({
      answer: result.answer,
      intent: result.intent,
      data: result.data,
      provider: result.provider,
    });
  } catch (error) {
    return next(error);
  }
};
