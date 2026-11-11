// src/pages/Settings.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Smartphone, Mail, Palette } from 'lucide-react';
import { GET_PREFERENCES } from '../graphql/queries';
import { UPDATE_PREFERENCES } from '../graphql/mutations';
import Card from '../components/Card';
import Loader from '../components/Loader';

const DEBOUNCE_MS = 400;

// Two-factor auth was removed from this page: the toggle only flipped a database flag; no authenticator
// flow exists, so it gave users false assurance. Re-add when TOTP is actually implemented.
const SECTIONS = [
  {
    title: 'Alert channels',
    icon: Bell,
    items: [
      { id: 'smsOptIn', label: 'SMS alerts', desc: 'Critical payroll run status via text.', icon: Smartphone },
      { id: 'emailOptIn', label: 'Email reports', desc: 'Monthly GRA/SSNIT summaries.', icon: Mail },
    ],
  },
];

const Settings = () => {
  const { loading, error, data } = useQuery(GET_PREFERENCES, { fetchPolicy: 'cache-and-network' });
  const [updatePrefs, { loading: isSaving }] = useMutation(UPDATE_PREFERENCES);

  const [localPrefs, setLocalPrefs] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  const pendingRef = useRef({});   // keys changed since the last commit
  const confirmedRef = useRef(null); // last server-confirmed prefs (rollback target)

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (data?.preferences) {
      confirmedRef.current = data.preferences;
      // Don't clobber toggles the user flipped that haven't been committed yet.
      setLocalPrefs({ ...data.preferences, ...pendingRef.current });
    }
  }, [data]);

  // FIXED: a single shared timer meant toggling two switches within 400ms cancelled the first one's save.
  // Changes now accumulate in pendingRef and are committed together in one mutation.
  const commit = useCallback(async () => {
    const patch = pendingRef.current;
    pendingRef.current = {};
    timerRef.current = null;
    if (!Object.keys(patch).length) return;

    try {
      const { data: result } = await updatePrefs({ variables: { input: patch } });
      confirmedRef.current = result?.updatePreferences ?? { ...confirmedRef.current, ...patch };
    } catch (err) {
      console.error('Preference update failed', err);
      if (!mountedRef.current) return;
      setLocalPrefs(confirmedRef.current); // roll back to the last server-confirmed state
      setErrorMsg('Unable to save preference. Please try again.');
    }
  }, [updatePrefs]);

  const handleToggle = useCallback((key) => {
    setLocalPrefs((prev) => {
      if (!prev) return prev;
      const value = !prev[key];
      pendingRef.current = { ...pendingRef.current, [key]: value };
      return { ...prev, [key]: value };
    });
    setErrorMsg(null);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commit, DEBOUNCE_MS);
  }, [commit]);

  if (loading && !localPrefs) return <Loader message="Loading your preferences..." />;
  if (error && !localPrefs) {
    return <div role="alert" className="p-4 text-rose-400 bg-rose-400/10 rounded-xl">Connection error: {error.message}</div>;
  }

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Preferences</h1>
          <p className="text-slate-400 text-sm mt-1">Choose how Paylio contacts you.</p>
        </div>
        <AnimatePresence>
          {isSaving && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="flex items-center space-x-2 text-primary text-xs font-bold" aria-live="polite">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>Saving...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {errorMsg && (
        <div role="alert" className="rounded-xl bg-rose-500/10 text-rose-400 p-3 border border-rose-500/20">{errorMsg}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-4">
            <div className="flex items-center space-x-2 px-1">
              <section.icon size={18} className="text-slate-500" />
              <h2 className="text-xs font-bold tracking-widest text-slate-500">{section.title}</h2>
            </div>
            <Card className="divide-y divide-white/5 p-0 overflow-hidden">
              {section.items.map((item) => {
                const checked = !!localPrefs?.[item.id];
                return (
                  <div key={item.id} className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start space-x-4">
                      <div className="mt-1 p-2 rounded-lg bg-slate-900 text-slate-400" aria-hidden="true"><item.icon size={18} /></div>
                      <div>
                        <p className="text-sm font-bold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    {/* A native button already handles Enter/Space; the old extra onKeyDown fired the toggle twice. */}
                    <button type="button" role="switch" aria-checked={checked} onClick={() => handleToggle(item.id)}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${checked ? 'bg-primary' : 'bg-slate-700'}`}
                      aria-label={`${item.label} toggle`}>
                      <motion.div animate={{ x: checked ? 22 : 2 }} className="h-5 w-5 rounded-full bg-white shadow-lg" transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                    </button>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}

        <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/20 flex flex-col items-center justify-center text-center p-8">
          <Palette className="text-indigo-400 mb-4" size={40} />
          <h2 className="text-lg font-bold text-white">Appearance</h2>
          <p className="text-sm text-slate-400 mt-2">Use the sun/moon button in the top bar to switch between dark and light mode.</p>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
