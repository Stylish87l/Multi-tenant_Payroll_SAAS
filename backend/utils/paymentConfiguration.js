/**
 * Fail-closed live payout configuration.
 *
 * Credentials alone must never activate money movement. Hubtel live payouts require
 * verified merchant credentials, bank-account verification, and trusted callback ingress.
 */
export class PayoutStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayoutStateError';
    this.expose = true;
  }
}

export const resolvePayoutMode = ({ provider, employee, env = process.env }) => {
  if (!['hubtel', 'paystack'].includes(provider)) {
    throw new PayoutStateError(`Unsupported payment provider: ${provider}`);
  }

  const credentialsPresent = provider === 'paystack'
    ? Boolean(env.PAYSTACK_SECRET_KEY)
    : Boolean(
      env.HUBTEL_API_ID && env.HUBTEL_API_KEY && env.HUBTEL_COLLECTION_ACCOUNT
      && env.HUBTEL_DISBURSEMENT_ACCOUNT && env.HUBTEL_PAYOUT_CALLBACK_URL
    );

  if (!credentialsPresent) {
    if (['development', 'test'].includes(env.NODE_ENV)) return 'SIMULATION';
    throw new PayoutStateError(`Payment provider "${provider}" is not configured; refusing to simulate outside development/test.`);
  }

  if (env.ENABLE_LIVE_PAYOUTS !== 'true') {
    throw new PayoutStateError('Live payouts are disabled. Enable them only after completing provider verification and a successful sandbox reconciliation.');
  }

  if (provider === 'paystack') {
    if (env.PAYSTACK_TRANSFER_CONFIGURATION_VERIFIED !== 'true') {
      throw new PayoutStateError('Paystack transfers are blocked until the transfer configuration and bank-code mapping have been verified.');
    }
    if (!employee?.bankCode) {
      throw new PayoutStateError('Paystack payout requires a verified bank code on the employee record.');
    }
  }

  if (provider === 'hubtel') {
    if (env.HUBTEL_TRANSFER_CONTRACT_VERIFIED !== 'true') {
      throw new PayoutStateError('Hubtel transfers are blocked until the current Send to Bank contract has been verified in the Hubtel sandbox.');
    }
    let callbackUrl;
    try { callbackUrl = new URL(env.HUBTEL_PAYOUT_CALLBACK_URL); } catch { throw new PayoutStateError('HUBTEL_PAYOUT_CALLBACK_URL must be a valid HTTPS URL.'); }
    if (callbackUrl.protocol !== 'https:') throw new PayoutStateError('HUBTEL_PAYOUT_CALLBACK_URL must use HTTPS.');
    if (env.HUBTEL_CALLBACK_INGRESS_ALLOWLIST_VERIFIED !== 'true') {
      throw new PayoutStateError('Hubtel payouts are blocked until the callback ingress is restricted to Hubtel source IPs and the trusted proxy chain is verified.');
    }
    if (!employee?.bankCode || !employee?.bankAccount || !employee?.bankName || !employee?.name) {
      throw new PayoutStateError('Hubtel bank payouts require a bank code, bank name, account number and employee name.');
    }
  }

  return 'LIVE';
};
