# Security and reliability hardening

## Shared authorization policy
`backend/policies/permissions.js` is the canonical permission map. REST middleware and GraphQL field resolvers consume it. Sensitive employee fields are nullable in GraphQL and return null when the caller lacks the corresponding read permission.

| Data group | Roles |
|---|---|
| Employee directory | SUPER_ADMIN, ADMIN, HR |
| Compensation | SUPER_ADMIN, ADMIN, ACCOUNTANT |
| Bank details | SUPER_ADMIN, ADMIN, ACCOUNTANT |
| Ghana Card / SSNIT identifiers | SUPER_ADMIN, ADMIN, HR, ACCOUNTANT |
| Tax/dependent profile | SUPER_ADMIN, ADMIN, HR, ACCOUNTANT |
| Payroll and reports | SUPER_ADMIN, ADMIN, ACCOUNTANT |
| Audit and user administration | SUPER_ADMIN, ADMIN |

## Tenant isolation
Tenant IDs are derived from authenticated context for tenant roles. DataLoader instances are request-scoped and apply the same tenant predicate when resolving companies, payroll runs and payroll items. Add integration tests for every new route/resolver that accepts a record ID: cross-tenant records should be indistinguishable from missing records.

## Employee-account reconciliation
Employee profiles and login accounts are matched by normalized email AND company ID. Only EMPLOYEE accounts in ACTIVE/PENDING state are eligible. Existing links are never reassigned; concurrent updates use a conditional update. The hourly reconciliation job reports scanned, linked, unmatched and conflict counts without logging employee PII.

## Durable background jobs
The PostgreSQL `background_jobs` table is the transactional outbox. Producers write the business row and its job in one transaction. A separate worker process claims jobs with an expiring lock token, retries with exponential backoff, and marks terminal failures after eight attempts. Delivery is at-least-once; handlers must remain idempotent.

### Render worker configuration
Create a separate Background Worker service from the same repository and deployment branch:
- Root directory: `backend`
- Build command: `npm install && npm run build`
- Start command: `npm run worker`
- Environment: the same `DATABASE_URL`, `NODE_ENV=production`, and required service configuration as the API (never commit secrets).

Do not start a second worker inside the web process. Monitor pending/failed job counts and alert on sustained backlog or terminal failures.

## Operational phases
1. Field-level authorization and one shared permission policy.
2. Request-scoped tenant-aware data access and cross-tenant regression coverage.
3. Employee identity linking plus periodic reconciliation.
4. Transactional outbox and separately deployed worker.
5. Audit/event observability, retry monitoring, and ongoing security regression tests.

## Rollout
Deploy the schema migration before enabling the worker. Run API and worker from the same commit. Verify worker logs and a test notification before relying on asynchronous delivery. Existing invite email delivery remains synchronous until its bearer token can be safely represented as a one-time encrypted outbox payload.