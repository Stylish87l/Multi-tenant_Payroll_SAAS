// Payment provider webhook receiver. NOT behind authMiddleware (providers cannot send a Paylio
// JWT); protected by signature / shared-secret verification instead. Requires req.rawBody
// (captured by express.json({ verify }) in server.js).
import express from 'express';
import logger from '../config/logger.js';
import { handlePaymentWebhook, verifyPaystackSignature, verifySharedSecret } from '../services/paymentServices.js';

const router = express.Router();

router.post('/paystack', async (req, res) => {
  try {
    if (!verifyPaystackSignature(req.rawBody, req.get('x-paystack-signature'))) {
      logger.warn('Rejected Paystack webhook: invalid signature', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    if (!event?.event?.startsWith('transfer.')) {
      return res.status(200).json({ received: true });
    }

    await handlePaymentWebhook({
      reference: event.data?.reference,
      status: event.event === 'transfer.success' ? 'success' : 'failed',
      failureReason: event.data?.failures || event.data?.reason || null,
    });
    return res.status(200).json({ received: true });
  } catch (error) {
    // FIXED: previously returned 200 on internal errors, so a transient DB outage permanently
    // lost the confirmation (item stuck at SENT forever). 500 makes the provider retry.
    logger.error('Paystack webhook processing error', { message: error.message, stack: error.stack });
    return res.status(500).json({ error: 'processing_error' });
  }
});

router.post('/hubtel', async (req, res) => {
  try {
    // PLACEHOLDER AUTH: replace with Hubtel's real signature scheme before relying on it.
    // Header only: a secret in the query string ends up in proxy/access logs.
    if (!verifySharedSecret(req.get('x-hubtel-webhook-secret'), process.env.HUBTEL_WEBHOOK_SECRET)) {
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
    return res.status(500).json({ error: 'processing_error' });
  }
});

export default router;
