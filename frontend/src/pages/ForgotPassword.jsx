import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, Send } from 'lucide-react';
import { REST_BASE } from '../lib/apolloClient';
import Card from '../components/Card';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(`${REST_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to process your request. Please try again.');
      setMessage(payload.message || 'If an active account exists for that email, a password reset link will be sent.');
    } catch (requestError) {
      setError(requestError.message || 'Unable to process your request. Please try again.');
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
            <Mail size={26} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Reset your password</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Enter your work email and we’ll send a reset link if an active account exists.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="reset-email" className="text-xs font-semibold tracking-wider text-slate-500 ml-1">Work email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                id="reset-email" type="email" autoComplete="email" required value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="name@company.com"
              />
            </div>
          </div>
          {message && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
          {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-lg shadow-primary/20 disabled:opacity-70">
            <Send size={17} /> {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <div className="mt-6 text-center">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default ForgotPassword;
