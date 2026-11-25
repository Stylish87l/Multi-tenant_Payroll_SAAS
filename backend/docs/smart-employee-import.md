# Smart Employee Import

Smart Employee Import supports administrator-led onboarding from CSV and XLSX files.

## Supported files and limits

- CSV and XLSX; the first worksheet is used for XLSX.
- Maximum file size: 700 KB.
- Maximum rows: 500 employees.
- Maximum columns: 40.
- Required mapped fields: name, email, position and basic salary.
- Common header aliases are recognized locally; unmapped columns are reported and ignored.
- Legacy XLS files are not supported.

## Workflow

1. An ADMIN selects a CSV/XLSX file. SUPER_ADMIN must explicitly select a company.
2. Paylio maps known headers, validates each row using the existing employee schema and business rules, and checks duplicate email, SSNIT and Ghana Card identifiers within the file and against the selected tenant.
3. The preview shows row-level validation, mapped columns and the names of sensitive fields detected. Sensitive identifier values are not returned in the preview response.
4. The administrator explicitly confirms the preview. Only valid rows are imported; invalid rows are skipped and counted.
5. The server rechecks validation and duplicates inside a serializable transaction, links matching employee login accounts where available, creates employee records and writes one summary audit event.
6. A preview is bound to its creator and company, expires after 30 minutes, can be used once, and its encrypted payload is deleted after successful import.

## Security and privacy

- Only ADMIN and SUPER_ADMIN can use the import endpoints. HR cannot import compensation or identity fields through this workflow.
- SUPER_ADMIN must select a company; tenant administrators are pinned to their verified JWT company.
- The staged preview payload contains employee data and is encrypted with the existing AES-256-GCM data-encryption key. Startup refuses to serve traffic if a stored preview payload is not encrypted.
- The encrypted preview payload is included in the existing data-key rotation command.
- SSNIT and Ghana Card duplicate checks use keyed blind indexes; plaintext identifiers are not used in database lookup filters.
- No employee data, identifiers, bank details or uploaded file contents are sent to an external AI provider.
- Audit records contain only preview/import counts and references, not employee field values.
- Preview and commit responses use `Cache-Control: private, no-store`.

## API

- `POST /api/employees/import/preview` with `{ "fileName": "...", "fileBase64": "...", "companyId": "..." }` (companyId required for SUPER_ADMIN).
- `POST /api/employees/import/commit` with `{ "previewId": "...", "companyId": "..." }` (companyId required for SUPER_ADMIN).

The commit endpoint accepts only the server-stored preview ID; it does not accept replacement employee rows from the browser.
