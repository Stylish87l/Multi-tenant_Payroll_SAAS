// src/pages/Payroll.jsx

import React, { useCallback } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, FileCheck, History, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

import { GET_PAYROLL_RUNS } from '../graphql/queries';
import { RUN_PAYROLL } from '../graphql/mutations';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';

import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from "../context/AuthContext";

const Payroll = () => {
  const { user } = useAuth(); // RBAC and tenant context

  // Query: list existing runs with paginated structure parsing
  const { loading, error, data, refetch } = useQuery(GET_PAYROLL_RUNS, {
    variables: { companyId: user?.companyId, page: 1, limit: 50 },
    fetchPolicy: 'cache-and-network',
    skip: !user?.companyId,
    notifyOnNetworkStatusChange: true,
  });

  // Mutation: run payroll
  const [runPayroll, { loading: isRunning }] = useMutation(RUN_PAYROLL, {
    optimisticResponse: {
      __typename: 'Mutation',
      runPayroll: {
        __typename: 'PayrollRun',
        id: 'temp-id-' + Date.now(),
        month: new Date().toISOString().slice(0, 7),
        status: 'PROCESSING',
        totalNet: 0,
        processedAt: new Date().toISOString(),
      },
    },
    update(cache, { data: result }) {
      const newRun = result?.runPayroll;
      if (!newRun) return;
      try {
        const queryVars = { companyId: user?.companyId, page: 1, limit: 50 };
        const existing = cache.readQuery({
          query: GET_PAYROLL_RUNS,
          variables: queryVars,
        });
        
        if (existing?.payrollRuns?.items) {
          const updatedList = [newRun, ...existing.payrollRuns.items.filter(r => r.id !== newRun.id)];
          cache.writeQuery({
            query: GET_PAYROLL_RUNS,
            variables: queryVars,
            data: { 
              payrollRuns: {
                ...existing.payrollRuns,
                items: updatedList
              } 
            },
          });
        }
      } catch (e) {
        refetch();
      }
    },
  });

  // Subscription: handles the incoming data stream matching paginated structure paths
  useSubscription(PAYROLL_UPDATED_SUB, {
    variables: { companyId: user?.companyId },
    skip: !user?.companyId,
    onData: ({ client, data: subData }) => {
      const updated = subData?.data?.payrollUpdated;
      if (!updated) return;
      try {
        const queryVars = { companyId: user?.companyId, page: 1, limit: 50 };
        const existing = client.cache.readQuery({
          query: GET_PAYROLL_RUNS,
          variables: queryVars,
        });
        
        if (existing?.payrollRuns?.items) {
          const updatedList = [updated, ...existing.payrollRuns.items.filter(r => r.id !== updated.id)];
          client.cache.writeQuery({
            query: GET_PAYROLL_RUNS,
            variables: queryVars,
            data: { 
              payrollRuns: {
                ...existing.payrollRuns,
                items: updatedList
              } 
            },
          });
        }
      } catch (e) {
        client.refetchQueries({ include: [GET_PAYROLL_RUNS] });
      }
    },
  });

  const handleRun = useCallback(() => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) {
      window.alert('Unauthorized: You do not have permission to process payroll.');
      return;
    }
    const currentMonth = new Date().toISOString().slice(0, 7);
    runPayroll({ variables: { month: currentMonth } });
  }, [runPayroll, user]);

  const getStatusStyle = useCallback((status) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'PROCESSING':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse';
      case 'FAILED':
        return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      default:
        return 'bg-slate-500/10 text-slate-500 border-white/10';
    }
  }, []);

  if (loading && !data) return <Loader message="Loading payroll history..." />;
  if (error) {
    return (
      <div role="alert" className="p-8 text-rose-500 bg-rose-500/10 rounded-xl border border-rose-500/20">
        Error loading payroll runs: {error.message}
      </div>
    );
  }

  // FIXED: Extract the items flat array from the paginated object wrapper safely
  const runs = data?.payrollRuns?.items ?? [];

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Payroll Engine</h1>
          <p className="text-slate-400 text-sm">Execute and monitor monthly tax compliance</p>
        </div>

        {/* RBAC Protected Button */}
        {['ADMIN', 'SUPER_ADMIN'].includes(user?.role) && (
          <button
            onClick={handleRun}
            disabled={isRunning}
            aria-disabled={isRunning}
            aria-live="polite"
            className="group relative flex items-center justify-center space-x-3 overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 px-8 py-4 font-bold text-white shadow-xl shadow-purple-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            {isRunning ? <Clock className="animate-spin" size={20} /> : <Play size={20} fill="currentColor" />}
            <span>{isRunning ? 'Executing Algorithm...' : 'Run Monthly Payroll'}</span>
          </button>
        )}
      </div>

      {/* Empty State */}
      {runs.length === 0 && !loading && (
        <Card className="p-12 text-center">
          <p className="text-slate-400">No payroll runs yet. Start your first execution above.</p>
        </Card>
      )}

      {/* History Grid */}
      <div className="grid grid-cols-1 gap-6">
        <div className="flex items-center space-x-2 text-slate-400">
          <History size={18} />
          <h3 className="text-xs font-bold uppercase tracking-widest">Recent Executions</h3>
        </div>

        <AnimatePresence>
          {runs.map((run, idx) => (
            <motion.div
              key={run.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="border-white/5 bg-slate-950/40 hover:border-white/10 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-slate-300">
                      <FileCheck size={24} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Period</p>
                      <h2 className="text-lg font-bold text-white">{run.month}</h2>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-8">
                    <div className="text-left md:text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Net Disbursement</p>
                      <p className="text-lg font-mono font-bold text-white">
                        {run.totalNet ? `GHS ${Number(run.totalNet).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
                      </p>
                    </div>

                    <div
                      className={`flex items-center space-x-2 rounded-full border px-4 py-1.5 text-xs font-bold ${getStatusStyle(run.status)}`}
                      aria-label={`Payroll status ${run.status}`}
                    >
                      {run.status === 'COMPLETED' && <CheckCircle2 size={14} />}
                      {run.status === 'PROCESSING' && <Clock size={14} className="animate-spin" />}
                      {run.status === 'FAILED' && <AlertCircle size={14} />}
                      <span>{run.status || 'PENDING'}</span>
                    </div>
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