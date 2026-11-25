import { describe, expect, test } from '@jest/globals';
import { assertPayrollReviewGate, getBlockingPayrollReviewFindings } from '../services/payrollFinalizationGate.js';

const currentFingerprint = 'current-fingerprint';
const review = {
  status: 'COMPLETED',
  inputFingerprint: currentFingerprint,
  findings: [
    { id: 'critical-open', severity: 'CRITICAL', status: 'OPEN' },
    { id: 'high-confirmed', severity: 'HIGH', status: 'CONFIRMED' },
    { id: 'high-dismissed', severity: 'HIGH', status: 'DISMISSED' },
    { id: 'critical-resolved', severity: 'CRITICAL', status: 'RESOLVED' },
    { id: 'medium-open', severity: 'MEDIUM', status: 'OPEN' },
  ],
};

describe('payroll Copilot finalization gate', () => {
  test('requires a completed review', () => {
    expect(() => assertPayrollReviewGate({ review: null, currentFingerprint }))
      .toThrow(/completed Copilot review is required/);
    expect(() => assertPayrollReviewGate({ review: { ...review, status: 'FAILED' }, currentFingerprint }))
      .toThrow(/completed Copilot review is required/);
  });

  test('rejects missing or stale input fingerprints', () => {
    expect(() => assertPayrollReviewGate({ review: { ...review, inputFingerprint: null }, currentFingerprint }))
      .toThrow(/review is stale/);
    expect(() => assertPayrollReviewGate({ review, currentFingerprint: 'changed-inputs' }))
      .toThrow(/review is stale/);
  });

  test('blocks unresolved CRITICAL and HIGH findings, including confirmed findings', () => {
    expect(getBlockingPayrollReviewFindings(review.findings).map((finding) => finding.id))
      .toEqual(['critical-open', 'high-confirmed']);
    expect(() => assertPayrollReviewGate({ review, currentFingerprint }))
      .toThrow(/blocked by unresolved CRITICAL\/HIGH/);
  });

  test('allows an administrator override only with a meaningful reason', () => {
    expect(assertPayrollReviewGate({
      review, currentFingerprint, overrideReason: 'Approved by CFO after checking the supporting records',
    })).toMatchObject({
      normalizedOverrideReason: 'Approved by CFO after checking the supporting records',
      blockingFindings: [{ id: 'critical-open' }, { id: 'high-confirmed' }],
    });
  });

  test('rejects short reasons, government identifiers, and overrides without blockers', () => {
    expect(() => assertPayrollReviewGate({ review, currentFingerprint, overrideReason: 'because' }))
      .toThrow(/between 10 and 1000 characters/);
    expect(() => assertPayrollReviewGate({ review, currentFingerprint, overrideReason: 'Approved using ref 1234567890' }))
      .toThrow(/Do not include bank account numbers or government identifiers/);
    const clearReview = { ...review, findings: [{ severity: 'HIGH', status: 'DISMISSED' }] };
    expect(() => assertPayrollReviewGate({ review: clearReview, currentFingerprint, overrideReason: 'No blockers now' }))
      .toThrow(/only accepted when unresolved/);
    expect(assertPayrollReviewGate({ review: clearReview, currentFingerprint }))
      .toMatchObject({ blockingFindings: [], normalizedOverrideReason: '' });
  });
});
