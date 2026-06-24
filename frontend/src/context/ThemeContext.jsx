// src/contexts/ThemeContext.jsx
import React, {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import PropTypes from 'prop-types';

const STORAGE_KEY = 'app_theme';
const CHANNEL_NAME = 'theme_sync';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';

export const ThemeContext = createContext(null);

const readLocalStorage = (key) => {
  try {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorage = (key, value) => {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode, quota, etc.)
  }
};

const getSystemTheme = () => {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia(SYSTEM_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const getInitialTheme = () => {
  const saved = readLocalStorage(STORAGE_KEY);
  if (saved) return saved;
  return getSystemTheme();
};

export const ThemeProvider = ({ children }) => {
  const channelRef = useRef(null);
  const mountedRef = useRef(true);

  const [theme, setTheme] = useState(getInitialTheme);

  // Apply theme before paint to avoid flash
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // Smooth transitions (optional)
    root.style.setProperty('--theme-transition', '0.3s ease-in-out');

    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';

    writeLocalStorage(STORAGE_KEY, theme);
  }, [theme]);

  // Initialize BroadcastChannel and storage fallback
  useEffect(() => {
    mountedRef.current = true;

    // Setup BroadcastChannel if available
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
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

    // Storage event fallback for older browsers and cross-origin tabs
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      const newTheme = e.newValue;
      if (!newTheme) return;
      setTheme((prev) => (prev === newTheme ? prev : newTheme));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage);
    }

    return () => {
      mountedRef.current = false;
      if (channelRef.current) {
        try { channelRef.current.close(); } catch {}
        channelRef.current = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage);
      }
    };
  }, []);

  // System preference listener (only when user hasn't explicitly set a theme)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(SYSTEM_QUERY);

    const handleSystem = () => {
      try {
        const saved = readLocalStorage(STORAGE_KEY);
        if (saved) return; // user override present
        const systemTheme = mq.matches ? 'dark' : 'light';
        setTheme((prev) => (prev === systemTheme ? prev : systemTheme));
      } catch {
        // ignore
      }
    };

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleSystem);
      return () => mq.removeEventListener('change', handleSystem);
    }

    mq.addListener(handleSystem);
    return () => mq.removeListener(handleSystem);
  }, []);

  // Toggle and set helpers that broadcast to other tabs
  const setThemeAndBroadcast = useCallback((next) => {
    setTheme(next);
    writeLocalStorage(STORAGE_KEY, next);

    try {
      if (channelRef.current) {
        channelRef.current.postMessage(next);
      } else {
        // Fallback: write to localStorage (already done) to trigger storage event
        writeLocalStorage(STORAGE_KEY, next);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeAndBroadcast((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, [setThemeAndBroadcast]);

  const value = useMemo(() => ({
    theme,
    setTheme: setThemeAndBroadcast,
    toggleTheme,
    isDark: theme === 'dark',
  }), [theme, setThemeAndBroadcast, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
