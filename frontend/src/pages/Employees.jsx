// src/pages/Employees.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, ShieldCheck, Mail, Landmark, Users as UsersIcon, Wallet } from 'lucide-react';

import { GET_EMPLOYEES } from '../graphql/queries';
import { CREATE_EMPLOYEE, UPDATE_EMPLOYEE } from '../graphql/mutations';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { formatGHS } from '../utils/formatCurrency';
import { validateForm } from '../utils/validateForm';
import { employeeFormSchema } from '../schemas/employeeSchema';
import { useAuth } from '../context/AuthContext';

// Same defaults the DB applies; pre-filled so "Add Staff" never silently locks in wrong PAYE reliefs.
const DEFAULT_RELIEF_VALUES = {
  age: 30, isMarried: false, hasResponsibility: false, childrenCount: 0, isDisabled: false, agedDependentsCount: 0,
};
const DEFAULT_ALLOWANCES = { housingAllowance: 0, transportAllowance: 0, otherAllowance: 0 };

const LIMIT = 50;
const inputClass = 'w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary';
const labelClass = 'text-xs font-bold text-slate-500 ml-1';

const mutationMessage = (err, fallback) => err?.graphQLErrors?.[0]?.message || fallback;

const Employees = () => {
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const [userError, setUserError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const { user } = useAuth();
  const companyId = user?.companyId;

  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // `page` stays 1 here on purpose. Further pages are appended ONLY by fetchMore + the cache typePolicy merge.
  // Previously loadNextPage also did setPage() (re-running this query) and a manual updateQuery, so every
  // "Load more" appended the same page two or three times.
  const queryVars = useMemo(() => ({ companyId, page: 1, limit: LIMIT, search: debouncedSearch }), [companyId, debouncedSearch]);

  const { loading, error, data, fetchMore, refetch } = useQuery(GET_EMPLOYEES, {
    variables: queryVars,
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
    notifyOnNetworkStatusChange: true,
    skip: !companyId && user?.role !== 'SUPER_ADMIN',
  });

  const [createEmployee] = useMutation(CREATE_EMPLOYEE);
  const [updateEmployee] = useMutation(UPDATE_EMPLOYEE);

  const maskPII = useCallback((value) => {
    if (!value) return 'N/A';
    return `${value.slice(0, 1)}****${value.slice(-4)}`;
  }, []);

  const employees = useMemo(() => data?.employees?.items ?? [], [data]);
  const hasNextPage = data?.employees?.pageInfo?.hasNextPage ?? false;

  useEffect(() => {
    setUserError(error ? 'Unable to load employees. Please try again.' : null);
  }, [error]);

  const handleEdit = useCallback((employee) => {
    setFormData({
      name: employee.name ?? '',
      email: employee.email ?? '',
      basicSalary: employee.basicSalary ?? '',
      housingAllowance: employee.housingAllowance ?? 0,
      transportAllowance: employee.transportAllowance ?? 0,
      otherAllowance: employee.otherAllowance ?? 0,
      ssnitNumber: employee.ssnitNumber ?? '',
      ghanaCardPin: employee.ghanaCardPin ?? '',
      position: employee.position ?? 'Staff',
      bankName: employee.bankName ?? '',
      bankAccount: employee.bankAccount ?? '',
      age: employee.age ?? DEFAULT_RELIEF_VALUES.age,
      isMarried: employee.isMarried ?? false,
      hasResponsibility: employee.hasResponsibility ?? false,
      childrenCount: employee.childrenCount ?? 0,
      isDisabled: employee.isDisabled ?? false,
      agedDependentsCount: employee.agedDependentsCount ?? 0,
    });
    setFieldErrors({});
    setUserError(null);
    setEditingId(employee.id);
    setShowModal(true);
  }, []);

  const openCreate = () => {
    setFormData({ position: 'Staff', ...DEFAULT_RELIEF_VALUES, ...DEFAULT_ALLOWANCES });
    setFieldErrors({});
    setUserError(null);
    setEditingId(null);
    setShowModal(true);
  };

  const closeModal = useCallback(() => {
    setShowModal(false);
    setFormData({});
    setFieldErrors({});
    setEditingId(null);
    setSaving(false);
  }, []);

  const setField = (key, value) => setFormData((f) => ({ ...f, [key]: value }));

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setUserError(null);

    // Zod validation (mirrors the backend schema). Replaces the old ad-hoc checks and the unused validateForm util.
    const { valid, errors, data: clean } = await validateForm(employeeFormSchema, formData);
    setFieldErrors(errors);
    if (!valid) {
      setUserError(Object.values(errors)[0]);
      return;
    }

    // Drop undefined optional keys so an edit never overwrites a stored value with "nothing".
    const input = Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined));

    setSaving(true);
    try {
      // No optimisticResponse: a failed save used to flash a fake temp-id row, and the optimistic object
      // lacked required fragment fields (Apollo "Missing field" errors). Mutations now reject on failure.
      if (editingId) {
        await updateEmployee({ variables: { id: editingId, input } });
      } else {
        await createEmployee({
          variables: { input },
          update: (cache, { data: result }) => {
            try {
              const existing = cache.readQuery({ query: GET_EMPLOYEES, variables: queryVars });
              if (!existing?.employees?.items) return;
              cache.writeQuery({
                query: GET_EMPLOYEES,
                variables: queryVars,
                data: {
                  employees: {
                    ...existing.employees,
                    total: existing.employees.total + 1,
                    items: [result.createEmployee, ...existing.employees.items],
                  },
                },
              });
            } catch {
              refetch();
            }
          },
        });
      }
      closeModal();
    } catch (mutationError) {
      console.error('Mutation error:', mutationError);
      setUserError(mutationMessage(mutationError, 'Failed to save employee. Please try again.'));
    } finally {
      setSaving(false);
    }
  }, [createEmployee, updateEmployee, editingId, formData, closeModal, queryVars, refetch]);

  const loadNextPage = useCallback(() => {
    const nextPage = (data?.employees?.page ?? 1) + 1;
    fetchMore({ variables: { ...queryVars, page: nextPage } }).catch((err) => console.warn('fetchMore error', err));
  }, [data, fetchMore, queryVars]);

  if (loading && !data) return <Loader message="Loading staff records..." />;

  const fieldError = (key) => fieldErrors[key] && <p role="alert" className="text-xs text-rose-400 ml-1">{fieldErrors[key]}</p>;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-6 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Staff directory</h1>
          <p className="text-slate-400 text-sm">Manage payroll profiles and tax reliefs</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={18} aria-hidden="true" />
            <input
              type="text" placeholder="Search staff..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-900/50 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-primary/50 outline-none w-full md:w-64"
              aria-label="Search staff"
            />
          </div>
          <button onClick={openCreate} aria-label="Add staff"
            className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-primary/20 active:scale-95">
            <Plus size={18} />
            <span className="hidden md:block">Add staff</span>
          </button>
        </div>
      </div>

      {userError && !showModal && (
        <div role="alert" className="rounded-md bg-rose-900/80 text-rose-100 p-3 text-sm">{userError}</div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence>
          {employees.length === 0 && !loading ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card className="p-6 text-center"><p className="text-slate-400">No staff found. Add your first staff member.</p></Card>
            </motion.div>
          ) : (
            employees.map((emp, idx) => (
              <motion.div key={emp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx, 10) * 0.03 }}>
                <Card className="hover:border-primary/30 transition-all group">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center border border-white/10 text-white font-bold">
                        {emp.name ? emp.name.charAt(0) : '?'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{emp.name}</h2>
                          {emp.position && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 font-medium">{emp.position}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                          <span className="flex items-center gap-1"><Mail size={14} /> {emp.email}</span>
                          <span className="hidden md:flex items-center gap-1 text-slate-500"><ShieldCheck size={14} /> {maskPII(emp.ghanaCardPin)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 border-white/5 pt-4 md:pt-0">
                      <div className="text-left md:text-right">
                        <p className="text-[10px] font-bold text-slate-500 tracking-widest">Basic salary</p>
                        <p className="text-lg font-bold text-emerald-400 font-mono">{formatGHS(emp.basicSalary)}</p>
                      </div>
                      <button onClick={() => handleEdit(emp)} aria-label={`Edit ${emp.name}`}
                        className="p-3 bg-white/5 hover:bg-primary/20 text-slate-300 hover:text-primary rounded-xl transition-all active:scale-90">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {hasNextPage && (
        <div className="flex justify-center mt-4">
          <button onClick={loadNextPage} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}

      <Modal isOpen={showModal} onClose={closeModal} title={editingId ? 'Update staff profile' : 'Register new staff'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {userError && <div role="alert" className="rounded-md bg-rose-900/80 text-rose-100 p-3 text-sm">{userError}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label htmlFor="emp-name" className={labelClass}>Full name</label>
              <input id="emp-name" type="text" value={formData.name || ''} onChange={(e) => setField('name', e.target.value)} className={inputClass} required />
              {fieldError('name')}
            </div>
            <div className="space-y-1">
              <label htmlFor="emp-position" className={labelClass}>Job title</label>
              <input id="emp-position" type="text" value={formData.position || ''} onChange={(e) => setField('position', e.target.value)} className={inputClass} placeholder="e.g. Engineer" required />
              {fieldError('position')}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="emp-email" className={labelClass}>Email address</label>
            <input id="emp-email" type="email" value={formData.email || ''} onChange={(e) => setField('email', e.target.value)} className={inputClass} required />
            {fieldError('email')}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="emp-salary" className={labelClass}>Basic salary (GHS)</label>
              <input id="emp-salary" type="number" min="0" step="0.01" value={formData.basicSalary ?? ''} onChange={(e) => setField('basicSalary', e.target.value)} className={inputClass} required />
              {fieldError('basicSalary')}
            </div>
            <div className="space-y-1">
              <label htmlFor="emp-ssnit" className={labelClass}>SSNIT number</label>
              <input id="emp-ssnit" type="text" value={formData.ssnitNumber || ''} onChange={(e) => setField('ssnitNumber', e.target.value)} className={inputClass} placeholder="S123456789012" />
              {fieldError('ssnitNumber')}
            </div>
            <div className="space-y-1">
              <label htmlFor="emp-card" className={labelClass}>Ghana Card PIN</label>
              <input id="emp-card" type="text" value={formData.ghanaCardPin || ''} onChange={(e) => setField('ghanaCardPin', e.target.value)} className={inputClass} placeholder="GHA-000000000-0" />
              {fieldError('ghanaCardPin')}
            </div>
          </div>

          <div className="space-y-3 border-t border-white/5 pt-5">
            <div className="flex items-center gap-2 text-slate-400"><Wallet size={16} /><h3 className="text-xs font-bold tracking-widest">Monthly allowances (GHS)</h3></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[['housingAllowance', 'Housing'], ['transportAllowance', 'Transport'], ['otherAllowance', 'Other']].map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`emp-${key}`} className={labelClass}>{label}</label>
                  <input id={`emp-${key}`} type="number" min="0" step="0.01" value={formData[key] ?? 0} onChange={(e) => setField(key, e.target.value)} className={inputClass} />
                  {fieldError(key)}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-white/5 pt-5">
            <div className="flex items-center gap-2 text-slate-400"><Landmark size={16} /><h3 className="text-xs font-bold tracking-widest">Banking details</h3></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="emp-bank" className={labelClass}>Bank name</label>
                <input id="emp-bank" type="text" value={formData.bankName || ''} onChange={(e) => setField('bankName', e.target.value)} className={inputClass} placeholder="e.g. GCB Bank" />
                {fieldError('bankName')}
              </div>
              <div className="space-y-1">
                <label htmlFor="emp-account" className={labelClass}>Account number</label>
                <input id="emp-account" type="text" inputMode="numeric" value={formData.bankAccount || ''} onChange={(e) => setField('bankAccount', e.target.value)} className={inputClass} placeholder="5-20 digits" />
                {fieldError('bankAccount')}
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-white/5 pt-5">
            <div className="flex items-center gap-2 text-slate-400"><UsersIcon size={16} /><h3 className="text-xs font-bold tracking-widest">GRA tax relief details</h3></div>
            <p className="text-xs text-slate-500 -mt-2">These directly affect PAYE relief on every payroll run. Confirm with the employee instead of leaving defaults if any don&apos;t apply.</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label htmlFor="emp-age" className={labelClass}>Age</label>
                <input id="emp-age" type="number" min="18" max="70" value={formData.age ?? DEFAULT_RELIEF_VALUES.age} onChange={(e) => setField('age', e.target.value)} className={inputClass} />
                <p className="text-[10px] text-slate-600 ml-1">60+ qualifies for old-age relief</p>
                {fieldError('age')}
              </div>
              <div className="space-y-1">
                <label htmlFor="emp-children" className={labelClass}>Children (relief, max 3)</label>
                <input id="emp-children" type="number" min="0" max="3" value={formData.childrenCount ?? 0} onChange={(e) => setField('childrenCount', e.target.value)} className={inputClass} />
                {fieldError('childrenCount')}
              </div>
              <div className="space-y-1">
                <label htmlFor="emp-aged" className={labelClass}>Aged dependents (max 2)</label>
                <input id="emp-aged" type="number" min="0" max="2" value={formData.agedDependentsCount ?? 0} onChange={(e) => setField('agedDependentsCount', e.target.value)} className={inputClass} />
                {fieldError('agedDependentsCount')}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {[['isMarried', 'Married'], ['hasResponsibility', 'Responsible for a dependent spouse'], ['isDisabled', 'Registered disability']].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 bg-slate-950 border border-white/10 rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors">
                  <input type="checkbox" checked={!!formData[key]} onChange={(e) => setField(key, e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-primary focus:ring-primary/50" />
                  <span className="text-sm text-slate-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" disabled={saving}
            className="w-full mt-2 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60">
            {saving ? 'Saving...' : editingId ? 'Save changes' : 'Register staff'}
          </button>
        </form>
      </Modal>
    </div>
  );
};

export default Employees;
