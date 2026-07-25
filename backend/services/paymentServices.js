import { trace } from '@opentelemetry/api';
import pRetry from 'p-retry';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/db.js';
import logger from '../config/logger.js';

/**
 * NEW: Live-mode gate. Without real provider credentials configured, this
 * service runs in SIMULATION mode - it behaves exactly as it did before
 * (fabricates a 'SENT' result) but now says so loudly in the logs, so a
 * misconfigured production deployment is obvious rather than silently
 * "working" while never actually moving money. This does not change
 * behavior for existing dev/staging setups; it only makes the previously
 * implicit simulation explicit and makes production capable of doing the
 * real thing once credentials exist.
 */
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || null;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || PAYSTACK_SECRET_KEY;
const HUBTEL_CLIENT_ID = process.env.HUBTEL_CLIENT_ID || null;
const HUBTEL_CLIENT_SECRET = process.env.HUBTEL_CLIENT_SECRET || null;
const HUBTEL_MERCHANT_ACCOUNT = process.env.HUBTEL_MERCHANT_ACCOUNT || null;

if (process.env.NODE_ENV === 'production' && !PAYSTACK_SECRET_KEY && !HUBTEL_CLIENT_ID) {
  logger.warn(
    '⚠️  No payment provider credentials configured (PAYSTACK_SECRET_KEY / ' +
    'HUBTEL_CLIENT_ID+HUBTEL_CLIENT_SECRET). Payouts will run in SIMULATION ' +
    'mode - no real money will move, and payslips will appear as "SENT" ' +
    'without genuine disbursement. Configure provider credentials before ' +
    'running real payroll.'
  );
}

/**
 * Real Paystack Transfer API call. Paystack's transfer endpoint is a
 * two-step flow (create a transfer recipient, then initiate a transfer to
 * it) - for brevity and because employee bank/mobile-money recipient codes
 * would need to be created and cached separately, this performs the
 * recipient-creation + transfer as a single best-effort call using the
 * employee's bank details already on file. Verify field names against
 * Paystack's current API reference before enabling in production - their
 * public Transfer API has been stable for years but recipient `type`
 * values (nuban vs mobile_money) depend on the employee's actual payout
 * method, which this schema doesn't yet distinguish (see
 * Employee.bankName/bankAccount - no "payout method" field).
 */
const callPaystackTransfer = async ({ employee, amountInKobo, reference }) => {
  const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'nuban',
      name: employee.name,
      account_number: employee.bankAccount,
      bank_code: employee.bankName, // NOTE: Paystack requires a bank CODE, not a free-text name;
      // map Employee.bankName -> Paystack bank code via their /bank list
      // endpoint before going live. Left as-is here to avoid guessing a
      // mapping table that could silently misroute funds.
      currency: 'GHS',
    }),
  });
  const recipientJson = await recipientRes.json();
  if (!recipientRes.ok || !recipientJson.status) {
    throw new Error(`Paystack recipient creation failed: ${recipientJson.message || recipientRes.status}`);
  }

  const transferRes = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount: amountInKobo,
      recipient: recipientJson.data.recipient_code,
      reference,
      reason: 'Payroll disbursement',
    }),
  });
  const transferJson = await transferRes.json();
  if (!transferRes.ok || !transferJson.status) {
    throw new Error(`Paystack transfer failed: ${transferJson.message || transferRes.status}`);
  }

  return { status: 'SENT', reference, providerTransferCode: transferJson.data?.transfer_code };
};

/**
 * Real Hubtel Send Money call. Hubtel's Merchant API surface varies by
 * account type (Receive Money vs Send Money vs Commission Services) - the
 * shape below follows their commonly documented Send Money pattern.
 * VERIFY against your specific Hubtel merchant contract/docs before
 * enabling in production; this is a reasonable starting structure, not a
 * guaranteed-correct integration for every Hubtel account type.
 */
