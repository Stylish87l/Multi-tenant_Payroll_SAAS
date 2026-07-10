// frontend/src/graphql/queries.js
import { gql } from '@apollo/client';

export const EMPLOYEE_CORE_FIELDS = gql`
  fragment EmployeeCore on Employee {
    id
    name
    email
    position
    isActive
    companyId
  }
`;

export const EMPLOYEE_FINANCIAL_FIELDS = gql`
  fragment EmployeeFinancial on Employee {
    id
    basicSalary
    allowances
  }
`;

// FIXED (2026-07-05): added so the Employees.jsx edit form can actually
// prefill an employee's GRA tax-relief attributes and banking details.
// Previously these were never fetched by the list/edit query at all, so
// every "edit" silently reset them to their Prisma column defaults the
// moment updateEmployee ran (since resolvers.js's update previously wrote
// `undefined` for anything not in formData, and formData never had these
// keys to begin with).
export const EMPLOYEE_RELIEF_FIELDS = gql`
  fragment EmployeeRelief on Employee {
    id
    age
    isMarried
    hasResponsibility
    childrenCount
    isDisabled
    agedDependentsCount
    bankName
    bankAccount
  }
`;

export const GET_PAYROLL_RUNS = gql`
  query GetPayrollRuns($companyId: ID, $page: Int = 1, $limit: Int = 50) {
    payrollRuns(companyId: $companyId, page: $page, limit: $limit) {
      items {
        id
        month
        status
        totalNet
        processedAt
        errorMessage
        isFinalized
        runType
      }
      page 
      limit 
      total 
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_EMPLOYEES = gql`
  query GetEmployees($companyId: ID, $page: Int = 1, $limit: Int = 50, $search: String) {
    employees(companyId: $companyId, page: $page, limit: $limit, search: $search) {
      items {
        ...EmployeeCore
        ...EmployeeFinancial
        ...EmployeeRelief
        ssnitNumber 
        ghanaCardPin
      }
      page
      limit
      total
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
  ${EMPLOYEE_RELIEF_FIELDS}
`;

// FIXED (2026-07-10): $companyId changed from ID! to ID (nullable).
// SUPER_ADMIN's JWT deliberately carries companyId: null (see
// backend/utils/authTokens.js / middleware/auth.js - "SUPER_ADMIN is
// global, not tied to a specific tenant"). A non-null ID! variable made
// this query impossible to run for that role without sending an invalid
// value. The underlying resolvers (employeeCount, recentPayrollRuns) both
// already handle a null/absent companyId correctly for SUPER_ADMIN
// (falling back to an explicit, logged global aggregate) - only the
// client-side contract was too strict.
export const GET_DASHBOARD_DATA = gql`
  query GetDashboardData($companyId: ID) {
    stats: employeeCount(companyId: $companyId)
    recentRuns: recentPayrollRuns(companyId: $companyId, limit: 5) {
      id
      month
      status
      totalNet
      processedAt
    }
    notificationsCount: pendingNotifications
  }
`;

export const GET_ME = gql`
  query GetMe {
    me {
      id
      email
      name
      role
      companyId
      status
    }
  }
`;

export const GET_PREFERENCES = gql`
  query GetPreferences {
    preferences {
      id
      smsOptIn
      emailOptIn
      twoFactorEnabled
      darkMode
      language
      notificationsEnabled
    }
  }
`;

// NEW (2026-07-10): SUPER_ADMIN-only tenant directory for the Branding
// page's company picker. Deliberately requests only scalar identity
// fields - no employee/payroll data is exposed through this query.
export const GET_COMPANIES = gql`
  query GetCompanies {
    companies {
      id
      name
      tin
      themeColor
      logoUrl
      footerNote
    }
  }
`;