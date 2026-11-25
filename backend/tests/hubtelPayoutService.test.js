import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  getHubtelPayoutStatus,
  normalizeAccountHolderName,
  submitHubtelBankPayout,
  verifyHubtelBankAccountName,
} from '../services/hubtelPayoutService.js';

const originalEnv = { ...process.env };
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('Hubtel bank payout client', () => {
  beforeEach(() => {
    process.env.HUBTEL_API_ID = 'test-api-id';
    process.env.HUBTEL_API_KEY = 'test-api-key';
    process.env.HUBTEL_COLLECTION_ACCOUNT = 'collection-123';
    process.env.HUBTEL_DISBURSEMENT_ACCOUNT = 'disbursement-456';
    process.env.HUBTEL_PAYOUT_CALLBACK_URL = 'https://api.example.test/api/webhooks/hubtel';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('normalizes bank holder names independent of case, punctuation and word order', () => {
    expect(normalizeAccountHolderName('Kwame Osei-Asante')).toBe('ASANTE KWAME OSEI');
    expect(normalizeAccountHolderName('ASANTE, KWAME OSEI')).toBe('ASANTE KWAME OSEI');
  });

  it('verifies the bank account name before payout', async () => {
    global.fetch.mockResolvedValue(response({ responseCode: '0000', data: { name: 'ASANTE, KWAME OSEI' } }));
    const name = await verifyHubtelBankAccountName({
      bankCode: '300304', bankAccount: '0012345678', employeeName: 'Kwame Osei-Asante',
    });
    expect(name).toBe('ASANTE, KWAME OSEI');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cs.hubtel.com/v2/merchantaccount/merchants/collection-123/bank/verify/300304/0012345678',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a bank account name mismatch before sending money', async () => {
    global.fetch.mockResolvedValue(response({ responseCode: '0000', data: { name: 'SOMEONE ELSE' } }));
    await expect(verifyHubtelBankAccountName({
      bankCode: '300304', bankAccount: '12345678', employeeName: 'Kwame Osei',
    })).rejects.toThrow(/does not match the employee record/);
  });

  it('uses the documented Send to Bank endpoint and exact callback fields', async () => {
    global.fetch.mockResolvedValue(response({
      ResponseCode: '0001',
      Data: { TransactionId: 'hubtel-tx-1', ClientReference: 'pay_012345678901234567890123' },
    }));
    const result = await submitHubtelBankPayout({
      bankCode: '300304', bankName: 'GCB BANK LIMITED', bankAccount: '0012345678',
      verifiedAccountName: 'KWAME OSEI', amount: 1250.5, reference: 'pay_012345678901234567890123',
    });
    expect(result).toMatchObject({ status: 'PROCESSING', providerTransactionId: 'hubtel-tx-1' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://smp.hubtel.com/api/merchants/disbursement-456/send/bank/gh/300304');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('test-api-id:test-api-key').toString('base64')}`);
    expect(JSON.parse(options.body)).toMatchObject({
      Amount: 1250.5, BankName: 'GCB BANK LIMITED', BankAccountNumber: '0012345678',
      BankAccountName: 'KWAME OSEI', ClientReference: 'pay_012345678901234567890123',
      PrimaryCallbackUrl: 'https://api.example.test/api/webhooks/hubtel',
    });
  });

  it('treats documented immediate success as PAID', async () => {
    global.fetch.mockResolvedValue(response({ ResponseCode: '0000', Data: { TransactionId: 'tx-success' } }));
    const result = await submitHubtelBankPayout({
      bankCode: '300304', bankName: 'GCB BANK LIMITED', bankAccount: '12345678',
      verifiedAccountName: 'KWAME OSEI', amount: 10, reference: 'pay_012345678901234567890123',
    });
    expect(result.status).toBe('PAID');
  });

  it('marks explicit validation and insufficient-balance responses as definitive failures', async () => {
    global.fetch.mockResolvedValue(response({ ResponseCode: '4075', Message: 'Insufficient prepaid balance' }));
    await expect(submitHubtelBankPayout({
      bankCode: '300304', bankName: 'GCB BANK LIMITED', bankAccount: '12345678',
      verifiedAccountName: 'KWAME OSEI', amount: 10, reference: 'pay_012345678901234567890123',
    })).rejects.toThrow(/4075/);
  });

  it('keeps ambiguous provider response codes non-retryable for reconciliation', async () => {
    global.fetch.mockResolvedValue(response({ ResponseCode: '5000' }));
    await expect(submitHubtelBankPayout({
      bankCode: '300304', bankName: 'GCB BANK LIMITED', bankAccount: '12345678',
      verifiedAccountName: 'KWAME OSEI', amount: 10, reference: 'pay_012345678901234567890123',
    })).rejects.toThrow(/5000/);
  });

  it('checks status by clientReference and maps only documented terminal values', async () => {
    global.fetch.mockResolvedValue(response({
      ResponseCode: 'success',
      Data: { ClientReference: 'pay_012345678901234567890123', transactionStatus: 'success', Amount: 10, TransactionId: 'tx-2' },
    }));
    const result = await getHubtelPayoutStatus({ reference: 'pay_012345678901234567890123' });
    expect(result).toMatchObject({ status: 'PAID', amount: 10, providerTransactionId: 'tx-2' });
    expect(global.fetch.mock.calls[0][0].toString()).toContain('clientReference=pay_012345678901234567890123');
  });

  it('rejects a status response for a different reference', async () => {
    global.fetch.mockResolvedValue(response({
      ResponseCode: 'success',
      Data: { ClientReference: 'another-reference', transactionStatus: 'success', Amount: 10 },
    }));
    await expect(getHubtelPayoutStatus({ reference: 'pay_012345678901234567890123' }))
      .rejects.toThrow(/did not match/);
  });
});
