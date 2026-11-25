import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, KeyRound, Lock } from 'lucide-react';
import { REST_BASE } from '../lib/apolloClient';
import Card from '../components/Card';

const readResetToken = () => new URLSearchParams(window.location.hash.slice(1)).get('token') || '';

const ResetPassword = () => {
  const [token] = useState(readResetToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, document.title, window.location.pathname);
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    setMessage('');
    if (!token) {
      setError('This reset link is missing or invalid. Request a new one.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (password.length < 8 || password.length > 72 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError('Use 8–72 characters with an uppercase letter, a number and a special character.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${REST_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'This reset link is invalid or has expired.');
      setMessage(payload.message || 'Your password has been reset. Please sign in.');
      setPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to reset your password. Please request a new link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-secondary/10 blur-[120px]" />
      <Card className="relative z-10 w-full max-w-md border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-900/60 backdrop-blur-2xl shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
            {message ? <CheckCircle2 size={26} /> : <KeyRound size={26} />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Choose a new password</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your reset link can only be used once and expires after 30 minutes.</p>
        </div>
        {!token && !message ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">This reset link is missing or invalid. Request a new one.</p>
            <Link to="/forgot-password" className="block text-center text-sm font-semibold text-primary hover:underline">Request another reset link</Link>
          </div>
        ) : message ? (
          <div className="space-y-4">
            <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>
            <Link to="/login" className="block w-full rounded-xl bg-primary px-4 py-3 text-center font-bold text-white">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-xs font-semibold tracking-wider text-slate-500 ml-1">New password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input id="new-password" type="password" autoComplete="new-password" required value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-xs font-semibold tracking-wider text-slate-500 ml-1">Confirm new password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input id="confirm-password" type="password" autoComplete="new-password" required value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>
            {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400">Use 8–72 characters with an uppercase letter, a number and a special character.</p>
            <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-lg shadow-primary/20 disabled:opacity-70">
              {isSubmitting ? 'Updating password…' : 'Reset password'}
            </button>
          </form>
        )}
      </Card>
    </div>
  );
};

export default ResetPassword;
