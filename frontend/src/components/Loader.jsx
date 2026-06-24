import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';

const Loader = ({ message = 'Syncing data...', className = '', size = 'md' }) => {
  const sizeMap = {
    sm: { ring: 'h-10 w-10', svg: 'h-8 w-8' },
    md: { ring: 'h-16 w-16', svg: 'h-12 w-12' },
    lg: { ring: 'h-24 w-24', svg: 'h-20 w-20' },
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center min-h-[200px] w-full ${className}`}
    >
      <div className="relative flex items-center justify-center">
        {/* Outer Glowing Ring */}
        <motion.div
          className={`absolute rounded-full border-2 border-primary/20 ${sizeMap[size].ring}`}
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Main Animated SVG Spinner */}
        <svg
          className={`${sizeMap[size].svg} animate-spin text-primary`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>

      {/* Modern Typography with subtle pulse */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="mt-6 text-sm font-medium tracking-widest text-slate-400 uppercase"
      >
        {message}
      </motion.p>
    </div>
  );
};

Loader.propTypes = {
  message: PropTypes.string,
  className: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
};

export default React.memo(Loader);
