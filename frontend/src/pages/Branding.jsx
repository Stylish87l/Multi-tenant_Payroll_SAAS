// src/pages/Branding.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
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
  tagline: '', // simple, safe subset of payslipTemplate JSON - avoids a raw JSON textarea
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
    if (form.logoUrl) {
      try {
        const u = new URL(form.logoUrl);
        if (u.protocol !== 'https:') {
          errs.logoUrl = 'Logo URL must use https://';
        }
      } catch {
        errs.logoUrl = 'Must be a valid URL';
      }
    }
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
        logoUrl: form.logoUrl || null,
        footerNote: form.footerNote || null,
        payslipTemplate: form.tagline ? { tagline: form.tagline } : null,
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
                <h3 className="text-xs font-bold uppercase tracking-widest">Logo URL</h3>
              </div>
              <input
                type="url"
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://cdn.example.com/logo.png"
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
              />
              <p className="text-[11px] text-slate-600">Must be an https:// URL. Used on payslips and company header.</p>
              {fieldErrors.logoUrl && <p className="text-xs text-rose-400">{fieldErrors.logoUrl}</p>}

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
              <p className="text-[11px] text-slate-600 text-right">{form.footerNote.length}/300</p>
              {fieldErrors.footerNote && <p className="text-xs text-rose-400">{fieldErrors.footerNote}</p>}

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
                Optional short line shown near the payslip header. Stored in the tenant's payslip template config.
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
                <div className="flex flex-col items-center text-center">
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
                      ? (companies.find((c) => c.id === selectedCompanyId)?.name || 'Company Name')
                      : (user?.companyName || 'Your Company')}
                  </h2>
                  {form.tagline && (
                    <p className="text-xs text-slate-500 mt-1 italic">{form.tagline}</p>
                  )}
                  <p className="text-sm text-slate-700 mt-3">OFFICIAL PAYSLIP: 2026-07</p>
                  <div className="w-full border-t border-slate-200 my-4" />
                  <p className="text-[10px] text-slate-400 italic">
                    {form.footerNote || 'Generated by Payroll System 2026. Secure Document.'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 mt-4">
                This mirrors the layout used in <code>backend/routes/payslips.js</code>'s PDF generator.
              </p>
            </Card>
          </form>
        )
      )}
    </div>
  );
};

export default Branding;