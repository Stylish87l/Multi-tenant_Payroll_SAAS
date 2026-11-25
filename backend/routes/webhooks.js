// Payment provider webhook receiver. NOT behind authMiddleware (providers cannot send a Paylio
// JWT); protected by signature / shared-secret verification instead. Requires req.rawBody
// (captured by express.json({ verify }) in server.js).
import express from 'express';
import logger from '../config/logger.js';
import { handlePaymentWebhook, verifyPaystackSignature } from '../services/paymentServices.js';
import { enqueueHubtelPayoutReconciliation } from '../services/backgroundJobService.js';

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
    // Hubtel's published production v1 contract does not provide a verifiable signature.
    // This flag must only be enabled after the trusted ingress/firewall allowlists Hubtel's
    // documented payout callback source (18.202.122.131) and the proxy chain is verified.
    if (process.env.HUBTEL_CALLBACK_INGRESS_ALLOWLIST_VERIFIED !== 'true') {
      logger.error('Rejected Hubtel callback: trusted ingress allowlist has not been verified');
      return res.status(503).json({ error: 'callback_ingress_not_configured' });
    }
    const allowedIps = (process.env.HUBTEL_CALLBACK_SOURCE_IPS || '18.202.122.131')
      .split(',').map((value) => value.trim()).filter(Boolean);
    const requestIp = String(req.ip || '').replace(/^::ffff:/, '');
    if (!allowedIps.includes(requestIp)) {
      logger.warn('Rejected Hubtel callback from an unapproved source IP', { ip: requestIp });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Callback content is only a signal. The worker verifies the reference, amount and
    // authoritative transaction status directly with Hubtel before changing payment state.
    const payload = req.body;
    const reference = payload?.Data?.ClientReference || payload?.data?.clientReference
      || payload?.ClientReference || payload?.clientReference;
    if (typeof reference !== 'string' || !reference.trim() || reference.length > 36) {
      logger.warn('Rejected Hubtel callback with invalid client reference', { ip: requestIp });
      return res.status(400).json({ error: 'invalid_callback_reference' });
    }
    await enqueueHubtelPayoutReconciliation(reference);
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Hubtel callback processing error', { message: error.message, stack: error.stack });
    return res.status(500).json({ error: 'processing_error' });
  }
});

export default router;
