/**
 * Legacy route-role adapter. New authorization decisions should use named permissions
 * from policies/permissions.js; role hierarchy is centralized there.
 */
import { hasRoleAccess } from '../policies/permissions.js';

const rbac = (allowedRoles) => (req, res, next) => {
  const userRole = req.userRole || req.user?.role;
  if (!userRole) return res.status(401).json({ error: 'Authentication required' });
  if (!hasRoleAccess(userRole, allowedRoles)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }
  if (userRole !== 'SUPER_ADMIN') {
    const targetCompanyId = req.params?.companyId || req.body?.companyId || req.query?.companyId;
    if (targetCompanyId && targetCompanyId !== req.companyId) {
      return res.status(403).json({ error: 'Access denied: Tenant mismatch' });
    }
  }
  return next();
};
export default rbac;
