# Employee Payslip Explainer

The Employee Payslip Explainer gives an authenticated employee a plain-language breakdown of their own finalized payslip.

## Employee experience

On My Payslips, the employee can expand **Explain this payslip** to view:
- Stored basic salary and allowance snapshots, when those historical values exist.
- Gross pay.
- Employee SSNIT and PAYE deductions and their recorded total.
- The recorded taxable income used for PAYE.
- Employer SSNIT contribution, clearly separated from employee deductions.
- Tier 1 and Tier 2 SSNIT remittance values in a separate section; these are not shown as extra employee deductions or as additional employer contributions.
- The recorded take-home pay and payment status.
- Whether the historical tax-configuration and relief-input snapshots are available.

## Data and calculation rules

- The API scopes the request to the authenticated employee's user ID and company, and only returns finalized payroll items.
- The response is built from values stored on the payroll item and the payroll run's historical tax snapshot.
- It never reads the employee's current salary, current bank profile, current identity fields, or current tax configuration to reconstruct historical payroll.
- It does not recalculate PAYE, SSNIT, net pay or statutory rates. The saved payroll amounts remain authoritative.
- Employer SSNIT is shown separately and is never described as a deduction from employee take-home pay.
- Tier 1 and Tier 2 are displayed as remittance categories, not as additional deductions or as additional employer-only contributions.
- Legacy payroll rows without earnings, relief-input or tax-configuration snapshots are clearly identified; missing historical values are not guessed or backfilled from today's profile.
- The explanation is deterministic and stays inside Paylio. No employee salary, tax, payslip or question data is sent to an external AI provider.

## API

- `GET /api/payslips/item/:itemId/explanation`
- Requires the exact `EMPLOYEE` role.
- Returns `Cache-Control: private, no-store`.
- The read is audit logged as `PAYSLIP_EXPLAINED`, without including payslip amounts or employee details in the audit payload.

The endpoint intentionally returns no employee name, email, bank details, SSNIT identifier, Ghana Card PIN, employee ID or company ID.
