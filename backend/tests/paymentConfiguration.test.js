import { describe, test, expect } from '@jest/globals';
import { resolvePayoutMode } from '../utils/paymentConfiguration.js';

const paystackEnv = {
  NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'test-key', ENABLE_LIVE_PAYOUTS: 'true',
  PAYSTACK_TRANSFER_CONFIGURATION_VERIFIED: 'true',
};
const hubtelEnv = {
  NODE_ENV: 'production', HUBTEL_API_ID: 'api-id', HUBTEL_API_KEY: 'api-key',
  HUBTEL_COLLECTION_ACCOUNT: 'collection-account', HUBTEL_DISBURSEMENT_ACCOUNT: 'disbursement-account',
  HUBTEL_PAYOUT_CALLBACK_URL: 'https://api.example.test/api/webhooks/hubtel',
  ENABLE_LIVE_PAYOUTS: 'true', HUBTEL_TRANSFER_CONTRACT_VERIFIED: 'true',
  HUBTEL_CALLBACK_INGRESS_ALLOWLIST_VERIFIED: 'true',
};
const employee = { name: 'Kwame Asante', bankCode: '300304', bankName: 'GCB BANK LIMITED', bankAccount: '0012345678' };

describe('live payout safety gate', () => {
  test('allows simulation only outside production when credentials are absent', () => {
    expect(resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { NODE_ENV: 'test' } })).toBe('SIMULATION');
  });
  test('refuses production simulation when provider credentials are missing', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee: {}, env: { NODE_ENV: 'production' } }))
      .toThrow(/refusing to simulate/);
  });
  test('requires explicit global opt-in even when credentials exist', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee, env: { ...hubtelEnv, ENABLE_LIVE_PAYOUTS: 'false' } }))
      .toThrow(/Live payouts are disabled/);
  });
  test('requires the current Hubtel Send to Bank contract verification', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee, env: { ...hubtelEnv, HUBTEL_TRANSFER_CONTRACT_VERIFIED: 'false' } }))
      .toThrow(/contract/);
  });
  test('requires trusted callback ingress verification', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee, env: { ...hubtelEnv, HUBTEL_CALLBACK_INGRESS_ALLOWLIST_VERIFIED: 'false' } }))
      .toThrow(/callback ingress/);
  });
  test('requires an HTTPS callback URL and complete employee bank details', () => {
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee, env: { ...hubtelEnv, HUBTEL_PAYOUT_CALLBACK_URL: 'http://example.test/hook' } }))
      .toThrow(/HTTPS/);
    expect(() => resolvePayoutMode({ provider: 'hubtel', employee: { ...employee, bankCode: null }, env: hubtelEnv }))
      .toThrow(/bank code/);
  });
  test('enables Hubtel live mode only when every gate is satisfied', () => {
    expect(resolvePayoutMode({ provider: 'hubtel', employee, env: hubtelEnv })).toBe('LIVE');
  });
  test('preserves Paystack bank-code verification', () => {
    expect(() => resolvePayoutMode({ provider: 'paystack', employee: { bankName: 'GCB Bank' }, env: paystackEnv }))
      .toThrow(/bank code/);
    expect(resolvePayoutMode({ provider: 'paystack', employee: { bankCode: 'GH-GCB' }, env: paystackEnv })).toBe('LIVE');
  });
});
