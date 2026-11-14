import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Building2, UserPlus, Mail, ShieldCheck, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { GET_COMPANIES } from '../graphql/queries';
import { useAuth } from '../context/AuthContext';
import Card from '../components/Card';
import Loader from '../components/Loader';

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_API_URL || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');
const ROLES = ['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'];

const UserManagement = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [companyId, setCompanyId] = useState(isSuperAdmin ? '' : user?.companyId || '');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState({ name: '', email: '', role: 'EMPLOYEE' });
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const { data: companyData, loading: loadingCompanies } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = useMemo(() => companyData?.companies || [], [companyData]);

  const headers = useCallback(() => {
    const token = localStorage.getItem('token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const loadUsers = useCallback(async () => {
    if (!companyId) { setUsers([]); return; }
    setLoadingUsers(true); setError(null);
    try {
      const response = await fetch(`${REST_BASE}/api/users?companyId=${encodeURIComponent(companyId)}`, { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load users.');
      setUsers(payload.users || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingUsers(false); }
  }, [companyId, headers]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const submit = async (event) => {
    event.preventDefault(); setError(null); setNotice(null); setSubmitting(true);
    try {
      const endpoint = mode === 'create' ? 'create' : 'invite';
      const response = await fetch(`${REST_BASE}/api/users/${endpoint}`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ ...form, ...(isSuperAdmin ? { companyId } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to provision this user.');
      setNotice(payload.message);
      setForm({ name: '', email: '', role: 'EMPLOYEE' });
      await loadUsers();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const changeStatus = async (target, status) => {
    setError(null); setNotice(null);
    try {
      const response = await fetch(`${REST_BASE}/api/users/${target.id}/status`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update account.');
      setNotice(`${target.name || target.email} is now ${status.toLowerCase()}.`);
      await loadUsers();
    } catch (e) { setError(e.message); }
  };

  if (isSuperAdmin && loadingCompanies && !companyData) return <Loader message="Loading companies..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-7 pb-24">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Access control</p>
        <h1 className="mt-2 text-3xl font-bold text-white">User management</h1>
        <p className="mt-2 text-sm text-slate-400">Provision accounts, onboard invited users and manage access within your organisation.</p>
      </header>

      {isSuperAdmin && (
        <Card className="border-white/5 bg-slate-950/40 p-5">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400"><Building2 size={15}/> Tenant</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-full md:max-w-md rounded-xl border border-white/10 bg-slate-900 p-3 text-white">
            <option value="">Select a company</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Card>
      )}

      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">{notice}</div>}

      {!companyId ? (
        <Card className="p-8 text-center text-slate-400">Select a tenant to manage its user accounts.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border-white/5 bg-slate-950/40 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-3 text-primary"><UserPlus size={20}/></div>
              <div><h2 className="font-bold text-white">Add a user</h2><p className="text-xs text-slate-500">Secure password setup is completed by the user</p></div>
            </div>
            <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/10 bg-slate-900 p-1">
              <button type="button" onClick={() => setMode('create')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'create' ? 'bg-primary text-white' : 'text-slate-400'}`}>Create account</button>
              <button type="button" onClick={() => setMode('invite')} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'invite' ? 'bg-primary text-white' : 'text-slate-400'}`}>Send invitation</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-xs text-slate-400">Full name<input required minLength={2} maxLength={100} value={form.name} onChange={e => setForm({...form,name:e.target.value})} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 p-3 text-white"/></label>
              <label className="block text-xs text-slate-400">Email address<input required type="email" maxLength={254} value={form.email} onChange={e => setForm({...form,email:e.target.value})} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 p-3 text-white"/></label>
              <label className="block text-xs text-slate-400">Role<select value={form.role} onChange={e => setForm({...form,role:e.target.value})} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 p-3 text-white">{ROLES.map(role=><option key={role} value={role}>{role.replace('_',' ')}</option>)}</select></label>
              <div className="rounded-xl border border-sky-500/15 bg-sky-500/5 p-3 text-xs leading-5 text-slate-300"><ShieldCheck size={15} className="mr-2 inline text-sky-400"/>{mode === 'create' ? 'The account is provisioned immediately as pending. The user receives a secure, time-limited activation link and chooses their own password.' : 'An invitation is sent with a secure activation link. The account remains pending until the user accepts.'}</div>
              <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-50"><Mail size={17}/>{submitting ? 'Processing...' : mode === 'create' ? 'Create account & send setup link' : 'Send invitation'}</button>
            </form>
          </Card>

          <Card className="border-white/5 bg-slate-950/40 p-6">
            <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-bold text-white">Organisation users</h2><p className="text-xs text-slate-500">Pending, active and suspended accounts</p></div><button onClick={loadUsers} disabled={loadingUsers} aria-label="Refresh users" className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white"><RefreshCw size={16} className={loadingUsers ? 'animate-spin' : ''}/></button></div>
            {loadingUsers ? <Loader message="Loading users..."/> : users.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No accounts found for this tenant.</p> : (
              <div className="space-y-3">{users.map(account => (
                <div key={account.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><p className="truncate font-semibold text-white">{account.name || 'Unnamed user'}</p><p className="truncate text-xs text-slate-400">{account.email}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-300">{account.role}</span><span className={`rounded-full px-2 py-1 text-[10px] ${account.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-300' : account.status === 'PENDING' ? 'bg-amber-500/10 text-amber-300' : 'bg-rose-500/10 text-rose-300'}`}>{account.status}</span></div></div>
                  {account.id !== user?.id && account.role !== 'SUPER_ADMIN' && account.status !== 'PENDING' && <button onClick={() => changeStatus(account, account.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')} className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5">{account.status === 'ACTIVE' ? <><UserX size={14}/> Suspend</> : <><UserCheck size={14}/> Reactivate</>}</button>}
                </div>
              ))}</div>
            )}
          </Card>
        </div>
      )}
      <p className="text-xs leading-5 text-slate-600">Security: passwords are never created or viewed by administrators. Activation links expire after 48 hours and are single-use. Suspended users have active refresh sessions revoked.</p>
    </div>
  );
};

export default UserManagement;
