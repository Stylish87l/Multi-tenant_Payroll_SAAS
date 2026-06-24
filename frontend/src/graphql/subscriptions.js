import { gql } from '@apollo/client';

/**
 * Subscriptions are intentionally strict: require tenant/user IDs and
 * include only the fields the UI needs to avoid accidental over-fetching.
 * Client must call useSubscription(..., { skip: !companyId }) to prevent
 * subscriptions from opening without a valid context.
 */

/* Payroll updates for a tenant — used to update dashboard metrics and recent runs */
export const PAYROLL_UPDATED_SUB = gql`
  subscription OnPayrollUpdated($companyId: ID!) {
    payrollUpdated(companyId: $companyId) {
      id
      month
      status
      totalNet
      processedAt
    }
  }
`;

/* Notification events for a specific user — keep payload minimal for UI */
export const NOTIFICATION_SENT_SUB = gql`
  subscription OnNotificationSent($userId: ID!) {
    notificationSent(userId: $userId) {
      id
      type
      content
      channel
      status
      createdAt
    }
  }
`;

/* System health for a tenant — lightweight heartbeat for sync indicators */
export const SYSTEM_HEALTH_SUB = gql`
  subscription OnSystemStatus($companyId: ID!) {
    systemStatus(companyId: $companyId) {
      isSyncing
      lastBackup
      activeUsers
    }
  }
`;
