import React, { useCallback, useEffect, useState } from 'react';
import { Download, Receipt, AlertCircle, CheckCircle2, Clock, RefreshCw, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { getMyPayslips, downloadMyPayslipPdf, getMyPayslipExplanation } from '../services/payslipService';

const money = (value) => Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MyPayslips = () => {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [explaining, setExplaining] = useState('');
  const [explanations, setExplanations] = useState({});
  const [expandedExplanation, setExpandedExplanation] = useState('');
  const latestPayslip = payslips[0] || null;

  const loadPayslips = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayslips(await getMyPayslips());
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
      const blob = await downloadMyPayslipPdf(item.id);
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

  const explain = useCallback(async (item) => {
    if (expandedExplanation === item.id) {
      setExpandedExplanation('');
      return;
    }
    if (explanations[item.id]) {
      setExpandedExplanation(item.id);
      return;
    }
    setExplaining(item.id);
    setError('');
    try {
      const explanation = await getMyPayslipExplanation(item.id);
      setExplanations((current) => ({ ...current, [item.id]: explanation }));
      setExpandedExplanation(item.id);
    } catch (err) {
      setError(err.message || 'Unable to explain this payslip.');
    } finally {
      setExplaining('');
    }
  }, [expandedExplanation, explanations]);

  if (loading && payslips.length === 0) return <Loader message="Loading your payslips..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Your payroll</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">My payslips</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your finalized monthly statements, ready to review and download.</p>
        </div>
        <button type="button" onClick={loadPayslips} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300"><AlertCircle size={16} />{error}</div>}

      {payslips.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Payslip summary">
          <Card className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-950/40 p-4"><p className="text-xs font-medium text-slate-600 dark:text-slate-400">Available statements</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{payslips.length}</p><p className="mt-1 text-[11px] text-slate-500">Finalized payslips in your account</p></Card>
          <Card className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-950/40 p-4"><p className="text-xs font-medium text-slate-600 dark:text-slate-400">Latest net pay</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{latestPayslip ? `GHS ${money(latestPayslip.netPay)}` : '—'}</p><p className="mt-1 text-[11px] text-slate-500">{latestPayslip ? `Pay period ${String(latestPayslip.month).slice(0, 7)}` : 'No finalized statement yet'}</p></Card>
        </section>
      )}

      {payslips.length === 0 && !loading ? (
        <Card className="p-10 text-center">
          <Receipt size={32} className="mx-auto text-slate-500 mb-3" />
          <h2 className="font-semibold text-slate-900 dark:text-white">No payslips available yet</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Your payslip will appear here after your company&apos;s payroll is finalized.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {payslips.map((item) => (
            <Card key={item.id} className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-950/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary"><Receipt size={20} /></div>
                  <div><p className="text-xs text-slate-500">Pay period</p><h2 className="font-bold text-slate-900 dark:text-white">{String(item.month).slice(0, 7)}</h2></div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                  {item.paymentStatus === 'PAID' || item.paymentStatus === 'SENT' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                  {String(item.paymentStatus || 'PENDING').replaceAll('_', ' ')}
                </span>
              </div>
              <div><p className="text-xs text-slate-500">Net pay</p><p className="text-2xl font-bold font-mono text-slate-900 dark:text-white">GHS {money(item.netPay)}</p></div>
              {item.paymentRef && <p className="text-xs text-slate-500 break-all">Payment reference: {item.paymentRef}</p>}
              <button type="button" onClick={() => explain(item)} disabled={explaining === item.id} aria-expanded={expandedExplanation === item.id} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-white/10 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:border-primary disabled:opacity-50">
                <BookOpen size={16} /> {explaining === item.id ? 'Preparing explanation...' : expandedExplanation === item.id ? 'Hide explanation' : 'Explain this payslip'}
                {expandedExplanation === item.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {expandedExplanation === item.id && explanations[item.id] && (
                <section className="space-y-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 p-4" aria-label={`Payslip explanation for ${String(item.month).slice(0, 7)}`}>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Your pay, explained</h3>
                    <p className="mt-1 text-xs text-slate-500">Pay period {explanations[item.id].period}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Earnings</h4>
                    {explanations[item.id].earnings ? (
                      <div className="mt-2 space-y-2">
                        {explanations[item.id].earnings.map((line) => <div key={line.label} className="flex justify-between gap-3 text-sm"><span className="text-slate-600 dark:text-slate-300">{line.label}</span><span className="font-medium tabular-nums text-slate-900 dark:text-white">GHS {line.amountGhs}</span></div>)}
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-500">The historical earnings breakdown was not saved for this payslip.</p>}
                    <div className="mt-2 flex justify-between border-t border-slate-200 dark:border-white/10 pt-2 text-sm font-semibold"><span>Gross pay</span><span>GHS {explanations[item.id].grossPayGhs}</span></div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Your deductions</h4>
                    <div className="mt-2 space-y-2">
                      {explanations[item.id].employeeDeductions.map((line) => <div key={line.label} className="flex justify-between gap-3 text-sm"><span className="text-slate-600 dark:text-slate-300">{line.label}</span><span className="font-medium tabular-nums text-slate-900 dark:text-white">GHS {line.amountGhs}</span></div>)}
                    </div>
                    <div className="mt-2 flex justify-between border-t border-slate-200 dark:border-white/10 pt-2 text-sm font-semibold"><span>Total deductions</span><span>GHS {explanations[item.id].totalEmployeeDeductionsGhs}</span></div>
                    <p className="mt-2 text-xs text-slate-500">Taxable income recorded for PAYE: GHS {explanations[item.id].taxableIncomeGhs}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Employer contribution</h4>
                    <div className="mt-2 space-y-2">
                      {explanations[item.id].employerContributions.map((line) => <div key={line.label} className="flex justify-between gap-3 text-xs"><span className="text-slate-600 dark:text-slate-300">{line.label}</span><span className="font-medium tabular-nums text-slate-900 dark:text-white">GHS {line.amountGhs}</span></div>)}
                    </div>
                    <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">SSNIT remittance breakdown</h4>
                    <div className="mt-2 space-y-2">
                      {explanations[item.id].ssnitRemittances.map((line) => <div key={line.label} className="flex justify-between gap-3 text-xs"><span className="text-slate-600 dark:text-slate-300">{line.label}</span><span className="font-medium tabular-nums text-slate-900 dark:text-white">GHS {line.amountGhs}</span></div>)}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Tier 1 and Tier 2 are remittance categories, not additional deductions from your take-home pay.</p>
                  </div>
                  <div className="flex justify-between rounded-lg bg-primary/10 p-3 text-sm font-bold text-slate-900 dark:text-white"><span>Your recorded take-home pay</span><span>GHS {explanations[item.id].netPayGhs}</span></div>
                  <div className="space-y-1 text-xs text-slate-500">
                    <p>{explanations[item.id].taxContext.historicalSnapshotAvailable ? `Historical tax configuration saved for ${explanations[item.id].taxContext.taxYear} (effective ${explanations[item.id].taxContext.effectiveAt || 'date not recorded'}).` : 'Historical tax configuration is unavailable for this older payroll record.'}</p>
                    {explanations[item.id].taxContext.reliefInputs && (
                      <p>Tax-relief inputs saved at the time: family relief {explanations[item.id].taxContext.reliefInputs.familyReliefInput ? 'yes' : 'no'}, children {explanations[item.id].taxContext.reliefInputs.childrenCount}, disability relief {explanations[item.id].taxContext.reliefInputs.disabilityReliefInput ? 'yes' : 'no'}, old-age relief eligibility {explanations[item.id].taxContext.reliefInputs.oldAgeReliefEligible ? 'yes' : 'no'}, aged dependents {explanations[item.id].taxContext.reliefInputs.agedDependentsCount}.</p>
                    )}
                    {explanations[item.id].notes.map((note, index) => <p key={index}>• {note}</p>)}
                  </div>
                </section>
              )}
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
