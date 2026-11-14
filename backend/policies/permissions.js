/**
 * Canonical application permission policy.
 * Keep role grants here; REST middleware and GraphQL resolvers consume the same policy.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'tenant.read', 'tenant.manage', 'user.manage', 'employee.read', 'employee.create',
    'employee.update', 'employee.compensation.read', 'employee.compensation.write',
    'employee.identity.read', 'employee.identity.write', 'employee.bank.read', 'employee.bank.write',
    'employee.tax_profile.read', 'employee.tax_profile.write', 'payroll.read', 'payroll.write',
    'payroll.finalize', 'payout.process', 'report.read', 'audit.read', 'notification.send',
  ],
  HR: [
    'employee.read', 'employee.create', 'employee.update', 'employee.identity.read',
    'employee.identity.write', 'employee.tax_profile.read', 'employee.tax_profile.write',
    'notification.send',
  ],
  ACCOUNTANT: [
    'employee.compensation.read', 'employee.compensation.write', 'employee.identity.read',
    'employee.bank.read', 'employee.bank.write', 'employee.tax_profile.read',
    'payroll.read', 'payroll.write', 'payout.process', 'report.read',
  ],
  EMPLOYEE: ['payslip.read.own', 'notification.read.own', 'preferences.manage.own'],
  CUSTOM: [],
});

export const hasPermission = (role, permission) => {
  const grants = ROLE_PERMISSIONS[role] || [];
  return grants.includes('*') || grants.includes(permission);
};

export const canReadEmployeeField = (role, field) => {
  const permissionByField = {
    basicSalary: 'employee.compensation.read',
    housingAllowance: 'employee.compensation.read',
    transportAllowance: 'employee.compensation.read',
    otherAllowance: 'employee.compensation.read',
    allowances: 'employee.compensation.read',
    bankName: 'employee.bank.read',
    bankCode: 'employee.bank.read',
    bankAccount: 'employee.bank.read',
    ssnitNumber: 'employee.identity.read',
    ghanaCardPin: 'employee.identity.read',
    ghanaCardPIN: 'employee.identity.read',
    age: 'employee.tax_profile.read',
    isMarried: 'employee.tax_profile.read',
    hasResponsibility: 'employee.tax_profile.read',
    childrenCount: 'employee.tax_profile.read',
    isDisabled: 'employee.tax_profile.read',
    agedDependentsCount: 'employee.tax_profile.read',
  };
  const permission = permissionByField[field];
  return permission ? hasPermission(role, permission) : true;
};

export const assertEmployeeInputPermissions = (role, input = {}) => {
  const groups = [
    [['basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowance', 'allowances'], 'employee.compensation.write'],
    [['bankName', 'bankCode', 'bankAccount'], 'employee.bank.write'],
    [['ssnitNumber', 'ghanaCardPin', 'ghanaCardPIN'], 'employee.identity.write'],
    [['age', 'isMarried', 'hasResponsibility', 'childrenCount', 'isDisabled', 'agedDependentsCount'], 'employee.tax_profile.write'],
  ];
  for (const [fields, permission] of groups) {
    if (fields.some((field) => Object.hasOwn(input, field)) && !hasPermission(role, permission)) {
      return false;
    }
  }
  return true;
};
