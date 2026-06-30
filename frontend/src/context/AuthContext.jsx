import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { useMutation, useApolloClient } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { LOGIN_MUTATION } from '../graphql/mutations';
// --- IMPORT THE SHARED REFRESH LOGIC FROM APOLLO ---
import { doRefresh } from '../lib/apolloClient'; 

const AuthContext = createContext(null);

const TOKEN_KEY = 'token';
const COMPANY_KEY = 'companyContext';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const client = useApolloClient();
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef(null);
  // Tracks whether we've ever successfully established an authenticated
  // session in THIS app lifetime. Used to distinguish "never logged in /
  // cookie not present yet" (expected, silent) from "had a session, refresh
  // just failed" (real logout).
  const hasAuthenticatedRef = useRef(false);

  const [loginMutation] = useMutation(LOGIN_MUTATION);

  // --- 1. UTILS ---
  
  const parseJwt = useCallback((token) => {
    if (!token) return null;
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(window.atob(base64));
    } catch (e) { 
      return null; 
    }
  }, []);

  const clearAuthStorage = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(COMPANY_KEY);
    localStorage.removeItem('user'); 
  }, []);

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    hasAuthenticatedRef.current = false;
    setUser(null); // Immediately update UI state to unauthenticated
    navigate('/login', { replace: true }); // Initiate navigation to login page

    // Add a small delay to ensure React has a chance to unmount protected components
    await new Promise(resolve => setTimeout(resolve, 50)); 

    clearAuthStorage(); // Clear tokens from localStorage after navigation
    try {
      await client.resetStore(); // Reset Apollo cache after tokens are cleared and navigation has begun
    } catch (e) {
      console.warn("Store reset failed", e);
    }
  }, [client, navigate, clearAuthStorage]);

  // --- 2. CORE AUTH LOGIC ---

  /**
   * @param {boolean} isInitialCheck - true only for the very first refresh
   *   attempt on app mount, before any session has been established. A
   *   failure here is EXPECTED for a logged-out visitor (no refresh cookie
   *   exists yet) and must NOT trigger logout()'s navigate/cache-reset
   *   cycle - that was the cause of "login immediately logs me out": every
   *   mount called refreshSession() unconditionally, and any transient
   *   failure (including normal cross-site cookie propagation timing) was
   *   treated identically to "your session just died".
   */
  const refreshSession = useCallback(async (isInitialCheck = false) => {
    try {
      // Use the SHARED promise from Apollo to prevent "Double Refresh" race conditions
      const accessToken = await doRefresh(); 

      if (!accessToken) {
        if (!isInitialCheck) logout();
        return null;
      }

      // Sync state with what doRefresh saved to localStorage
      const storedUser = JSON.parse(localStorage.getItem('user'));
      const storedCompanyId = localStorage.getItem(COMPANY_KEY);

      if (mountedRef.current) {
        hasAuthenticatedRef.current = true;
        setUser({
          ...storedUser,
          companyId: storedCompanyId || storedUser?.companyId
        });
        scheduleRefresh(accessToken);
      }
      return accessToken;
    } catch (err) {
      if (isInitialCheck && !hasAuthenticatedRef.current) {
        // Expected case: no prior session, no refresh cookie yet (or it
        // hasn't propagated). Stay quietly unauthenticated - do NOT
        // navigate or reset the Apollo store.
        console.warn("No existing session found on initial load.");
        return null;
      }
      console.error("AuthContext Refresh Error:", err);
      if (mountedRef.current) logout();
      return null;
    }
  }, [logout]);

  const scheduleRefresh = useCallback((token) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const payload = parseJwt(token);
    if (!payload?.exp) return;

    const timeUntilExpiry = (payload.exp * 1000) - Date.now();
    
    // SMART TIMER: Refresh 1 minute before expiry, OR at the halfway point of the token's life.
    // This guarantees we never get a 0ms delay.
    const ms = Math.max(timeUntilExpiry - 60000, timeUntilExpiry * 0.5);

    if (ms > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshSession(false).catch(() => {});
      }, ms);
    }
  }, [parseJwt, refreshSession]);

  const login = useCallback(async (variables) => {
    setLoading(true);
    try {
      const { data } = await loginMutation({ variables });
      const { accessToken, user: userData, companyId } = data.login;

      localStorage.setItem(TOKEN_KEY, accessToken);
      if (companyId) localStorage.setItem(COMPANY_KEY, companyId);
      localStorage.setItem('user', JSON.stringify(userData));

      if (mountedRef.current) {
        hasAuthenticatedRef.current = true;
        setUser({ ...userData, companyId: companyId || userData.companyId });
        scheduleRefresh(accessToken);
      }

      await client.resetStore();
      return { success: true };
    } catch (err) {
      return { 
        success: false, 
        message: err.graphQLErrors?.[0]?.message || 'Login failed' 
      };
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [loginMutation, client, scheduleRefresh]);

  // --- 3. LIFECYCLE ---

  useEffect(() => {
    mountedRef.current = true;
    
    const initAuth = async () => {
      try {
        // Attempt a silent refresh on first load (checks the HttpOnly
        // cookie regardless of whether a local access token is cached -
        // the cookie is the actual source of truth). isInitialCheck=true
        // ensures a failure here is treated as "not logged in yet", not
        // "session expired".
        await refreshSession(true);
      } catch (e) {
        console.warn("Initial auth check failed - treating as logged out.");
      } finally {
        // ALWAYS set loading to false to unblock the UI
        if (mountedRef.current) setLoading(false); 
      }
    };

    initAuth();

    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshSession]);

  const value = {
    user,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    refreshSession,
    companyId: user?.companyId || localStorage.getItem(COMPANY_KEY)
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// --- 4. EXPORTS ---

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

/**
 * Hook to use auth context. 
 * Explicitly exported as a named constant to solve the SyntaxError.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;