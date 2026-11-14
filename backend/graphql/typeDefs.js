import { gql } from 'graphql-tag';

const typeDefs = gql`
  """Arbitrary-precision decimal, serialised as a string to avoid IEEE 754 rounding."""
  scalar Decimal
  scalar JSON
  scalar DateTime

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type Company {
    id: ID!
    name: String!
    tin: String
    address: String
    themeColor: String
    logoUrl: String
    footerNote: String
    payslipTemplate: JSON
    createdBy: String
    createdAt: DateTime!
  }

  enum Role { SUPER_ADMIN ADMIN HR ACCOUNTANT EMPLOYEE CUSTOM }
  enum Status { PENDING ACTIVE SUSPENDED }

  enum PaymentStatus { PENDING PROCESSING SENT PAID FAILED }
  enum PaymentProvider { HUBTEL PAYSTACK }

  type User {
    id: ID!
    email: String!
    name: String
    role: Role!
    status: Status!
    company: Company
    companyId: ID
  }

  type AuthPayload {
    accessToken: String!
    user: User!
    companyId: String
  }

  type Employee {
    id: ID!
    name: String!
    email: String!
    """Deprecated: legacy casing. Use 'ghanaCardPin'."""
    ghanaCardPIN: String @deprecated(reason: "Unified standard migrated to camelCase 'ghanaCardPin'.")
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!

    housingAllowance: Decimal
    transportAllowance: Decimal
    otherAllowance: Decimal
    """Read-only computed sum of the three allowance fields."""
    allowances: Decimal @deprecated(reason: "Use housingAllowance/transportAllowance/otherAllowance instead.")
    position: String
    isActive: Boolean!
    companyId: ID!
    company: Company!

    bankName: String
    bankCode: String
    bankAccount: String

    age: Int
    isMarried: Boolean
    hasResponsibility: Boolean
    childrenCount: Int
    isDisabled: Boolean
    agedDependentsCount: Int

    createdAt: DateTime
    updatedAt: DateTime
  }

  type EmployeeConnection {
    items: [Employee!]!
    page: Int!
    limit: Int!
    total: Int!
    pageInfo: PageInfo!
  }

  input EmployeeInput {
    name: String!
    email: String!
    ghanaCardPIN: String
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!

    housingAllowance: Decimal
    transportAllowance: Decimal
    otherAllowance: Decimal
    allowances: Decimal @deprecated(reason: "Use housingAllowance/transportAllowance/otherAllowance instead.")

    position: String
    companyId: ID

    bankName: String
    bankCode: String
    bankAccount: String

    age: Int
    isMarried: Boolean
    hasResponsibility: Boolean
    childrenCount: Int
    isDisabled: Boolean
    agedDependentsCount: Int
  }

  input UpdateEmployeeInput {
    name: String
    email: String
    ghanaCardPIN: String
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal

    housingAllowance: Decimal
    transportAllowance: Decimal
    otherAllowance: Decimal
    allowances: Decimal @deprecated(reason: "Use housingAllowance/transportAllowance/otherAllowance instead.")

    position: String
    isActive: Boolean

    bankName: String
    bankCode: String
    bankAccount: String

    age: Int
    isMarried: Boolean
    hasResponsibility: Boolean
    childrenCount: Int
    isDisabled: Boolean
    agedDependentsCount: Int
  }

  enum PayrollStatus { DRAFT FINALIZED CANCELLED }
  enum PayrollRunType { REGULAR BONUS ADJUSTMENT }

  type PayrollRun {
    id: ID!
    month: String!
    status: PayrollStatus!
    runType: PayrollRunType!
    totalNet: Decimal
    items: [PayrollItem!]
    createdAt: DateTime!
    processedAt: DateTime
    errorMessage: String
    isFinalized: Boolean
    companyId: ID!
  }

  type PayrollRunConnection {
    items: [PayrollRun!]!
    page: Int!
    limit: Int!
    total: Int!
    pageInfo: PageInfo!
  }

  type PayrollItem {
    id: ID!
    grossSalary: Decimal!
    taxableIncome: Decimal!
    payeTax: Decimal!
    ssnitEmployee: Decimal!
    ssnitEmployer: Decimal!
    netPay: Decimal!
    totalNet: Decimal
    paymentStatus: PaymentStatus!
    paymentRef: String
    processedAt: DateTime
    isFinalized: Boolean
    updatedAt: DateTime
    employee: Employee!
  }

  enum NotificationType { INVITE PAYSLIP ALERT APPROVAL SYSTEM REMINDER }
  enum NotificationChannel { EMAIL SMS PUSH }
  enum NotificationStatus { PENDING SENT FAILED DELIVERED }

  type Notification {
    id: ID!
    type: NotificationType!
    channel: NotificationChannel!
    status: NotificationStatus!
    content: JSON!
    sentAt: DateTime
    expiresAt: DateTime
    userId: ID!
    companyId: ID
  }

  input NotificationInput {
    userId: ID!
    type: NotificationType!
    channel: NotificationChannel
    body: String!
    subject: String
  }

  type Preferences {
    id: ID!
    smsOptIn: Boolean!
    emailOptIn: Boolean!
    twoFactorEnabled: Boolean!
    darkMode: Boolean!
    language: String!
    notificationsEnabled: Boolean!
  }

  """twoFactorEnabled is intentionally not accepted: no 2FA mechanism is implemented yet."""
  input UpdatePreferencesInput {
    smsOptIn: Boolean
    emailOptIn: Boolean
    darkMode: Boolean
    language: String
    notificationsEnabled: Boolean
  }

  type AuditLog {
    id: ID!
    userId: ID
    companyId: ID
    action: String!
    details: JSON!
    ipAddress: String
    createdAt: DateTime!
    performedBy: String
    resourceId: String
    resourceType: String
  }

  type PayrollSummaryReport {
    totalGross: Decimal!
    totalPAYE: Decimal!
    totalSSNIT: Decimal!
    totalNetPay: Decimal!
    employeeCount: Int!
  }

  type Query {
    me: User

    """SUPER_ADMIN-only tenant directory. Company scalar fields only."""
    companies: [Company!]!

    employees(companyId: ID, search: String, page: Int, limit: Int, after: String): EmployeeConnection!
    employeeCount(companyId: ID): Int
    recentPayrollRuns(companyId: ID, limit: Int): [PayrollRun!]!
    pendingNotifications(userId: ID): Int

    payrollRuns(companyId: ID, page: Int, limit: Int, after: String): PayrollRunConnection!
    payrollRun(id: ID!): PayrollRun
    notifications(page: Int, limit: Int): [Notification!]!
    """ADMIN / SUPER_ADMIN only. Tenant-scoped."""
    auditLogs(companyId: ID, page: Int, limit: Int): [AuditLog!]!
    payrollSummaryReport(companyId: ID, month: String): PayrollSummaryReport!
    preferences: Preferences
  }

  type Mutation {
    register(email: String!, password: String!, name: String!, companyName: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    createEmployee(input: EmployeeInput!): Employee!
    updateEmployee(id: ID!, input: UpdateEmployeeInput!): Employee!
    runPayroll(month: String!, companyId: ID): PayrollRun!
    """DRAFT -> FINALIZED. Rejects runs that are not DRAFT."""
    finalizePayroll(runId: ID!): PayrollRun!
    """Deletes a DRAFT run (and its items) so the month can be re-run. FINALIZED runs cannot be discarded."""
    discardPayrollDraft(runId: ID!): Boolean!
    sendNotification(input: NotificationInput!): Notification!
    updatePreferences(input: UpdatePreferencesInput!): Preferences!

    """Requires the parent run to be FINALIZED. Idempotent: SENT/PAID items are rejected."""
    processPayout(payrollItemId: ID!, provider: PaymentProvider): PayrollItem!
    """Bulk-disburses every PENDING/FAILED item on a finalized run (partial failure is non-fatal)."""
    processRunPayouts(runId: ID!, provider: PaymentProvider): PayrollRun!
  }

  type Subscription {
    payrollUpdated(companyId: ID): PayrollRun!
    notificationSent(userId: ID!): Notification!
  }
`;

export default typeDefs;
