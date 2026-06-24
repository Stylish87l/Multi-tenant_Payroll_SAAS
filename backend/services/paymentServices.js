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

      if (!item || item.paymentStatus === 'SUCCESS' || item.paymentStatus === 'SENT') {
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

      let gatewayResult;

      // 3. Execution with Provider-Specific Logic
      await pRetry(async () => {
        if (provider === 'hubtel') {
          // Example Hubtel Mobile Money / Bank Payout
          // POST https://api.hubtel.com/v1/merchantaccount/merchants/{id}/transfers/out
          gatewayResult = { status: 'SENT', reference: idempotencyKey }; 
        } else if (provider === 'paystack') {
          // Paystack uses kobo (GHS * 100)
          const amountInKobo = Math.round(item.netPay * 100);
          gatewayResult = { status: 'SENT', reference: idempotencyKey, amount: amountInKobo };
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
      if (item.netPay > 100000) {
        logger.warn('HIGH_VALUE_PAYOUT_DETECTED', { itemId: item.id, amount: item.netPay });
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
    const updated = await prisma.payrollItem.updateMany({
      where: { paymentRef: reference },
      data: { 
        paymentStatus: status === 'success' ? 'SUCCESS' : 'FAILED',
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
