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