/**
 * RBAC Middleware - Hierarchical & Tenant-Safe
 * Supports SUPER_ADMIN (global) and tenant-scoped roles.
 */
const rbac = (allowedRoles) => (req, res, next) => {
  // 1. Check if user exists (set by authMiddleware)
  const userRole = req.userRole || req.user?.role;
  if (!userRole) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // 2. Define Role Hierarchy
  const hierarchy = {
    SUPER_ADMIN: ['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'], // global override
    ADMIN: ['HR', 'ACCOUNTANT', 'EMPLOYEE'],
    HR: ['EMPLOYEE'],
    ACCOUNTANT: ['EMPLOYEE'],
    EMPLOYEE: [],
  };

  // 3. Determine Effective Permissions
  const effectiveRoles = [userRole, ...(hierarchy[userRole] || [])];
  const hasPermission = allowedRoles.some(role => effectiveRoles.includes(role));

  if (!hasPermission) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  // 4. Tenant Safety Check
  // SUPER_ADMIN bypasses tenant scoping
  if (userRole !== 'SUPER_ADMIN') {
    const targetCompanyId = req.params.companyId || req.body.companyId;
    if (targetCompanyId && targetCompanyId !== req.companyId) {
      return res.status(403).json({ error: 'Access denied: Tenant mismatch' });
    }
  }

  next();
};

export default rbac;
