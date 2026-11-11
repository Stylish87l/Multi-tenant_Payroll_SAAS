import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useMutation, useApolloClient } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { LOGIN_MUTATION } from '../graphql/mutations';
import { doRefresh, doLogout, TOKEN_KEY, USER_KEY } from '../lib/apolloClient';

const AuthContext = createContext(null);

// SUPER_ADMIN's selected tenant. The JWT carries no tenant for SUPER_ADMIN, so queries pass this as `companyId`.
const TENANT_KEY = 'tenantOverride';

const readJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

/** Layers the SUPER_ADMIN tenant selection (if any) over the stored user. */
const withTenant = (base) => {
  if (!base) return null;
  if (base.role !== 'SUPER_ADMIN') return base;
  const tenant = readJson(TENANT_KEY);
  return tenant?.id ? { ...base, companyId: tenant.id, companyName: tenant.name } : base;
};

const normalizeUser = (u) => (u ? { ...u, companyName: u.companyName ?? u.company?.name ?? null } : null);

const parseJwt = (token) => {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(base64));
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // initial session check ONLY
  const navigate = useNavigate();
  const client = useApolloClient();
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef(null);
  const hasAuthenticatedRef = useRef(false);
  const refreshSessionRef = useRef(null);

  const [loginMutation] = useMutation(LOGIN_MUTATION);

  const clearAuthStorage = useCallback(() => {
    [TOKEN_KEY, USER_KEY, TENANT_KEY, 'companyContext'].forEach((k) => localStorage.removeItem(k));
  }, []);

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    hasAuthenticatedRef.current = false;
    setUser(null);
    navigate('/login', { replace: true });

    await doLogout(); // revoke the refresh token server-side BEFORE dropping local state
    clearAuthStorage();
    try {
      await client.resetStore();
    } catch (e) {
      console.warn('Store reset failed', e);
    }
  }, [client, navigate, clearAuthStorage]);

  const scheduleRefresh = useCallback((token) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const payload = parseJwt(token);
    if (!payload?.exp) return;

    const timeUntilExpiry = payload.exp * 1000 - Date.now();
    // Refresh 1 minute before expiry, or at half-life for short tokens (never a 0ms loop).
    const ms = Math.max(timeUntilExpiry - 60000, timeUntilExpiry * 0.5);
    if (ms > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshSessionRef.current?.(false).catch(() => {});
      }, ms);
    }
  }, []);

  /**
   * @param {boolean} isInitialCheck first attempt on mount. Failure is EXPECTED for a logged-out visitor
   *   and must not trigger logout()'s navigate/cache-reset cycle.
   */
  const refreshSession = useCallback(async (isInitialCheck = false) => {
    try {
      const accessToken = await doRefresh();
      if (mountedRef.current) {
        hasAuthenticatedRef.current = true;
        setUser(withTenant(normalizeUser(readJson(USER_KEY))));
        scheduleRefresh(accessToken);
      }
      return accessToken;
    } catch (err) {
      if (isInitialCheck && !hasAuthenticatedRef.current) {
        console.warn('No existing session found on initial load.');
        return null;
      }
      console.error('AuthContext Refresh Error:', err);
      if (mountedRef.current) logout();
      return null;
    }
  }, [logout, scheduleRefresh]);

  refreshSessionRef.current = refreshSession;

  /**
   * FIXED: login() used to call setLoading(true), and since this provider renders
   * `{!loading && children}`, the ENTIRE app - including the Login page - unmounted mid-request.
   * Login's local error state was lost, so a wrong password showed no error at all. Login owns its own spinner.
   */
  const login = useCallback(async (variables) => {
    try {
      const { data } = await loginMutation({ variables });
      const { accessToken, user: rawUser, companyId } = data.login;
      const userData = normalizeUser({ ...rawUser, companyId: rawUser.companyId ?? companyId });

      localStorage.removeItem(TENANT_KEY);
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));

      hasAuthenticatedRef.current = true;
      setUser(withTenant(userData));
      scheduleRefresh(accessToken);

      await client.resetStore();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.graphQLErrors?.[0]?.message || err.message || 'Login failed' };
    }
  }, [loginMutation, client, scheduleRefresh]);

  /** SUPER_ADMIN only: act on behalf of another tenant. Pages read companyId from `user`. */
  const switchTenant = useCallback(async (tenant) => {
    const base = readJson(USER_KEY);
    if (base?.role !== 'SUPER_ADMIN') return;
    if (tenant?.id) localStorage.setItem(TENANT_KEY, JSON.stringify({ id: tenant.id, name: tenant.name }));
    else localStorage.removeItem(TENANT_KEY);
    setUser(withTenant(normalizeUser(base)));
    await client.resetStore();
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        // The httpOnly cookie is the source of truth, regardless of any cached access token.
        await refreshSession(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshSession]);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    switchTenant,
    refreshSession,
    companyId: user?.companyId || null,
  }), [user, loading, login, logout, switchTenant, refreshSession]);

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
};

AuthProvider.propTypes = { children: PropTypes.node.isRequired };

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export default AuthContext;
