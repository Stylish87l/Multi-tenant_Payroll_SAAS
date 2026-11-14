import { describe, test, expect } from '@jest/globals';
import { resolvePayoutMode } from '../utils/paymentConfiguration.js';

const paystackEnv = {
  NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'test-key', ENABLE_LIVE_PAYOUTS: 'true',
  PAYSTACK_TRANSFER_CONFIGURATION_VERIFIED: 'true',
};
const hubtelEnv = {
  NODE_ENV: 'production', HUBTEL_CLIENT_ID: 'id', HUBTEL_CLIENT_SECRET: 'secret',
  HUBTEL_MERCHANT_ACCOUNT: 'merchant', ENABLE_LIVE_PAYOUTS: 'true',
  HUBTEL_TRANSFER_CONTRACT_VERIFIED: 'true',
};

describe('live payout safety gate', () => {
  test('allows simulation only outside production when credentials are absent', () => {
    expect(resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { NODE_ENV: 'test' } })).toBe('SIMULATION');
  });
  test('refuses production simulation when provider credentials are missing', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { NODE_ENV: 'production' } }))
      .toThrow(/refusing to simulate/);
  });
  test('requires explicit global opt-in even when credentials exist', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { ...hubtelEnv, ENABLE_LIVE_PAYOUTS: 'false' } }))
      .toThrow(/Live payouts are disabled/);
  });
  test('requires Hubtel contract verification before live transfers', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { ...hubtelEnv, HUBTEL_TRANSFER_CONTRACT_VERIFIED: 'false' } }))
      .toThrow(/contract/);
  });
  test('requires Paystack bank-code mapping verification and an employee bank code', () => {
    expect(() => resolvePayoutMode({ provider: 'paystack', employee: { bankName: 'GCB Bank' }, env: paystackEnv }))
      .toThrow(/bank code/);
    expect(resolvePayoutMode({ provider: 'paystack', employee: { bankCode: 'GH-GCB' }, env: paystackEnv })).toBe('LIVE');
  });
});
