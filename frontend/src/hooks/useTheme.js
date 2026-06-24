import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from 'react';
import PropTypes from 'prop-types';

const ThemeContext = createContext();

const STORAGE_KEY = 'app-theme';
const CHANNEL_NAME = 'theme_sync';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';

export const ThemeProvider = ({ children }) => {
  const channelRef = useRef(null);
  const mountedRef = useRef(true);

  // SSR guard: default to light if window is not available
  const getInitialTheme = () => {
    try {
      if (typeof window === 'undefined') return 'light';
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return saved;
      return window.matchMedia(SYSTEM_QUERY).matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };

  const [theme, setTheme] = useState(getInitialTheme);

  // Apply theme to DOM before paint to avoid flash
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage errors (e.g., private mode)
    }
  }, [theme]);

  // Initialize BroadcastChannel once and wire message handler
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === 'undefined') return () => { mountedRef.current = false; };

    // Create channel if supported
    try {
      if ('BroadcastChannel' in window) {
        channelRef.current = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current.onmessage = (e) => {
          const newTheme = e?.data;
          if (!newTheme) return;
          setTheme((prev) => (prev === newTheme ? prev : newTheme));
        };
      }
    } catch {
      channelRef.current = null;
    }

    // Storage event fallback for multi-tab sync and older browsers
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const newTheme = e.newValue;
        if (newTheme) setTheme((prev) => (prev === newTheme ? prev : newTheme));
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mountedRef.current = false;
      if (channelRef.current) {
        try { channelRef.current.close(); } catch {}
        channelRef.current = null;
      }
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // System theme changes: only update when user hasn't explicitly set a theme
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(SYSTEM_QUERY);
    const handleSystem = (e) => {
      try {
        // Only change if user hasn't persisted a preference
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return;
        const systemTheme = e.matches ? 'dark' : 'light';
        setTheme((prev) => (prev === systemTheme ? prev : systemTheme));
      } catch {
        // ignore
      }
    };

    // Modern API
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleSystem);
      return () => mq.removeEventListener('change', handleSystem);
    }

    // Fallback
    mq.addListener(handleSystem);
    return () => mq.removeListener(handleSystem);
  }, []);

  // Toggle theme and broadcast to other tabs
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        // Persist and notify other tabs
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }

      // Broadcast if available
      try {
        if (channelRef.current) {
          channelRef.current.postMessage(next);
        } else if (typeof window !== 'undefined') {
          // Fallback: write to localStorage to trigger storage event in other tabs
          // Use a short-lived key to avoid clobbering user preference
          localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        // ignore
      }

      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark', setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be inside ThemeProvider');
  return context;
};
