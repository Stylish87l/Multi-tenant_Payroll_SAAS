// frontend/src/graphql/mutations.js
import { gql } from '@apollo/client';
import { EMPLOYEE_CORE_FIELDS, EMPLOYEE_FINANCIAL_FIELDS, EMPLOYEE_RELIEF_FIELDS } from './queries';

/**
 * AUTHENTICATION MUTATIONS
 *
 * NOTE (2026-07-10): There is intentionally NO GraphQL refresh mutation.
 * controllers/authController.js documents why: refresh/rotation lives
 * exclusively in routes/auth.js (POST /api/auth/refresh) + config/cookies.js
 * as the single source of truth for httpOnly cookie options. A prior
 * GraphQL-based refresh flow signed tokens without the `tokenId` claim
 * routes/auth.js requires for DB lookup, silently breaking every session's
 * ability to refresh. frontend/src/lib/apolloClient.js's doRefresh() calls
 * the REST endpoint directly and is the only supported client entry point -
 * do not reintroduce a GraphQL refresh mutation here.
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

/**
 * EMPLOYEE MANAGEMENT
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

export const FINALIZE_PAYROLL = gql`
  mutation FinalizePayroll($runId: ID!) {
    finalizePayroll(runId: $runId) {
      id
      status
      isFinalized
      processedAt
    }
  }
`;

/**
 * PAYOUTS (NEW, 2026-07-10)
 * FIXED: previously declared `processPayout(runId: ID!)` and requested
 * fields (disbursementReference, payoutLog) that exist nowhere in the
 * schema or the Prisma model - this mutation could never have worked.
 * A payout is per PayrollItem, not per PayrollRun (a run has many
 * employees, each disbursed independently) - see
 * backend/graphql/typeDefs.js's Mutation.processPayout signature.
 */
export const PROCESS_PAYOUT = gql`
  mutation ProcessPayout($payrollItemId: ID!, $provider: PaymentProvider) {
    processPayout(payrollItemId: $payrollItemId, provider: $provider) {
      id
      paymentStatus
      paymentRef
      netPay
      updatedAt
      employee {
        id
        name
      }
    }
  }
`;

/**
 * Bulk disbursement for every pending/failed item on a finalized run.
 * Use this for the "Pay All" action on the Payroll page; use PROCESS_PAYOUT
 * for a single employee's retry/manual disbursement.
 */
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
        employee {
          id
          name
        }
      }
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