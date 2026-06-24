import React, { useState, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  FileText,
  ChevronDown,
  LogOut,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { tenants } from '../config/tenantConfig';
import { useTenantSwitcher } from '../hooks/useTenantSwitcher';
import { useAuth } from '../context/AuthContext';

const TenantMenu = ({ isOpen, user, onSwitchTenant, onLogout }) => (
  <AnimatePresence>
    {isOpen && user?.role === 'SUPER_ADMIN' && (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        role="menu"
        aria-label="Tenant Menu"
        className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-slate-900/90 p-1 shadow-2xl backdrop-blur-xl"
      >
        <div className="px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
          Switch Organization
        </div>
        {tenants.map((tenant) => (
          <button
            key={tenant.id}
            onClick={() => onSwitchTenant(tenant.id)}
            className="flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
            role="menuitem"
          >
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <span>{tenant.name}</span>
          </button>
        ))}
        <div className="my-1 border-t border-white/5" />
        <button
          onClick={onLogout}
          className="flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm text-rose-400 transition-colors hover:bg-rose-500/10"
          role="menuitem"
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </motion.div>
    )}
  </AnimatePresence>
);

const MobileMenu = ({ navItems, isOpen, onClose }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        className="fixed inset-y-0 right-0 w-64 bg-slate-900 p-4 z-50 md:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile Navigation"
      >
        <button
          onClick={onClose}
          className="mb-4 text-white"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="block py-2 text-slate-300 hover:text-white"
            onClick={onClose}
          >
            <item.icon size={16} className="inline mr-2" />
            {item.name}
          </Link>
        ))}
      </motion.div>
    )}
  </AnimatePresence>
);

const Navbar = () => {
  const { user, logout } = useAuth(); // ✅ useAuth instead of props
  const location = useLocation();
  const [isTenantMenuOpen, setIsTenantMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const { activeTenant, switchTenant } = useTenantSwitcher(user?.companyName || "");

  const navItems = useMemo(
    () => [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Employees', path: '/employees', icon: Users },
      { name: 'Payroll', path: '/payroll', icon: CreditCard },
      { name: 'Reports', path: '/reports', icon: FileText },
    ],
    []
  );

  const isActive = useCallback((path) => location.pathname === path, [location.pathname]);

  return (
    <nav className="sticky top-0 z-[60] w-full border-b border-white/10 bg-slate-950/60 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center space-x-2">
          <div className="h-8 w-8 rounded bg-gradient-to-tr from-primary to-secondary shadow-lg shadow-primary/20" />
          <span className="text-xl font-bold tracking-tight text-white">
            Ghana<span className="text-primary">Payroll</span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center space-x-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                isActive(item.path) ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="relative z-10 flex items-center space-x-2">
                <item.icon size={16} />
                <span>{item.name}</span>
              </span>
              {isActive(item.path) && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute inset-0 rounded-lg bg-white/5 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                  initial={false}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
            </Link>
          ))}
        </div>

        {/* Mobile Hamburger */}
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden p-2 text-white"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>

        {/* User & Tenant Section */}
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          {user ? (
            <div className="relative">
              <button
                onClick={() => setIsTenantMenuOpen((prev) => !prev)}
                aria-expanded={isTenantMenuOpen}
                aria-controls="tenant-menu"
                className="flex items-center space-x-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition-all hover:bg-white/10"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary/20 text-secondary">
                  <Shield size={14} />
                </div>
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Tenant</p>
                  <p className="text-xs font-semibold text-slate-200">{activeTenant}</p>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${isTenantMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <TenantMenu
                isOpen={isTenantMenuOpen}
                user={user}
                onSwitchTenant={switchTenant}
                onLogout={logout}
              />
            </div>
          ) : (
            <Link
              to="/login"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105"
            >
              Login
            </Link>
          )}
        </div>
      </div>

      {/* Mobile Drawer */}
      <MobileMenu
        navItems={navItems}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
    </nav>
  );
};

export default React.memo(Navbar);
