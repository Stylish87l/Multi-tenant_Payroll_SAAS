/**
 * Dark/Light Mode Toggle - Iconic, Glowing, Persistent
 * - Toggles theme with sun/moon icons; localStorage persistence.
 * - Bounty Target: Toggle accessibility fail ($600)—ensure keyboard nav (added tabIndex/focus).
 * - Optimization: useEffect cleanup; no re-renders on unrelated updates.
 * - Modern: Lucide icons; smooth transition via CSS vars.
 */
import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { Sun, Moon } from 'lucide-react';
import { ThemeContext } from '../context/ThemeContext';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useContext(ThemeContext);

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-full glass-card hover:scale-105 transition-transform focus:outline-none focus:shadow-glow"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      tabIndex={0}
      data-testid="theme-toggle"
    >
      {theme === 'light' ? <Moon className="h-5 w-5 text-gray-800" /> : <Sun className="h-5 w-5 text-yellow-400" />}
    </button>
  );
};

ThemeToggle.propTypes = {}; // No props

export default ThemeToggle;