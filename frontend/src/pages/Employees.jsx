// src/pages/Employees.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, ShieldCheck, Mail } from 'lucide-react';
import EmployeeFormWizard from '../components/EmployeeFormWizard';

import { GET_EMPLOYEES, GET_COMPANIES } from '../graphql/queries';
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
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const companyId = isSuperAdmin ? selectedCompanyId : user?.companyId;
  const { data: companiesData } = useQuery(GET_COMPANIES, { skip: !isSuperAdmin });
  const companies = companiesData?.companies ?? [];

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
    skip: !companyId,
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
      bankCode: employee.bankCode ?? '',
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

    // HR may update permitted profile/statutory fields but cannot change existing compensation
    // or bank details. Those values are omitted before validation and mutation because the API
    // intentionally redacts them from HR reads.
    const isHrEdit = user?.role === 'HR' && Boolean(editingId);
    const validationInput = { ...formData };
    if (isHrEdit) {
      ['basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowance', 'bankName', 'bankCode', 'bankAccount']
        .forEach((key) => delete validationInput[key]);
    }
    const validationSchema = isHrEdit
      ? employeeFormSchema.omit({
        basicSalary: true, housingAllowance: true, transportAllowance: true, otherAllowance: true,
        bankName: true, bankCode: true, bankAccount: true,
      }).partial()
      : employeeFormSchema;
    const { valid, errors, data: clean } = await validateForm(validationSchema, validationInput);
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
          variables: { input: { ...input, ...(isSuperAdmin ? { companyId } : {}) } },
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
  }, [createEmployee, updateEmployee, editingId, formData, closeModal, queryVars, refetch, isSuperAdmin, companyId, user?.role]);

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
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Staff directory</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">Manage payroll profiles and tax reliefs</p>
        </div>

        <div className="flex items-center gap-2">
          {isSuperAdmin && <select aria-label="Select tenant" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="max-w-56 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"><option value="">Select tenant</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={18} aria-hidden="true" />
            <input
              type="text" placeholder="Search staff..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-primary/50 outline-none w-full md:w-64"
              aria-label="Search staff"
            />
          </div>
          <button onClick={openCreate} aria-label="Add staff" disabled={isSuperAdmin && !companyId}
            className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-primary/20 active:scale-95">
            <Plus size={18} />
            <span className="hidden md:block">Add staff</span>
          </button>
        </div>
      </div>

      {isSuperAdmin && !companyId && <Card className="border-dashed border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/30 p-8 text-center text-slate-600 dark:text-slate-400">Select an organisation before adding or viewing staff.</Card>}

      {userError && !showModal && (
        <div role="alert" className="rounded-md bg-rose-900/80 text-rose-100 p-3 text-sm">{userError}</div>
      )}

      {companyId && <div className="grid grid-cols-1 gap-4">
        <AnimatePresence>
          {employees.length === 0 && !loading ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card className="p-6 text-center"><p className="text-slate-600 dark:text-slate-400">No staff found. Add your first staff member.</p></Card>
            </motion.div>
          ) : (
            employees.map((emp, idx) => (
              <motion.div key={emp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx, 10) * 0.03 }}>
                <Card className="hover:border-primary/30 transition-all group">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center border border-slate-200 dark:border-white/10 text-white font-bold">
                        {emp.name ? emp.name.charAt(0) : '?'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">{emp.name}</h2>
                          {emp.position && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-medium">{emp.position}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 mt-1">
                          <span className="flex items-center gap-1"><Mail size={14} /> {emp.email}</span>
                          <span className="hidden md:flex items-center gap-1 text-slate-500"><ShieldCheck size={14} /> {maskPII(emp.ghanaCardPin)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 border-slate-200 dark:border-white/5 pt-4 md:pt-0">
                      {['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(user?.role) ? (
                        <div className="text-left md:text-right">
                          <p className="text-[10px] font-bold text-slate-500 tracking-widest">Basic salary</p>
                          <p className="text-lg font-bold text-emerald-400 font-mono">{formatGHS(emp.basicSalary)}</p>
                        </div>
                      ) : (
                        <div className="text-left md:text-right">
                          <p className="text-[10px] font-bold text-slate-500 tracking-widest">Compensation</p>
                          <p className="text-xs font-medium text-slate-500">Restricted by role</p>
                        </div>
                      )}
                      <button onClick={() => handleEdit(emp)} aria-label={`Edit ${emp.name}`}
                        className="p-3 bg-white/5 hover:bg-primary/20 text-slate-700 dark:text-slate-300 hover:text-primary rounded-xl transition-all active:scale-90">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>}

      {companyId && hasNextPage && (
        <div className="flex justify-center mt-4">
          <button onClick={loadNextPage} disabled={loading} className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}

      <Modal isOpen={showModal && !!companyId} onClose={closeModal} title={editingId ? 'Update employee profile' : 'Add a new employee'} size="xl">
        <EmployeeFormWizard
          key={editingId || 'new-employee'}
          formData={formData}
          setField={setField}
          fieldError={fieldError}
          userError={userError}
          saving={saving}
          editingId={editingId}
          role={user?.role}
          onSubmit={handleSubmit}
          onCancel={closeModal}
        />
      </Modal>
    </div>
  );
};

export default Employees;
