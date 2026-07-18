import { gql } from 'graphql-tag';

const typeDefs = gql`
  # --- Custom High-Precision Architecture Scalars ---
  """
  The 'Decimal' scalar handles arbitrary-precision arithmetic values, 
  passed as string formats or floating-point literals to prevent JS IEEE 754 rounding errors.
  """
  scalar Decimal
  scalar JSON
  scalar DateTime

  # --- Shared Types ---
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  # --- Company & User Domain ---
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

  enum Role { 
    SUPER_ADMIN
    ADMIN
    HR
    ACCOUNTANT
    EMPLOYEE
    CUSTOM 
  }

  enum Status { 
    PENDING
    ACTIVE
    SUSPENDED 
  }
# --- Payment Domain (NEW) ---
  enum PaymentStatus {
    PENDING
    SENT
    PAID
    FAILED
  }

  enum PaymentProvider {
    HUBTEL
    PAYSTACK
  }

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
    refreshToken: String
    user: User!
    companyId: String
  }

  # --- Employee Domain ---
  type Employee {
    id: ID!
    name: String!
    email: String!
    """
    Deprecated: Legacy casing variant. Use 'ghanaCardPin' instead.
    """
    ghanaCardPIN: String @deprecated(reason: "Unified standard migrated to camelCase 'ghanaCardPin'.")
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!
    allowances: Decimal      
    position: String         
    isActive: Boolean!
    companyId: ID!
    company: Company!

    # --- Banking Data ---
    bankName: String
    bankAccount: String
    
    # --- Ghanaian GRA Tax Relief Parameters ---
    age: Int
    isMarried: Boolean
    hasResponsibility: Boolean
    childrenCount: Int
    isDisabled: Boolean
    agedDependentsCount: Int

    createdAt: DateTime      
    updatedAt: DateTime
  }

  """
  FIXED (2026-07-10): Previously declared 'totalCount: Int!' which no
  resolver ever populated (Query.employees returns { items, total, page,
  limit, pageInfo } - never totalCount), and omitted 'page'/'limit'/'total'
  entirely even though frontend/src/graphql/queries.js's GET_EMPLOYEES has
  always requested them. Since GraphQL validates a query's selection set
  against the schema BEFORE execution, requesting an undeclared field like
  'total' caused Apollo Server to reject the entire operation with a 400
  ("Cannot query field") - this is the exact cause of Employees.jsx's
  "Unable to load employees" and the identical failure mode on Payroll.jsx
  below. Schema now matches what resolvers.js actually returns.
  """
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
    """
    Legacy client override property.
    """
    ghanaCardPIN: String
    """
    Preferred clean camelCase standard payload key.
    """
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!
    allowances: Decimal
    position: String
    companyId: ID

    # --- Banking ---
    bankName: String
    bankAccount: String
    
    # --- Tax Relief Inclusions ---
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
    allowances: Decimal
    position: String
    isActive: Boolean

    # --- Banking ---
    bankName: String
    bankAccount: String
    
    # --- Tax Relief Inclusions ---
    age: Int
    isMarried: Boolean
    hasResponsibility: Boolean
    childrenCount: Int
    isDisabled: Boolean
    agedDependentsCount: Int
  }

  # --- Payroll Domain ---
  enum PayrollStatus { 
    DRAFT
    FINALIZED
    CANCELLED 
  }
  
  enum PayrollRunType { 
    REGULAR
    BONUS
    ADJUSTMENT 
  }

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

  """
  FIXED (2026-07-10): Same schema/resolver mismatch as EmployeeConnection
  above - 'totalCount' was declared but never populated, and 'page'/
  'limit'/'total' were missing even though GET_PAYROLL_RUNS has always
  queried them and resolvers.js's payrollRuns resolver has always returned
  them. This was rejecting Payroll.jsx's query with a 400 before it ever
  reached the RBAC/tenant-scoping logic inside the resolver.
  """
  type PayrollRunConnection {
    items: [PayrollRun!]!
    page: Int!
    limit: Int!
    total: Int!
    pageInfo: PageInfo!
  }

  type PayrollItem {
    id: ID!
    month: String
    status: String
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
    errorMessage: String
    isFinalized: Boolean
    updatedAt: DateTime
    employee: Employee!
  }
    
  # --- Notification Domain ---
  enum NotificationType { 
    INVITE
    PAYSLIP
    ALERT
    APPROVAL
    SYSTEM
    REMINDER 
  }
  
  enum NotificationChannel { 
    EMAIL
    SMS
    PUSH 
  }
  
  enum NotificationStatus { 
    PENDING
    SENT
    FAILED
    DELIVERED 
  }

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
    companyId: ID
    type: NotificationType!
    channel: NotificationChannel
    body: String!
    subject: String
  }

  # --- Preferences Domain ---
  type Preferences {
    id: ID!
    smsOptIn: Boolean!
    emailOptIn: Boolean!
    twoFactorEnabled: Boolean!
    darkMode: Boolean!
    language: String!
    notificationsEnabled: Boolean!
  }

  input UpdatePreferencesInput {
    smsOptIn: Boolean
    emailOptIn: Boolean
    twoFactorEnabled: Boolean
    darkMode: Boolean
    language: String
    notificationsEnabled: Boolean
  }

  # --- Audit Log Domain ---
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

  # --- Reports Domain ---
  type PayrollSummaryReport {
    totalGross: Decimal!
    totalPAYE: Decimal!
    totalSSNIT: Decimal!
    totalNetPay: Decimal!
    employeeCount: Int!
  }

  # --- Root Operations ---
  type Query {
    me: User
    
    """
    SUPER_ADMIN-only: lists every tenant for the branding tenant-picker.
    Deliberately returns ONLY Company scalar fields (no employees, payroll,
    or financial data attached) - this is a directory listing, not a data
    export.
    """
    companies: [Company!]!

    employees(
      companyId: ID
      search: String
      page: Int
      limit: Int
      after: String
    ): EmployeeConnection! 

    employeeCount(companyId: ID): Int
    recentPayrollRuns(companyId: ID, limit: Int): [PayrollRun!]!
    pendingNotifications(userId: ID): Int
    
    payrollRuns(
      companyId: ID
      page: Int
      limit: Int
      after: String
    ): PayrollRunConnection!
    
    payrollRun(id: ID!): PayrollRun
    notifications(page: Int, limit: Int): [Notification!]!
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
    finalizePayroll(runId: ID!): PayrollRun!
    sendNotification(input: NotificationInput!): Notification!
    updatePreferences(input: UpdatePreferencesInput!): Preferences!
    
    """
    Processes disbursement for a single payroll item. Requires the parent
    PayrollRun to be FINALIZED first - payouts must never fire against a
    DRAFT run that hasn't been reviewed. Idempotent: calling this twice on
    an already SENT/PAID item is rejected by paymentServices.js's guard.
    """
    processPayout(payrollItemId: ID!, provider: PaymentProvider): PayrollItem!

    """
    Bulk-disburses every PENDING or previously-FAILED item on a finalized
    run. Partial failure is expected and non-fatal - the mutation reports
    the run's post-attempt state; check each item's paymentStatus to see
    which succeeded.
    """
    processRunPayouts(runId: ID!, provider: PaymentProvider): PayrollRun!
  }

  type Subscription {
    payrollUpdated(companyId: ID): PayrollRun!
    notificationSent(userId: ID!): Notification!
  }
`;

export default typeDefs;