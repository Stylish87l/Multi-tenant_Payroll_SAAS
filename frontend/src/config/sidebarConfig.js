// src/config/sidebarConfig.js
import { Home, Users, DollarSign, FileText, Settings, Paintbrush } from 'lucide-react';

/**
 * Role-based sidebar menu configuration
 * Each item defines which roles can see it
 */
export const sidebarMenuItems = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: Home,
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'],
  },
  {
    name: 'Employees',
    path: '/employees',
    icon: Users,
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  },
  {
    name: 'Payroll',
    path: '/payroll',
    icon: DollarSign,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
  },
  {
    name: 'Reports',
    path: '/reports',
    icon: FileText,
    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'],
  },
  {
    // NEW (2026-07-10): Tenant-wide branding (theme color, logo, footer
    // note, payslip template) - distinct from personal Settings below.
    // Restricted to tenant administrators: SUPER_ADMIN (any tenant) and
    // ADMIN (their own tenant only, enforced server-side in
    // routes/tenantBranding.js). HR/ACCOUNTANT/EMPLOYEE never see this -
    // they have no legitimate reason to alter company-wide branding.
    name: 'Branding',
    path: '/branding',
    icon: Paintbrush,
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    // Personal preferences (notification opt-ins, 2FA) - backend applies
    // no role restriction beyond "is authenticated" (see
    // graphql/resolvers.js Query.preferences / Mutation.updatePreferences),
    // so every role must be able to reach it.
    name: 'Settings',
    path: '/settings',
    icon: Settings,
    roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'],
  },
];