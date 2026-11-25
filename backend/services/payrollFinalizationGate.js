import { badInput, conflict } from '../utils/appError.js';

export const getBlockingPayrollReviewFindings = (findings = []) => findings.filter((finding) =>
  ['CRITICAL', 'HIGH'].includes(finding.severity)
  && !['DISMISSED', 'RESOLVED'].includes(finding.status)
);

export const assertPayrollReviewGate = ({ review, currentFingerprint, overrideReason }) => {
  if (!review || review.status !== 'COMPLETED') {
    throw conflict('A completed Copilot review is required before payroll can be finalized.');
  }
  if (!review.inputFingerprint || review.inputFingerprint !== currentFingerprint) {
    throw conflict('The latest Copilot review is stale. Run a new review before finalizing payroll.');
  }

  const normalizedOverrideReason = typeof overrideReason === 'string' ? overrideReason.trim() : '';
  if (overrideReason !== undefined && overrideReason !== null) {
    if (typeof overrideReason !== 'string' || normalizedOverrideReason.length < 10 || normalizedOverrideReason.length > 1000) {
      throw badInput('An override reason must contain between 10 and 1000 characters.');
    }
    if (/(?:[0-9][ -]?){9,}/.test(normalizedOverrideReason)) {
      throw badInput('Do not include bank account numbers or government identifiers in an override reason.');
    }
  }

  const blockingFindings = getBlockingPayrollReviewFindings(review.findings);
  if (blockingFindings.length && !normalizedOverrideReason) {
    throw conflict('Payroll finalization blocked by unresolved CRITICAL/HIGH Copilot findings. Resolve them or submit an audited override reason.');
  }
  if (normalizedOverrideReason && !blockingFindings.length) {
    throw badInput('An override reason is only accepted when unresolved CRITICAL or HIGH findings exist.');
  }

  return { blockingFindings, normalizedOverrideReason };
};
