Claude Project Context – Ghana Payroll System
Project Name: Ghana Payroll (Multi-Tenant SaaS Payroll System)
Current Date: March 2026
Tech Stack: Node.js 20+, Express 5, Prisma 7, PostgreSQL, GraphQL (Apollo Server), React 18 + Vite + Tailwind, Zod, BullMQ, Winston
Core Purpose
A modern, production-ready, multi-tenant payroll platform built specifically for Ghanaian companies. It handles:
* Employee management with Ghana Card (TIN) and SSNIT validation
* 2026-compliant PAYE & SSNIT calculations (dynamic via TaxConfig)
* Payroll runs, payslip generation (PDF + ZIP), GRA/SSNIT schedule exports
* Secure auth (JWT + refresh token rotation)
* Notifications (Email + SMS via Twilio/Hubtel)
* Payments/disbursements (Hubtel primary, Paystack fallback)
* Audit logging and notification preferences for compliance
Folder Structure (Key Directories)
Backend (/backend/)
* server.js – Main Express + Apollo GraphQL server
* schema.prisma – Full Prisma schema (Company, User, Employee, PayrollRun, PayrollItem, Notification, TaxConfig, AuditLog, etc.)
* /routes/ – REST endpoints (auth, employees, payroll, reports, users, payslips)
* /utils/ – Calculators (ssnitCalculator.js, payeCalculator.js), authTokens.js
* /services/ – notificationService.js, paymentService.js, emailService.js
* /schemas/ – Zod validation (employeeSchema, userSchema, payrollSchema, notificationSchema)
* /graphql/ – typeDefs.js, resolvers.js
* /middleware/ – auth.js, rbac.js, validate.js, errorHandler.js
* db.js, logger.js, .env
Frontend (/frontend/)
* src/App.jsx – Router + Providers (Theme, Auth, Apollo)
* src/main.jsx – Entry point
* src/components/ – Card (glassmorphism), ThemeToggle, Navbar, Sidebar, Loader, Modal
* src/contexts/ – ThemeContext.jsx
* src/hooks/ – useAuth.js, useTheme.js, useGraphQL.js
* src/graphql/ – queries.js, mutations.js, subscriptions.js
* src/services/api.js – Apollo Client with auth + WS support
* src/pages/ – Login, Dashboard, Employees, Payroll, Reports, Settings, NotFound
* src/utils/ – formatCurrency.js, validateForm.js
* index.css, tailwind.config.js, vite.config.js
Design & UI Guidelines (Claude must follow)
* Glassmorphism: Semi-transparent cards with backdrop-filter: blur(10px), subtle borders, frosted look.
* Glowing Borders: On hover/focus use box-shadow: 0 0 15px rgba(59, 130, 246, 0.5) (blue in light, pink in dark).
* Dark/Light Mode: Use CSS variables + dark: Tailwind prefix. Toggle persists in localStorage.
* Typography: Primary font = Inter (weights 400, 500, 600, 700). Clean, professional, highly readable for financial data.
* Overall Feel: Modern, premium SaaS dashboard style. Clean spacing, subtle animations (Framer Motion), responsive (mobile-first).
Important Rules for Claude
1. Always respect multi-tenancy: Every operation must include companyId from context.
2. Security first: Never suggest hardcoding credentials. Use JWT + refresh tokens. Validate all inputs with Zod on both frontend and backend.
3. Ghana Compliance: SSNIT cap, 2026 PAYE bands, Ghana Card PIN format, TIN validation, GRA/SSNIT schedule formats must be preserved.
4. Modern Practices: Use async/await, proper error handling with Winston, BigInt for financial calculations, queues for heavy jobs.
5. Frontend Style: When suggesting UI changes, always use glassmorphism + glowing borders + Inter font + dark/light support.
6. GraphQL Preference: Prefer GraphQL queries/mutations when possible, but support REST fallback.
7. Performance: Suggest DataLoader for N+1, Redis caching for configs, BullMQ for background jobs.

## 🛑 STRICTOR LOGIC PRESERVATION (CRITICAL)
- **No Over-Simplification:** Do not refactor code by removing "excess" logic. The complexity in this app (validation, multi-step math, security middleware) is intentional.
- **Maintain Robustness:** If a function looks "long" because of extensive error handling, Zod validation, or audit logging, leave it intact. 
- **Bug Prevention:** Never suggest "shorter" versions of functions if it results in losing edge-case coverage or type safety.
- **Security Persistence:** Never suggest removing a middleware check or a `tenantId` filter to "clean up" a route.

## 🔒 MULTI-TENANCY & SECURITY
- **Isolation Pattern:** Every database query **MUST** include `where: { companyId: context.companyId }`. 
- **Data Integrity:** Use `BigInt` or `Decimal.js` for all financial calculations. Never use standard Floating Point for currency.
- **Audit Trails:** Every sensitive action (salary change, payroll run) must trigger an `AuditLog` entry.

How to Use This Context
When I say “continue working on the payroll system”, always reference this file and maintain consistency with the architecture, security model, and UI style described above.
When refactoring or adding features, **prioritize correctness and security over brevity.** If code is "verbose," it is likely to support the complex multi-tenant and regulatory requirements of the Ghanaian market.
You now have full context of the entire codebase.

