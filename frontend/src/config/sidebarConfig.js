// src/config/sidebarConfig.js
import { Home, Users, DollarSign, FileText, Settings } from 'lucide-react';

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
    name: 'Settings',
    path: '/settings',
    icon: Settings,
    roles: ['SUPER_ADMIN'],
  },
];
