import React, { useMemo, useState } from 'react';
import { Sparkles, Send, ShieldCheck, Building2, MessageSquareText } from 'lucide-react';
import { useQuery } from '@apollo/client';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';
import { GET_COMPANIES } from '../graphql/queries';
import authFetch from '../lib/authFetch';
import { REST_BASE } from '../lib/apolloClient';

const SUGGESTIONS = [
  'How many active employees do we have?',
  'Summarise the latest finalized payroll.',
  'Show payroll trends over the last few months.',
  'How many payroll runs are drafts or finalized?',
];

const AskPaylio = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const companyId = isSuperAdmin ? selectedCompanyId : user?.companyId;
  const { data: companiesData, loading: companiesLoading } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = companiesData?.companies || [];
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canAsk = useMemo(() => !!companyId && !!question.trim() && !busy, [companyId, question, busy]);

  const ask = async (value = question) => {
    if (!companyId || !value.trim()) return;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const response = await authFetch(`${REST_BASE}/api/companies/${encodeURIComponent(companyId)}/ask-paylio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ question: value.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Ask Paylio could not answer that question.');
      setAnswer(payload);
      setQuestion(value);
    } catch (err) {
      setError(err.message || 'Ask Paylio is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  };

  if (isSuperAdmin && companiesLoading) return <Loader message="Loading companies..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-6 pb-24 max-w-5xl mx-auto">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Paylio intelligence</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3"><Sparkles className="text-primary" /> Ask Paylio</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">Ask questions about workforce counts and payroll reporting. Paylio uses approved, read-only reporting tools; it cannot change payroll or employee records.</p>
      </header>

      {isSuperAdmin && (
        <Card className="p-5 space-y-2">
          <label htmlFor="ask-company" className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"><Building2 size={16} /> Select a company</label>
          <select id="ask-company" value={selectedCompanyId} onChange={(event) => { setSelectedCompanyId(event.target.value); setAnswer(null); setError(''); }} className="w-full rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 p-3 text-sm text-slate-900 dark:text-white">
            <option value="">Choose a company before asking</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}

      <Card className="p-5 md:p-7 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><MessageSquareText size={18} className="text-primary" /> What would you like to know?</div>
        <form onSubmit={(event) => { event.preventDefault(); ask(); }} className="space-y-3">
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={3} placeholder="e.g. Summarise the latest finalized payroll..." className="w-full rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 p-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Up to 500 characters. Do not enter employee identifiers or bank details.</p>
            <button type="submit" disabled={!canAsk} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Send size={16} /> {busy ? 'Thinking...' : 'Ask Paylio'}</button>
          </div>
        </form>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={!companyId || busy} onClick={() => { setQuestion(suggestion); ask(suggestion); }} className="rounded-full border border-slate-300 dark:border-white/10 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:border-primary disabled:opacity-50">{suggestion}</button>)}
          </div>
        </div>
      </Card>

      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
      {busy && <Card className="p-5 text-sm text-slate-500">Checking approved company reports...</Card>}
      {answer && (
        <Card className="p-5 md:p-7 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Sparkles size={17} className="text-primary" /> Paylio response</div>
          <p className="text-sm leading-7 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{answer.answer}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={14} /> Read-only result · {answer.provider || 'rules-only'}{answer.intent ? ` · ${answer.intent.toLowerCase().replaceAll('_', ' ')}` : ''}</div>
          {answer.data && <details className="border-t border-slate-200 dark:border-white/10 pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-400">View source figures</summary>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300">{JSON.stringify(answer.data, null, 2)}</pre>
          </details>}
        </Card>
      )}
      <p className="text-xs text-slate-500">Ask Paylio is advisory. Payroll calculations, statutory amounts, approvals and payments remain controlled by Paylio deterministic workflows and authorized users.</p>
    </div>
  );
};

export default AskPaylio;
