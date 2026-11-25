import { trace } from '@opentelemetry/api';
import { AbortError } from 'p-retry';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import prisma, { Prisma } from '../config/db.js';
import logger from '../config/logger.js';
import { enqueueBackgroundJob } from './backgroundJobService.js';
import { PayoutStateError, resolvePayoutMode } from '../utils/paymentConfiguration.js';
import { getHubtelPayoutStatus, submitHubtelBankPayout, verifyHubtelBankAccountName } from './hubtelPayoutService.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || null;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || PAYSTACK_SECRET_KEY;
const HUBTEL_CLIENT_ID = process.env.HUBTEL_CLIENT_ID || null;
const HUBTEL_CLIENT_SECRET = process.env.HUBTEL_CLIENT_SECRET || null;
const HUBTEL_MERCHANT_ACCOUNT = process.env.HUBTEL_MERCHANT_ACCOUNT || null;

/**
 * Simulation is restricted to development/test. Live transfers require an explicit
 * global opt-in plus provider-specific verification (see utils/paymentConfiguration.js).
 */

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
      bank_code: employee.bankCode, currency: 'GHS',
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

  return { status: 'PROCESSING', reference, providerTransferCode: transferJson.data?.transfer_code, providerStatus: transferJson.data?.status || 'pending' };
};

