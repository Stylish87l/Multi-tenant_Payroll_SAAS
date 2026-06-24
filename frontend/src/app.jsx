// src/App.jsx
import React, { lazy, Suspense, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import PropTypes from 'prop-types';

import client from './lib/apolloClient';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';

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

/* Secure route guard */
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

const AuthSidebarWrapper = React.memo(() => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Sidebar /> : null;
});

const AuthNavbarWrapper = React.memo(() => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navbar /> : null;
});

const protectedRoutes = [
  { path: '/', element: <Dashboard /> },
  { path: '/employees/*', element: <Employees /> }, // Allow sub-routes for employee details
  { path: '/payroll/*', element: <Payroll /> },   // FIX: Allow sub-routes like /payroll/run
  { path: '/reports/*', element: <Reports /> },   // FIX: Allow sub-routes for specific reports
  { path: '/settings/*', element: <Settings /> },
];

function AppRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<Login />} />

        {protectedRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <PrivateRoute>
                <PageWrapper>
                  <Suspense fallback={<Loader />}>
                    {r.element}
                  </Suspense>
                </PageWrapper>
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
