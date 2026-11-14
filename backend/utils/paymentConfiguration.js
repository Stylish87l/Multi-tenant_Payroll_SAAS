/**
 * Fail-closed live payout configuration.
 *
 * Credentials alone must never activate money movement. A live transfer requires
 * an explicit global opt-in and provider-specific verification. Paystack also
 * requires a provider bank code; a display name such as "GCB Bank" is not a code.
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
    : Boolean(env.HUBTEL_CLIENT_ID && env.HUBTEL_CLIENT_SECRET && env.HUBTEL_MERCHANT_ACCOUNT);

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

  if (provider === 'hubtel' && env.HUBTEL_TRANSFER_CONTRACT_VERIFIED !== 'true') {
    throw new PayoutStateError('Hubtel transfers are blocked until the merchant transfer contract and request format have been verified.');
  }

  return 'LIVE';
};
