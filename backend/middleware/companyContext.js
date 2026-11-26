import prisma from '../config/db.js';
import { forbidden, notFound } from '../utils/appError.js';

/**
 * Resolves an explicitly selected company for company-scoped workflows.
 * Tenant users are pinned to their verified JWT company; SUPER_ADMIN must
 * supply the company in the route and never receives an implicit global scope.
 */
const companyContext = async (req, _res, next) => {
  try {
    const { companyId } = req.params;
    if (!companyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
      return next(notFound('Company not found.'));
    }

    if (req.userRole !== 'SUPER_ADMIN' && req.companyId !== companyId) {
      if (req.userRole !== 'COMPLIANCE_SPECIALIST') {
        return next(forbidden('You do not have access to this company.'));
      }
      const access = await prisma.complianceSpecialistAccess.findFirst({
        where: { userId: req.userId, companyId, revokedAt: null },
        select: { id: true },
      });
      if (!access) return next(forbidden('You do not have an active specialist grant for this company.'));
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) return next(notFound('Company not found or inactive.'));

    req.reviewCompanyId = company.id;
    req.reviewCompanyName = company.name;
    return next();
  } catch (error) {
    return next(error);
  }
};

export default companyContext;
