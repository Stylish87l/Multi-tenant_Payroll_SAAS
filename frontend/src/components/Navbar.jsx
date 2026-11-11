import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, LogOut, Shield, Menu, Building2 } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { useAuth } from '../context/AuthContext';
import { GET_COMPANIES } from '../graphql/queries';

/**
 * FIXED:
 *  - Logout lived only inside the SUPER_ADMIN-only tenant menu, so ADMIN/HR/ACCOUNTANT/EMPLOYEE had NO way to
 *    sign out. The account menu now exists for every role; tenant switching is shown to SUPER_ADMIN only.
 *  - The tenant switcher used a hard-coded fake company list and a stub that only console.log'd. It now reads
 *    the real tenant directory (GET_COMPANIES) and switches the active tenant through AuthContext.
 *  - A duplicate hamburger + role-unfiltered mobile menu (which also existed in Sidebar) was removed.
 */
const Navbar = ({ onMenuClick }) => {
  const { user, logout, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const isSuper = user?.role === 'SUPER_ADMIN';

  const { data } = useQuery(GET_COMPANIES, { skip: !isSuper, fetchPolicy: 'cache-first' });
  const tenants = data?.companies ?? [];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav className="sticky top-0 z-[60] w-full border-b border-white/10 bg-slate-950/60 backdrop-blur-md">
      <div className="w-full flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          {user && (
            <button onClick={onMenuClick} className="md:hidden p-2 text-white hover:bg-white/5 rounded-xl transition-colors" aria-label="Open menu">
              <Menu size={20} />
            </button>
          )}
          <Link to="/" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded bg-gradient-to-tr from-primary to-secondary shadow-lg shadow-primary/20" />
            <span className="text-xl font-bold tracking-tight text-white">Paylio</span>
          </Link>
        </div>

        <div className="flex items-center space-x-4">
          <ThemeToggle />

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen((p) => !p)}
                aria-expanded={open}
                aria-haspopup="menu"
                className="flex items-center space-x-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 transition-all hover:bg-white/10"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary/20 text-secondary"><Shield size={14} /></div>
                <div className="text-left">
                  <p className="text-[10px] text-slate-500">{isSuper ? 'Viewing' : user.role}</p>
                  <p className="text-xs font-semibold text-slate-200 max-w-[140px] truncate">{user.companyName || user.email}</p>
                </div>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {open && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    role="menu"
                    aria-label="Account menu"
                    className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-2xl backdrop-blur-xl"
                  >
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold text-slate-200 truncate">{user.name || user.email}</p>
                      <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                    </div>

                    {isSuper && (
                      <>
                        <div className="my-1 border-t border-white/5" />
                        <div className="px-3 py-2 text-[10px] font-bold text-slate-500">Switch organization</div>
                        <div className="max-h-56 overflow-y-auto">
                          {tenants.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No organizations yet.</p>}
                          {tenants.map((t) => (
                            <button
                              key={t.id}
                              role="menuitemradio"
                              aria-checked={t.id === user.companyId}
                              onClick={() => { switchTenant({ id: t.id, name: t.name }); setOpen(false); }}
                              className={`flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5 hover:text-white ${t.id === user.companyId ? 'text-white' : 'text-slate-300'}`}
                            >
                              <Building2 size={14} className={t.id === user.companyId ? 'text-primary' : 'text-slate-500'} />
                              <span className="truncate">{t.name}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="my-1 border-t border-white/5" />
                    <button
                      onClick={() => { setOpen(false); logout(); }}
                      role="menuitem"
                      className="flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm text-rose-400 transition-colors hover:bg-rose-500/10"
                    >
                      <LogOut size={16} />
                      <span>Sign out</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link to="/login" className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
};

export default React.memo(Navbar);
