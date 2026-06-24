// src/pages/Settings.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Smartphone, Mail, Shield, Palette, CheckCircle2 } from 'lucide-react';
import { GET_PREFERENCES } from '../graphql/queries';
import { UPDATE_PREFERENCES } from '../graphql/mutations';
import Card from '../components/Card';
import Loader from '../components/Loader';

const DEBOUNCE_MS = 400;

const Settings = () => {
  // 1. Query Preferences
  const { loading, error, data } = useQuery(GET_PREFERENCES, {
    fetchPolicy: 'cache-and-network',
  });

  // 2. Mutation with optimistic UI and error handling
  const [updatePrefs, { loading: isSaving }] = useMutation(UPDATE_PREFERENCES);

  // local state initialized from data when it arrives
  const [localPrefs, setLocalPrefs] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const mountedRef = useRef(true);
  const debounceRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (data?.preferences) {
      setLocalPrefs(data.preferences);
    }
  }, [data]);

  // Helper to perform the network update with optimistic response and rollback
  const commitPreference = useCallback(async (key, newValue, previousPrefs) => {
    setErrorMsg(null);

    const optimistic = {
      __typename: 'Mutation',
      updatePreferences: {
        __typename: 'Preferences',
        ...previousPrefs,
        [key]: newValue,
      },
    };

    try {
      await updatePrefs({
        variables: { input: { [key]: newValue } },
        optimisticResponse: optimistic,
      });
    } catch (err) {
      // Rollback UI if mutation fails
      console.error('Preference update failed', err);
      if (!mountedRef.current) return;
      setLocalPrefs(previousPrefs);
      setErrorMsg('Unable to save preference. Please try again.');
    }
  }, [updatePrefs]);

  // Debounced toggle handler to reduce network churn
  const handleToggle = useCallback((key) => {
    if (!localPrefs) return;

    const previous = localPrefs;
    const newValue = !previous[key];
    const updated = { ...previous, [key]: newValue };

    // Update UI immediately
    setLocalPrefs(updated);
    setErrorMsg(null);

    // Debounce network commit
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      commitPreference(key, newValue, previous);
      debounceRef.current = null;
    }, DEBOUNCE_MS);
  }, [localPrefs, commitPreference]);

  if (loading && !localPrefs) return <Loader message="Accessing your vault..." />;
  if (error) {
    return (
      <div role="alert" className="p-4 text-rose-400 bg-rose-400/10 rounded-xl">
        Connection Error: {error.message}
      </div>
    );
  }

  const sections = [
    {
      title: 'Alert Channels',
      icon: Bell,
      items: [
        { id: 'smsOptIn', label: 'SMS Alerts', desc: 'Critical payroll run status via text.', icon: Smartphone },
        { id: 'emailOptIn', label: 'Email Reports', desc: 'Monthly GRA/SSNIT summaries.', icon: Mail },
      ],
    },
    {
      title: 'Security',
      icon: Shield,
      items: [
        { id: 'twoFactorEnabled', label: 'Two-Factor Auth', desc: 'Secure login via authenticator app.', icon: CheckCircle2 },
      ],
    },
  ];

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Preferences</h1>
          <p className="text-slate-400 text-sm mt-1">Configure your personal dashboard and alerts.</p>
        </div>

        <AnimatePresence>
          {isSaving && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center space-x-2 text-primary text-xs font-bold uppercase tracking-widest"
              aria-live="polite"
            >
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>Cloud Syncing...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {errorMsg && (
        <div role="status" aria-live="polite" className="rounded-xl bg-rose-500/10 text-rose-400 p-3 border border-rose-500/20">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <div className="flex items-center space-x-2 px-1">
              <section.icon size={18} className="text-slate-500" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{section.title}</h3>
            </div>

            <Card className="divide-y divide-white/5 p-0 overflow-hidden">
              {section.items.map((item) => {
                const checked = !!localPrefs?.[item.id];
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="mt-1 p-2 rounded-lg bg-slate-900 text-slate-400" aria-hidden="true">
                        <item.icon size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                    </div>

                    {/* Accessible Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() => handleToggle(item.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(item.id); } }}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 outline-none ring-offset-slate-950 focus:ring-2 focus:ring-primary/50 ${
                        checked ? 'bg-primary' : 'bg-slate-700'
                      }`}
                      aria-label={`${item.label} toggle`}
                    >
                      <motion.div
                        animate={{ x: checked ? 22 : 2 }}
                        className="h-5 w-5 rounded-full bg-white shadow-lg"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}

        {/* Branding Visual Section */}
        <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/20 flex flex-col items-center justify-center text-center p-8">
          <Palette className="text-indigo-400 mb-4" size={40} />
          <h3 className="text-lg font-bold text-white">Visual Themes</h3>
          <p className="text-sm text-slate-400 mt-2">Dynamic themes are synced to your OS settings for the best PWA experience.</p>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
