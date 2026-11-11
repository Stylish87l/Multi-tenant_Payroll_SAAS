import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import Card from '../components/Card';
import { REST_BASE } from '../lib/apolloClient';

// Mirrors backend/schemas/authSchema.js passwordSchema.
const validatePassword = (pw) => {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 72) return 'Password must be 72 characters or fewer';
  if (!/[A-Z]/.test(pw)) return 'Include at least one uppercase letter';
  if (!/[0-9]/.test(pw)) return 'Include at least one number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Include at least one special character';
  return null;
};

/**
 * The invite email links to /accept-invite?token=..., but no such route or page existed, so every
 * invitation led to the 404 screen. Public route: the invitee has no session yet.
 */
const AcceptInvite = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const pwError = validatePassword(password);
    if (pwError) return setError(pwError);
    if (password !== confirm) return setError('Passwords do not match');

    setSubmitting(true);
    try {
      const res = await fetch(`${REST_BASE}/api/users/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error || json?.errors?.[0]?.message || 'Could not activate your account.';
        throw new Error(msg);
      }
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full bg-slate-950/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all';

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 flex items-center justify-center p-4">
      <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-primary/20 blur-[120px]" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md z-10">
        <Card className="border-white/10 bg-slate-900/60 backdrop-blur-2xl shadow-2xl">
          {done ? (
            <div role="status" className="text-center py-6 space-y-3">
              <CheckCircle2 className="mx-auto text-emerald-400" size={40} />
              <h1 className="text-xl font-bold text-white">Account activated</h1>
              <p className="text-sm text-slate-400">Taking you to sign in…</p>
            </div>
          ) : !token ? (
            <div role="alert" className="text-center py-6 space-y-3">
              <AlertCircle className="mx-auto text-rose-400" size={40} />
              <h1 className="text-xl font-bold text-white">Invitation link is incomplete</h1>
              <p className="text-sm text-slate-400">Open the link from your invitation email again, or ask your administrator to send a new one.</p>
              <Link to="/login" className="text-sm text-primary hover:underline">Go to sign in</Link>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-white">Set your password</h1>
                <p className="mt-2 text-sm text-slate-400">Choose a password to activate your account.</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-xs font-semibold tracking-wider text-slate-500 ml-1">New password</label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input id="new-password" type="password" autoComplete="new-password" value={password}
                      onChange={(e) => setPassword(e.target.value)} className={inputClass} required />
                  </div>
                  <p className="text-[11px] text-slate-600 ml-1">8+ characters with an uppercase letter, a number and a special character.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-xs font-semibold tracking-wider text-slate-500 ml-1">Confirm password</label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
                      onChange={(e) => setConfirm(e.target.value)} className={inputClass} required />
                  </div>
                </div>
                {error && (
                  <div role="alert" className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-400">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}
                <button type="submit" disabled={submitting}
                  className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70">
                  {submitting ? 'Activating…' : 'Activate account'}
                </button>
              </form>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
};

export default AcceptInvite;
