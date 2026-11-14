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

### 2. Paystack Ghana payout onboarding

Paylio is configured to use Paystack for live employee salary disbursement. The initial payout rail is Ghana bank accounts (GHS/GHIPSS); mobile-money payroll is not part of this first implementation. Follow [the detailed Paystack Ghana payout setup](paystack-ghana-payout-setup.md).

- Complete Paystack registered-business compliance/KYC and obtain explicit approval for the Transfers product for your Ghana business.
- Store the Paystack TEST and LIVE secret keys only in the matching Render environment; never expose them to Vercel or browser code.
- Configure the public webhook at `/api/webhooks/paystack` and verify its signature and final transfer events.
- Fetch bank identifiers from Paystack's Ghana bank list, select GHIPSS bank channels, and exclude Bank of Ghana as instructed by Paystack. Verify each employee's beneficiary name, account number, and bank code.
- Confirm Paystack's transfer OTP / URL approval settings. The current app does not implement an interactive OTP approval flow, so resolve this with Paystack before live automation.
- Confirm balance funding, transfer fees, limits, settlement timing, and reversal handling.
- Run the sandbox acceptance tests and reconcile every transfer reference before requesting approval for live payouts.

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
