# Paylio role and access matrix

This matrix records the current application policy implemented across the React route/sidebar configuration, Express routes, and GraphQL resolvers. Backend authorization remains the security boundary; frontend visibility is only navigation UX.

| Capability | SUPER_ADMIN | ADMIN | HR | ACCOUNTANT | EMPLOYEE |
|---|---:|---:|---:|---:|---:|
| Platform tenant directory and tenant creation | Yes | No | No | No | No |
| Tenant employee directory and employee CRUD | Any tenant | Own tenant | Own tenant | No | No |
| Employee export | Any tenant | Own tenant | Own tenant | No | No |
| User provisioning and account status management | Any tenant | Own tenant | No | No | No |
| Payroll runs and run details | Any tenant | Own tenant | No | Own tenant | No |
| Create/run payroll | Any tenant | Own tenant | No | Own tenant | No |
| Finalize or discard payroll drafts | Any tenant | Own tenant | No | No | No |
| Payroll disbursement | Any tenant | Own tenant | No | Own tenant | No |
| Payroll summary, GRA and SSNIT reports | Any tenant | Own tenant | No | Own tenant | No |
| Individual payslip data/PDF | Any tenant | Own tenant | No | Own tenant | Own finalized payslips |
| Bulk payslip PDF export | Any tenant | Own tenant | No | Own tenant | No |
| Audit log viewing | Any tenant | Own tenant | No | No | No |
| Tenant branding | Any tenant | Own tenant | No | No | No |
| Send organisation notifications | Yes | Own tenant | Own tenant | No | No |
| View own notifications and preferences | Yes | Yes | Yes | Yes | Yes |
| Personal dashboard | Yes | Yes | Yes | Yes | Yes |

## Role notes and sensitive data

- SUPER_ADMIN is the platform operator. Tenant-specific actions require a selected/explicit tenant where appropriate; platform-level directory and tenant creation are restricted to this role.
- ADMIN has broad operational access inside one tenant, including user administration, payroll approval, financial reports, payouts, employee management, audit logs and branding.
- HR manages employee profiles and can export employee records. Salary and allowance values are masked in REST and GraphQL reads; HR cannot change compensation after creation or submit bank details. HR can enter initial compensation during employee creation because the payroll onboarding model requires it. HR can access statutory identifiers and tax/dependent profile fields needed for employee administration.
- ACCOUNTANT has payroll and disbursement access, including compensation, bank, statutory identity and tax fields required for payroll workflows, but cannot manage users, edit the employee directory, change branding or view audit logs.
- EMPLOYEE can access only their own notifications/preferences and their own finalized payslip data/PDF. No company-wide payroll or employee directory access is intended.
- CUSTOM exists in the database/GraphQL role enum but is not an invitable role and has no sidebar/route permission profile. It is not a configurable custom-role system today.

## Enforcement details

- Express RBAC hierarchy is centralized in the permission policy. Sensitive GraphQL fields and REST employee payloads/exports use explicit field-level permissions and are redacted when the caller lacks access. HR cannot inherit individual payslip report access.
- Tenant-scoped lookups use the authenticated tenant from the verified access token; only SUPER_ADMIN may explicitly target other tenants.
- Employee payslip reads must bind to the authenticated user and tenant and require a FINALIZED payroll run.
- Notification creation validates that the recipient belongs to the actor's tenant unless the actor is SUPER_ADMIN.
- Frontend route guards and sidebar visibility do not replace backend authorization.

## Follow-up architecture work

1. Extend the central permission policy to all remaining REST/GraphQL operations and frontend route metadata so role definitions cannot drift.
2. Expand tenant-isolation integration coverage to every route and nested field, especially bulk exports and payout callbacks.
3. Move PDF generation and other long-running report jobs onto the transactional outbox worker; notification delivery and employee-account reconciliation now use the worker.
4. Add provider-level idempotency and reconciliation for payout callbacks and bulk payout requests.
5. Add alerting/retention dashboards for failed jobs, audit anomalies and repeated authorization denials.
