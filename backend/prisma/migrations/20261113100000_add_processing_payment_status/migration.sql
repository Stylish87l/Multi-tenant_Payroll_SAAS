-- Keep transfers in a non-retryable state when the provider outcome is uncertain.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
