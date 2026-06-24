// src/pages/Reports.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { FileSpreadsheet, FileText, ShieldCheck, Download, ExternalLink } from 'lucide-react';
import { GET_REPORTS } from '../graphql/queries';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from "../context/AuthContext";

const Reports = () => {
  const { user } = useAuth();
  const [isDownloading, setIsDownloading] = useState(null); // reportId|format while downloading
  const [errorMsg, setErrorMsg] = useState(null);
  const abortRef = useRef(null);

  const { loading, error, data } = useQuery(GET_REPORTS, {
    variables: { companyId: user?.companyId },
    skip: !user?.companyId,
    fetchPolicy: 'cache-and-network',
  });

  // Cleanup any in-flight download when component unmounts or user changes tenant
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [user?.companyId]);

  const safeFilename = (name) => name.replace(/[^a-z0-9_\-\.]/gi, '_');

  const parseFilenameFromDisposition = (disposition) => {
    if (!disposition) return null;
    const match = /filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i.exec(disposition);
    if (match && match[1]) return decodeURIComponent(match[1]);
    return null;
  };

  const handleExport = useCallback(async (reportType, format) => {
    setErrorMsg(null);
    setIsDownloading(`${reportType}|${format}`);
    // Abort previous download if any
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Missing authentication token.');

      const url = `${import.meta.env.VITE_API_URL}/exports/${encodeURIComponent(reportType)}?format=${encodeURIComponent(format)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-ID': user?.companyId,
          Accept: '*/*',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // Try to parse JSON error body for better message
        let msg = `Export failed (${response.status})`;
        try {
          const json = await response.json();
          if (json?.message) msg = json.message;
        } catch (e) {
          // ignore parse error
        }
        throw new Error(msg);
      }

      const disposition = response.headers.get('content-disposition');
      const parsedName = parseFilenameFromDisposition(disposition);
      const ext = format;
      const fallbackName = `${reportType}_${new Date().toISOString().split('T')[0]}.${ext}`;
      const filename = safeFilename(parsedName || fallbackName);

      const blob = await response.blob();

      // Create object URL and trigger download
      const urlObj = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlObj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Revoke URL after short delay to ensure download started
      setTimeout(() => window.URL.revokeObjectURL(urlObj), 15000);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('Download aborted');
      } else {
        console.error('Export Failed:', err);
        setErrorMsg(err.message || 'Failed to generate report. Please ensure you have sufficient permissions.');
      }
    } finally {
      setIsDownloading(null);
      abortRef.current = null;
    }
  }, [user?.companyId]);

  const reportCards = useMemo(() => [
    {
      id: 'gra',
      title: 'GRA P.A.Y.E Schedule',
      desc: 'Monthly income tax returns for the Revenue Authority.',
      icon: FileSpreadsheet,
      color: 'text-amber-400',
      formats: ['csv', 'xlsx'],
    },
    {
      id: 'ssnit',
      title: 'SSNIT Contribution',
      desc: 'Social Security Tier 1 & 2 employee schedules.',
      icon: ShieldCheck,
      color: 'text-blue-400',
      formats: ['csv', 'pdf'],
    },
    {
      id: 'payslips',
      title: 'Bulk Payslips',
      desc: 'Consolidated employee payslips for the selected period.',
      icon: FileText,
      color: 'text-emerald-400',
      formats: ['pdf'],
    },
  ], []);

  if (loading) return <Loader message="Generating compliance schedules..." />;
  if (error) {
    return (
      <div role="alert" className="p-6 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
        Error loading reports: {error.message}
      </div>
    );
  }

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Compliance Center</h1>
        <p className="text-slate-400 text-sm mt-1">Download official schedules for Ghanaian regulatory bodies.</p>
      </header>

      {errorMsg && (
        <div role="status" aria-live="polite" className="rounded-xl bg-rose-500/10 text-rose-400 p-4 border border-rose-500/20">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {reportCards.map((report) => (
          <Card key={report.id} className="group border-white/5 bg-slate-950/40">
            <div className="flex items-start space-x-5">
              <div className={`p-4 rounded-2xl bg-white/5 ${report.color} group-hover:scale-110 transition-transform`} aria-hidden="true">
                <report.icon size={32} />
              </div>

              <div className="flex-1">
                <h2 className="text-xl font-bold text-white">{report.title}</h2>
                <p className="text-sm text-slate-400 mt-1 mb-6 leading-relaxed">{report.desc}</p>

                <div className="flex flex-wrap gap-3">
                  {report.formats.map((format) => {
                    const downloading = isDownloading === `${report.id}|${format}`;
                    return (
                      <button
                        key={format}
                        disabled={!!isDownloading}
                        onClick={() => handleExport(report.id, format)}
                        className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-primary/20 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white transition-all active:scale-95 disabled:opacity-50"
                        aria-label={`Download ${report.title} as ${format}`}
                      >
                        {downloading ? (
                          <div role="status" aria-live="polite" className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        ) : (
                          <Download size={14} />
                        )}
                        <span>{format}</span>
                      </button>
                    );
                  })}

                  <button
                    className="flex items-center space-x-2 px-4 py-2 text-xs font-bold text-slate-500 hover:text-primary transition-colors"
                    onClick={() => window.open(`${import.meta.env.VITE_API_URL}/portal`, '_blank', 'noopener')}
                    aria-label="Open reports portal"
                  >
                    <ExternalLink size={14} />
                    <span>View Portal</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="absolute top-4 right-4 flex items-center space-x-2 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-500 uppercase">Ready</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="rounded-2xl border border-dashed border-white/10 p-6 flex items-center justify-between text-slate-500">
        <div className="flex items-center space-x-3">
          <ShieldCheck size={20} />
          <p className="text-sm italic">All exports are cryptographically signed and logged for audit purposes.</p>
        </div>
      </div>
    </div>
  );
};

export default Reports;
