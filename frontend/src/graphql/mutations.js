// frontend/src/graphql/mutations.js
import { gql } from '@apollo/client';
import { EMPLOYEE_CORE_FIELDS, EMPLOYEE_FINANCIAL_FIELDS } from './queries';

/**
 * AUTHENTICATION MUTATIONS
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
 * FIXED: Removed the lingering 'createdAt' field from the selection set 
 * to align perfectly with the backend typeDefs.js specification.
 */
export const CREATE_EMPLOYEE = gql`
  mutation CreateEmployee($input: EmployeeInput!) {
    createEmployee(input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ssnitNumber
      ghanaCardPin
      companyId
      isActive
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

/**
 * PREFERENCES & NOTIFICATIONS
 */
export const UPDATE_PREFERENCES = gql`
  mutation UpdatePreferences($input: UpdatePreferencesInput!) {
    updatePreferences(input: $input) {
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