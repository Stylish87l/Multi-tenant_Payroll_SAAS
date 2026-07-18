-- FIXED (2026-07-10): paymentServices.js has always written 'SENT' as an
-- intermediate dispatched-to-provider state, and the webhook handler wrote
-- 'SUCCESS' on confirmation - neither value existed in PaymentStatus
-- (PENDING/PAID/FAILED only). Every real call to processPayout() or the
-- webhook handler threw a Prisma enum validation error. Added SENT here;
-- SUCCESS is retired in favor of the existing PAID value (see
-- paymentServices.js), so no separate migration is needed for that one.
ALTER TYPE "PaymentStatus" ADD VALUE 'SENT';