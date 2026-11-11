// frontend/src/graphql/mutations.js
import { gql } from '@apollo/client';
import { EMPLOYEE_CORE_FIELDS, EMPLOYEE_FINANCIAL_FIELDS, EMPLOYEE_RELIEF_FIELDS } from './queries';

/**
 * There is intentionally NO GraphQL refresh mutation: refresh/rotation lives in REST
 * (POST /api/auth/refresh) with config/cookies.js as the single source of truth for cookie options.
 * apolloClient.js's doRefresh() is the only supported client entry point.
 */
export const LOGIN_MUTATION = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      accessToken
      companyId
      user {
        id
        email
        name
        role
        status
        companyId
        company {
          id
          name
        }
      }
    }
  }
`;

export const CREATE_EMPLOYEE = gql`
  mutation CreateEmployee($input: EmployeeInput!) {
    createEmployee(input: $input) {
      id
      ...EmployeeCore
      ...EmployeeFinancial
      ...EmployeeRelief
      ssnitNumber
      ghanaCardPin
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
      updatedAt
    }
  }
  ${EMPLOYEE_CORE_FIELDS}
  ${EMPLOYEE_FINANCIAL_FIELDS}
  ${EMPLOYEE_RELIEF_FIELDS}
`;

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

export const FINALIZE_PAYROLL = gql`
  mutation FinalizePayroll($runId: ID!) {
    finalizePayroll(runId: $runId) {
      id
      month
      status
      totalNet
      isFinalized
      processedAt
      runType
      companyId
      errorMessage
    }
  }
`;

export const DISCARD_PAYROLL_DRAFT = gql`
  mutation DiscardPayrollDraft($runId: ID!) {
    discardPayrollDraft(runId: $runId)
  }
`;

// A payout is per PayrollItem (a run has many employees, each disbursed independently).
export const PROCESS_PAYOUT = gql`
  mutation ProcessPayout($payrollItemId: ID!, $provider: PaymentProvider) {
    processPayout(payrollItemId: $payrollItemId, provider: $provider) {
      id
      paymentStatus
      paymentRef
      netPay
      updatedAt
      employee { id name }
    }
  }
`;

export const PROCESS_RUN_PAYOUTS = gql`
  mutation ProcessRunPayouts($runId: ID!, $provider: PaymentProvider) {
    processRunPayouts(runId: $runId, provider: $provider) {
      id
      status
      isFinalized
      items {
        id
        paymentStatus
        paymentRef
        employee { id name }
      }
    }
  }
`;

export const UPDATE_PREFERENCES = gql`
  mutation UpdatePreferences($input: UpdatePreferencesInput!) {
    updatePreferences(input: $input) {
      id
      smsOptIn
      emailOptIn
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
