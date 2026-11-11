import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';

const sizeMap = {
  sm: { ring: 'h-10 w-10', svg: 'h-8 w-8' },
  md: { ring: 'h-16 w-16', svg: 'h-12 w-12' },
  lg: { ring: 'h-24 w-24', svg: 'h-20 w-20' },
};

// `fullScreen` is now supported (app.jsx passed it before, but it was silently ignored).
const Loader = ({ message = 'Loading...', className = '', size = 'md', fullScreen = false }) => (
  <div
    role="status"
    aria-live="polite"
    className={`flex flex-col items-center justify-center w-full ${fullScreen ? 'min-h-screen bg-slate-950' : 'min-h-[200px]'} ${className}`}
  >
    <div className="relative flex items-center justify-center">
      <motion.div
        className={`absolute rounded-full border-2 border-primary/20 ${sizeMap[size].ring}`}
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <svg className={`${sizeMap[size].svg} animate-spin text-primary`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 1.5, repeat: Infinity }}
      className="mt-6 text-sm font-medium tracking-wider text-slate-400"
    >
      {message}
    </motion.p>
  </div>
);

Loader.propTypes = {
  message: PropTypes.string,
  className: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  fullScreen: PropTypes.bool,
};

export default React.memo(Loader);
