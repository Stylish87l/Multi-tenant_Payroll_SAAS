# Paylio production launch checklist

This checklist separates repository safeguards from actions that require an operator, provider account, accountant, or infrastructure access.

## Current code-level payout safeguards

Live payouts are fail-closed. Provider credentials alone do not activate money movement.

Before any live transfer, configure and verify all of the following in the backend environment:

- `ENABLE_LIVE_PAYOUTS=true` — explicit global authorization to move money.
- Paystack: `PAYSTACK_TRANSFER_CONFIGURATION_VERIFIED=true` only after the Paystack transfer request, GHS currency/subunit handling, recipient type, bank-code mapping, and webhook signature have been verified against the merchant account.
- Hubtel: `HUBTEL_TRANSFER_CONTRACT_VERIFIED=true` only after Hubtel confirms the merchant transfer endpoint, authentication, payload fields, response states, and webhook authentication for the specific merchant account.

Do not enable these flags for a production account until sandbox tests and a small controlled reconciliation exercise have passed. Keep them unset/false while onboarding.

## Operator-owned launch work

### 1. Ghana payroll and statutory configuration

- Have a qualified Ghana payroll accountant verify the effective PAYE bands, relief amounts, SSNIT rates, contribution floors/caps, and effective dates in the `TaxConfig` records.
- The repository seed currently contains 2026 configurations, including a PAYE effective-date change from 2026-09-01. It does not automatically establish approved 2027 statutory values.
- Confirm the treatment of bonuses, allowances, employee categories, rounding, and statutory remittance outputs against current GRA and SSNIT guidance.
- Approve a set of independently calculated payroll test cases before processing real payroll.
- Do not run a real payroll using unreviewed seeded tax values.

### 2. Payment provider onboarding

- Complete provider business verification/KYC and confirm the account is approved for payroll transfers.
- Obtain production credentials through the provider dashboard and store them only in Render's secret environment settings.
- Verify the supported bank/payment-method codes. Populate each employee's separate `bankCode`; do not copy a human-readable bank name into that field.
- Confirm account-name validation, transfer limits, fees, settlement times, funding requirements, and reversal procedures.
- Verify signed webhook delivery, retry behavior, and final-state reconciliation in the provider dashboard.
- Run sandbox payouts first. For the first live run, use a small approved test payroll and reconcile every reference before scaling up.

### 3. Email and domain

- Configure a production email provider and the `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, and `EMAIL_FROM` settings.
- Verify sender-domain SPF, DKIM, and DMARC records and test invitations, password resets, and payslip notifications.
- Prefer a shared custom domain, for example `app.example.com` and `api.example.com`, for the frontend and backend. Configure the refresh-cookie parent domain only after both hosts are correctly mapped and HTTPS is active.
- Keep the current host-only cookie configuration while using unrelated Vercel and Render domains.

### 4. Infrastructure and recovery

- Confirm `NODE_ENV=production`, exact frontend origins, strong distinct JWT access/refresh secrets, and production database connection settings.
- Configure automated PostgreSQL backups and perform a restore drill into a separate database. A backup that has never been restored is not a verified recovery plan.
- Confirm Render health checks, instance sizing, restart behavior, and database connection limits.
- Ship application logs to durable external log storage; local rotating files may be lost when an ephemeral container is replaced.
- Configure uptime/error alerts and an incident contact.
- Establish a documented rollback procedure for application releases and database migrations.

### 5. Legal, privacy, and business operations

- Obtain legal/accounting review of payroll terms, privacy notice, data retention, employee consent/notice, and customer contracts.
- Confirm applicable Ghana data-protection obligations and any required registrations with qualified counsel/the relevant regulator.
- Decide who in each customer organization can create, approve, finalize, and disburse payroll; use separate accounts for those duties.
- Define employee onboarding verification, bank-detail change approval, payroll correction, leaver, and offboarding procedures.
- Never send passwords, JWT secrets, provider credentials, refresh tokens, bank details, Ghana Card PINs, or full SSNIT identifiers in support tickets or screenshots.

## Release gates

Do not process real payroll until all of these are true:

- Tenant-isolation and role tests pass.
- Statutory calculations are signed off by a qualified Ghana payroll professional.
- Database backup restoration has been demonstrated.
- Provider sandbox payouts and webhook reconciliation pass.
- Production email delivery is verified.
- Production monitoring and incident/rollback procedures are active.
- A small controlled live payroll has been reconciled and approved.
