import React from 'react';
import PropTypes from 'prop-types';

/** Content-shaped loading placeholder; preserves the existing Loader API. */
const Loader = ({ message = 'Loading...', className = '', size = 'md', fullScreen = false }) => {
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-5xl' : 'max-w-3xl';
  return (
    <section role="status" aria-live="polite" aria-busy="true" aria-label={message}
      className={`mx-auto flex w-full flex-col gap-6 px-4 py-8 md:px-8 ${fullScreen ? 'min-h-screen justify-center bg-slate-950' : 'min-h-[200px]'} ${width} ${className}`}>
      <p className="text-sm font-medium text-slate-400">{message}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <div className="skeleton-shimmer mb-4 h-3 w-2/5" />
            <div className="skeleton-shimmer h-8 w-3/5" />
            <div className="skeleton-shimmer mt-5 h-2 w-4/5" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-5" aria-hidden="true">
        <div className="skeleton-shimmer mb-6 h-4 w-1/3" />
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="skeleton-shimmer h-3 w-2/5" />
                <div className="skeleton-shimmer mt-2 h-2 w-3/5" />
              </div>
              <div className="skeleton-shimmer h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{message}</span>
    </section>
  );
};

Loader.propTypes = {
  message: PropTypes.string,
  className: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  fullScreen: PropTypes.bool,
};

export default React.memo(Loader);
