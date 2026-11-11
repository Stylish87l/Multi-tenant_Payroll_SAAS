import React, { useEffect, useState } from 'react';

/**
 * Surfaces the service-worker update event. main.jsx dispatched 'sw:update' but nothing listened,
 * so new deployments never reached users with an installed PWA.
 */
const UpdateBanner = () => {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    const handler = (e) => setUpdate(() => e.detail?.apply ?? null);
    window.addEventListener('sw:update', handler);
    return () => window.removeEventListener('sw:update', handler);
  }, []);

  if (!update) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-4 rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 text-sm text-slate-200 shadow-2xl backdrop-blur-xl">
      <span>A new version of Paylio is available.</span>
      <button onClick={() => update(true)} className="rounded-lg bg-primary px-3 py-1 font-semibold text-white hover:bg-primary/80">Reload</button>
      <button onClick={() => setUpdate(null)} className="text-slate-400 hover:text-white" aria-label="Dismiss">Later</button>
    </div>
  );
};

export default UpdateBanner;
