import { trace } from '@opentelemetry/api';
import pRetry, { AbortError } from 'p-retry';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import prisma, { Prisma } from '../config/db.js';
import logger from '../config/logger.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || null;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || PAYSTACK_SECRET_KEY;
const HUBTEL_CLIENT_ID = process.env.HUBTEL_CLIENT_ID || null;
const HUBTEL_CLIENT_SECRET = process.env.HUBTEL_CLIENT_SECRET || null;
const HUBTEL_MERCHANT_ACCOUNT = process.env.HUBTEL_MERCHANT_ACCOUNT || null;

/**
 * Simulation mode fabricates a "SENT" result without moving money. It is now OPT-IN in
 * production (ALLOW_PAYMENT_SIMULATION=true). Previously a production deploy without provider
 * credentials silently "paid" everyone - the payslips said SENT and no money moved.
 */
const ALLOW_SIMULATION = process.env.ALLOW_PAYMENT_SIMULATION === 'true' || process.env.NODE_ENV !== 'production';

/** Thrown for "this item may not be paid right now". Must NEVER flip the item to FAILED. */
class PayoutStateError extends Error {
  constructor(message) { super(message); this.name = 'PayoutStateError'; this.expose = true; }
}

/** 4xx responses are deterministic: retrying cannot help and risks duplicate transfers. */
const assertOk = (res, json, label) => {
  if (res.ok && json?.status !== false) return;
  const message = `${label} failed: ${json?.message || json?.Message || res.status}`;
  if (res.status >= 400 && res.status < 500) throw new AbortError(message);
  throw new Error(message);
};

/**
 * Paystack Transfer (recipient creation + transfer).
 * VERIFY before production: Paystack needs a bank CODE (not free-text bankName), and recipient
 * `type` depends on payout method. Left unmapped on purpose to avoid silently misrouting funds.
 */
const callPaystackTransfer = async ({ employee, amountInSubunit, reference }) => {
  const headers = { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' };

  const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      type: 'nuban', name: employee.name, account_number: employee.bankAccount,
      bank_code: employee.bankName, currency: 'GHS',
    }),
  });
  const recipientJson = await recipientRes.json().catch(() => ({}));
  assertOk(recipientRes, recipientJson, 'Paystack recipient creation');

  const transferRes = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      source: 'balance', amount: amountInSubunit, recipient: recipientJson.data.recipient_code,
      reference, reason: 'Payroll disbursement',
    }),
  });
  const transferJson = await transferRes.json().catch(() => ({}));
  assertOk(transferRes, transferJson, 'Paystack transfer');

  return { status: 'SENT', reference, providerTransferCode: transferJson.data?.transfer_code };
};

