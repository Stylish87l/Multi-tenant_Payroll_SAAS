import React, { useCallback, useEffect, useState } from 'react';
import { Download, Receipt, AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import Card from '../components/Card';
import Loader from '../components/Loader';

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_API_URL || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');
const money = (value) => Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MyPayslips = () => {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');

  const loadPayslips = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${REST_BASE}/api/payslips/mine`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load your payslips.');
      setPayslips(body.payslips || []);
    } catch (err) {
      setError(err.message || 'Unable to load your payslips.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPayslips(); }, [loadPayslips]);

  const download = useCallback(async (item) => {
    setDownloading(item.id);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${REST_BASE}/api/payslips/item/${encodeURIComponent(item.id)}/pdf`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Payslip download failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `payslip_${String(item.month).slice(0, 7)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Payslip download failed.');
    } finally {
      setDownloading('');
    }
  }, []);

  if (loading && payslips.length === 0) return <Loader message="Loading your payslips..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">My Payslips</h1>
          <p className="text-sm text-slate-400 mt-1">Download your finalized monthly payroll statements.</p>
        </div>
        <button type="button" onClick={loadPayslips} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300"><AlertCircle size={16} />{error}</div>}

      {payslips.length === 0 && !loading ? (
        <Card className="p-10 text-center">
          <Receipt size={32} className="mx-auto text-slate-500 mb-3" />
          <h2 className="font-semibold text-white">No finalized payslips yet</h2>
          <p className="text-sm text-slate-400 mt-1">Your payslip will appear here after your company's payroll is finalized.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {payslips.map((item) => (
            <Card key={item.id} className="border-white/5 bg-slate-950/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary"><Receipt size={20} /></div>
                  <div><p className="text-xs text-slate-500">Pay period</p><h2 className="font-bold text-white">{String(item.month).slice(0, 7)}</h2></div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                  {item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                  {String(item.paymentStatus || 'PENDING').replaceAll('_', ' ')}
                </span>
              </div>
              <div><p className="text-xs text-slate-500">Net pay</p><p className="text-2xl font-bold font-mono text-white">GHS {money(item.netPay)}</p></div>
              {item.paymentRef && <p className="text-xs text-slate-500 break-all">Payment reference: {item.paymentRef}</p>}
              <button type="button" onClick={() => download(item)} disabled={downloading === item.id} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">
                <Download size={16} /> {downloading === item.id ? 'Preparing PDF...' : 'Download payslip'}
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyPayslips;
