# Employee PII encryption and migration runbook

Paylio encrypts the following employee fields at application level with AES-256-GCM:

- Bank account number
- SSNIT number
- Ghana Card PIN

The application exposes the same role-protected API fields, but Prisma stores ciphertext. SSNIT and Ghana Card uniqueness is enforced using keyed HMAC-SHA256 blind indexes scoped to company. Substring search over SSNIT identifiers is intentionally disabled; the application supports exact identifier matching through the blind index only.

## Required secrets

Configure these in the backend secret manager. Do not commit actual values:

- `DATA_ENCRYPTION_KEY`: base64-encoded 32-byte AES key
- `DATA_ENCRYPTION_KEY_ID`: stable identifier for the current key (letters, numbers, underscore or hyphen; 1-32 characters)
- `DATA_ENCRYPTION_INDEX_KEY`: a separate base64-encoded 32-byte HMAC key; it must not equal the AES key
- `DATA_ENCRYPTION_PREVIOUS_KEYS`: optional JSON object mapping old key IDs to base64-encoded 32-byte keys while rotating

Production startup refuses to serve traffic unless the keys validate and `EMPLOYEE_PII_ENCRYPTION_READY=true`. Test mode uses test-only fallback keys; production and development do not.

## Initial production rollout

**This is a maintenance-window operation. Do not run it against production until a restorable database backup exists.** No production migration or backfill has been run by this change.

1. Schedule a maintenance window. Pause employee create/update/import and payroll payout actions, and stop the old backend so it cannot continue writing plaintext while backfill runs.
2. Set the four encryption secrets above (the previous-key JSON can be `{}` for a first rollout).
3. Apply migrations through `20261125030000_employee_pii_encryption`. This adds encrypted columns and blind-index columns. Legacy columns are retained temporarily for backfill.
4. Run a dry run:
   `EMPLOYEE_PII_BACKFILL_MODE=true npm run employee-pii:backfill -- --dry-run`
5. Run the backfill:
   `EMPLOYEE_PII_BACKFILL_MODE=true npm run employee-pii:backfill`
   The script encrypts existing values, computes blind indexes, clears the legacy plaintext columns and verifies that no legacy plaintext values remain. It is idempotent and logs counts only.
6. Set `EMPLOYEE_PII_ENCRYPTION_READY=true` and deploy the new backend. Do not set this flag before the backfill completes.
7. Verify employee reads/updates, GraphQL and REST exports, payslips, payroll payouts, and uniqueness conflicts in a controlled staging environment before restoring production writes.

The legacy database columns remain present but must be NULL after the backfill. A later migration can drop them after the encrypted deployment has been verified and rollback retention requirements are satisfied.

## Key rotation

AES key rotation is supported with key IDs:

1. Set a new `DATA_ENCRYPTION_KEY_ID` and `DATA_ENCRYPTION_KEY`.
2. Add the old key ID and old base64 key to `DATA_ENCRYPTION_PREVIOUS_KEYS` so existing ciphertext remains readable.
3. Run `npm run employee-pii:rotate` (or `npm run employee-pii:rotate -- --dry-run`) to re-encrypt ciphertext with the current key.
4. Verify the rotation, then remove old keys from `DATA_ENCRYPTION_PREVIOUS_KEYS`.

The blind-index key is deliberately separate and stable. This rotation command does not rotate `DATA_ENCRYPTION_INDEX_KEY`; changing it requires a dedicated maintenance re-index operation and unique-index validation.

## Implementation boundaries

- Direct Employee create/update/upsert/createMany writes are encrypted by the Prisma query extension.
- Prisma result fields decrypt only when application code reads the protected Employee fields, including nested Employee results.
- Employee nested writes are not used by the current application paths; new nested Employee write paths must be reviewed before adoption.
- Legacy plaintext columns are ignored by the Prisma Client and are only accessed by the one-off parameterized backfill script.
- Blind-index values and ciphertext are never returned as API fields or sent to AI providers.
- Prisma query parameter logging in production omits values; development logs must still be treated as sensitive operational data.
