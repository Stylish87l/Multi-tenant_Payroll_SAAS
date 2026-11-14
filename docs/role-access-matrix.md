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
- HR manages employee profiles and can export employee records. The current employee GraphQL model includes salary, statutory identifiers and bank fields, so HR's employee-management access is broader than basic contact information. Review whether bank account details and statutory identifiers should be field-restricted further.
- ACCOUNTANT has payroll and disbursement access, but cannot manage users, edit the employee directory, change branding or view audit logs. Payroll run GraphQL data includes nested employee fields needed by payroll workflows; those fields should be reviewed for least-privilege exposure.
- EMPLOYEE can access only their own notifications/preferences and their own finalized payslip data/PDF. No company-wide payroll or employee directory access is intended.
- CUSTOM exists in the database/GraphQL role enum but is not an invitable role and has no sidebar/route permission profile. It is not a configurable custom-role system today.

## Enforcement details

- Express RBAC has hierarchical inheritance (for example, HR inherits the EMPLOYEE permission label). Sensitive routes that must not inherit access use an additional exact-role check.
- Tenant-scoped lookups use the authenticated tenant from the verified access token; only SUPER_ADMIN may explicitly target other tenants.
- Employee payslip reads must bind to the authenticated user and tenant and require a FINALIZED payroll run.
- Notification creation validates that the recipient belongs to the actor's tenant unless the actor is SUPER_ADMIN.
- Frontend route guards and sidebar visibility do not replace backend authorization.

## Follow-up architecture work

1. Add field-level GraphQL authorization for bank account, Ghana Card, SSNIT, family/dependent and compensation fields based on approved business need.
2. Introduce a central permission policy (role-to-capability map) shared by REST, GraphQL and frontend route metadata to reduce policy drift.
3. Add tenant-isolation integration tests for every read/write/export path, including nested GraphQL fields.
4. Move notification and PDF work to a durable queue/outbox worker once the deployment environment includes a persistent job runner.
5. Add idempotency keys and reconciliation for payout provider callbacks and bulk payout requests.
