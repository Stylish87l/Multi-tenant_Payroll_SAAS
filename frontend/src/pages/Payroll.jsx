// src/pages/Payroll.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, FileCheck, History, AlertCircle, Clock, CheckCircle2, Trash2, Lock, Sparkles, ShieldAlert, RefreshCw } from 'lucide-react';

import { GET_PAYROLL_RUNS, GET_COMPANIES } from '../graphql/queries';
import { RUN_PAYROLL, FINALIZE_PAYROLL, DISCARD_PAYROLL_DRAFT } from '../graphql/mutations';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';
import { REST_BASE, TOKEN_KEY } from '../lib/apolloClient';

// Mirrors the server: runPayroll = finance roles; finalize/discard = ADMIN tier (segregation of duties).
const RUN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
const APPROVE_ROLES = ['SUPER_ADMIN', 'ADMIN'];

// FIXED: the UI keyed on COMPLETED / PROCESSING / FAILED, none of which exist in the PayrollStatus enum
// (DRAFT / FINALIZED / CANCELLED), so every run rendered as an unstyled grey "PENDING".
const STATUS_STYLES = {
  DRAFT: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  FINALIZED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  CANCELLED: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10',
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
  const [reviewHistory, setReviewHistory] = useState([]);
  const [activeReview, setActiveReview] = useState(null);
  const [activeReviewMonth, setActiveReviewMonth] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  const requestReviewApi = useCallback(async (path, options = {}) => {
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(`${REST_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
    return payload;
  }, []);

  useEffect(() => {
    if (!companyId) {
      setReviewHistory([]);
      setActiveReview(null);
      setActiveReviewMonth(null);
      return undefined;
    }
    let cancelled = false;
    requestReviewApi(`/api/companies/${encodeURIComponent(companyId)}/payroll-reviews?page=1&limit=10`)
      .then((result) => { if (!cancelled) setReviewHistory(result.items || []); })
      .catch(() => { if (!cancelled) setReviewHistory([]); });
    return () => { cancelled = true; };
  }, [companyId, requestReviewApi]);

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

  const handleReviewRun = useCallback(async (run) => {
    if (!companyId || !RUN_ROLES.includes(user?.role)) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const review = await requestReviewApi(
        `/api/companies/${encodeURIComponent(companyId)}/payroll-reviews/payroll-runs/${encodeURIComponent(run.id)}`,
        { method: 'POST' }
      );
      setActiveReview(review);
      setActiveReviewMonth(run.month);
      const history = await requestReviewApi(`/api/companies/${encodeURIComponent(companyId)}/payroll-reviews?page=1&limit=10`);
      setReviewHistory(history.items || []);
    } catch (err) {
      setReviewError(err.message || 'Payroll review could not be completed.');
    } finally {
      setReviewBusy(false);
    }
  }, [companyId, requestReviewApi, user]);

  const handleOpenReview = useCallback(async (review) => {
    if (!companyId) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const detail = await requestReviewApi(
        `/api/companies/${encodeURIComponent(companyId)}/payroll-reviews/${encodeURIComponent(review.id)}`
      );
      setActiveReview(detail);
      setActiveReviewMonth(detail.payrollRun?.month || review.payrollRun?.month || null);
    } catch (err) {
      setReviewError(err.message || 'Could not load this review.');
    } finally {
      setReviewBusy(false);
    }
  }, [companyId, requestReviewApi]);

  const handleFindingDecision = useCallback(async (findingId, decision) => {
    if (!companyId || !activeReview?.id) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const updated = await requestReviewApi(
        `/api/companies/${encodeURIComponent(companyId)}/payroll-reviews/${encodeURIComponent(activeReview.id)}/findings/${encodeURIComponent(findingId)}`,
        { method: 'PATCH', body: JSON.stringify({ decision }) }
      );
      setActiveReview((current) => ({
        ...current,
        findings: current.findings.map((finding) => finding.id === findingId ? { ...finding, status: updated.status } : finding),
      }));
    } catch (err) {
      setReviewError(err.message || 'Could not save the review decision.');
    } finally {
      setReviewBusy(false);
    }
  }, [activeReview, companyId, requestReviewApi]);

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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Payroll operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Payroll</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Prepare, review and approve monthly payroll with a clear audit trail.</p>
        </div>

        {canRun && (
          <button onClick={handleRun} disabled={isRunning || !companyId} aria-disabled={isRunning || !companyId}
            className="group relative flex items-center justify-center space-x-3 overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 px-8 py-4 font-bold text-white shadow-xl shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
            {isRunning ? <Clock className="animate-spin" size={20} /> : <Play size={20} fill="currentColor" />}
            <span>{isRunning ? 'Calculating...' : 'Run monthly payroll'}</span>
          </button>
        )}
      </div>


      <section aria-label="Payroll workflow" className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/35 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Payroll workflow</h2>
          <span className="text-[11px] text-slate-500">Drafts are not final payroll</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['01', 'Prepare', 'Generate a draft from active employee records.'],
            ['02', 'Review', 'Check totals and resolve any payroll issues.'],
            ['03', 'Finalize', 'An administrator approves and locks the payroll run.'],
          ].map(([number, title, description], index) => (
            <div key={number} className="flex items-start gap-3 rounded-xl bg-white/[0.025] p-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${index === 2 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-primary/10 text-primary'}`}>{number}</span>
              <div><p className="text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{description}</p></div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">Accountants can prepare payroll runs. Finalization is restricted to administrators to support separation of duties.</p>
      </section>

      {isSuperAdmin && (
        <Card className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-950/40 p-5">
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">Select tenant</label>
          <select aria-label="Select tenant" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="w-full md:max-w-md rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-900 p-3 text-slate-900 dark:text-white">
            <option value="">Choose a company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}
      {!companyId && <Card className="p-8 text-center text-slate-600 dark:text-slate-400">Select a tenant to view payroll and run a payroll cycle.</Card>}

      {companyId && (
        <section className="space-y-4" aria-label="Paylio AI payroll reviews">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                <Sparkles size={18} className="text-indigo-500" />
                <h2 className="text-sm font-bold tracking-wide">Paylio AI review history</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">Rule-based checks with optional AI explanations. A human remains responsible for every decision.</p>
            </div>
            <button type="button" onClick={() => {
              requestReviewApi(`/api/companies/${encodeURIComponent(companyId)}/payroll-reviews?page=1&limit=10`)
                .then((result) => setReviewHistory(result.items || []))
                .catch((err) => setReviewError(err.message));
            }} className="rounded-lg border border-slate-200 dark:border-white/10 p-2 text-slate-600 dark:text-slate-300" aria-label="Refresh review history">
              <RefreshCw size={15} />
            </button>
          </div>
          {reviewError && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">{reviewError}</div>}
          {reviewHistory.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {reviewHistory.map((review) => (
                <button key={review.id} type="button" onClick={() => handleOpenReview(review)} disabled={reviewBusy}
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-left text-xs hover:border-indigo-400 disabled:opacity-50">
                  <span className="block font-semibold text-slate-800 dark:text-slate-100">{review.payrollRun?.month?.slice(0, 7) || 'Payroll review'}</span>
                  <span className="mt-1 block text-slate-500">{review._count?.findings ?? 0} findings · {new Date(review.createdAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-slate-500">No reviews have been run for this company yet.</p>}
          {activeReview && (
            <Card className="border-indigo-500/20 bg-indigo-500/[0.035] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Payroll review · {activeReviewMonth?.slice(0, 7) || 'Selected run'}</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{activeReview.findings?.length || 0} findings identified</h3>
                  {activeReview.summary && <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{activeReview.summary}</p>}
                  <p className="mt-1 text-[11px] text-slate-500">Explanation provider: {activeReview.provider || 'Rules only'}{activeReview.model ? ` · ${activeReview.model}` : ''}</p>
                </div>
                <button type="button" onClick={() => setActiveReview(null)} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white">Close review</button>
              </div>
              {activeReview.findings?.length ? (
                <div className="mt-4 space-y-3">
                  {activeReview.findings.map((finding) => (
                    <div key={finding.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-slate-950/50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'bg-rose-500/10 text-rose-500' : finding.severity === 'MEDIUM' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-500'}`}>{finding.severity}</span>
                        <span className="text-[10px] text-slate-500">{finding.code}</span>
                        <span className="ml-auto text-[10px] font-semibold uppercase text-slate-500">{finding.status}</span>
                      </div>
                      <h4 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{finding.title}</h4>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{finding.description}</p>
                      <p className="mt-2 text-xs text-slate-500"><strong>Suggested check:</strong> {finding.recommendation}</p>
                      {finding.aiExplanation && <p className="mt-2 rounded-lg bg-indigo-500/5 p-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><strong>AI context:</strong> {finding.aiExplanation}</p>}
                      {finding.employeeId && <p className="mt-2 text-[10px] text-slate-500">Employee reference: {finding.employeeId.slice(0, 8)}…</p>}
                      {finding.status !== 'RESOLVED' && finding.status !== 'DISMISSED' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            ['CONFIRMED', 'Confirm'],
                            ['NEEDS_INVESTIGATION', 'Investigate'],
                            ['DISMISSED', 'Dismiss'],
                            ['RESOLVED', 'Resolve'],
                          ].map(([decision, label]) => (
                            <button key={decision} type="button" disabled={reviewBusy} onClick={() => handleFindingDecision(finding.id, decision)}
                              className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-400 disabled:opacity-50">{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="mt-4 rounded-lg bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-300">No anomalies were detected by the enabled deterministic checks. Continue with the normal payroll review and approval process.</p>}
              <div className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-slate-500"><ShieldAlert size={15} className="mt-0.5 shrink-0" /> Paylio AI does not change payroll values, tax calculations or payment status. Review every finding before finalizing.</div>
            </Card>
          )}
        </section>
      )}

      {actionError && (
        <div role="alert" className="rounded-xl bg-rose-500/10 text-rose-400 p-4 border border-rose-500/20 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {actionError}
        </div>
      )}

      {companyId && runs.length === 0 && !loading && (
        <Card className="p-12 text-center"><p className="text-slate-600 dark:text-slate-400">No payroll runs yet. Start your first run above.</p></Card>
      )}

      {companyId && <div className="grid grid-cols-1 gap-6">
        <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
          <History size={18} />
          <h2 className="text-xs font-bold tracking-widest">Recent runs</h2>
        </div>

        <AnimatePresence>
          {runs.map((run, idx) => (
            <motion.div key={run.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ delay: Math.min(idx, 10) * 0.05 }}>
              <Card className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-white/10 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-slate-700 dark:text-slate-300"><FileCheck size={24} /></div>
                    <div>
                      <p className="text-[10px] font-bold tracking-widest text-slate-500">Period</p>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{String(run.month).slice(0, 7)}</h3>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4">
                    <div className="text-left lg:text-right">
                      <p className="text-[10px] font-bold tracking-widest text-slate-500">Net pay</p>
                      <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">
                        {run.totalNet ? `GHS ${Number(run.totalNet).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
                      </p>
                    </div>

                    <div className={`flex items-center space-x-2 rounded-full border px-4 py-1.5 text-xs font-bold ${STATUS_STYLES[run.status] || STATUS_STYLES.CANCELLED}`} aria-label={`Payroll status ${run.status}`}>
                      {run.status === 'FINALIZED' && <CheckCircle2 size={14} />}
                      {run.status === 'DRAFT' && <Clock size={14} />}
                      <span>{STATUS_LABELS[run.status] || run.status}</span>
                    </div>

                    {canRun && (
                      <button type="button" onClick={() => handleReviewRun(run)} disabled={reviewBusy}
                        className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-50">
                        <Sparkles size={14} /> {reviewBusy ? 'Reviewing...' : 'AI review'}
                      </button>
                    )}
                    {run.status === 'DRAFT' && canApprove && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleFinalize(run)} disabled={busyRunId === run.id}
                          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 active:scale-95 transition-all">
                          <Lock size={14} /> Finalize
                        </button>
                        <button onClick={() => handleDiscard(run)} disabled={busyRunId === run.id}
                          className="flex items-center gap-2 rounded-xl bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50 active:scale-95 transition-all">
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
      </div>}
    </div>
  );
};

export default Payroll;
