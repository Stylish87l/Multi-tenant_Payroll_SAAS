// src/pages/Payroll.jsx
import React, { useCallback, useState } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, FileCheck, History, AlertCircle, Clock, CheckCircle2, Trash2, Lock } from 'lucide-react';

import { GET_PAYROLL_RUNS, GET_COMPANIES } from '../graphql/queries';
import { RUN_PAYROLL, FINALIZE_PAYROLL, DISCARD_PAYROLL_DRAFT } from '../graphql/mutations';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';

// Mirrors the server: runPayroll = finance roles; finalize/discard = ADMIN tier (segregation of duties).
const RUN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
const APPROVE_ROLES = ['SUPER_ADMIN', 'ADMIN'];

// FIXED: the UI keyed on COMPLETED / PROCESSING / FAILED, none of which exist in the PayrollStatus enum
// (DRAFT / FINALIZED / CANCELLED), so every run rendered as an unstyled grey "PENDING".
const STATUS_STYLES = {
  DRAFT: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  FINALIZED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  CANCELLED: 'bg-slate-500/10 text-slate-400 border-white/10',
};
const STATUS_LABELS = { DRAFT: 'Draft - awaiting approval', FINALIZED: 'Finalized', CANCELLED: 'Cancelled' };

const errMsg = (err, fallback) => err?.graphQLErrors?.[0]?.message || fallback;

