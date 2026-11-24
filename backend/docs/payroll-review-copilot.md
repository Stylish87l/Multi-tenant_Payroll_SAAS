# Paylio AI — Payroll Review Copilot

## What it does

The Payroll Review Copilot runs deterministic checks against a payroll run and its most recent earlier finalized run of the same run type. It can flag:

- Inactive employees included in a payroll run
- Missing bank name or account details
- Duplicate bank instructions within the same bank/bank code
- New employees not present in the prior finalized run
- Gross-pay or net-pay movements of at least 20% and GHS 100
- PAYE or employee SSNIT total movements of at least 20% and GHS 100

Findings are advisory. The Copilot does not recalculate payroll, alter amounts, change employee records, finalize payroll, or initiate payments. An authorised administrator/accountant records a human decision for each finding.

## Tenant security

All routes require a verified access token and the SUPER_ADMIN, ADMIN, or ACCOUNTANT role.

- Platform super administrators must supply a company UUID in the URL for every operation.
- Company users are restricted to the company ID in their verified access token.
- Every payroll run, review, finding and action lookup is scoped to that company on the server.
- Review creation and finding decisions write audit records in the same database transaction as the review/action write.

## API

Base path: /api/companies/:companyId/payroll-reviews

| Method | Path | Purpose |
|---|---|---|
| POST | /payroll-runs/:payrollRunId | Run deterministic checks and create a review |
| GET | /?page=1&limit=20 | List review history for the selected company |
| GET | /:reviewId | Read one review and its findings/action history |
| PATCH | /:reviewId/findings/:findingId | Record a human decision |

Decision request body fields: decision and optional comment.

Allowed decisions: CONFIRMED, DISMISSED, NEEDS_INVESTIGATION, RESOLVED.

Avoid putting bank account numbers, Ghana Card PINs, SSNIT numbers or other sensitive identifiers in review comments. The API rejects long numeric identifier patterns.

## Optional AI explanations

Without AI configuration, the Copilot still runs all deterministic checks and records provider as rules-only. To enable explanations, configure these backend environment variables:

- AI_API_KEY — provider API key
- AI_BASE_URL — optional OpenAI-compatible API base URL; defaults to https://api.openai.com/v1
- AI_MODEL — optional model name; defaults to gpt-4o-mini
- AI_PROVIDER_NAME — optional display name
- AI_TIMEOUT_MS — optional request timeout; defaults to 10000

Only rule-generated codes, categories, severity, titles, descriptions and recommendations are sent to the provider. Employee names/IDs, bank data, Ghana Card PINs, SSNIT identifiers and raw payroll evidence are not included in the AI request. Provider errors/timeouts fall back to rules-only mode and do not block payroll review.

## Migration and rollout

The migration is prisma/migrations/20261124000000_payroll_review_copilot. CI runs Prisma generation and migration deployment against its disposable PostgreSQL service. Review the migration and CI results before merging. Do not run the migration manually against production as part of this feature branch.
