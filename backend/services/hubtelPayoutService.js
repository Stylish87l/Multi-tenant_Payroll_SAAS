import { AbortError } from 'p-retry';
import { PayoutStateError } from '../utils/paymentConfiguration.js';

const HUBTEL_SEND_HOST = 'https://smp.hubtel.com';
const HUBTEL_VERIFY_HOST = 'https://cs.hubtel.com';

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new PayoutStateError(`Missing required Hubtel setting: ${name}`);
  return value;
};

const authHeaders = () => ({
  Authorization: `Basic ${Buffer.from(`${requiredEnv('HUBTEL_API_ID')}:${requiredEnv('HUBTEL_API_KEY')}`).toString('base64')}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
});

const readResponse = async (response, label) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = `${label} failed with HTTP ${response.status}`;
    if (response.status >= 400 && response.status < 500) throw new AbortError(message);
    throw new Error(message);
  }
  return payload;
};

export const normalizeAccountHolderName = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(' ');

export const verifyHubtelBankAccountName = async ({ bankCode, bankAccount, employeeName }) => {
  if (!/^\d{6}$/.test(String(bankCode || ''))) throw new PayoutStateError('A valid Hubtel/GhIPSS bank code is required for a live bank payout.');
  if (!/^\d{6,20}$/.test(String(bankAccount || ''))) throw new PayoutStateError('A valid bank account number is required for a live bank payout.');
  if (!employeeName) throw new PayoutStateError('The employee name is required for bank account verification.');

  const collectionAccount = encodeURIComponent(requiredEnv('HUBTEL_COLLECTION_ACCOUNT'));
  const url = `${HUBTEL_VERIFY_HOST}/v2/merchantaccount/merchants/${collectionAccount}/bank/verify/${encodeURIComponent(bankCode)}/${encodeURIComponent(bankAccount)}`;
  const response = await fetch(url, { method: 'GET', headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  const payload = await readResponse(response, 'Hubtel bank account verification');
  const responseCode = String(payload.responseCode ?? payload.ResponseCode ?? '');
  const verifiedName = payload.data?.name ?? payload.Data?.Name;
  if (responseCode !== '0000' || typeof verifiedName !== 'string' || !verifiedName.trim()) {
    throw new AbortError('Hubtel could not verify the employee bank account. Confirm the bank details before retrying.');
  }
  if (normalizeAccountHolderName(verifiedName) !== normalizeAccountHolderName(employeeName)) {
    throw new PayoutStateError('The verified bank account holder name does not match the employee record. Resolve the mismatch before payout.');
  }
  return verifiedName.trim();
};

export const submitHubtelBankPayout = async ({
  bankCode, bankName, bankAccount, verifiedAccountName, amount, reference,
}) => {
  if (!/^\d{6}$/.test(String(bankCode || ''))) throw new PayoutStateError('A valid Hubtel/GhIPSS bank code is required for a live bank payout.');
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
    throw new PayoutStateError('Hubtel bank payouts must be a positive GHS amount with no more than two decimal places.');
  }
  if (!reference || reference.length > 36) throw new PayoutStateError('Hubtel client references must be unique and no longer than 36 characters.');
  const callbackUrl = requiredEnv('HUBTEL_PAYOUT_CALLBACK_URL');
  let parsedCallbackUrl;
  try { parsedCallbackUrl = new URL(callbackUrl); } catch { throw new PayoutStateError('HUBTEL_PAYOUT_CALLBACK_URL must be a valid HTTPS URL.'); }
  if (parsedCallbackUrl.protocol !== 'https:') throw new PayoutStateError('HUBTEL_PAYOUT_CALLBACK_URL must use HTTPS.');

  const account = encodeURIComponent(requiredEnv('HUBTEL_DISBURSEMENT_ACCOUNT'));
  const url = `${HUBTEL_SEND_HOST}/api/merchants/${account}/send/bank/gh/${encodeURIComponent(bankCode)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      Amount: amount,
      BankName: bankName,
      BankAccountNumber: bankAccount,
      BankAccountName: verifiedAccountName,
      ClientReference: reference,
      PrimaryCallbackUrl: callbackUrl,
      Description: 'Paylio payroll disbursement',
    }),
  });
  const payload = await readResponse(response, 'Hubtel bank payout');
  const responseCode = String(payload.ResponseCode ?? payload.responseCode ?? '');
  if (responseCode === '0000') {
    return { status: 'PAID', reference, providerTransactionId: payload.Data?.TransactionId ?? null };
  }
  if (responseCode === '0001') {
    return { status: 'PROCESSING', reference, providerTransactionId: payload.Data?.TransactionId ?? null };
  }
  const message = `Hubtel bank payout returned response code ${responseCode || 'unknown'}`;
  if (['3050', '4000', '4075'].includes(responseCode)) throw new AbortError(message);
  // 2001/5000 and undocumented codes remain ambiguous: never release the payout for a blind retry.
  throw new Error(message);
};

export const getHubtelPayoutStatus = async ({ reference }) => {
  if (!reference) throw new PayoutStateError('A payout reference is required for Hubtel status reconciliation.');
  const account = encodeURIComponent(requiredEnv('HUBTEL_DISBURSEMENT_ACCOUNT'));
  const url = new URL(`${HUBTEL_SEND_HOST}/api/merchants/${account}/transactions/status`);
  url.searchParams.set('clientReference', reference);
  const response = await fetch(url, { method: 'GET', headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  const payload = await readResponse(response, 'Hubtel payout status check');
  const data = payload.Data ?? payload.data;
  if (!data || String(data.ClientReference ?? data.clientReference ?? '') !== reference) {
    throw new Error('Hubtel payout status response did not match the requested client reference.');
  }
  const status = String(data.transactionStatus ?? data.TransactionStatus ?? data.status ?? '').toLowerCase();
  const mappedStatus = ['success', 'successful', 'paid'].includes(status)
    ? 'PAID'
    : ['failed', 'failure', 'rejected', 'cancelled', 'canceled'].includes(status)
      ? 'FAILED'
      : 'PROCESSING';
  return {
    reference,
    status: mappedStatus,
    amount: data.Amount ?? data.amount,
    providerTransactionId: data.TransactionId ?? data.transactionId ?? null,
    rawStatus: status,
  };
};
