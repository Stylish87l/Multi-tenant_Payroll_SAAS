/**
 * RBAC Middleware - Hierarchical & Tenant-Safe
 * Supports SUPER_ADMIN (global) and tenant-scoped roles.
 */
const hierarchy = {
  SUPER_ADMIN: ['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'], // global override
  ADMIN: ['HR', 'ACCOUNTANT', 'EMPLOYEE'],
  HR: ['EMPLOYEE'],
  ACCOUNTANT: ['EMPLOYEE'],
  EMPLOYEE: [],
};

const rbac = (allowedRoles) => (req, res, next) => {
  const userRole = req.userRole || req.user?.role;
  if (!userRole) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const effectiveRoles = [userRole, ...(hierarchy[userRole] || [])];
  const hasPermission = allowedRoles.some((role) => effectiveRoles.includes(role));

  if (!hasPermission) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  // Tenant Safety Check - SUPER_ADMIN bypasses tenant scoping.
  // FIXED: Express 5 no longer initialises req.body to {} when no body was parsed (every GET),
  // so `req.body.companyId` threw a TypeError for every non-SUPER_ADMIN GET request.
  if (userRole !== 'SUPER_ADMIN') {
    const targetCompanyId = req.params?.companyId || req.body?.companyId;
    if (targetCompanyId && targetCompanyId !== req.companyId) {
      return res.status(403).json({ error: 'Access denied: Tenant mismatch' });
    }
  }

  return next();
};

export default rbac;
