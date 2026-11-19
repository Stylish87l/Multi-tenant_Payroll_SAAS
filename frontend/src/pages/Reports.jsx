// src/pages/Reports.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@apollo/client';
import { FileSpreadsheet, FileText, ShieldCheck, Download } from 'lucide-react';

import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';
import { GET_PAYROLL_RUNS } from '../graphql/queries';
import { authFetch } from '../lib/authFetch';

// Derive the REST base endpoint using the verified GraphQL environment key
const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_API_URL || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');

const Reports = () => {
  const { user } = useAuth();
  const [selectedRunId, setSelectedRunId] = useState('');
  const [isDownloading, setIsDownloading] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const abortRef = useRef(null);

  // Pagination parameters standardized across dashboards
  const page = 1;
  const limit = 50;

  // Query execution utilizing standardized tenant contexts and fetch policies
  const { data: runsData, loading: runsLoading } = useQuery(GET_PAYROLL_RUNS, {
    variables: { companyId: user?.companyId, page, limit },
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
    skip: !user?.companyId,
  });

  const runs = useMemo(() => runsData?.payrollRuns?.items ?? [], [runsData]);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) || null, [runs, selectedRunId]);

  // Handle auto-selection of the latest active payroll run once data streams in
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  // Cleanup pending abort tokens when changing components or company domains
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [user?.companyId]);

  const safeFilename = useCallback((name) => {
    return name.replace(/[^a-z0-9_.-]/gi, '_');
  }, []);

  const parseFilenameFromDisposition = useCallback((disposition) => {
    if (!disposition) return null;
    const match = /filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i.exec(disposition);
    if (match && match[1]) return decodeURIComponent(match[1]);
    return null;
  }, []);

  // Strict structural mapping connecting each card layout to explicit REST path interfaces
  const buildDownloadUrl = useCallback((reportId, runId) => {
    if (!runId) return null;
    switch (reportId) {
      case 'gra':
        return `${REST_BASE}/api/reports/gra-schedule/${runId}?format=excel`;
      case 'ssnit':
        return `${REST_BASE}/api/reports/ssnit-schedule/${runId}?format=csv`;
      case 'payslips':
        return `${REST_BASE}/api/payslips/bulk/${runId}/pdf`;
      default:
        return null;
    }
  }, []);

  const handleExport = useCallback(async (reportId, extension) => {
    if (!selectedRunId) {
      setErrorMsg('Select a payroll run first.');
      return;
    }

    setErrorMsg(null);
    setIsDownloading(reportId);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = buildDownloadUrl(reportId, selectedRunId);
      if (!url) throw new Error('Unknown report configuration type.');

      const response = await authFetch(url, {
        method: 'GET',
        headers: { Accept: '*/*' },
        signal: controller.signal,
      });

      if (!response.ok) {
        let msg = `Export failed with status code (${response.status})`;
        try {
          const json = await response.json();
          if (json?.error) msg = json.error;
        } catch {
          // Fallback if error format is raw or text
        }
        throw new Error(msg);
      }

      const disposition = response.headers.get('content-disposition');
      const parsedName = parseFilenameFromDisposition(disposition);
      const fallbackName = `${reportId}_run_${selectedRunId}_${new Date().toISOString().split('T')[0]}.${extension}`;
      const filename = safeFilename(parsedName || fallbackName);

      const blob = await response.blob();
      const urlObj = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlObj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      setTimeout(() => window.URL.revokeObjectURL(urlObj), 15000);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('Report compilation download pipeline aborted.');
      } else {
        console.error('Export Failure Exception:', err);
        setErrorMsg(err.message || 'Failed to generate report. Confirm authorization variables or system states.');
      }
    } finally {
      setIsDownloading(null);
      abortRef.current = null;
    }
  }, [selectedRunId, buildDownloadUrl, parseFilenameFromDisposition, safeFilename]);

  const reportCards = useMemo(() => [
    {
      id: 'gra',
      title: 'GRA P.A.Y.E Schedule',
      desc: 'Monthly income tax returns formatted for the Ghana Revenue Authority compliance schema.',
      icon: FileSpreadsheet,
      color: 'text-amber-400',
      extension: 'xlsx',
    },
    {
      id: 'ssnit',
      title: 'SSNIT Contribution',
      desc: 'Social Security Tier 1 & 2 schedules matching regulatory submission frameworks.',
      icon: ShieldCheck,
      color: 'text-blue-400',
      extension: 'csv',
    },
    {
      id: 'payslips',
      title: 'Bulk Payslips Export',
      desc: 'Consolidated package containing individual employee payslips for the target run.',
      icon: FileText,
      color: 'text-emerald-400',
      extension: 'zip',
    },
  ], []);

  if (runsLoading && !runs.length) return <Loader message="Loading compliance matrix metadata..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Reporting & compliance</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Reports & exports</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Prepare payroll schedules and employee payslip exports for the payroll period you select.</p>
      </header>

      <Card className="border-white/5 bg-slate-950/40 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
          <label htmlFor="payroll-run-select" className="block text-xs font-semibold text-slate-300">
            Payroll period
          </label>
          <p className="text-xs text-slate-500">Choose the payroll run to use for each export.</p>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-400 bg-slate-900/40 p-3 border border-white/5 rounded-xl">
              No payroll runs are available yet. Run payroll and save a draft or finalize it before exporting.
            </p>
          ) : (
            <select
              id="payroll-run-select"
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="w-full md:w-80 bg-slate-900 border border-white/10 rounded-xl py-3 px-4 text-sm text-white outline-none focus:ring-2 focus:ring-primary/50 transition-all cursor-pointer"
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id} className="bg-slate-950 text-white">
                  {run.month} — Status: {run.status}
                </option>
              ))}
            </select>
          )}
          </div>
          {selectedRun && <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-wider text-primary">Selected run</p><p className="mt-1 text-sm font-semibold text-white">{String(selectedRun.month).slice(0, 7)}</p><p className="mt-0.5 text-[11px] text-slate-400">Status: {String(selectedRun.status).toLowerCase()}</p></div>}
        </div>
      </Card>

      {errorMsg && (
        <div role="alert" aria-live="polite" className="rounded-xl bg-rose-500/10 text-rose-400 p-4 border border-rose-500/20 text-sm shadow-sm">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {reportCards.map((report) => {
          const downloading = isDownloading === report.id;
          const dynamicDisabled = !!isDownloading || !selectedRunId || runs.length === 0;
          
          return (
            <Card key={report.id} className="group relative border-white/5 bg-slate-950/40 p-5 transition-all hover:border-primary/25" >
              <div className="flex items-start space-x-5">
                <div className={`p-4 rounded-2xl bg-white/5 ${report.color} group-hover:scale-105 transition-transform duration-200`} aria-hidden="true">
                  <report.icon size={28} />
                </div>

                <div className="flex-1 space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wide">{report.title}</h2>
                    <p className="text-sm text-slate-400 mt-1.5 leading-relaxed pr-8">{report.desc}</p>
                  </div>

                  <button
                    disabled={dynamicDisabled}
                    onClick={() => handleExport(report.id, report.extension)}
                    className="flex items-center space-x-2.5 px-5 py-2.5 bg-white/5 hover:bg-primary/20 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                    aria-label={`Download ${report.title}`}
                  >
                    {downloading ? (
                      <div role="status" className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>Get Document ({report.extension})</span>
                  </button>
                </div>
              </div>

              <div className="mt-4 border-t border-white/5 pt-3 text-[11px] text-slate-500" aria-live="polite">
                {downloading ? 'Preparing your export…' : selectedRun ? `Ready for ${String(selectedRun.month).slice(0, 7)}` : 'Select a payroll period to continue'}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-400/10 bg-sky-400/[0.04] p-4 text-xs leading-5 text-slate-400">
        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-sky-300" />
        <p>Review exported schedules before submission. Confirm employee details and statutory amounts against the applicable requirements for the selected payroll period.</p>
      </div>
    </div>
  );
};

export default Reports;