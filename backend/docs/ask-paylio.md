# Ask Paylio — read-only assistant (first release)

Ask Paylio is a company-scoped natural-language entry point for a deliberately small set of approved reporting tools.

## Supported questions

- Workforce headcount: active and inactive employee counts. Available to SUPER_ADMIN, ADMIN, ACCOUNTANT and HR.
- Latest finalized payroll summary: aggregate gross payroll, net pay, PAYE and employee/employer SSNIT totals. Available to SUPER_ADMIN, ADMIN and ACCOUNTANT.
- Finalized payroll trends: up to six most recent finalized periods with aggregate gross, net and PAYE totals. Available to SUPER_ADMIN, ADMIN and ACCOUNTANT.
- Payroll run status counts. Available to SUPER_ADMIN, ADMIN and ACCOUNTANT.

Unsupported questions receive a response explaining the currently supported report categories. HR does not receive financial payroll data. Employee self-service questions are intentionally handled by the separate Payslip Explainer roadmap item.

## Security and architecture

- The company ID comes from the company-context middleware. Tenant users are pinned to the company in their verified access token. SUPER_ADMIN must select a company explicitly.
- Every query uses a fixed, server-defined tool. User text is classified locally into an allowlisted intent; it is never translated into SQL, Prisma filters, or executable code.
- All database reads are aggregate/count queries. Employee names, IDs, email addresses, bank details, Ghana Card PINs, SSNIT identifiers, payslip line items and raw payroll evidence are not included in the assistant context.
- The original question is not sent to the AI provider and is not written to the audit log. The provider receives only a fixed report intent and aggregate result values.
- Gemini/OpenAI-compatible narration is optional and uses the existing `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_PROVIDER_NAME` and `AI_TIMEOUT_MS` configuration. Without a key, or when the provider fails, deterministic report wording is returned.
- AI only narrates the aggregates returned by the allowlisted tools. It cannot write data, calculate statutory payroll, approve payroll, or initiate payments.
- The endpoint is rate-limited, responses are not cached, and the audit record stores only the report intent and provider (never the user's question).
- The endpoint is `POST /api/companies/:companyId/ask-paylio` with JSON body `{ "question": "..." }`; maximum question length is 500 characters.

## Deliberate limits

This first release does not provide unrestricted report querying, employee-level lookup, SQL generation, chat memory, or write actions. Add new report tools only with explicit role permissions, tenant-scoped queries, aggregate/privacy review and tests.
