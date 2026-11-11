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

// The three allowance columns are now read AND written (previously only the deprecated computed total
// was exposed, so every UI-created employee silently had zero allowances in payroll).
export const EMPLOYEE_FINANCIAL_FIELDS = gql`
  fragment EmployeeFinancial on Employee {
    id
    basicSalary
    housingAllowance
    transportAllowance
    otherAllowance
  }
`;

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
        companyId
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

// $companyId is nullable: SUPER_ADMIN has no tenant until one is selected.
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

export const GET_PREFERENCES = gql`
  query GetPreferences {
    preferences {
      id
      smsOptIn
      emailOptIn
      darkMode
      language
      notificationsEnabled
    }
  }
`;

// SUPER_ADMIN-only tenant directory (Branding picker + navbar tenant switcher).
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
