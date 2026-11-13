/** Build an authorization scope for an individual payslip lookup. */
export const buildPayslipItemWhere = ({ userRole, companyId, userId }, itemId) => {
  const where = {
    id: itemId,
    ...(userRole === 'SUPER_ADMIN' ? {} : { payrollRun: { companyId } }),
  };
  if (userRole === 'EMPLOYEE') {
    where.employee = { userId };
    where.payrollRun = { companyId, status: 'FINALIZED' };
  }
  return where;
};

/** Reject corrupt payroll-item relations that could cross tenant boundaries. */
export const hasConsistentPayslipTenant = (item) =>
  Boolean(item?.payrollRun?.companyId && item?.employee?.companyId
    && item.payrollRun.companyId === item.employee.companyId);
