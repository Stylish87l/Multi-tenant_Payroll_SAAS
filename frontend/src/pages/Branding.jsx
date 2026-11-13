// src/pages/Branding.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { Paintbrush, Image, MessageSquare, Save, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { GET_COMPANIES } from '../graphql/queries';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_API_URL || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');

const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const EMPTY_FORM = {
  themeColor: '',
  logoUrl: '',
  footerNote: '',
  address: '',
  contactEmail: '',
  contactPhone: '',
  companyDisplayName: '',
  logoAlignment: 'center',
  showFooter: true,
  tagline: '',
};

const Branding = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // For SUPER_ADMIN: which tenant they're currently editing.
  // For ADMIN: always locked to their own company - never selectable.
  const [selectedCompanyId, setSelectedCompanyId] = useState(isSuperAdmin ? '' : user?.companyId || '');

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [successMsg, setSuccessMsg] = useState(null);

  // SUPER_ADMIN-only tenant directory for the picker. Skipped entirely for
  // ADMIN - they never need or see the full tenant list.
  const { data: companiesData, loading: companiesLoading } = useQuery(GET_COMPANIES, {
    skip: !isSuperAdmin,
    fetchPolicy: 'cache-and-network',
  });
  const companies = useMemo(() => companiesData?.companies ?? [], [companiesData]);

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadBranding = useCallback(async (companyId) => {
    if (!companyId) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`${REST_BASE}/api/companies/${companyId}/branding`, {
        method: 'GET',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Failed to load branding (status ${res.status})`);
      }
      const b = json.branding || {};
      setForm({
        themeColor: b.themeColor || '',
        logoUrl: b.logoUrl || '',
        footerNote: b.footerNote || '',
        address: b.address || '',
        contactEmail: b.contactEmail || '',
        contactPhone: b.contactPhone || '',
        companyDisplayName: b.payslipTemplate?.companyDisplayName || b.name || '',
        logoAlignment: b.payslipTemplate?.logoAlignment || 'center',
        showFooter: b.payslipTemplate?.showFooter !== false,
        tagline: b.payslipTemplate?.tagline || '',
      });
    } catch (err) {
      console.error('Branding load error:', err);
      setErrorMsg(err.message || 'Unable to load branding settings.');
      setForm(EMPTY_FORM);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  // Auto-load for ADMIN (fixed company). For SUPER_ADMIN, load whenever
  // they pick a tenant from the dropdown.
  useEffect(() => {
    if (selectedCompanyId) {
      loadBranding(selectedCompanyId);
    } else {
      setForm(EMPTY_FORM);
    }
  }, [selectedCompanyId, loadBranding]);

  const validate = useCallback(() => {
    const errs = {};
    if (form.themeColor && !HEX_COLOR_RE.test(form.themeColor)) {
      errs.themeColor = 'Must be a valid hex color, e.g. #4B6EF5';
    }
    if (form.logoUrl && !form.logoUrl.startsWith('data:image/')) {
      try {
        const u = new URL(form.logoUrl);
        if (u.protocol !== 'https:') errs.logoUrl = 'Logo URL must use https://';
      } catch { errs.logoUrl = 'Must be a valid URL'; }
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\\.[^\s@]+$/.test(form.contactEmail)) errs.contactEmail = 'Enter a valid email address.';
    if (form.footerNote && form.footerNote.length > 300) {
      errs.footerNote = 'Must be 300 characters or fewer';
    }
    return errs;
  }, [form]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedCompanyId) {
      setErrorMsg(isSuperAdmin ? 'Select a tenant first.' : 'No company context available.');
      return;
    }

    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const payload = {
        themeColor: form.themeColor || null,
        ...(form.logoUrl?.startsWith('data:image/')
          ? { logoDataUrl: form.logoUrl }
          : { logoUrl: form.logoUrl || null }),
        footerNote: form.footerNote || null,
        address: form.address || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        payslipTemplate: {
          companyDisplayName: form.companyDisplayName || null,
          logoAlignment: form.logoAlignment,
          showFooter: form.showFooter,
          tagline: form.tagline || null,
        },
      };

      const res = await fetch(`${REST_BASE}/api/companies/${selectedCompanyId}/branding`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json?.errors) {
          setFieldErrors(json.errors);
          throw new Error('Please fix the highlighted fields.');
        }
        throw new Error(json?.error || `Save failed (status ${res.status})`);
      }

      setSuccessMsg('Branding updated successfully.');
    } catch (err) {
      console.error('Branding save error:', err);
      setErrorMsg(err.message || 'Failed to save branding settings.');
    } finally {
      setSaving(false);
    }
  }, [selectedCompanyId, form, validate, authHeaders, isSuperAdmin]);

  const previewThemeColor = HEX_COLOR_RE.test(form.themeColor) ? form.themeColor : '#4B6EF5';

  if (isSuperAdmin && companiesLoading && companies.length === 0) {
    return <Loader message="Loading tenant directory..." />;
  }

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-8 pb-24">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Tenant Branding</h1>
        <p className="text-slate-400 text-sm mt-1">
          Customize theme color, logo, footer note, and payslip presentation for {isSuperAdmin ? 'a tenant' : 'your organization'}.
        </p>
      </header>

      {/* Tenant selector - SUPER_ADMIN only. ADMIN never sees or controls this. */}
      {isSuperAdmin && (
        <Card className="border-white/5 bg-slate-950/40 p-6">
          <div className="flex items-center gap-2 text-slate-400 mb-3">
            <Building2 size={16} />
            <h3 className="text-xs font-bold uppercase tracking-widest">Select Tenant</h3>
          </div>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full md:w-96 bg-slate-900 border border-white/10 rounded-xl py-3 px-4 text-sm text-white outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="" className="bg-slate-950">— Choose a company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-950">
                {c.name} {c.tin ? `(${c.tin})` : ''}
              </option>
            ))}
          </select>
        </Card>
      )}

      {errorMsg && (
        <div role="alert" className="rounded-xl bg-rose-500/10 text-rose-400 p-4 border border-rose-500/20 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div role="status" aria-live="polite" className="rounded-xl bg-emerald-500/10 text-emerald-400 p-4 border border-emerald-500/20 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} />
          {successMsg}
        </div>
      )}

      {!selectedCompanyId && isSuperAdmin && !errorMsg && (
        <Card className="p-6 text-center text-slate-400">
          Select a tenant above to view or edit their branding.
        </Card>
      )}

      {selectedCompanyId && (
        loading ? (
          <Loader message="Loading branding settings..." />
        ) : (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Form fields */}
            <Card className="border-white/5 bg-slate-950/40 p-6 space-y-6">
              <div className="flex items-center gap-2 text-slate-400">
                <Paintbrush size={16} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Theme Color</h3>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={HEX_COLOR_RE.test(form.themeColor) ? form.themeColor : '#4B6EF5'}
                  onChange={(e) => setForm({ ...form, themeColor: e.target.value })}
                  className="h-12 w-14 rounded-lg border border-white/10 bg-slate-900 cursor-pointer"
                  aria-label="Pick theme color"
                />
                <input
                  type="text"
                  value={form.themeColor}
                  onChange={(e) => setForm({ ...form, themeColor: e.target.value })}
                  placeholder="#4B6EF5"
                  className="flex-1 bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary font-mono"
                />
              </div>
              {fieldErrors.themeColor && <p className="text-xs text-rose-400">{fieldErrors.themeColor}</p>}

              <div className="flex items-center gap-2 text-slate-400 pt-2 border-t border-white/5">
                <Image size={16} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Company logo</h3>
              </div>
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 512 * 1024) {
                  setFieldErrors((prev) => ({ ...prev, logoDataUrl: 'Choose a PNG or JPEG image no larger than 512 KB.' }));
                  e.target.value = '';
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setForm((prev) => ({ ...prev, logoUrl: String(reader.result) }));
                reader.onerror = () => setFieldErrors((prev) => ({ ...prev, logoDataUrl: 'Unable to read the selected image.' }));
                reader.readAsDataURL(file);
              }} className="w-full text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white" />
              {form.logoUrl && <div className="flex items-center gap-3"><img src={form.logoUrl} alt="Selected company logo" className="h-12 max-w-40 object-contain rounded bg-white p-1" /><button type="button" onClick={() => setForm((prev) => ({ ...prev, logoUrl: '' }))} className="text-xs text-rose-400">Remove logo</button></div>}
              <p className="text-[11px] text-slate-600">Upload PNG or JPEG, maximum 512 KB. The logo is stored with this tenant's branding.</p>
              {fieldErrors.logoUrl && <p className="text-xs text-rose-400">{fieldErrors.logoUrl}</p>}
              {fieldErrors.logoDataUrl && <p className="text-xs text-rose-400">{fieldErrors.logoDataUrl}</p>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">Payslip display name<input value={form.companyDisplayName} onChange={(e) => setForm({ ...form, companyDisplayName: e.target.value })} maxLength={120} className="mt-2 w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white" placeholder="Company name on payslip" /></label>
                <label className="text-xs text-slate-400">Logo alignment<select value={form.logoAlignment} onChange={(e) => setForm({ ...form, logoAlignment: e.target.value })} className="mt-2 w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
              </div>
              <label className="block text-xs text-slate-400">Company address<textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={300} rows={2} className="mt-2 w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white" placeholder="Company address" /></label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">Contact email<input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="mt-2 w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white" placeholder="payroll@company.com" /></label>
                <label className="text-xs text-slate-400">Contact phone<input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} maxLength={40} className="mt-2 w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white" placeholder="+233 ..." /></label>
              </div>
              {fieldErrors.contactEmail && <p className="text-xs text-rose-400">{fieldErrors.contactEmail}</p>}

              <div className="flex items-center gap-2 text-slate-400 pt-2 border-t border-white/5">
                <MessageSquare size={16} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Footer Note</h3>
              </div>
              <textarea
                value={form.footerNote}
                onChange={(e) => setForm({ ...form, footerNote: e.target.value })}
                maxLength={300}
                rows={3}
                placeholder="e.g. Generated by Paylio. Confidential document."
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary resize-none"
              />
              <p className="text-[11px] text-slate-600 text-right">{form.footerNote.length}/500</p>
              {fieldErrors.footerNote && <p className="text-xs text-rose-400">{fieldErrors.footerNote}</p>}
              <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.showFooter} onChange={(e) => setForm({ ...form, showFooter: e.target.checked })} className="rounded border-white/20 bg-slate-950" /> Show footer on payslip</label>

              <div className="flex items-center gap-2 text-slate-400 pt-2 border-t border-white/5">
                <MessageSquare size={16} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Payslip Tagline</h3>
              </div>
              <input
                type="text"
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                placeholder="e.g. Empowering Ghanaian Businesses"
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
              />
              <p className="text-[11px] text-slate-600">
                Optional short line shown near the payslip header. Stored in the tenant&apos;s payslip template config.
              </p>

              <button
                type="submit"
                disabled={saving}
                className="w-full mt-4 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Save size={18} />
                {saving ? 'Saving...' : 'Save Branding'}
              </button>
            </Card>

            {/* Live preview */}
            <Card className="border-white/5 bg-slate-950/40 p-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Payslip Header Preview</h3>
              <div className="rounded-xl border border-white/10 bg-white p-6">
                <div className={`flex flex-col ${form.logoAlignment === 'left' ? 'items-start text-left' : form.logoAlignment === 'right' ? 'items-end text-right' : 'items-center text-center'}`}>
                  {form.logoUrl ? (
                    <img
                      src={form.logoUrl}
                      alt="Company logo preview"
                      className="h-16 object-contain mb-3"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-lg bg-slate-200 mb-3 flex items-center justify-center text-slate-400 text-xs">
                      No logo
                    </div>
                  )}
                  <h2
                    className="text-lg font-bold uppercase tracking-tight"
                    style={{ color: previewThemeColor }}
                  >
                    {isSuperAdmin
                      ? (form.companyDisplayName || companies.find((c) => c.id === selectedCompanyId)?.name || 'Company Name')
                      : (form.companyDisplayName || user?.companyName || 'Your Company')}
                  </h2>
                  {form.address && <p className="text-xs text-slate-500 mt-1">{form.address}</p>}
                  {[form.contactEmail, form.contactPhone].filter(Boolean).join(' · ') && <p className="text-xs text-slate-500 mt-1">{[form.contactEmail, form.contactPhone].filter(Boolean).join(' · ')}</p>}
                  {form.tagline && <p className="text-xs text-slate-500 mt-1 italic">{form.tagline}</p>}
                  <p className="text-sm text-slate-700 mt-3">EMPLOYEE PAYSLIP · Preview period</p>
                  <div className="w-full border-t border-slate-200 my-4" />
                  {form.showFooter && <p className="text-[10px] text-slate-400 italic">{form.footerNote || 'This is an electronically generated payslip and does not require a signature.'}</p>}
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-4">
                This mirrors the layout used in <code>backend/routes/payslips.js</code>&apos;s PDF generator.
              </p>
            </Card>
          </form>
        )
      )}
    </div>
  );
};

export default Branding;