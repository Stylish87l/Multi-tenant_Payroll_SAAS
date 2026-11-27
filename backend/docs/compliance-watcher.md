# Compliance Watcher — first release

## Scope

The watcher monitors a small allowlist of official Ghana Revenue Authority (GRA) and Social Security and National Insurance Trust (SSNIT) HTML publications:

- GRA PAYE guidance: https://gra.gov.gh/domestic-tax/tax-types/paye/
- GRA tax law amendments: https://gra.gov.gh/amendments-of-tax-laws/
- SSNIT employer guidance: https://www.ssnit.org.gh/become-an-employer/

The source registry is inserted by migration `20261125093000_ghana_compliance_watcher`. Only these exact HTTPS URLs can be fetched. Redirects are rejected, requests time out after 10 seconds, and response bodies are limited to 1 MB.

## Detection

- A durable `COMPLIANCE_WATCHER_SCAN` background job is scheduled once per six-hour UTC bucket.
- The first successful scan establishes a content-hash baseline and does not create an alert.
- Subsequent content changes create a `ComplianceNotice` with the official URL, extracted heading, sanitized text excerpt and SHA-256 fingerprint.
- ETag and Last-Modified headers are used when supplied.
- Failed or blocked sources record a status and bounded error message; they do not stop other sources from being scanned.
- The watcher stores public page excerpts only. It does not fetch employee data or send content to an AI provider.

## Human review

Company administrators and accountants can create one company-specific draft impact assessment per notice. A draft contains:
- A human-written impact summary
- Impact areas (PAYE, SSNIT, allowances, payroll process, employee data or other)
- Human-proposed review actions

The route is company-scoped using verified JWT context; SUPER_ADMIN must select a company explicitly. Draft creation is audited.

## Non-negotiable safety boundary

This release is detection and draft documentation only:
- It does not extract or apply statutory rates.
- It does not create, update or activate TaxConfig records.
- It does not change payroll calculations, historical snapshots or payroll runs.
- It does not provide legal advice or claim that a detected page change is a statutory amendment.
- It does not provide an approval/activation endpoint.

A separate implementation must establish an explicit qualified-tax-specialist authorization model, versioned TaxConfig approval, effective-date controls and Ghana payroll golden tests before any proposed statutory configuration can be activated. Existing payroll configuration remains the source of truth.

## API

- `GET /api/companies/:companyId/compliance/notices`
- `POST /api/companies/:companyId/compliance/notices/:noticeId/assessments`

The API is rate-limited and returns `Cache-Control: private, no-store`. Only SUPER_ADMIN, ADMIN and ACCOUNTANT roles may access the compliance center.

## Operations

The background worker must be running for scheduled scans. If it is stopped, no source polling occurs. Review source status and worker logs after deployment; do not manually change TaxConfig based solely on a watcher notice.


## Specialist review lifecycle (follow-up release)

A dedicated `COMPLIANCE_SPECIALIST` role is provisioned by a platform administrator only. A platform administrator grants or revokes access per company; specialist access is never inferred from the user's home company. Every specialist request checks an active grant for the selected company.

- `POST /api/compliance-access/specialists` provisions a specialist identity and sends the normal activation invitation. The supplied company is the initial explicit grant.
- `GET /api/compliance-access/specialists/:userId/companies` lists a specialist's grants (platform administrator only).
- `PUT /api/compliance-access/specialists/:userId/companies/:companyId` grants or restores access.
- `DELETE /api/compliance-access/specialists/:userId/companies/:companyId` revokes access.
- `GET /api/compliance-access/my-companies` lists active company grants for the signed-in specialist.
- `POST /api/companies/:companyId/compliance/assessments/:assessmentId/submit` submits a draft or rejected assessment.
- `PATCH /api/companies/:companyId/compliance/assessments/:assessmentId/review` records an APPROVED or REJECTED decision with a required rationale.

A specialist cannot review their own assessment. Review history is append-only at the database layer, and assessment state changes and audit records are committed together. Approval means the human assessment passed review only: the response explicitly reports `configurationChanged: false`. It does not update TaxConfig, statutory rates, payroll calculations or finalized runs.
