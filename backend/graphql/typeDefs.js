import { gql } from 'graphql-tag';

const typeDefs = gql`
  scalar Decimal
  scalar JSON
  scalar DateTime

  # --- Shared Types ---
  type PageInfo {
    hasNextPage: Boolean!
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
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!
    allowances: Decimal
    position: String!
    isActive: Boolean!
    companyId: ID!
    company: Company!
  }

  # FIX: Added page, limit, and total (matching your query)
  type EmployeeConnection {
    items: [Employee!]!
    page: Int
    limit: Int
    total: Int
    pageInfo: PageInfo!
  }

  input EmployeeInput {
    name: String!
    email: String!
    ghanaCardPin: String
    ssnitNumber: String
    basicSalary: Decimal!
    allowances: Decimal
    position: String!
    companyId: ID
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

  # FIX: Added totalNet, errorMessage, and isFinalized here too for consistency
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

  # FIX: Added pagination fields to match your query for payroll runs
  type PayrollRunConnection {
    items: [PayrollRun!]!
    page: Int
    limit: Int
    total: Int
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
    netPay: Decimal!
    totalNet: Decimal      
    processedAt: DateTime  
    errorMessage: String   
    isFinalized: Boolean  
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
  }

  input NotificationInput {
    userId: ID!
    type: NotificationType!
    channel: NotificationChannel
    body: String!
    subject: String
  }

  # --- Root Operations ---
  type Query {
    me: User
    employees(companyId: ID, search: String, page: Int, limit: Int): EmployeeConnection! 
    employeeCount(companyId: ID): Int
    recentPayrollRuns(companyId: ID, limit: Int): [PayrollRun!]!
    pendingNotifications(userId: ID): Int
    # FIX: Updated return type to use the new Connection type
    payrollRuns(companyId: ID, page: Int, limit: Int): PayrollRunConnection!
    payrollRun(id: ID!): PayrollRun
    notifications(page: Int, limit: Int): [Notification!]!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!, companyName: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    createEmployee(input: EmployeeInput!): Employee!
    runPayroll(month: String!, companyId: ID!): PayrollRun!
    finalizePayroll(runId: ID!): PayrollRun!
    sendNotification(input: NotificationInput!): Notification!
  }

  type Subscription {
    payrollUpdated(companyId: ID): PayrollRun!
    notificationSent(userId: ID!): Notification!
  }
`;

export default typeDefs;