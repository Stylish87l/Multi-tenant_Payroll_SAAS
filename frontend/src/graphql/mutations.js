// frontend/src/graphql/mutations.js
import { gql } from '@apollo/client';
import { EMPLOYEE_CORE_FIELDS, EMPLOYEE_FINANCIAL_FIELDS, EMPLOYEE_RELIEF_FIELDS } from './queries';

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
 * FIXED (2026-07-05): now also selects ...EmployeeRelief so the mutation
 * response (used directly as the optimistic/cache-written record in
 * Employees.jsx) includes the tax-relief and banking fields the resolver
 * now actually persists - without this, the cache write after a create/
 * update would silently overwrite those fields back to `undefined` in
 * the Apollo cache even though the DB write succeeded correctly.
 */
export const CREATE_EMPLOYEE = gql`
  mutation CreateEmployee($input: EmployeeInput!) {
    createEmployee(input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ...EmployeeRelief
      ssnitNumber
      ghanaCardPin
      companyId
      isActive
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
  ${EMPLOYEE_RELIEF_FIELDS}
`;

export const UPDATE_EMPLOYEE = gql`
  mutation UpdateEmployee($id: ID!, $input: UpdateEmployeeInput!) {
    updateEmployee(id: $id, input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ...EmployeeRelief
      ssnitNumber
      ghanaCardPin
      companyId
      isActive
      updatedAt
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
  ${EMPLOYEE_RELIEF_FIELDS}
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
 * FIXED (2026-07-06): Re-aligned payload selections with the fixed backend 
 * updatePreferences resolver to ensure instant Apollo Cache updates for settings pages.
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

/**
 * FIXED (2026-07-06): Expanded returned fields to fully synchronize with your 
 * backend Prisma creation payload, preventing missing state elements in tracking views.
 */
export const SEND_NOTIFICATION = gql`
  mutation SendNotification($input: SendNotificationInput!) {
    sendNotification(input: $input) {
      id
      userId
      type
      channel
      status
      content
      companyId
      sentAt
    }
  }
`;