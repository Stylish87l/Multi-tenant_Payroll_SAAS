import { describe, test, expect } from '@jest/globals';
import { mergePayslipTemplate } from '../utils/payslipBranding.js';

describe('tenant payslip branding persistence', () => {
  test('merges partial settings without discarding existing template preferences', () => {
    expect(mergePayslipTemplate(
      { tagline: 'People first', logoAlignment: 'left', showFooter: true },
      { logoAlignment: 'right', showFooter: false },
    )).toEqual({ tagline: 'People first', logoAlignment: 'right', showFooter: false });
  });

  test('starts from an empty object for a new tenant template', () => {
    expect(mergePayslipTemplate(null, { logoAlignment: 'center' })).toEqual({ logoAlignment: 'center' });
  });

  test('allows an explicit reset', () => {
    expect(mergePayslipTemplate({ tagline: 'Old' }, null)).toBeNull();
  });
});
