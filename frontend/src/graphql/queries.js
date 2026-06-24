import { gql } from '@apollo/client';

/**
 * FRAGMENTS
 * Restored: All core fields required by Employees.jsx and Mutation Cache updates.
 */
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

/**
 * GET_PAYROLL_RUNS
 * Restored: Sibling positioning for page, limit, and total.
 */
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

/**
 * GET_EMPLOYEES
 * Restored: Fragment composition and SSNIT/GhanaCard fields for immediate UI display.
 */
export const GET_EMPLOYEES = gql`
  query GetEmployees($companyId: ID, $page: Int = 1, $limit: Int = 50, $search: String) {
    employees(companyId: $companyId, page: $page, limit: $limit, search: $search) {
      items {
        ...EmployeeCore
        ...EmployeeFinancial
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
`;

/**
 * GET_DASHBOARD_DATA
 * Restored: Multi-query fetching for the main dashboard view.
 */
export const GET_DASHBOARD_DATA = gql`
  query GetDashboardData($companyId: ID!) {
    stats: employeeCount(companyId: $companyId)
    recentRuns: recentPayrollRuns(companyId: $companyId, limit: 5) {
      id
      month
      status
      totalNet
      processedAt
    }
    notificationsCount: pendingNotifications(companyId: $companyId)
  }
`;

/**
 * GET_REPORTS (GRA & SSNIT)
 * Restored: Locally compliant fields for Ghana Revenue Authority and SSNIT.
 */
export const GET_REPORTS = gql`
  query GetReports($companyId: ID!, $month: String!) {
    graSchedules(companyId: $companyId, month: $month) {
      serialNo
      tin
      name
      assessable
      paye
    }
    ssnitSchedules(companyId: $companyId, month: $month) {
      ssnitNo
      name
      tier1
      tier2
      totalContribution
    }
  }
`;

/**
 * GET_ME
 * Restored: Essential auth context fields.
 */
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

/**
 * GET_PREFERENCES
 * Restored: UI Theme and Notification settings.
 */
export const GET_PREFERENCES = gql`
  query GetPreferences {
    preferences {
      id
      darkMode
      language
      notificationsEnabled
    }
  }
`;