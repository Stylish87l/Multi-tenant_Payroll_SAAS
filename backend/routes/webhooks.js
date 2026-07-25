// backend/routes/webhooks.js
//
// NEW: Payment provider webhook receiver. This was a flagged open gap -
// services/paymentServices.js's handlePaymentWebhook() existed, but no
// route ever called it, so every payout was permanently stuck at 'SENT'
// with no way to ever reach 'PAID'.
//
// SECURITY NOTE: This route is intentionally NOT behind authMiddleware -
// payment providers can't send a Paylio JWT. Instead it's protected by
// verifying the provider's webhook signature (Paystack: HMAC-SHA512 over
// the raw body, per paymentServices.js's verifyPaystackSignature). Requests
// that fail signature verification are rejected with 401 and never reach
// handlePaymentWebhook(). This route MUST be mounted with access to the
// raw request body - see server.js's express.json({ verify }) change.
//
// Hubtel's webhook signing scheme varies by product; the /hubtel endpoint
// below is scaffolded with a shared-secret query-param check as a
// placeholder minimum bar (better than nothing, not equivalent to HMAC
// verification) - replace with Hubtel's actual signature scheme from your
// merchant dashboard before relying on it in production.

import express from 'express';
import logger from '../config/logger.js';
import { handlePaymentWebhook, verifyPaystackSignature } from '../services/paymentServices.js';

const router = express.Router();

router.post('/paystack', async (req, res) => {
  try {
    const signature = req.get('x-paystack-signature');
    const rawBody = req.rawBody;

    if (!verifyPaystackSignature(rawBody, signature)) {
      logger.warn('Rejected Paystack webhook: invalid signature', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // Paystack sends various event types on this single endpoint
    // (transfer.success, transfer.failed, transfer.reversed, charge.success,
    // etc.) - only act on transfer events, which is what payroll payouts are.
    if (!event?.event?.startsWith('transfer.')) {
      logger.info('Ignoring non-transfer Paystack webhook event', { event: event?.event });
      return res.status(200).json({ received: true });
    }

    const status = event.event === 'transfer.success' ? 'success' : 'failed';

    await handlePaymentWebhook({
      reference: event.data?.reference,
      status,
      failureReason: event.data?.failures || event.data?.reason || null,
    });

    // Always 200 quickly - providers retry aggressively on non-2xx, and
    // handlePaymentWebhook() already logs+swallows its own errors for
    // unknown references so retries wouldn't help in that case anyway.
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Paystack webhook processing error', { message: error.message, stack: error.stack });
    // Still 200 to prevent an infinite provider retry storm on a bug in
    // our own handler; the error is already logged for investigation.
    return res.status(200).json({ received: true, error: 'internal_processing_error' });
  }
});

router.post('/hubtel', async (req, res) => {
  try {
    // PLACEHOLDER AUTH: replace with Hubtel's actual webhook signature
    // verification scheme (check your Hubtel merchant dashboard / API
    // docs) before enabling this in production. A shared secret alone is
    // weaker than HMAC verification but still prevents casual/opportunistic
    // spoofing of this endpoint.
    const sharedSecret = req.query.secret || req.get('x-hubtel-webhook-secret');
    if (!process.env.HUBTEL_WEBHOOK_SECRET || sharedSecret !== process.env.HUBTEL_WEBHOOK_SECRET) {
      logger.warn('Rejected Hubtel webhook: missing or invalid shared secret', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;

    await handlePaymentWebhook({
      reference: payload?.ClientReference || payload?.reference,
      status: payload?.Status || payload?.status,
      failureReason: payload?.Reason || null,
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Hubtel webhook processing error', { message: error.message, stack: error.stack });
    return res.status(200).json({ received: true, error: 'internal_processing_error' });
  }
});

export default router;
