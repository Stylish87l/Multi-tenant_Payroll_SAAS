-- Bind each Copilot review to the exact draft inputs it inspected.
-- The HMAC fingerprint is generated server-side and is never sent to the AI provider.
ALTER TABLE "payroll_reviews"
  ADD COLUMN "input_fingerprint" TEXT,
  ADD COLUMN "prompt_version" TEXT;
