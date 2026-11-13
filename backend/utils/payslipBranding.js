/** Merge partial tenant payslip preferences without erasing unrelated saved settings. */
export const mergePayslipTemplate = (existing, updates) => {
  if (updates === null) return null;
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return { ...current, ...(updates || {}) };
};
