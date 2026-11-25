import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';
import { GET_COMPANIES } from '../graphql/queries';
import { REST_BASE } from '../lib/apolloClient';
import { authFetch } from '../lib/authFetch';

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const value = String(reader.result || '');
    const comma = value.indexOf(',');
    if (comma < 0) return reject(new Error('Unable to read the selected file.'));
    resolve(value.slice(comma + 1));
  };
  reader.onerror = () => reject(new Error('Unable to read the selected file.'));
  reader.readAsDataURL(file);
});

const EmployeeImport = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const companyId = isSuperAdmin ? selectedCompanyId : user?.companyId;
  const { data: companiesData, loading: companiesLoading } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = companiesData?.companies || [];

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const previewFile = async () => {
    if (!companyId) {
      setError('Select a company before uploading the employee file.');
      return;
    }
    if (!file) {
      setError('Choose a CSV or XLSX file first.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setPreview(null);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const response = await authFetch(`${REST_BASE}/api/employees/import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64,
          ...(isSuperAdmin ? { companyId } : {}),
        }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to preview this file.');
      setPreview(payload);
    } catch (err) {
      setError(err.message || 'Unable to preview this file.');
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!preview?.previewId || !companyId) return;
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`${REST_BASE}/api/employees/import/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          previewId: preview.previewId,
          ...(isSuperAdmin ? { companyId } : {}),
        }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Employee import failed.');
      setResult(payload);
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError(err.message || 'Employee import failed.');
    } finally {
      setBusy(false);
    }
  };

  if (isSuperAdmin && companiesLoading) return <Loader message="Loading companies..." />;

  return (
    <div className="safe-area-inset mx-auto max-w-6xl space-y-6 p-4 pb-24 md:p-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Employee onboarding</p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white"><FileSpreadsheet className="text-primary" /> Smart employee import</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">Upload a CSV or Excel workbook, review the field mapping and validation results, then confirm the import. No employee records are created during preview.</p>
      </header>

      {isSuperAdmin && (
        <Card className="space-y-2 p-5">
          <label htmlFor="import-company" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Company to import into</label>
          <select id="import-company" value={selectedCompanyId} onChange={(event) => { setSelectedCompanyId(event.target.value); setPreview(null); setResult(null); }} className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white">
            <option value="">Select a company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}

      <Card className="space-y-5 p-5 md:p-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Upload size={18} className="text-primary" /> Select employee file</div>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setResult(null); setError(''); }}
          className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white dark:text-slate-300"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">CSV or XLSX · maximum 700 KB and 500 employee rows · first worksheet only</p>
          <button type="button" onClick={previewFile} disabled={busy || !file || !companyId} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <FileSpreadsheet size={16} /> {busy ? 'Working...' : 'Preview import'}
          </button>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs text-slate-500 dark:border-white/10">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
          <p>Employee identifiers and bank details are processed inside Paylio and encrypted while awaiting confirmation. They are not sent to an external AI provider. Only administrators can import employee compensation and identity fields.</p>
        </div>
      </Card>

      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>}

      {result && (
        <Card className="space-y-2 p-5">
          <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={18} /> Import completed</div>
          <p className="text-sm text-slate-700 dark:text-slate-300">Imported {result.importedCount} employee record(s). {result.skippedInvalidCount} invalid row(s) were skipped.</p>
        </Card>
      )}

      {preview && (
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Preview results</h2>
              <p className="text-xs text-slate-500">Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><p className="text-xs text-slate-500">Rows found</p><p className="mt-1 text-2xl font-bold">{preview.summary.totalRows}</p></div>
              <div className="rounded-xl bg-emerald-500/10 p-3"><p className="text-xs text-emerald-700 dark:text-emerald-300">Valid rows</p><p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{preview.summary.validRows}</p></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><p className="text-xs text-amber-700 dark:text-amber-300">Rows needing attention</p><p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-300">{preview.summary.invalidRows}</p></div>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Detected field mapping</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(preview.mapping || {}).map(([field, header]) => <span key={field} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 dark:border-white/10 dark:text-slate-300">{header} <span className="text-slate-400">→</span> {field}</span>)}
              </div>
            </div>
            {preview.ignoredHeaders?.length > 0 && <p className="text-xs text-slate-500">Ignored columns: {preview.ignoredHeaders.join(', ')}</p>}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 p-4 dark:border-white/10"><h3 className="font-semibold text-slate-900 dark:text-white">Employee rows</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-100 text-xs text-slate-500 dark:bg-slate-900">
                  <tr><th className="p-3">Row</th><th className="p-3">Employee</th><th className="p-3">Position</th><th className="p-3">Basic salary</th><th className="p-3">Sensitive fields</th><th className="p-3">Validation</th></tr>
                </thead>
                <tbody>
                  {(preview.rows || []).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-slate-100 dark:border-white/5">
                      <td className="p-3 text-slate-500">{row.rowNumber}</td>
                      <td className="p-3"><p className="font-medium text-slate-900 dark:text-white">{row.name || '—'}</p><p className="text-xs text-slate-500">{row.email || '—'}</p></td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{row.position || '—'}</td>
                      <td className="p-3 tabular-nums text-slate-600 dark:text-slate-300">{row.basicSalary ? `GHS ${Number(row.basicSalary).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                      <td className="p-3 text-xs text-slate-500">{row.sensitiveFieldsDetected?.length ? row.sensitiveFieldsDetected.join(', ') : 'None'}</td>
                      <td className="p-3">{row.valid ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} /> Valid</span> : <div className="space-y-1 text-xs text-rose-600 dark:text-rose-300"><span className="inline-flex items-center gap-1 font-semibold"><AlertTriangle size={13} /> Needs attention</span>{row.errors.map((message, index) => <p key={index}>{message}</p>)}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs text-slate-500">Only valid rows will be imported. Invalid rows will be skipped. The server rechecks duplicates and validation when you confirm.</p>
            <button type="button" onClick={commitImport} disabled={busy || preview.summary.validRows === 0} className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Importing...' : `Confirm import of ${preview.summary.validRows} employee(s)`}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeImport;
