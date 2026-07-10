// src/App.jsx
import React, { lazy, Suspense, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import PropTypes from 'prop-types';

import client from './lib/apolloClient';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { sidebarMenuItems } from './config/sidebarConfig';

// Layout & UI
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Loader from './components/Loader';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy Loaded Pages
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Employees = lazy(() => import('./pages/Employees'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Reports = lazy(() => import('./pages/Reports'));
const Branding = lazy(() => import('./pages/Branding'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

/* Page transition wrapper */
const PageWrapper = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    transition={{ duration: 0.28, ease: 'easeOut' }}
    className="w-full h-full"
  >
    {children}
  </motion.div>
);

PageWrapper.propTypes = { children: PropTypes.node.isRequired };

/* Secure route guard: authentication only */
const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Loader fullScreen ariaLive="polite" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

PrivateRoute.propTypes = { children: PropTypes.node.isRequired };

/**
 * RBAC route guard (defense-in-depth, NOT the security boundary).
 *
 * FIXED (2026-07-10): Previously nothing on the client stopped an
 * authenticated but under-privileged user (e.g. EMPLOYEE, or HR after the
 * payroll REST/GraphQL RBAC alignment fix) from navigating straight to
 * '/employees' or '/payroll' by URL. The backend has always correctly
 * rejected the underlying GraphQL/REST calls (see requireRole() in
 * graphql/resolvers.js and rbac() in middleware/rbac.js) - no tenant or
 * cross-role data was ever actually exposed - but the user just saw a raw
 * "Unauthorized" GraphQL error inside a half-rendered page instead of a
 * clean redirect. This guard reads the SAME roles-per-route mapping
 * already defined in config/sidebarConfig.js (single source of truth - no
 * separate role list to drift out of sync) and redirects to /dashboard
 * before the page (and its data-fetching hooks) ever mounts.
 *
 * IMPORTANT: this is a UX affordance only. Removing it does not create a
 * security hole, and adding it does not substitute for server-side checks.
 * Every mutation/query still enforces its own RBAC independently.
 */
const RoleRoute = ({ basePath, children }) => {
  const { user } = useAuth();
  const menuItem = sidebarMenuItems.find((item) => item.path === basePath);

  // No matching config entry (or no roles restriction) -> nothing to guard.
  if (!menuItem || !Array.isArray(menuItem.roles)) {
    return children;
  }

  if (!user?.role || !menuItem.roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

RoleRoute.propTypes = {
  basePath: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

const AuthSidebarWrapper = React.memo(() => {
  const { isAuthenticated, user } = useAuth();
  // FIX: Sidebar's role-based menu filter needs the actual user object -
  // it was previously rendered with no props at all, so the nav was always
  // empty regardless of role.
  return isAuthenticated ? <Sidebar user={user} /> : null;
});

const AuthNavbarWrapper = React.memo(() => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navbar /> : null;
});

/**
 * Canonical route table.
 * '/dashboard' is the path every other part of the app already assumes:
 * Navbar links, sidebarConfig.js, and the post-login redirect in Login.jsx.
 * Previously Dashboard was only registered at '/', so '/dashboard' silently
 * fell through to the catch-all NotFound route below with zero errors logged
 * anywhere - that's the "Lost in the Cloud?" screen from the bug report.
 *
 * `basePath` mirrors the exact path used in config/sidebarConfig.js so
 * RoleRoute can look up the correct roles list for each route.
 */
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
        <Route path="/login" element={<Login />} />

        {/* '/' is not a real page on its own - redirect to the canonical
            dashboard route instead of letting it die against an
            unregistered path. */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {protectedRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <PrivateRoute>
                <RoleRoute basePath={r.basePath}>
                  <PageWrapper>
                    {/* Per-route error boundary: a crash on THIS page now
                        shows a localized "Something went wrong" inside the
                        content area only. The navbar/sidebar stay mounted and
                        the user can navigate away instead of facing a fully
                        blank app. */}
                    <ErrorBoundary>
                      <Suspense fallback={<Loader />}>
                        {r.element}
                      </Suspense>
                    </ErrorBoundary>
                  </PageWrapper>
                </RoleRoute>
              </PrivateRoute>
            }
          />
        ))}

        <Route
          path="*"
          element={
            <PageWrapper>
              <Suspense fallback={<Loader />}>
                <NotFound />
              </Suspense>
            </PageWrapper>
          }
        />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  const providers = useMemo(() => (
    // Outer boundary is now a last-resort safety net only (e.g. a crash in
    // AuthProvider/ApolloProvider themselves) - it should rarely fire now
    // that every individual route has its own boundary above.
    <ErrorBoundary>
      <ApolloProvider client={client}>
        <AuthProvider>
          <ThemeProvider>
            <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
              <AuthSidebarWrapper />

              <div className="flex-1 flex flex-col relative overflow-hidden">
                <AuthNavbarWrapper />

                <main className="flex-1 overflow-x-hidden overflow-y-auto" role="main">
                  <Suspense fallback={<Loader fullScreen />}>
                    <AppRoutes />
                  </Suspense>
                </main>
              </div>
            </div>
          </ThemeProvider>
        </AuthProvider>
      </ApolloProvider>
    </ErrorBoundary>
  ), []);

  return providers;
}