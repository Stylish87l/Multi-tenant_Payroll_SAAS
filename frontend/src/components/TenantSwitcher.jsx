// src/components/TenantSwitcher.jsx
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Shield, LogOut } from 'lucide-react';
import { tenants } from '../config/tenantConfig';
import { useTenantSwitcher } from '../hooks/useTenantSwitcher';

const TenantSwitcher = ({ user, onSwitchTenant, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { activeTenant, switchTenant } = useTenantSwitcher();

  if (user.role !== 'SUPER_ADMIN') {
    // Non-super admins only see their company name
    return (
      <div className="flex items-center space-x-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
        <Shield size={14} className="text-secondary" />
        <span className="text-xs font-semibold text-slate-200">{user.companyName}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="tenant-menu"
        className="flex items-center space-x-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition-all hover:bg-white/10"
      >
        <Shield size={14} className="text-secondary" />
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Tenant</p>
          <p className="text-xs font-semibold text-slate-200">{user.companyName}</p>
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            id="tenant-menu"
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-slate-900/90 p-1 shadow-2xl backdrop-blur-xl"
          >
            <div className="px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
              Switch Organization
            </div>
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => {
                  onSwitchTenant(tenant.id);
                  setIsOpen(false);
                }}
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
    </div>
  );
};

TenantSwitcher.propTypes = {
  user: PropTypes.shape({
    companyName: PropTypes.string,
    role: PropTypes.oneOf(['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE']),
  }).isRequired,
  onSwitchTenant: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
};

export default TenantSwitcher;
