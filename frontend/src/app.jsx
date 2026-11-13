// src/App.jsx
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import PropTypes from 'prop-types';

import { ThemeProvider } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import { sidebarMenuItems } from './config/sidebarConfig';

import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Loader from './components/Loader';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateBanner from './components/UpdateBanner';

const Login = lazy(() => import('./pages/Login'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Employees = lazy(() => import('./pages/Employees'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Reports = lazy(() => import('./pages/Reports'));
const Branding = lazy(() => import('./pages/Branding'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

const PageWrapper = ({ children }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.28, ease: 'easeOut' }} className="w-full h-full">
    {children}
  </motion.div>
);
PageWrapper.propTypes = { children: PropTypes.node.isRequired };

/** Authentication guard. */
const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loader fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
};
PrivateRoute.propTypes = { children: PropTypes.node.isRequired };

/** Signed-in users have no business on /login: send them to the app. */
const PublicOnlyRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children;
};
PublicOnlyRoute.propTypes = { children: PropTypes.node.isRequired };

/**
 * RBAC route guard (UX only, NOT the security boundary - every query/mutation enforces its own RBAC server-side).
 * Reads the same roles-per-route table as the sidebar so there is one source of truth.
 */
const RoleRoute = ({ basePath, children }) => {
  const { user } = useAuth();
  const menuItem = sidebarMenuItems.find((item) => item.path === basePath);
  if (!menuItem || !Array.isArray(menuItem.roles)) return children;
  if (!user?.role || !menuItem.roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
};
RoleRoute.propTypes = { basePath: PropTypes.string.isRequired, children: PropTypes.node.isRequired };

const protectedRoutes = [
  { path: '/dashboard', basePath: '/dashboard', element: <Dashboard /> },
  { path: '/employees/*', basePath: '/employees', element: <Employees /> },
  { path: '/payroll/*', basePath: '/payroll', element: <Payroll /> },
  { path: '/reports/*', basePath: '/reports', element: <Reports /> },
  { path: '/branding/*', basePath: '/branding', element: <Branding /> },
  { path: '/settings/*', basePath: '/settings', element: <Settings /> },
];

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        {/* Public: invitees have no session. The invite email links here. */}
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {protectedRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <PrivateRoute>
                <RoleRoute basePath={r.basePath}>
                  <PageWrapper>
                    <ErrorBoundary>
                      <Suspense fallback={<Loader />}>{r.element}</Suspense>
                    </ErrorBoundary>
                  </PageWrapper>
                </RoleRoute>
              </PrivateRoute>
            }
          />
        ))}

        <Route path="*" element={<PageWrapper><Suspense fallback={<Loader />}><NotFound /></Suspense></PageWrapper>} />
      </Routes>
    </AnimatePresence>
  );
}

function GlassPanelReveal() {
  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const seen = new WeakSet();
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('glass-panel--reveal-pending');
        entry.target.classList.add('glass-panel--revealed');
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
    const scan = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
      const panels = [];
      if (node.matches && node.matches('.glass-panel')) panels.push(node);
      if (node.querySelectorAll) node.querySelectorAll('.glass-panel').forEach((panel) => panels.push(panel));
      panels.forEach((panel) => {
        if (seen.has(panel)) return;
        seen.add(panel);
        panel.classList.add('glass-panel--reveal-pending');
        observer.observe(panel);
      });
    };
    scan(document);
    const mutations = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(scan)));
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => { mutations.disconnect(); observer.disconnect(); };
  }, []);
  return null;
}

function Shell() {
  const { isAuthenticated, user } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">\n      <GlassPanelReveal />
      {isAuthenticated && <Sidebar user={user} isMobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {isAuthenticated && <Navbar onMenuClick={() => setMobileNavOpen(true)} />}
        <main className="flex-1 overflow-x-hidden overflow-y-auto" role="main">
          <Suspense fallback={<Loader fullScreen />}>
            <AppRoutes />
          </Suspense>
        </main>
      </div>
      <UpdateBanner />
    </div>
  );
}

/**
 * FIXED: this component used to wrap ANOTHER ApolloProvider and AuthProvider inside the ones main.jsx already
 * provides, so two AuthProviders each ran their own session refresh and timers. Router, Apollo and Auth are
 * provided once, in main.jsx.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
