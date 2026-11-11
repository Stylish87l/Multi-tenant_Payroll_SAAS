import React, { createContext, useContext, useState, useLayoutEffect, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';

const STORAGE_KEY = 'app_theme';
const CHANNEL_NAME = 'theme_sync';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const isTheme = (v) => v === 'light' || v === 'dark';

export const ThemeContext = createContext(null);

const readStored = () => {
  try {
    const v = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return isTheme(v) ? v : null;
  } catch { return null; }
};
const writeStored = (v) => { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* private mode */ } };
const getSystemTheme = () => {
  try { return window.matchMedia?.(SYSTEM_QUERY).matches ? 'dark' : 'light'; } catch { return 'light'; }
};

export const ThemeProvider = ({ children }) => {
  const channelRef = useRef(null);
  const [theme, setTheme] = useState(() => readStored() ?? getSystemTheme());

  // Apply before paint. FIXED: this effect used to also persist, which saved the *system* theme as if the
  // user had chosen it on first render, so "follow the OS until the user picks" never worked.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      if ('BroadcastChannel' in window) {
        channelRef.current = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current.onmessage = (e) => { if (isTheme(e?.data)) setTheme(e.data); };
      }
    } catch { channelRef.current = null; }

    const onStorage = (e) => { if (e.key === STORAGE_KEY && isTheme(e.newValue)) setTheme(e.newValue); };
    window.addEventListener('storage', onStorage);
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Follow OS changes only while the user has made no explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.(SYSTEM_QUERY);
    if (!mq) return undefined;
    const handle = () => { if (!readStored()) setTheme(mq.matches ? 'dark' : 'light'); };
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, []);

  // FIXED: toggleTheme passed an updater FUNCTION to this setter, which then wrote the function's source text
  // to localStorage and tried to postMessage() a function (DataCloneError). It now always receives a string.
  const setThemeExplicit = useCallback((next) => {
    if (!isTheme(next)) return;
    setTheme(next);
    writeStored(next);
    try { channelRef.current?.postMessage(next); } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(
    () => setThemeExplicit(theme === 'light' ? 'dark' : 'light'),
    [theme, setThemeExplicit]
  );

  const value = useMemo(
    () => ({ theme, setTheme: setThemeExplicit, toggleTheme, isDark: theme === 'dark' }),
    [theme, setThemeExplicit, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

ThemeProvider.propTypes = { children: PropTypes.node.isRequired };

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
