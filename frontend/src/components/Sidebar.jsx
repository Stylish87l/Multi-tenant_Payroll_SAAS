import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { sidebarMenuItems } from '../config/sidebarConfig';

const MobileSidebar = ({ isOpen, onClose, user }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.aside
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
        className="fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-4"
        role="navigation"
        aria-label="Mobile Sidebar"
      >
        <button
          onClick={onClose}
          className="mb-6 text-slate-400 hover:text-white"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        <nav className="space-y-2">
          {sidebarMenuItems
            .filter((item) => user?.role && item.roles.includes(user.role))
            .map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-xl px-3 py-3 transition-all duration-200',
                    isActive
                      ? 'bg-primary/10 text-primary shadow-[inset_0_0_10px_rgba(var(--primary-rgb),0.1)]'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  )
                }
              >
                <item.icon size={22} className="mr-3" />
                <span className="font-medium">{item.name}</span>
              </NavLink>
            ))}
        </nav>
      </motion.aside>
    )}
  </AnimatePresence>
);

const Sidebar = ({ user }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'relative hidden md:flex flex-col border-r border-white/10 bg-slate-950 transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-20' : 'w-64'
        )}
        role="navigation"
        aria-label="Desktop Sidebar"
      >
        {/* Collapse Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          aria-label="Toggle sidebar"
          className="absolute -right-3 top-10 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-slate-400 hover:text-white"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Role-based Navigation Links */}
        <nav className="flex-1 space-y-2 p-4 pt-20 overflow-y-auto custom-scrollbar">
          {sidebarMenuItems
            .filter((item) => user?.role && item.roles.includes(user.role))
            .map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center rounded-xl px-3 py-3 transition-all duration-200',
                    isActive
                      ? 'bg-primary/10 text-primary shadow-[inset_0_0_10px_rgba(var(--primary-rgb),0.1)]'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  )
                }
              >
                {/* FIXED: We pass a callback function to evaluate children props cleanly */}
                {({ isActive }) => (
                  <>
                    <div className="flex items-center">
                      <item.icon
                        size={22}
                        className={cn(
                          'min-w-[22px] transition-colors',
                          isActive
                            ? 'text-primary'
                            : 'text-slate-500 group-hover:text-slate-300'
                        )}
                      />
                      <AnimatePresence>
                        {!isCollapsed && (
                          <motion.span
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="ml-4 whitespace-nowrap font-medium"
                          >
                            {item.name}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {/* The layout glow marker can now cleanly track the true active layout value */}
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-glow"
                        className="absolute left-0 h-6 w-1 rounded-r-full bg-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.8)]"
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
        </nav>

        {/* Sidebar Footer */}
        {!isCollapsed && (
          <div className="p-4 border-t border-white/5">
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-[10px] font-bold uppercase text-slate-500">
                System Status
              </p>
              <div className="mt-2 flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-slate-300 font-medium">
                  GRA Sync Active
                </span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Hamburger */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="md:hidden p-2 text-white"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile Sidebar Drawer */}
      <MobileSidebar
        isOpen={isMobileOpen}
        onClose={() => setIsMobileOpen(false)}
        user={user}
      />
    </>
  );
};

export default Sidebar;