export const processPayout = async (payrollItemId, provider = 'hubtel') => {
  const tracer = trace.getTracer('payment-service');
  return await tracer.startActiveSpan('processPayout', async (span) => {
    let claimed = false;
    let providerSucceeded = false;
    try {
      const item = await prisma.payrollItem.findUnique({
        where: { id: payrollItemId },
        include: { employee: { select: { bankAccount: true, bankName: true, bankCode: true, name: true } }, payrollRun: { select: { status: true, companyId: true } } },
      });

      if (!item) throw new PayoutStateError('Payroll item not found.');
      if (item.payrollRun?.status !== 'FINALIZED') {
        throw new PayoutStateError('Payroll must be FINALIZED before any payout can be processed.');
      }
      const netPayDecimal = new Prisma.Decimal(item.netPay);
      if (!netPayDecimal.isFinite() || netPayDecimal.lte(0)) {
        throw new PayoutStateError('Payout amount must be a finite positive amount.');
      }
      if (['PAID', 'SENT', 'PROCESSING'].includes(item.paymentStatus)) {
        throw new PayoutStateError(`Item ${payrollItemId} has already been processed.`);
      }
      if (!item.employee?.bankAccount || !item.employee?.bankName) {
        throw new PayoutStateError(`Cannot disburse: ${item.employee?.name || item.employeeId} has no bank account on file.`);
      }

      const payoutMode = resolvePayoutMode({ provider, employee: item.employee });
      const isLive = payoutMode === 'LIVE';

      // Atomic claim. @updatedAt changes on every write, so a concurrent claimer's `updatedAt` filter fails.
      const idempotencyKey = `pay_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
      const claim = await prisma.payrollItem.updateMany({
        where: { id: payrollItemId, paymentStatus: { in: ['PENDING', 'FAILED'] }, updatedAt: item.updatedAt },
        data: { paymentRef: idempotencyKey, paymentStatus: 'PROCESSING', payoutProvider: provider.toUpperCase(), providerTransactionId: null },
      });
      if (claim.count !== 1) throw new PayoutStateError(`Item ${payrollItemId} is already being processed.`);
      claimed = true;

      // Decimal validation above; convert only at the external provider boundary.
      const netPay = netPayDecimal.toNumber();
      let gatewayResult;

      if (provider === 'hubtel') {
        gatewayResult = isLive
          ? await submitHubtelBankPayout({
            bankCode: item.employee.bankCode, bankName: item.employee.bankName, bankAccount: item.employee.bankAccount,
            verifiedAccountName: verifiedBankAccountName, amount: netPay, reference: idempotencyKey,
          })
          : (logger.warn('PAYMENT_SIMULATION_MODE: Hubtel not configured, faking SENT', { itemId: payrollItemId }),
             { status: 'SENT', reference: idempotencyKey, simulated: true });
      } else {
        const amountInSubunit = netPayDecimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
        gatewayResult = isLive
          ? await callPaystackTransfer({ employee: item.employee, amountInSubunit, reference: idempotencyKey })
          : (logger.warn('PAYMENT_SIMULATION_MODE: Paystack not configured, faking SENT', { itemId: payrollItemId }),
             { status: 'SENT', reference: idempotencyKey, amount: amountInSubunit, simulated: true });
      }
      providerSucceeded = true;

      // A webhook can arrive before the provider request returns. Never overwrite its final state.
      // Paystack transfer acceptance is not proof that the employee has received funds.
      // Keep the item PROCESSING until transfer.success / transfer.failed / transfer.reversed.
      const finalizationStatus = isLive && provider === 'hubtel'
        ? gatewayResult.status
        : provider === 'paystack' && isLive ? 'PROCESSING' : 'SENT';
      await prisma.$transaction(async (tx) => {
        const updated = await tx.payrollItem.updateMany({
          where: { id: payrollItemId, paymentStatus: 'PROCESSING', paymentRef: idempotencyKey },
          data: {
            paymentStatus: finalizationStatus,
            providerTransactionId: gatewayResult.providerTransactionId || null,
            payoutSubmittedAt: new Date(),
            payoutLastCheckedAt: finalizationStatus === 'PAID' ? new Date() : null,
          },
        });
        if (updated.count === 1 && provider === 'hubtel' && isLive && finalizationStatus === 'PROCESSING') {
          await enqueueBackgroundJob(tx, {
            type: 'HUBTEL_PAYOUT_RECONCILIATION',
            payload: { payrollItemId, reference: idempotencyKey },
            companyId: item.payrollRun.companyId,
            idempotencyKey: `hubtel-payout-reconcile:${idempotencyKey}:scheduled`,
            availableAt: new Date(Date.now() + 5 * 60 * 1000),
          });
        }
        if (updated.count === 1) {
          await tx.auditLog.create({
            data: {
              companyId: item.payrollRun.companyId, action: 'PAYROLL_PAYOUT_SUBMITTED',
              resourceType: 'PayrollItem', resourceId: payrollItemId,
              details: { provider: provider.toUpperCase(), reference: idempotencyKey, status: finalizationStatus, simulated: !isLive },
            },
          });
        }
      });

      if (netPay > 100000) logger.warn('HIGH_VALUE_PAYOUT_DETECTED', { itemId: item.id, amount: netPay });

      span.setAttributes({
        'payout.itemId': payrollItemId, 'payout.provider': provider, 'payout.status': finalizationStatus,
        'payout.reference': idempotencyKey, 'payout.simulated': !isLive,
      });
      return gatewayResult;
    } catch (error) {
      if (providerSucceeded) {
        logger.error('CRITICAL: payout sent but status update failed - reconcile manually', { itemId: payrollItemId, error: error.message });
      } else if (claimed) {
        logger.error('Payout Execution Failed; payment remains PROCESSING until reconciled', {
          itemId: payrollItemId,
          error: error.message,
          deterministic: error instanceof AbortError,
        });
        // A timeout/network error/5xx may mean the provider accepted the transfer.
        // Only a definitive 4xx rejection is safe to mark FAILED and retry.
        if (error instanceof AbortError) {
          await prisma.payrollItem
            .updateMany({ where: { id: payrollItemId, paymentStatus: 'PROCESSING' }, data: { paymentStatus: 'FAILED' } })
            .catch(() => logger.error('Failed to mark definitively rejected payout as FAILED', { itemId: payrollItemId }));
        }
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
    const successful = ['success', 'successful', 'paid'].includes(normalizedStatus);
    const failed = ['failed', 'failure', 'rejected', 'cancelled', 'canceled'].includes(normalizedStatus);
    if (!successful && !failed) {
      logger.warn('Webhook received with an unsupported payment status; no state change applied', {
        reference,
        status: normalizedStatus || null,
      });
      return;
    }
    const nextStatus = successful ? 'PAID' : 'FAILED';

    const updated = await prisma.payrollItem.updateMany({
      where: { paymentRef: reference, OR: [{ payoutProvider: 'PAYSTACK' }, { payoutProvider: null }], paymentStatus: { in: ['SENT', 'PENDING', 'PROCESSING'] } },
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


/** Verify Hubtel's authoritative payout status before changing payroll payment state. */
export const reconcileHubtelPayout = async ({ payrollItemId, reference }) => {
  const item = await prisma.payrollItem.findFirst({
    where: { id: payrollItemId, paymentRef: reference, payoutProvider: 'HUBTEL', deletedAt: null },
    include: { payrollRun: { select: { companyId: true } } },
  });
  if (!item) {
    logger.warn('Hubtel reconciliation skipped: payout reference does not match a payroll item', { payrollItemId, reference });
    return { skipped: true };
  }
  if (item.paymentStatus !== 'PROCESSING') return { skipped: true, status: item.paymentStatus };

  const providerResult = await getHubtelPayoutStatus({ reference });
  if (providerResult.reference !== item.paymentRef) throw new Error('Hubtel payout status reference mismatch.');
  if (providerResult.amount === null || providerResult.amount === undefined
    || !new Prisma.Decimal(providerResult.amount).eq(new Prisma.Decimal(item.netPay).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP))) {
    throw new Error('Hubtel payout status amount does not match the finalized payroll item.');
  }
  if (providerResult.status === 'PROCESSING') throw new Error('Hubtel payout is still pending; reconciliation will retry.');

  await prisma.$transaction(async (tx) => {
    const updated = await tx.payrollItem.updateMany({
      where: { id: item.id, paymentRef: reference, payoutProvider: 'HUBTEL', paymentStatus: 'PROCESSING' },
      data: {
        paymentStatus: providerResult.status,
        providerTransactionId: providerResult.providerTransactionId || item.providerTransactionId,
        payoutLastCheckedAt: new Date(),
      },
    });
    if (updated.count === 1) {
      await tx.auditLog.create({
        data: {
          companyId: item.payrollRun.companyId, action: 'PAYROLL_PAYOUT_RECONCILED',
          resourceType: 'PayrollItem', resourceId: item.id,
          details: { provider: 'HUBTEL', reference, status: providerResult.status, providerTransactionId: providerResult.providerTransactionId || null },
        },
      });
    }
  });
  return { status: providerResult.status, reference };
};