const Payroll = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const companyId = isSuperAdmin ? selectedCompanyId : user?.companyId;
  const { data: companiesData } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = companiesData?.companies ?? [];
  const [actionError, setActionError] = useState(null);
  const [busyRunId, setBusyRunId] = useState(null);

  const variables = { companyId, page: 1, limit: 50 };
  const { loading, error, data, refetch } = useQuery(GET_PAYROLL_RUNS, {
    variables,
    fetchPolicy: 'cache-and-network',
    skip: !companyId,
    notifyOnNetworkStatusChange: true,
  });

  // No optimisticResponse: running payroll is a heavy server operation that can be rejected (duplicate month,
  // no employees). The old optimistic "PROCESSING" row was a status that doesn't exist and lacked required fields.
  const [runPayroll, { loading: isRunning }] = useMutation(RUN_PAYROLL);
  const [finalizePayroll] = useMutation(FINALIZE_PAYROLL);
  const [discardDraft] = useMutation(DISCARD_PAYROLL_DRAFT);

  // The subscription payload is partial; refetching is simpler and always consistent with the server.
  useSubscription(PAYROLL_UPDATED_SUB, {
    variables: { companyId },
    skip: !companyId,
    onData: () => { refetch().catch(() => {}); },
  });

  const handleRun = useCallback(async () => {
    if (!RUN_ROLES.includes(user?.role)) return;
    setActionError(null);
    try {
      await runPayroll({ variables: { month: new Date().toISOString().slice(0, 7), companyId } });
      await refetch();
    } catch (err) {
      setActionError(errMsg(err, 'Payroll could not be run. Please try again.'));
    }
  }, [runPayroll, user, companyId, refetch]);

  const handleFinalize = useCallback(async (run) => {
    if (!window.confirm(`Finalize payroll for ${run.month.slice(0, 7)}? Finalized runs cannot be edited or discarded.`)) return;
    setActionError(null);
    setBusyRunId(run.id);
    try {
      await finalizePayroll({ variables: { runId: run.id } });
      await refetch();
    } catch (err) {
      setActionError(errMsg(err, 'Could not finalize this payroll run.'));
    } finally {
      setBusyRunId(null);
    }
  }, [finalizePayroll, refetch]);

  const handleDiscard = useCallback(async (run) => {
    if (!window.confirm(`Discard the draft for ${run.month.slice(0, 7)}? You can run payroll for this month again afterwards.`)) return;
    setActionError(null);
    setBusyRunId(run.id);
    try {
      await discardDraft({ variables: { runId: run.id } });
      await refetch();
    } catch (err) {
      setActionError(errMsg(err, 'Could not discard this draft.'));
    } finally {
      setBusyRunId(null);
    }
  }, [discardDraft, refetch]);

  if (loading && !data) return <Loader message="Loading payroll history..." />;
  if (error && !data) {
    return <div role="alert" className="p-8 text-rose-500 bg-rose-500/10 rounded-xl border border-rose-500/20">Error loading payroll runs: {error.message}</div>;
  }

  const runs = data?.payrollRuns?.items ?? [];
  const canRun = RUN_ROLES.includes(user?.role);
  const canApprove = APPROVE_ROLES.includes(user?.role);

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Payroll</h1>
          <p className="text-slate-400 text-sm">Run, review and approve monthly payroll</p>
        </div>

        {canRun && (
          <button onClick={handleRun} disabled={isRunning} aria-disabled={isRunning}
            className="group relative flex items-center justify-center space-x-3 overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 px-8 py-4 font-bold text-white shadow-xl shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
            {isRunning ? <Clock className="animate-spin" size={20} /> : <Play size={20} fill="currentColor" />}
            <span>{isRunning ? 'Calculating...' : 'Run monthly payroll'}</span>
          </button>
        )}
      </div>


      {isSuperAdmin && (
        <Card className="border-white/5 bg-slate-950/40 p-5">
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Select tenant</label>
          <select aria-label="Select tenant" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="w-full md:max-w-md rounded-xl border border-white/10 bg-slate-900 p-3 text-white">
            <option value="">Choose a company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}
      {!companyId && <Card className="p-8 text-center text-slate-400">Select a tenant to view payroll and run a payroll cycle.</Card>}

      {actionError && (
        <div role="alert" className="rounded-xl bg-rose-500/10 text-rose-400 p-4 border border-rose-500/20 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {actionError}
        </div>
      )}

      {companyId && runs.length === 0 && !loading && (
        <Card className="p-12 text-center"><p className="text-slate-400">No payroll runs yet. Start your first run above.</p></Card>
      )}

      {companyId && <div className="grid grid-cols-1 gap-6">
        <div className="flex items-center space-x-2 text-slate-400">
          <History size={18} />
          <h2 className="text-xs font-bold tracking-widest">Recent runs</h2>
        </div>

        <AnimatePresence>
          {runs.map((run, idx) => (
            <motion.div key={run.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ delay: Math.min(idx, 10) * 0.05 }}>
              <Card className="border-white/5 bg-slate-950/40 hover:border-white/10 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-slate-300"><FileCheck size={24} /></div>
                    <div>
                      <p className="text-[10px] font-bold tracking-widest text-slate-500">Period</p>
                      <h3 className="text-lg font-bold text-white">{String(run.month).slice(0, 7)}</h3>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4">
                    <div className="text-left lg:text-right">
                      <p className="text-[10px] font-bold tracking-widest text-slate-500">Net pay</p>
                      <p className="text-lg font-mono font-bold text-white">
                        {run.totalNet ? `GHS ${Number(run.totalNet).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
                      </p>
                    </div>

                    <div className={`flex items-center space-x-2 rounded-full border px-4 py-1.5 text-xs font-bold ${STATUS_STYLES[run.status] || STATUS_STYLES.CANCELLED}`} aria-label={`Payroll status ${run.status}`}>
                      {run.status === 'FINALIZED' && <CheckCircle2 size={14} />}
                      {run.status === 'DRAFT' && <Clock size={14} />}
                      <span>{STATUS_LABELS[run.status] || run.status}</span>
                    </div>

                    {run.status === 'DRAFT' && canApprove && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleFinalize(run)} disabled={busyRunId === run.id}
                          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 active:scale-95 transition-all">
                          <Lock size={14} /> Finalize
                        </button>
                        <button onClick={() => handleDiscard(run)} disabled={busyRunId === run.id}
                          className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50 active:scale-95 transition-all">
                          <Trash2 size={14} /> Discard
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Payroll;
