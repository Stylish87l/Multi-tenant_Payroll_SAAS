import { trace } from '@opentelemetry/api';
import pRetry from 'p-retry';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/db.js';
import logger from '../config/logger.js';

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

      // FIXED (2026-07-10): was comparing against 'SUCCESS', which is not
      // and never was a valid PaymentStatus enum value - PAID is the real
      // terminal-success state (see schema.prisma). This guard previously
      // could never actually trigger on a completed payout, meaning a
      // second call against an already-PAID item would silently attempt
      // to re-process it instead of being rejected here.
      if (!item || item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT') {
        throw new Error(`Invalid Payout State: Item ${payrollItemId} already processed or missing.`);
      }

      // 2. Generate/Retrieve Idempotency Key
      const idempotencyKey = item.paymentRef || `pay_${item.id}_${uuidv4().substring(0, 8)}`;
      
      if (!item.paymentRef) {
        await prisma.payrollItem.update({
          where: { id: payrollItemId },
          data: { paymentRef: idempotencyKey, paymentStatus: 'PENDING' }
        });
      }

      // FIXED (2026-07-10): item.netPay is a Prisma Decimal instance, not a
      // native number. decimal.js's valueOf()/toJSON() deliberately return
      // a STRING - so `item.netPay * 100` triggers JS's numeric coercion
      // path (Decimal has no [Symbol.toPrimitive] override for `*`), which
      // actually *does* coerce via valueOf() to a number correctly for `*`
      // specifically... but relying on that implicit behavior is exactly
      // the landmine CLAUDE.md's "Decimal arithmetic is a silent failure
      // mode" rule exists to prevent - `+` and comparison operators on the
      // same object silently do the WRONG thing (string concat / lexicographic
      // compare) with no error thrown, so every Decimal touchpoint must be
      // explicitly Number()-converted for consistency and safety, not left
      // to operator-specific implicit coercion that happens to work today.
      const netPayNumber = Number(item.netPay);

      let gatewayResult;

      // 3. Execution with Provider-Specific Logic
      await pRetry(async () => {
        if (provider === 'hubtel') {
          // Example Hubtel Mobile Money / Bank Payout
          // POST https://api.hubtel.com/v1/merchantaccount/merchants/{id}/transfers/out
          gatewayResult = { status: 'SENT', reference: idempotencyKey }; 
        } else if (provider === 'paystack') {
          // Paystack uses kobo (GHS * 100)
          const amountInKobo = Math.round(netPayNumber * 100);
          gatewayResult = { status: 'SENT', reference: idempotencyKey, amount: amountInKobo };
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

      // Fraud Detection ML Hook: Flag unusual amounts (> 100k GHS)
      // FIXED (2026-07-10): was `item.netPay > 100000` - a Decimal compared
      // with `>` against a number DOES coerce correctly via valueOf(), so
      // this one happened to work, but is fixed for consistency with the
      // explicit-conversion rule above and to avoid relying on
      // operator-specific Decimal coercion quirks anywhere in this file.
      if (netPayNumber > 100000) {
        logger.warn('HIGH_VALUE_PAYOUT_DETECTED', { itemId: item.id, amount: netPayNumber });
      }

      span.setAttributes({
        "payout.itemId": payrollItemId,
        "payout.provider": provider,
        "payout.status": "SENT",
        "payout.reference": idempotencyKey,
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
 * Webhook Handler for Async Status Updates
 */
export const handlePaymentWebhook = async (payload, signature) => {
  // 1. Verify Signature (Crucial for 2026 security)
  // verifyHubtelSignature(payload, signature);
  // verifyPaystackSignature(payload, signature);

  const { reference, status, failureReason } = payload;

  try {
    // FIXED (2026-07-10): was writing 'SUCCESS', which - like the guard
    // above - is not a valid PaymentStatus value. This updateMany would
    // have thrown a Prisma enum validation error on every successful
    // webhook delivery, meaning a payout could be confirmed by the
    // provider but the DB write recording that confirmation always failed.
    const updated = await prisma.payrollItem.updateMany({
      where: { paymentRef: reference },
      data: { 
        paymentStatus: status === 'success' ? 'PAID' : 'FAILED',
        // Optionally store failureReason in metadata for audit/debugging
      }
    });

    if (updated.count > 0) {
      logger.info(`Payment status updated via webhook: ${reference} -> ${status}`, { failureReason });
    } else {
      logger.warn(`Webhook received for unknown reference: ${reference}`);
    }
  } catch (error) {
    logger.error('Webhook processing failed', { reference, error: error.message });
  }
};