// tailwind.config.cjs (CommonJS: the package is "type": "module")
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          50: '#f0fdf4',
          500: '#10b981',
          600: '#059669',
        },
        // `secondary` was used all over (text-secondary, bg-secondary/20, to-secondary) but never defined.
        secondary: { DEFAULT: 'rgb(var(--secondary-rgb) / <alpha-value>)' },
        slate: { 950: '#020617' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(to bottom right, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
      },
      boxShadow: {
        glow: 'var(--glow-shadow)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      backdropBlur: { xs: '2px' },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in-up': 'fade-in-up 560ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translate3d(0, 1rem, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
      },
    },
  },

  // Only classes assembled at runtime need safelisting.
  safelist: [
    { pattern: /^(bg|text)-(emerald|amber|rose|blue)-(500)(\/10)?$/ },
  ],

  plugins: [
    require('tailwind-scrollbar'),
    require('@tailwindcss/forms')({ strategy: 'class' }),
  ],
};
