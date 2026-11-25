# Employee PII encryption and migration runbook

Paylio encrypts the following employee fields at application level with AES-256-GCM:

- Bank account number
- SSNIT number
- Ghana Card PIN

The existing `bankAccount`, `ssnitNumber` and `ghanaCardPin` database columns store ciphertext. The Prisma query extension encrypts direct Employee writes and decrypts Employee records after reads, including nested Employee records. The API field names and role-based access rules remain unchanged.

SSNIT and Ghana Card uniqueness is enforced with tenant-scoped keyed HMAC-SHA256 blind indexes. Exact identifier lookups are supported through those indexes; substring and range searches are intentionally disabled for encrypted identifiers.

## Required secrets

Configure these in the backend secret manager. Do not commit actual values:

- `DATA_ENCRYPTION_KEY`: base64-encoded 32-byte AES key
- `DATA_ENCRYPTION_KEY_ID`: stable identifier for the current key (letters, numbers, underscore or hyphen; 1-32 characters)
- `DATA_ENCRYPTION_INDEX_KEY`: a separate base64-encoded 32-byte HMAC key; it must not equal the current or any previous AES key
- `DATA_ENCRYPTION_PREVIOUS_KEYS`: optional JSON object mapping old key IDs to base64-encoded 32-byte keys while rotating

Production startup refuses to serve traffic unless the keys validate and `EMPLOYEE_PII_ENCRYPTION_READY=true`. The server and worker also verify that the migration is applied, every employee row has encryption version 1, and every non-null sensitive field has the ciphertext envelope. Test mode uses test-only fallback keys; production and development do not.

## Initial production rollout

**This is a maintenance-window operation. Do not run it against production until a restorable database backup exists.** No production migration or backfill has been run by this change.

1. Schedule a maintenance window. Pause employee create/update/import and payroll payout actions, and stop the old backend so it cannot continue writing plaintext while backfill runs.
2. Set the encryption secrets above (the previous-key JSON can be `{}` for a first rollout).
3. Apply migrations through `20261125030000_employee_pii_encryption`. This adds blind-index and encryption-version columns and replaces plaintext uniqueness with blind-index uniqueness.
4. Run a dry run:
   `EMPLOYEE_PII_BACKFILL_MODE=true npm run employee-pii:backfill -- --dry-run`
5. Run the backfill:
   `EMPLOYEE_PII_BACKFILL_MODE=true npm run employee-pii:backfill`
   The script encrypts the existing values in place, computes blind indexes, sets the per-record encryption version and verifies that no unencrypted employee records remain. It is idempotent and logs counts only.
6. Set `EMPLOYEE_PII_ENCRYPTION_READY=true` and deploy the new backend. The server and worker will independently verify the migration and ciphertext markers before starting. Do not set this flag before the backfill completes.
7. Verify employee reads/updates, GraphQL and REST exports, payslips, payroll payouts, exact identifier lookups and uniqueness conflicts in a controlled staging environment before restoring production writes.

## Key rotation

AES key rotation is supported with key IDs:

1. Set a new `DATA_ENCRYPTION_KEY_ID` and `DATA_ENCRYPTION_KEY`.
2. Add the old key ID and old base64 key to `DATA_ENCRYPTION_PREVIOUS_KEYS` so existing ciphertext remains readable.
3. Run `npm run employee-pii:rotate` (or `npm run employee-pii:rotate -- --dry-run`) to re-encrypt all stored values with the current key.
4. Verify the rotation, then remove old keys from `DATA_ENCRYPTION_PREVIOUS_KEYS`.

The blind-index key is deliberately separate and stable. This rotation command does not rotate `DATA_ENCRYPTION_INDEX_KEY`; changing it requires a dedicated maintenance re-index operation and unique-index validation.

## Implementation boundaries

- Direct Employee create/update/upsert/createMany writes are encrypted by the Prisma query extension.
- Query results are recursively inspected so nested Employee records are decrypted before they reach REST, GraphQL or service code.
- Nested Employee writes are rejected by the Prisma extension. Use direct Employee model operations so encryption cannot be bypassed.
- Ciphertext, blind indexes and the encryption-version marker are removed from query results before application/API code receives them.
- Employee records with missing or invalid ciphertext fail closed; the application never silently treats plaintext as encrypted.
- Blind-index values and ciphertext are never sent to AI providers.
- Prisma query parameter logging in production omits values; development logs must still be treated as sensitive operational data.
