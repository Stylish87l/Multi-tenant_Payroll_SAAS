# Production readiness and rollout checklist

This document records the hardening work on `chore/production-readiness-hardening` and the checks still required before a live payroll release.

## Implemented in this branch

- Payroll creation rejects zero, negative, or non-finite net pay.
- Payouts require a FINALIZED payroll run and a finite positive Decimal amount.
- Payout submission is not blindly retried. A provider timeout, network error, or 5xx leaves the item in PROCESSING for reconciliation; only a definitive provider 4xx rejection is eligible to become FAILED.
- Webhooks can resolve PROCESSING items, and unknown webhook statuses do not mutate payment state.
- Payment simulation is disabled whenever NODE_ENV=production.
- Statutory tax configuration is selected by payroll year and effective month. Missing or incomplete configuration blocks payroll.
- The 2026 September PAYE schedule and 2026 SSNIT insurable earnings are represented in the migration/seed data.
- SSNIT base is basic salary; allowances remain part of employment income for PAYE.
- Production CORS uses FRONTEND_URL and optional comma-separated ALLOWED_ORIGINS; development-only origins are not admitted in production.
- Refresh/logout cookie requests validate Origin in production.
- Content-Disposition is exposed for report download filename handling.
- Node 24 is the supported runtime; CI runs backend and frontend install, lint, tests, and builds.
- Obsolete public service-worker/manifest files and tracked audit JSON artifacts have been removed.
- Database schema/migration adds tenant-scoped employee identifiers, one payroll item per employee/run, tax configuration uniqueness, and delete restrictions that protect payroll/audit history.

## Statutory configuration notes

- GRA's revised 2026 resident monthly PAYE bands took effect on 1 September 2026. The earlier 2026 configuration is retained for January–August payroll periods.
- SSNIT's 2026 notice states minimum insurable earnings of GH₵587.80 and maximum insurable earnings of GH₵69,000, effective 1 January 2026.
- The calculator uses basic salary for SSNIT and gross employment income less the employee SSNIT deduction as the PAYE starting point. Validate the complete treatment of taxable benefits, exemptions, reliefs, overtime, bonuses, and non-resident employees with a Ghana payroll/tax specialist before release.
- Exact-year configuration is required. Create and independently approve the 2027 PAYE and SSNIT configuration before processing January 2027 payroll. Do not copy forward 2026 rates by default.
- Effective-dated tax records should be changed through reviewed migrations or an audited admin workflow. Do not silently edit a configuration used by a finalized payroll.

## Required before enabling live payouts

1. **Hubtel authentication:** replace the placeholder shared-secret header with the exact authentication/signature mechanism agreed with Hubtel for this merchant account. Verify timestamp/replay protection and raw-body signature validation. Until verified, do not enable Hubtel webhook settlement in production.
2. **Paystack bank mapping:** persist provider bank codes separately from display bank names, validate account details, and verify the transfer recipient/request format against the merchant's live GHS account.
3. **Reconciliation workflow:** provide a restricted finance/admin screen and audited operation to reconcile PROCESSING transfers using provider status/reference. Never reset an ambiguous transfer to PENDING merely to retry it.
4. **Dual control:** require maker-checker approval for payroll finalization and high-value/bulk disbursement. The person who prepares payroll should not be the sole approver and payer.
5. **Provider tests:** use provider sandbox accounts for success, rejection, timeout-after-acceptance, duplicate webhook, out-of-order webhook, and database-outage scenarios.

## Required production environment

- Set `NODE_ENV=production`, `DATABASE_URL`, `FRONTEND_URL`, JWT secrets, refresh-token settings, and provider credentials in a managed secret store. Never commit production secrets.
- Set `ALLOWED_ORIGINS` only for additional trusted production frontends. Origins must be exact origins (scheme + host + port), not URL paths.
- Host frontend and API under a same-site domain arrangement where possible. Set `REFRESH_COOKIE_DOMAIN` to the shared parent domain only when the deployment topology supports it; test Safari/iOS login, refresh, and logout.
- Ensure HTTPS end-to-end, secure database networking, least-privilege database credentials, managed encrypted backups, and a tested restore procedure.
- Send structured logs to a managed log platform; redact Ghana Card PINs, SSNIT numbers, bank accounts, tokens, and payroll amounts where not operationally necessary.
- Add uptime, database, queue, webhook, payroll-run, and payout monitoring with alerting and an incident runbook.
- Configure retention/deletion policies for employee PII and payroll records in line with Ghana legal and contractual requirements.

## Migration and release sequence

1. Take a verified database backup and test restore into a staging environment.
2. Apply migrations in order using `prisma migrate deploy`. The integrity migration deliberately aborts if duplicate employee identifiers, duplicate payroll items, or duplicate tax configurations are found; resolve those records before retrying.
3. Run Prisma generation, backend lint/tests/build, frontend lint/tests/build, and API integration tests.
4. Verify 2026 payroll calculations before and after 1 September using approved reference cases; compare against GRA/SSNIT reference calculations and obtain sign-off.
5. Verify historical finalized payslips remain unchanged after salary/employee profile edits.
6. Test tenant isolation with two separate companies for REST, GraphQL, reports, payslips, notifications, search, and exports.
7. Test payout/webhook idempotency and PROCESSING reconciliation in provider sandboxes.
8. Enable branch protection on main and require CI checks + at least one review before merge.
9. Deploy to staging, run smoke tests, then promote to production with a rollback plan.

## Further product improvements recommended

- Encrypt sensitive employee identifiers and bank account fields at rest using envelope encryption/KMS; mask them in UI and exports by default.
- Add genuine MFA (TOTP/WebAuthn), session/device management, login anomaly alerts, and tenant-configurable SSO for larger customers.
- Use a durable transactional outbox/queue for email, SMS, payslip generation, and webhook processing. Respect notification preferences and report SENT only after provider acceptance.
- Add employee self-service for payslips, tax documents, bank detail change requests, leave, and personal information updates.
- Add payroll variance checks, duplicate bank-account alerts, negative/zero pay warnings, large percentage-change approvals, and immutable approval history.
- Add GRA PAYE and SSNIT contribution exports with schema validation, reconciliation totals, filing calendars, and deadline reminders.
- Add accounting integrations, general-ledger journals, cost centres, departments, and payroll-to-bank reconciliation.
- Improve accessibility to WCAG 2.2 AA, add keyboard/focus management, and provide resilient mobile layouts. Keep private payroll data out of service-worker/offline caches.
- Build automated integration/e2e tests and meaningful coverage thresholds; a passing test command with no tests is not a release gate.
