// tailwind.config.cjs
/** @type {import('tailwindcss').Config} */
module.exports = {
  // 1. Content Purging: strict and explicit paths to minimize bundle size
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx,vue,svelte}',
  ],
  // 2. Manual dark mode via a top-level "dark" class (controlled by ThemeProvider)
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        // Keep both rgb var and fallback hex values for flexibility
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          50: '#f0fdf4',
          500: '#10b981',
          600: '#059669',
        },
        slate: {
          950: '#020617',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      backgroundImage: {
        'glass-gradient': 'linear-gradient(to bottom right, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
      },

      boxShadow: {
        glow: 'var(--glow-shadow)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },

      backdropBlur: {
        xs: '2px',
      },

      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },

  // 3. Safelist to prevent purge of dynamically generated classes
  safelist: [
    // status pills
    'bg-emerald-500', 'text-emerald-500', 'bg-emerald-500/10',
    'bg-amber-500', 'text-amber-500', 'bg-amber-500/10',
    'bg-rose-500', 'text-rose-500', 'bg-rose-500/10',
    'bg-blue-500', 'text-blue-500', 'bg-blue-500/10',

    // common dynamic utilities you might generate at runtime
    { pattern: /^bg-(emerald|amber|rose|blue)-[0-9]{3}$/, variants: ['hover', 'focus'] },
    { pattern: /^text-(emerald|amber|rose|blue)-[0-9]{3}$/, variants: ['hover', 'focus'] },
  ],

  // 4. Plugins
  plugins: [
    // Scrollbar utilities; install the package or replace with your preferred plugin
    // npm i -D tailwind-scrollbar
    require('tailwind-scrollbar'),

    // Forms plugin with class strategy to avoid global form resets
    require('@tailwindcss/forms')({ strategy: 'class' }),
  ],
};
