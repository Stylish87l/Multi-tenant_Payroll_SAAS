import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  Building2, CheckCircle2, Clock3, Mail, Plus, RefreshCw, Search,
  ShieldCheck, UserCheck, UserPlus, UserX, Users,
} from 'lucide-react';
import { GET_COMPANIES } from '../graphql/queries';
import { useAuth } from '../context/AuthContext';
import Card from '../components/Card';
import Loader from '../components/Loader';
import Modal from '../components/Modal';

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_API_URL || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');
const ROLES = ['ADMIN', 'HR', 'ACCOUNTANT', 'EMPLOYEE'];
const ROLE_HELP = {
  ADMIN: 'Broad organisation access, including user administration and payroll approval. Assign only to trusted administrators.',
  HR: 'Manage employee profiles and statutory details. Existing compensation and bank information remain restricted.',
  ACCOUNTANT: 'Manage payroll, compensation and banking information, and prepare statutory reports.',
  EMPLOYEE: 'Access personal payslips and account notifications only.',
};
const inputClass = 'mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3.5 py-3 text-sm text-white placeholder:text-slate-600 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15';
const statusTone = {
  ACTIVE: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  PENDING: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  SUSPENDED: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
};

const UserManagement = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [companyId, setCompanyId] = useState(isSuperAdmin ? '' : user?.companyId || '');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState({ name: '', email: '', role: 'EMPLOYEE' });
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
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
    setLoadingUsers(true);
    setError(null);
    try {
      const response = await fetch(`${REST_BASE}/api/users?companyId=${encodeURIComponent(companyId)}`, { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load users.');
      setUsers(payload.users || []);
    } catch (e) {
      setError(e.message || 'Unable to load users.');
    } finally {
      setLoadingUsers(false);
    }
  }, [companyId, headers]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return users.filter((account) => {
      const matchesQuery = !query || [account.name, account.email, account.role].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'ALL' || account.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [users, searchTerm, statusFilter]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((item) => item.status === 'ACTIVE').length,
    pending: users.filter((item) => item.status === 'PENDING').length,
    suspended: users.filter((item) => item.status === 'SUSPENDED').length,
  }), [users]);

  const openCreate = () => {
    setMode('create');
    setForm({ name: '', email: '', role: 'EMPLOYEE' });
    setError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const endpoint = mode === 'create' ? 'create' : 'invite';
      const response = await fetch(`${REST_BASE}/api/users/${endpoint}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...form, name: form.name.trim(), email: form.email.trim().toLowerCase(), ...(isSuperAdmin ? { companyId } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to provision this user.');
      setNotice(payload.message || 'User setup started successfully.');
      setShowModal(false);
      setForm({ name: '', email: '', role: 'EMPLOYEE' });
      await loadUsers();
    } catch (e) {
      setError(e.message || 'Unable to provision this user.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (target, status) => {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${REST_BASE}/api/users/${target.id}/status`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to update account.');
      setNotice(`${target.name || target.email} is now ${status.toLowerCase()}.`);
      await loadUsers();
    } catch (e) {
      setError(e.message || 'Unable to update account.');
    }
  };

  if (isSuperAdmin && loadingCompanies && !companyData) return <Loader message="Loading companies..." />;

  return (
    <div className="safe-area-inset mx-auto max-w-7xl space-y-6 p-4 pb-24 md:space-y-8 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Access & security</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">User management</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Invite your team, assign the right access level and manage account status from one place.</p>
        </div>
        <button type="button" onClick={openCreate} disabled={!companyId}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/15 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          <Plus size={17}/> Add user
        </button>
      </header>

      {isSuperAdmin && (
        <Card className="border-white/5 bg-slate-950/40 p-5">
          <label htmlFor="tenant-select" className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400"><Building2 size={15}/> Organisation</label>
          <select id="tenant-select" value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-3 text-sm text-white md:max-w-md">
            <option value="">Select an organisation</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}

      {error && !showModal && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">{notice}</div>}

      {!companyId ? (
        <Card className="border-dashed border-white/10 bg-slate-950/30 p-10 text-center">
          <Building2 className="mx-auto text-slate-500" size={28}/>
          <h2 className="mt-3 font-semibold text-white">Choose an organisation</h2>
          <p className="mt-1 text-sm text-slate-500">Select a tenant to view and manage its user accounts.</p>
        </Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="User account summary">
            {[
              { label: 'Team members', value: counts.total, icon: Users, tone: 'text-sky-300 bg-sky-400/10' },
              { label: 'Active', value: counts.active, icon: CheckCircle2, tone: 'text-emerald-300 bg-emerald-400/10' },
              { label: 'Invitations pending', value: counts.pending, icon: Clock3, tone: 'text-amber-300 bg-amber-400/10' },
              { label: 'Suspended', value: counts.suspended, icon: UserX, tone: 'text-rose-300 bg-rose-400/10' },
            ].map((item) => {
              const Icon = item.icon;
              return <Card key={item.label} className="border-white/5 bg-slate-950/40 p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-400">{item.label}</span><span className={`rounded-xl p-2 ${item.tone}`}><Icon size={17}/></span></div><p className="mt-3 text-2xl font-semibold tabular-nums text-white">{item.value}</p></Card>;
            })}
          </section>

          <Card className="overflow-hidden border-white/5 bg-slate-950/40 p-0">
            <div className="flex flex-col gap-4 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-semibold text-white">Organisation users</h2><p className="mt-1 text-xs text-slate-500">Review roles and account access</p></div>
              <button type="button" onClick={loadUsers} disabled={loadingUsers} aria-label="Refresh users" className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-50 sm:self-auto"><RefreshCw size={14} className={loadingUsers ? 'animate-spin' : ''}/> Refresh</button>
            </div>
            <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16}/><input aria-label="Search users" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name, email or role" className="w-full rounded-xl border border-white/10 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none"/></div>
              <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white sm:w-44"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="SUSPENDED">Suspended</option></select>
            </div>

            {loadingUsers ? <div className="p-8"><Loader message="Loading organisation users..."/></div> : filteredUsers.length === 0 ? (
              <div className="p-10 text-center"><Users className="mx-auto text-slate-600" size={28}/><h3 className="mt-3 font-semibold text-white">{users.length ? 'No matching users' : 'No accounts yet'}</h3><p className="mt-1 text-sm text-slate-500">{users.length ? 'Try another search or status filter.' : 'Add a user to start building your team.'}</p>{!users.length && <button type="button" onClick={openCreate} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"><UserPlus size={15}/> Add your first user</button>}</div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredUsers.map((account) => (
                  <div key={account.id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">{(account.name || account.email || '?').slice(0,1).toUpperCase()}</div>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{account.name || 'Unnamed user'}</p><p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500"><Mail size={12}/>{account.email}</p></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-slate-300">{String(account.role || '').replace('_', ' ')}</span>
                      <span className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${statusTone[account.status] || statusTone.PENDING}`}>{account.status || 'UNKNOWN'}</span>
                      {account.id !== user?.id && account.role !== 'SUPER_ADMIN' && account.status !== 'PENDING' && (
                        <button type="button" onClick={() => changeStatus(account, account.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-primary/30 hover:bg-white/5">
                          {account.status === 'ACTIVE' ? <><UserX size={13}/> Suspend</> : <><UserCheck size={13}/> Reactivate</>}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">Showing {filteredUsers.length} of {users.length} accounts</div>
          </Card>
        </>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-sky-400/10 bg-sky-400/[0.04] p-4 text-xs leading-5 text-slate-400"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sky-300"/>Passwords are never created or viewed by administrators. Account setup uses a secure, time-limited activation link. Suspended users have active refresh sessions revoked.</div>

      <Modal isOpen={showModal} onClose={closeModal} title="Add a team member" size="lg">
        <div className="space-y-5">
          <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-3 text-xs leading-5 text-slate-300"><ShieldCheck size={15} className="mr-2 inline text-sky-300"/>The person sets their own password through a secure activation link. You only choose their role and enter their contact details.</div>
          <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-slate-950 p-1">
            <button type="button" onClick={() => setMode('create')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'create' ? 'bg-primary text-white shadow' : 'text-slate-400 hover:text-white'}`}>Create account</button>
            <button type="button" onClick={() => setMode('invite')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'invite' ? 'bg-primary text-white shadow' : 'text-slate-400 hover:text-white'}`}>Send invitation</button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div><label htmlFor="new-user-name" className="text-xs font-semibold text-slate-300">Full name <span className="text-rose-400">*</span></label><input id="new-user-name" required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} placeholder="e.g. Kwame Mensah"/></div>
            <div><label htmlFor="new-user-email" className="text-xs font-semibold text-slate-300">Work email address <span className="text-rose-400">*</span></label><input id="new-user-email" required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={inputClass} placeholder="name@company.com"/></div>
            <div><label htmlFor="new-user-role" className="text-xs font-semibold text-slate-300">Access role <span className="text-rose-400">*</span></label><select id="new-user-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className={inputClass}>{ROLES.map((role) => <option key={role} value={role}>{role.replace('_', ' ')}</option>)}</select><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{ROLE_HELP[form.role]}</p></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3"><p className="text-xs font-semibold text-white">{mode === 'create' ? 'Create account & send setup link' : 'Send an invitation'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{mode === 'create' ? 'The account is provisioned as pending. The user receives a time-limited link and chooses their password.' : 'An invitation is sent with a secure activation link. The account remains pending until accepted.'}</p></div>
            {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>}
            <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-3 border-t border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              <button type="button" onClick={closeModal} disabled={submitting} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/15 hover:brightness-110 disabled:cursor-wait disabled:opacity-50"><Mail size={15}/>{submitting ? 'Processing…' : mode === 'create' ? 'Create & send link' : 'Send invitation'}</button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
};

export default UserManagement;