const callHubtelTransfer = async ({ employee, amountInGHS, reference }) => {
  const auth = Buffer.from(`${HUBTEL_CLIENT_ID}:${HUBTEL_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(
    `https://api.hubtel.com/v1/merchantaccount/merchants/${HUBTEL_MERCHANT_ACCOUNT}/transfers/out`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        RecipientName: employee.name,
        RecipientBankAccount: employee.bankAccount,
        RecipientBank: employee.bankName,
        Amount: amountInGHS,
        ClientReference: reference,
        Description: 'Payroll disbursement',
      }),
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Hubtel transfer failed: ${json.Message || res.status}`);
  }

  return { status: 'SENT', reference, providerTransactionId: json.Data?.TransactionId };
};

/**
 * Core Payout Logic with Idempotency Protection
 */
export const processPayout = async (payrollItemId, provider = 'hubtel') => {
  const tracer = trace.getTracer('payment-service');
  return await tracer.startActiveSpan('processPayout', async (span) => {
    try {
      // 1. Fetch Item & Check Previous Status (Critical Guard)
      const item = await prisma.payrollItem.findUnique({
        where: { id: payrollItemId },
        include: {
          employee: { select: { bankAccount: true, bankName: true, name: true } },
          payrollRun: { select: { companyId: true } }
        },
      });

      if (!item || item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT') {
        throw new Error(`Invalid Payout State: Item ${payrollItemId} already processed or missing.`);
      }

      if (!item.employee?.bankAccount || !item.employee?.bankName) {
        throw new Error(
          `Cannot disburse: employee ${item.employee?.name || item.employeeId} has no bank account on file.`
        );
      }

      // 2. Generate/Retrieve Idempotency Key
      const idempotencyKey = item.paymentRef || `pay_${item.id}_${uuidv4().substring(0, 8)}`;

      if (!item.paymentRef) {
        await prisma.payrollItem.update({
          where: { id: payrollItemId },
          data: { paymentRef: idempotencyKey, paymentStatus: 'PENDING' }
        });
      }

      // Prisma Decimal instances must be explicitly Number()-converted -
      // see CLAUDE.md's Decimal-safety rule; `+`/comparisons on a raw
      // Decimal silently do the wrong thing for some operators.
      const netPayNumber = Number(item.netPay);

      let gatewayResult;
      const isLive = provider === 'paystack' ? !!PAYSTACK_SECRET_KEY : !!(HUBTEL_CLIENT_ID && HUBTEL_CLIENT_SECRET);

      // 3. Execution with Provider-Specific Logic
      await pRetry(async () => {
        if (provider === 'hubtel') {
          if (isLive) {
            gatewayResult = await callHubtelTransfer({
              employee: item.employee,
              amountInGHS: netPayNumber,
              reference: idempotencyKey,
            });
          } else {
            logger.warn('PAYMENT_SIMULATION_MODE: Hubtel credentials not configured, faking SENT result', {
              itemId: payrollItemId,
            });
            gatewayResult = { status: 'SENT', reference: idempotencyKey, simulated: true };
          }
        } else if (provider === 'paystack') {
          const amountInKobo = Math.round(netPayNumber * 100);
          if (isLive) {
            gatewayResult = await callPaystackTransfer({
              employee: item.employee,
              amountInKobo,
              reference: idempotencyKey,
            });
          } else {
            logger.warn('PAYMENT_SIMULATION_MODE: Paystack credentials not configured, faking SENT result', {
              itemId: payrollItemId,
            });
            gatewayResult = { status: 'SENT', reference: idempotencyKey, amount: amountInKobo, simulated: true };
          }
        } else {
          throw new Error(`Unsupported payment provider: ${provider}`);
        }
      }, { retries: 3, onFailedAttempt: error => {
        logger.warn(`Payout attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { itemId: payrollItemId });
      }});

      // 4. Record the Attempt
      await prisma.payrollItem.update({
        where: { id: payrollItemId },
        data: {
          paymentStatus: 'SENT',
          updatedAt: new Date()
        }
      });

      // Fraud Detection Hook: Flag unusual amounts (> 100k GHS)
      if (netPayNumber > 100000) {
        logger.warn('HIGH_VALUE_PAYOUT_DETECTED', { itemId: item.id, amount: netPayNumber });
      }

      span.setAttributes({
        "payout.itemId": payrollItemId,
        "payout.provider": provider,
        "payout.status": "SENT",
        "payout.reference": idempotencyKey,
        "payout.simulated": !isLive,
      });

      return gatewayResult;

    } catch (error) {
      logger.error('Payout Execution Failed', { itemId: payrollItemId, error: error.message });
      // Update DB to FAILED so admin can manually retry or change provider
      await prisma.payrollItem.update({
        where: { id: payrollItemId },
        data: { paymentStatus: 'FAILED' }
      }).catch(() => {
        logger.error('Failed to mark payout as FAILED', { itemId: payrollItemId });
      });
      throw error;
    } finally {
      span.end();
    }
  });
};

/**
 * NEW: Verifies a Paystack webhook signature (HMAC-SHA512 of the raw
 * request body using the secret key, per Paystack's documented scheme).
 * server.js must capture the raw request body (see the `verify` callback
 * added to express.json()) for this to work, since JSON.stringify(parsed
 * body) is not guaranteed to byte-for-byte match what Paystack signed.
 *
 * @param {Buffer} rawBody
 * @param {string} signatureHeader - the 'x-paystack-signature' header value
 * @returns {boolean}
 */
export const verifyPaystackSignature = (rawBody, signatureHeader) => {
  if (!PAYSTACK_WEBHOOK_SECRET || !signatureHeader || !rawBody) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signatureHeader));
  } catch {
    // Buffers of different lengths throw in timingSafeEqual - treat as invalid.
    return false;
  }
};

/**
 * Webhook Handler for Async Status Updates.
 * Promotes a payroll item from SENT -> PAID (or -> FAILED) once the
 * provider confirms the transfer's final state.
 */
export const handlePaymentWebhook = async (payload) => {
  const { reference, status, failureReason } = payload;

  if (!reference) {
    logger.warn('Webhook payload missing reference, ignoring', { payload });
    return;
  }

  try {
    const normalizedStatus = String(status || '').toLowerCase();
    const nextStatus = ['success', 'successful', 'paid'].includes(normalizedStatus) ? 'PAID' : 'FAILED';

    const updated = await prisma.payrollItem.updateMany({
      where: { paymentRef: reference, paymentStatus: { in: ['SENT', 'PENDING'] } },
      data: { paymentStatus: nextStatus },
    });

    if (updated.count > 0) {
      logger.info(`Payment status updated via webhook: ${reference} -> ${nextStatus}`, { failureReason });

      // Audit trail: disbursement confirmation is exactly the kind of
      // sensitive payroll event CLAUDE.md requires logging.
      const item = await prisma.payrollItem.findFirst({
        where: { paymentRef: reference },
        include: { payrollRun: { select: { companyId: true } } },
      });
      if (item) {
        await prisma.auditLog.create({
          data: {
            companyId: item.payrollRun.companyId,
            action: 'PAYROLL_PAYOUT_WEBHOOK_CONFIRMED',
            details: { reference, status: nextStatus, failureReason: failureReason || null },
            resourceId: item.id,
            resourceType: 'PayrollItem',
          },
        });
      }
    } else {
      logger.warn(`Webhook received for unknown or already-finalized reference: ${reference}`);
    }
  } catch (error) {
    logger.error('Webhook processing failed', { reference, error: error.message });
    throw error;
  }
};
