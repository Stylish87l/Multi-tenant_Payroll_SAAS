import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ShieldCheck, RefreshCw, ExternalLink, FileText, AlertTriangle } from 'lucide-react';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';
import { GET_COMPANIES } from '../graphql/queries';
import authFetch from '../lib/authFetch';
import { REST_BASE } from '../lib/apolloClient';

const IMPACT_AREAS = ['PAYE', 'SSNIT', 'ALLOWANCES', 'PAYROLL_PROCESS', 'EMPLOYEE_DATA', 'OTHER'];

const ComplianceCenter = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isComplianceSpecialist = user?.role === 'COMPLIANCE_SPECIALIST';
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [assignedCompanies, setAssignedCompanies] = useState([]);
  const companyId = isSuperAdmin || isComplianceSpecialist ? selectedCompanyId : user?.companyId;
  const { data: companiesData, loading: companiesLoading } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = companiesData?.companies || [];

  const [notices, setNotices] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeNoticeId, setActiveNoticeId] = useState('');
  const [summary, setSummary] = useState('');
  const [impactAreas, setImpactAreas] = useState(['PAYE']);
  const [proposedActions, setProposedActions] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewRationale, setReviewRationale] = useState('');
  const [activeReviewId, setActiveReviewId] = useState('');

  useEffect(() => {
    if (!isComplianceSpecialist) return undefined;
    let cancelled = false;
    authFetch(REST_BASE + '/api/compliance-access/my-companies', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not load assigned companies.');
        if (!cancelled) {
          const available = payload.companies || [];
          setAssignedCompanies(available);
          setSelectedCompanyId((current) => current || available[0]?.id || '');
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load assigned companies.'); });
    return () => { cancelled = true; };
  }, [isComplianceSpecialist]);

  const loadNotices = useCallback(async () => {
    if (!companyId) {
      setNotices([]);
      setSources([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(`${REST_BASE}/api/companies/${encodeURIComponent(companyId)}/compliance/notices`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load compliance notices.');
      setNotices(payload.notices || []);
      setSources(payload.sources || []);
    } catch (err) {
      setError(err.message || 'Compliance notices are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadNotices(); }, [loadNotices]);

  const toggleImpactArea = (area) => {
    setImpactAreas((current) => current.includes(area)
      ? current.filter((value) => value !== area)
      : [...current, area]);
  };

  const beginAssessment = (noticeId) => {
    setActiveNoticeId(noticeId);
    setSummary('');
    setImpactAreas(['PAYE']);
    setProposedActions('');
    setError('');
  };

  const submitAssessment = async (event) => {
    event.preventDefault();
    const actions = proposedActions.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!activeNoticeId || !summary.trim() || actions.length === 0) {
      setError('Add an impact summary and at least one proposed action.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await authFetch(`${REST_BASE}/api/companies/${encodeURIComponent(companyId)}/compliance/notices/${encodeURIComponent(activeNoticeId)}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ summary: summary.trim(), impactAreas, proposedActions: actions }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save the draft assessment.');
      setActiveNoticeId('');
      await loadNotices();
    } catch (err) {
      setError(err.message || 'Draft assessment could not be saved.');
    } finally {
      setSaving(false);
    }
  };


  const submitAssessmentForReview = async (assessmentId) => {
    setSaving(true);
    setError('');
    try {
      const response = await authFetch(REST_BASE + '/api/companies/' + encodeURIComponent(companyId) + '/compliance/assessments/' + encodeURIComponent(assessmentId) + '/submit', {
        method: 'POST', headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not submit assessment.');
      await loadNotices();
    } catch (err) { setError(err.message || 'Could not submit assessment.'); }
    finally { setSaving(false); }
  };

  const recordAssessmentReview = async (assessmentId, decision) => {
    if (reviewRationale.trim().length < 30) {
      setError('A review rationale of at least 30 characters is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await authFetch(REST_BASE + '/api/companies/' + encodeURIComponent(companyId) + '/compliance/assessments/' + encodeURIComponent(assessmentId) + '/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision, rationale: reviewRationale.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not record review.');
      setActiveReviewId('');
      setReviewRationale('');
      await loadNotices();
    } catch (err) { setError(err.message || 'Could not record review.'); }
    finally { setSaving(false); }
  };

  const companyOptions = isSuperAdmin ? companies : assignedCompanies;
  const selectedCompany = useMemo(
    () => companyOptions.find((company) => company.id === companyId),
    [companyOptions, companyId],
  );

  if (isSuperAdmin && companiesLoading) return <Loader message="Loading companies..." />;

  return (
    <div className="safe-area-inset mx-auto max-w-6xl space-y-6 p-4 pb-24 md:p-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Ghana statutory updates</p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          <ShieldCheck className="text-primary" /> Compliance Watcher
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          Monitor official GRA and SSNIT publications, review detected changes, and prepare company-specific impact assessments.
        </p>
      </header>

      {(isSuperAdmin || isComplianceSpecialist) && (
        <Card className="space-y-2 p-5">
          <label htmlFor="compliance-company" className="text-sm font-semibold text-slate-800 dark:text-slate-200">{isSuperAdmin ? 'Company for this assessment' : 'Assigned company'}</label>
          <select id="compliance-company" value={selectedCompanyId} onChange={(event) => { setSelectedCompanyId(event.target.value); setActiveNoticeId(''); setActiveReviewId(''); }} className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white">
            <option value="">Choose a company</option>
            {companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Official source notices</h2>
          {selectedCompany && <p className="text-xs text-slate-500">Assessment company: {selectedCompany.name}</p>}
        </div>
        <button type="button" onClick={loadNotices} disabled={!companyId || loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-white/10 dark:text-slate-200">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {!companyId && <Card className="p-5 text-sm text-slate-600 dark:text-slate-300">Select an assigned company to review compliance notices.</Card>}
      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
      {loading && <Loader message="Loading official notices..." />}

      {companyId && !loading && notices.length === 0 && (
        <Card className="p-6 text-sm text-slate-600 dark:text-slate-300">No statutory changes have been detected yet. The watcher establishes a baseline on its first scan and records later content changes for review.</Card>
      )}

      {companyId && sources.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {sources.map((source) => (
            <Card key={source.id} className="space-y-2 p-4">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{source.authority} · {source.topic}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{source.name}</p>
              <p className="text-[11px] text-slate-500">Last scan: {source.lastCheckedAt ? new Date(source.lastCheckedAt).toLocaleString() : 'Not scanned yet'}</p>
              <p className={`text-[11px] font-semibold ${source.lastStatus === 'ERROR' || source.lastStatus === 'BLOCKED' ? 'text-rose-600' : 'text-emerald-600'}`}>{source.lastStatus || 'PENDING'}</p>
              {source.lastError && <p className="text-[11px] text-rose-600">{source.lastError}</p>}
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {notices.map((notice) => (
          <Card key={notice.id} className="space-y-4 p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{notice.source.authority}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{notice.source.topic}</span>
                  <span className="text-[11px] text-slate-500">{new Date(notice.detectedAt).toLocaleString()}</span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{notice.title}</h3>
              </div>
              <a href={notice.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Official publication <ExternalLink size={13} />
              </a>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{notice.excerpt}</p>

            {notice.assessment ? (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><FileText size={15} /> Draft impact assessment</div>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{notice.assessment.summary}</p>
                <p className="mt-2 text-xs text-slate-500">Impact areas: {(notice.assessment.impactAreas || []).join(', ')} · Status: {notice.assessment.status}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
                  {(notice.assessment.proposedActions || []).map((action, index) => <li key={index}>{action}</li>)}

                </ul>
                {(notice.assessment.reviews || []).map((review) => (
                  <div key={review.createdAt} className="mt-3 border-t border-slate-200 pt-2 text-xs dark:border-white/10">
                    <p className="font-semibold">{review.decision} · {review.reviewer?.name || review.reviewer?.email || 'Reviewer'}</p>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">{review.rationale}</p>
                  </div>
                ))}
                {!isComplianceSpecialist && ['DRAFT', 'REJECTED'].includes(notice.assessment.status) && (
                  <button type="button" disabled={saving} onClick={() => submitAssessmentForReview(notice.assessment.id)} className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {saving ? 'Submitting...' : 'Submit for specialist review'}
                  </button>
                )}
                {isComplianceSpecialist && notice.assessment.status === 'SUBMITTED' && (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-white/10">
                    {activeReviewId === notice.assessment.id ? (
                      <>
                        <label className="block text-xs font-semibold">Review rationale
                          <textarea value={reviewRationale} onChange={(event) => setReviewRationale(event.target.value)} rows={3} maxLength={3000} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-white/10 dark:bg-slate-900" placeholder="Explain the evidence reviewed and the reasons for your decision..." />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={saving || reviewRationale.trim().length < 30} onClick={() => recordAssessmentReview(notice.assessment.id, 'APPROVED')} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve assessment</button>
                          <button type="button" disabled={saving || reviewRationale.trim().length < 30} onClick={() => recordAssessmentReview(notice.assessment.id, 'REJECTED')} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-white/10 disabled:opacity-50">Reject assessment</button>
                          <button type="button" onClick={() => setActiveReviewId('')} className="rounded-xl px-3 py-2 text-xs">Cancel</button>
                        </div>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setActiveReviewId(notice.assessment.id); setReviewRationale(''); }} className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white">Review assessment</button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              !isComplianceSpecialist && <div>
                {activeNoticeId === notice.id ? (
                  <form onSubmit={submitAssessment} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-white/10">
                    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Impact summary
                      <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} maxLength={3000} placeholder="Describe which payroll rules, periods or employee groups may be affected..." className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-white/10 dark:bg-slate-900" />
                    </label>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Potential impact areas</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {IMPACT_AREAS.map((area) => (
                          <label key={area} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs dark:border-white/10">
                            <input type="checkbox" checked={impactAreas.includes(area)} onChange={() => toggleImpactArea(area)} />
                            {area.replaceAll('_', ' ')}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Proposed review actions (one per line)
                      <textarea value={proposedActions} onChange={(event) => setProposedActions(event.target.value)} rows={3} maxLength={4000} placeholder={'Compare the published effective date with active tax configuration\nPrepare payroll impact scenarios for specialist review'} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-white/10 dark:bg-slate-900" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={saving || impactAreas.length === 0} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save draft assessment'}</button>
                      <button type="button" onClick={() => setActiveNoticeId('')} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-white/10">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => beginAssessment(notice.id)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:text-slate-200">
                    Draft impact assessment
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="flex items-start gap-3 p-5">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
        <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
          Compliance Watcher records publication changes and human-written draft assessments only. It does not interpret law as legal advice, change tax rates, edit TaxConfig, or alter payroll. A qualified Ghana tax specialist must review any proposed statutory change, validate effective dates, and approve versioned configuration with golden tests before activation.
        </p>
      </Card>
    </div>
  );
};

export default ComplianceCenter;
