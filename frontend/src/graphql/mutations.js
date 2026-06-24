import { gql } from '@apollo/client';
// IMPORTANT: Ensure these fragments in queries.js include 'id', 'name', 'email', and 'basicSalary'
import { EMPLOYEE_CORE_FIELDS, EMPLOYEE_FINANCIAL_FIELDS } from './queries';

/**
 * AUTHENTICATION & SESSION
 * Restored: refreshToken handling and user profile fields.
 */
export const LOGIN_MUTATION = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
      refreshToken
      companyId
      user {
        id
        email
        name
        role
        status
        companyId
      }
    }
  }
`;

export const REFRESH_MUTATION = gql`
  mutation Refresh($refreshToken: String!) {
    refresh(refreshToken: $refreshToken) {
      accessToken
      refreshToken
      user {
        id
        role
        companyId
      }
    }
  }
`;

/**
 * EMPLOYEE MANAGEMENT
 * Restored: Full field returns to support the 'update' and 'optimisticResponse' 
 * logic in Employees.jsx.
 */
export const CREATE_EMPLOYEE = gql`
  mutation CreateEmployee($input: CreateEmployeeInput!) {
    createEmployee(input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ssnitNumber
      ghanaCardPin
      companyId
      isActive
      createdAt
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
`;

export const UPDATE_EMPLOYEE = gql`
  mutation UpdateEmployee($id: ID!, $input: UpdateEmployeeInput!) {
    updateEmployee(id: $id, input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ssnitNumber
      ghanaCardPin
      companyId
      isActive
      updatedAt
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
`;

/**
 * PAYROLL OPERATIONS
 * Restored: errorMessage and isFinalized for robust UI state.
 */
export const RUN_PAYROLL = gql`
  mutation RunPayroll($month: String!, $companyId: ID) {
    runPayroll(month: $month, companyId: $companyId) {
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
  }
`;

/**
 * FINANCIAL DISBURSEMENT
 * Restored: disbursementReference and payoutLog for audit trails.
 */
export const PROCESS_PAYOUT = gql`
  mutation ProcessPayout($runId: ID!) {
    processPayout(runId: $runId) {
      id
      status
      disbursementReference
      payoutLog
      updatedAt
    }
  }
`;

export const UPDATE_PREFERENCES = gql`
  mutation UpdatePreferences($input: UpdatePreferencesInput!) {
    updatePreferences(input: $input) {
      id
      darkMode
      language
      notificationsEnabled
    }
  }
`;

/**
 * NOTIFICATIONS
 * Added: To support the notification logic in your system.
 */
export const SEND_NOTIFICATION = gql`
  mutation SendNotification($input: NotificationInput!) {
    sendNotification(input: $input) {
      id
      type
      status
      sentAt
    }
  }
`;