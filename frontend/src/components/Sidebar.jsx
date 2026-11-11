import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { sidebarMenuItems } from '../config/sidebarConfig';

const visibleItems = (user) => sidebarMenuItems.filter((item) => user?.role && item.roles.includes(user.role));

const activeShadow = 'shadow-[inset_0_0_10px_rgb(var(--primary-rgb)/0.1)]';

const MobileSidebar = ({ isOpen, onClose, user }) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm md:hidden"
          aria-hidden="true"
        />
        <motion.aside
          initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
          className="fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-4 md:hidden"
          role="navigation" aria-label="Mobile sidebar"
        >
          <button onClick={onClose} className="mb-6 text-slate-400 hover:text-white" aria-label="Close menu"><X size={20} /></button>
          <nav className="space-y-2">
            {visibleItems(user).map((item) => (
              <NavLink
                key={item.path} to={item.path} onClick={onClose}
                className={({ isActive }) => cn(
                  'flex items-center rounded-xl px-3 py-3 transition-all duration-200',
                  isActive ? `bg-primary/10 text-primary ${activeShadow}` : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                )}
              >
                <item.icon size={22} className="mr-3" />
                <span className="font-medium">{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </motion.aside>
      </>
    )}
  </AnimatePresence>
);

MobileSidebar.propTypes = { isOpen: PropTypes.bool.isRequired, onClose: PropTypes.func.isRequired, user: PropTypes.object };

/**
 * Mobile open/close state now lives in App (the Navbar's hamburger controls it). Previously the sidebar rendered
 * its own hamburger as a column in the page's flex row, and the Navbar rendered a second one.
 * The fake "GRA Sync Active" status card was removed: no GRA integration exists, so it was a false claim.
 */
const Sidebar = ({ user, isMobileOpen = false, onMobileClose = () => {} }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <>
      <aside
        className={cn('relative hidden md:flex flex-col border-r border-white/10 bg-slate-950 transition-all duration-300 ease-in-out', isCollapsed ? 'w-20' : 'w-64')}
        role="navigation" aria-label="Desktop sidebar"
      >
        <button
          onClick={() => setIsCollapsed(!isCollapsed)} aria-expanded={!isCollapsed} aria-label="Toggle sidebar"
          className="absolute -right-3 top-10 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900 text-slate-400 hover:text-white"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <nav className="flex-1 space-y-2 p-4 pt-20 overflow-y-auto custom-scrollbar">
          {visibleItems(user).map((item) => (
            <NavLink
              key={item.path} to={item.path} title={isCollapsed ? item.name : undefined}
              className={({ isActive }) => cn(
                'group relative flex items-center rounded-xl px-3 py-3 transition-all duration-200',
                isActive ? `bg-primary/10 text-primary ${activeShadow}` : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              )}
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center">
                    <item.icon size={22} className={cn('min-w-[22px] transition-colors', isActive ? 'text-primary' : 'text-slate-500 group-hover:text-slate-300')} />
                    <AnimatePresence>
                      {!isCollapsed && (
                        <motion.span initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="ml-4 whitespace-nowrap font-medium">
                          {item.name}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  {isActive && (
                    <motion.div layoutId="sidebar-glow" className="absolute left-0 h-6 w-1 rounded-r-full bg-primary shadow-[0_0_15px_rgb(var(--primary-rgb)/0.8)]" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <MobileSidebar isOpen={isMobileOpen} onClose={onMobileClose} user={user} />
    </>
  );
};

Sidebar.propTypes = { user: PropTypes.object, isMobileOpen: PropTypes.bool, onMobileClose: PropTypes.func };


export default Sidebar;
