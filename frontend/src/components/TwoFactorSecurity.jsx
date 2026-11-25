import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldOff, Copy, RefreshCw } from 'lucide-react';
import Card from './Card';
import { REST_BASE } from '../lib/apolloClient';
import authFetch from '../lib/authFetch';

const apiRequest = async (path, body) => {
  const response = await authFetch(`${REST_BASE}/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to update two-factor authentication.');
  return payload;
};

const TwoFactorSecurity = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);

  const loadStatus = useCallback(async () => {
    try {
      const result = await apiRequest('/2fa/status');
      setStatus(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const runAction = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (requestError) {
      setError(requestError.message || 'Unable to update two-factor authentication.');
    } finally {
      setBusy(false);
    }
  };

  const beginEnrollment = () => runAction(async () => {
    const result = await apiRequest('/2fa/enroll', { password });
    setSecret(result.secret);
    setOtpauthUrl(result.otpauthUrl);
    setPassword('');
    setCode('');
    setMessage('Add this Paylio key to your authenticator app, then enter the six-digit code to verify setup.');
  });

  const verifyEnrollment = () => runAction(async () => {
    const result = await apiRequest('/2fa/verify-enrollment', { code });
    setRecoveryCodes(result.recoveryCodes || []);
    setSecret('');
    setOtpauthUrl('');
    setCode('');
    setStatus({ enabled: true, recoveryCodesRemaining: result.recoveryCodes?.length || 0 });
    setMessage(result.message || 'Two-factor authentication is enabled.');
  });

  const regenerateRecoveryCodes = () => runAction(async () => {
    const result = await apiRequest('/2fa/recovery-codes/regenerate', { code });
    setRecoveryCodes(result.recoveryCodes || []);
    setCode('');
    setStatus((previous) => ({ ...previous, recoveryCodesRemaining: result.recoveryCodes?.length || 0 }));
    setMessage(result.message || 'New recovery codes generated.');
  });

  const disableTwoFactor = () => runAction(async () => {
    const result = await apiRequest('/2fa/disable', { password, code });
    setStatus({ enabled: false, recoveryCodesRemaining: 0 });
    setPassword('');
    setCode('');
    setRecoveryCodes([]);
    setMessage(result.message || 'Two-factor authentication has been disabled.');
  });

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage('Recovery codes copied. Store them somewhere secure.');
    } catch {
      setError('Clipboard access is unavailable. Copy the recovery codes manually.');
    }
  };

  if (loading) return <Card className="p-5"><p className="text-sm text-slate-500">Loading account security…</p></Card>;

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/15 p-3 text-primary"><ShieldCheck size={22} /></div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Two-factor authentication</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Protect sign-in with an authenticator app and one-time recovery codes. SMS is not used as a second factor.
          </p>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            Status: {status?.enabled ? 'Enabled' : secret ? 'Setup in progress' : 'Not enabled'}
            {status?.enabled ? ` · ${status.recoveryCodesRemaining ?? 0} recovery codes remaining` : ''}
          </p>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm text-slate-700 dark:text-slate-200">{message}</p>}

      {!status?.enabled && !secret && (
        <div className="space-y-3 border-t border-slate-200 dark:border-white/10 pt-4">
          <label htmlFor="two-factor-current-password" className="block text-xs font-semibold text-slate-500">Confirm your current password to begin</label>
          <input
            id="two-factor-current-password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
            placeholder="Current password"
          />
          <button type="button" onClick={beginEnrollment} disabled={busy || !password}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            <KeyRound size={16} /> {busy ? 'Preparing…' : 'Set up authenticator'}
          </button>
        </div>
      )}

      {!status?.enabled && secret && (
        <div className="space-y-4 border-t border-slate-200 dark:border-white/10 pt-4">
          <div className="rounded-xl bg-slate-100 p-4 dark:bg-slate-950/60">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual setup key</p>
            <p className="mt-2 break-all font-mono text-lg font-bold tracking-wider text-slate-900 dark:text-white">{secret}</p>
            <p className="mt-2 text-xs text-slate-500">In your authenticator app, add an account named Paylio and enter this key. Keep it private.</p>
            <p className="mt-3 break-all text-xs text-slate-500">Authenticator URI: {otpauthUrl}</p>
          </div>
          <label htmlFor="two-factor-enroll-code" className="block text-xs font-semibold text-slate-500">Enter the six-digit authenticator code</label>
          <input id="two-factor-enroll-code" value={code} onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code" inputMode="numeric" maxLength={6}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono tracking-widest text-slate-900 dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
            placeholder="000000" />
          <button type="button" onClick={verifyEnrollment} disabled={busy || !/^\d{6}$/.test(code)}
            className="rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? 'Verifying…' : 'Verify and enable'}
          </button>
        </div>
      )}

      {status?.enabled && (
        <div className="space-y-4 border-t border-slate-200 dark:border-white/10 pt-4">
          <div className="space-y-2">
            <label htmlFor="two-factor-recovery-code" className="block text-xs font-semibold text-slate-500">Authenticator or recovery code</label>
            <input id="two-factor-recovery-code" value={code} onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code" maxLength={40}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono tracking-widest text-slate-900 dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
              placeholder="123456 or recovery code" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={regenerateRecoveryCodes} disabled={busy || code.trim().length < 6}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-white/15 dark:text-slate-200 disabled:opacity-60">
              <RefreshCw size={16} /> Regenerate recovery codes
            </button>
          </div>
          <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-white/10">
            <label htmlFor="two-factor-disable-password" className="block text-xs font-semibold text-slate-500">Current password to disable</label>
            <input id="two-factor-disable-password" type="password" autoComplete="current-password" value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
              placeholder="Current password" />
            <button type="button" onClick={disableTwoFactor} disabled={busy || !password || code.trim().length < 6}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-4 py-3 text-sm font-bold text-rose-600 dark:text-rose-300 disabled:opacity-60">
              <ShieldOff size={16} /> Disable two-factor authentication
            </button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div>
            <h3 className="font-bold text-amber-800 dark:text-amber-200">Save your recovery codes</h3>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">Each code works once. They will not be shown again after you leave this page.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => <code key={recoveryCode} className="rounded-lg bg-white/70 px-3 py-2 text-center font-mono text-sm text-slate-900 dark:bg-slate-950/50 dark:text-white">{recoveryCode}</code>)}
          </div>
          <button type="button" onClick={copyRecoveryCodes} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white">
            <Copy size={15} /> Copy recovery codes
          </button>
        </div>
      )}
    </Card>
  );
};

export default TwoFactorSecurity;