/** VERIFY against your Hubtel merchant contract/docs: request shape varies by account type. */
const callHubtelTransfer = async ({ employee, amountInGHS, reference }) => {
  const auth = Buffer.from(`${HUBTEL_CLIENT_ID}:${HUBTEL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(
    `https://api.hubtel.com/v1/merchantaccount/merchants/${HUBTEL_MERCHANT_ACCOUNT}/transfers/out`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        RecipientName: employee.name, RecipientBankAccount: employee.bankAccount, RecipientBank: employee.bankName,
        Amount: amountInGHS, ClientReference: reference, Description: 'Payroll disbursement',
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  assertOk(res, json, 'Hubtel transfer');
  return { status: 'SENT', reference, providerTransactionId: json.Data?.TransactionId };
};

/**
 * Core payout logic with idempotency and double-pay protection.
 *
 * FIXED (critical): the old catch block marked the item FAILED for ANY error - including the
 * "already processed" guard. A second/concurrent call on a PAID or SENT item therefore flipped
 * it to FAILED, making it eligible to be paid AGAIN. Now:
 *  1. The item is atomically CLAIMED (updateMany conditioned on status + updatedAt), so two
 *     concurrent calls cannot both proceed.
 *  2. Guard errors never change status.
 *  3. Only a failed provider call (claimed, pre-send) marks FAILED, and only from PENDING.
 *  4. If the provider succeeded but our DB write failed, we do NOT mark FAILED (money moved) -
 *     we log CRITICAL for manual reconciliation; the webhook will normally repair it.
 */
export const processPayout = async (payrollItemId, provider = 'hubtel') => {
  const tracer = trace.getTracer('payment-service');
  return await tracer.startActiveSpan('processPayout', async (span) => {
    let claimed = false;
    let providerSucceeded = false;
    try {
      const item = await prisma.payrollItem.findUnique({
        where: { id: payrollItemId },
        include: { employee: { select: { bankAccount: true, bankName: true, name: true } }, payrollRun: { select: { status: true } } },
      });

      if (!item) throw new PayoutStateError('Payroll item not found.');
      if (item.payrollRun?.status !== 'FINALIZED') {
        throw new PayoutStateError('Payroll must be FINALIZED before any payout can be processed.');
      }
      const netPayDecimal = new Prisma.Decimal(item.netPay);
      if (!netPayDecimal.isFinite() || netPayDecimal.lte(0)) {
        throw new PayoutStateError('Payout amount must be a finite positive amount.');
      }
      if (item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT') {
        throw new PayoutStateError(`Item ${payrollItemId} has already been processed.`);
      }
      if (!item.employee?.bankAccount || !item.employee?.bankName) {
        throw new PayoutStateError(`Cannot disburse: ${item.employee?.name || item.employeeId} has no bank account on file.`);
      }

      const isLive = provider === 'paystack' ? !!PAYSTACK_SECRET_KEY : !!(HUBTEL_CLIENT_ID && HUBTEL_CLIENT_SECRET && HUBTEL_MERCHANT_ACCOUNT);
      if (!isLive && !ALLOW_SIMULATION) {
        throw new PayoutStateError(`Payment provider "${provider}" is not configured; refusing to simulate in production.`);
      }
      if (provider !== 'hubtel' && provider !== 'paystack') {
        throw new PayoutStateError(`Unsupported payment provider: ${provider}`);
      }

      // Atomic claim. @updatedAt changes on every write, so a concurrent claimer's `updatedAt` filter fails.
      const idempotencyKey = item.paymentRef || `pay_${item.id}_${uuidv4().substring(0, 8)}`;
      const claim = await prisma.payrollItem.updateMany({
        where: { id: payrollItemId, paymentStatus: { in: ['PENDING', 'FAILED'] }, updatedAt: item.updatedAt },
        data: { paymentRef: idempotencyKey, paymentStatus: 'PENDING' },
      });
      if (claim.count !== 1) throw new PayoutStateError(`Item ${payrollItemId} is already being processed.`);
      claimed = true;

      // Decimal validation above; convert only at the external provider boundary.
      const netPay = netPayDecimal.toNumber();
      let gatewayResult;

      await pRetry(async () => {
        if (provider === 'hubtel') {
          gatewayResult = isLive
            ? await callHubtelTransfer({ employee: item.employee, amountInGHS: netPay, reference: idempotencyKey })
            : (logger.warn('PAYMENT_SIMULATION_MODE: Hubtel not configured, faking SENT', { itemId: payrollItemId }),
               { status: 'SENT', reference: idempotencyKey, simulated: true });
        } else {
          const amountInSubunit = netPayDecimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
          gatewayResult = isLive
            ? await callPaystackTransfer({ employee: item.employee, amountInSubunit, reference: idempotencyKey })
            : (logger.warn('PAYMENT_SIMULATION_MODE: Paystack not configured, faking SENT', { itemId: payrollItemId }),
               { status: 'SENT', reference: idempotencyKey, amount: amountInSubunit, simulated: true });
        }
      }, {
        retries: 3,
        onFailedAttempt: (error) =>
          logger.warn(`Payout attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { itemId: payrollItemId }),
      });
      providerSucceeded = true;

      await prisma.payrollItem.update({ where: { id: payrollItemId }, data: { paymentStatus: 'SENT' } });

      if (netPay > 100000) logger.warn('HIGH_VALUE_PAYOUT_DETECTED', { itemId: item.id, amount: netPay });

      span.setAttributes({
        'payout.itemId': payrollItemId, 'payout.provider': provider, 'payout.status': 'SENT',
        'payout.reference': idempotencyKey, 'payout.simulated': !isLive,
      });
      return gatewayResult;
    } catch (error) {
      if (providerSucceeded) {
        logger.error('CRITICAL: payout sent but status update failed - reconcile manually', { itemId: payrollItemId, error: error.message });
      } else if (claimed) {
        logger.error('Payout Execution Failed', { itemId: payrollItemId, error: error.message });
        await prisma.payrollItem
          .updateMany({ where: { id: payrollItemId, paymentStatus: 'PENDING' }, data: { paymentStatus: 'FAILED' } })
          .catch(() => logger.error('Failed to mark payout as FAILED', { itemId: payrollItemId }));
      } else {
        logger.warn('Payout rejected by guard', { itemId: payrollItemId, reason: error.message });
      }
      throw error;
    } finally {
      span.end();
    }
  });
};

/** HMAC-SHA512 of the raw body with the secret key (Paystack's documented scheme). */
export const verifyPaystackSignature = (rawBody, signatureHeader) => {
  if (!PAYSTACK_WEBHOOK_SECRET || !signatureHeader || !rawBody) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signatureHeader));
  } catch {
    return false; // differing lengths throw
  }
};

/** Constant-time shared-secret comparison (Hubtel placeholder auth). */
export const verifySharedSecret = (provided, expected) => {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
};

/** Promotes SENT -> PAID (or FAILED) once the provider confirms the transfer's final state. */
export const handlePaymentWebhook = async (payload) => {
  const { reference, status, failureReason } = payload;
  if (!reference) {
    logger.warn('Webhook payload missing reference, ignoring');
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
      const item = await prisma.payrollItem.findFirst({
        where: { paymentRef: reference },
        include: { payrollRun: { select: { companyId: true } } },
      });
      if (item) {
        await prisma.auditLog.create({
          data: {
            companyId: item.payrollRun.companyId,
            action: 'PAYROLL_PAYOUT_WEBHOOK_CONFIRMED',
            details: { reference, status: nextStatus, failureReason: failureReason ? String(failureReason).slice(0, 500) : null },
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
