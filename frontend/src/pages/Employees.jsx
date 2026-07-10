// src/pages/Employees.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, ShieldCheck, Mail, Landmark, Users as UsersIcon } from 'lucide-react';

import { GET_EMPLOYEES } from '../graphql/queries';
import { CREATE_EMPLOYEE, UPDATE_EMPLOYEE } from '../graphql/mutations';

import Card from '../components/Card';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { formatGHS } from '../utils/formatCurrency';
import { useAuth } from '../context/AuthContext';

// FIXED (2026-07-05): these are the defaults a brand-new employee record
// gets on the Prisma side (schema.prisma: age @default(30), isMarried
// @default(false), childrenCount @default(0), etc). Centralizing them here
// means "Add Staff" pre-fills the form with the same values the DB would
// have used anyway - previously the form simply never asked for any of
// these, silently locking every employee created through the UI into
// "30-year-old, unmarried, no children, not disabled" for PAYE relief
// purposes regardless of their actual circumstances.
const DEFAULT_RELIEF_VALUES = {
  age: 30,
  isMarried: false,
  hasResponsibility: false,
  childrenCount: 0,
  isDisabled: false,
  agedDependentsCount: 0,
};

const Employees = () => {
  // State management
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 50;

  // Local UI state
  const [saving, setSaving] = useState(false);
  const [userError, setUserError] = useState(null);

  // Authenticated user tenant context
  const { user } = useAuth();
  const companyId = user?.companyId;

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Query execution
  const { loading, error, data, fetchMore, refetch } = useQuery(GET_EMPLOYEES, {
    variables: { companyId, page, limit, search: debouncedSearch },
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
    notifyOnNetworkStatusChange: true,
    skip: !companyId && user?.role !== 'SUPER_ADMIN',
  });

  // Mutations
  const [createEmployee] = useMutation(CREATE_EMPLOYEE);
  const [updateEmployee] = useMutation(UPDATE_EMPLOYEE);

  // PII Masking Helper
  const maskPII = useCallback((value) => {
    if (!value) return 'N/A';
    const first = value.slice(0, 1);
    const last = value.slice(-4);
    return `${first}****${last}`;
  }, []);

  const employees = useMemo(() => data?.employees?.items ?? [], [data]);
  const hasNextPage = data?.employees?.pageInfo?.hasNextPage ?? false;

  useEffect(() => {
    if (error) {
      console.error('Employees query error:', error);
      setUserError('Unable to load employees. Please try again.');
    } else {
      setUserError(null);
    }
  }, [error]);

  // FIXED (2026-07-05): now also pulls the relief + banking fields back
  // into the edit form. Previously "editing" an employee only ever
  // touched name/email/basicSalary/ssnit/ghanaCard/position - the relief
  // fields simply weren't part of formData, so submitting an edit could
  // never change them, and (before the resolver fix) would have silently
  // reset them regardless of what was already saved.
  const handleEdit = useCallback((employee) => {
    setFormData({
      name: employee.name ?? '',
      email: employee.email ?? '',
      basicSalary: employee.basicSalary ?? '',
      ssnitNumber: employee.ssnitNumber ?? '',
      ghanaCardPin: employee.ghanaCardPin ?? '',
      position: employee.position ?? 'Staff',
      bankName: employee.bankName ?? '',
      bankAccount: employee.bankAccount ?? '',
      age: employee.age ?? DEFAULT_RELIEF_VALUES.age,
      isMarried: employee.isMarried ?? DEFAULT_RELIEF_VALUES.isMarried,
      hasResponsibility: employee.hasResponsibility ?? DEFAULT_RELIEF_VALUES.hasResponsibility,
      childrenCount: employee.childrenCount ?? DEFAULT_RELIEF_VALUES.childrenCount,
      isDisabled: employee.isDisabled ?? DEFAULT_RELIEF_VALUES.isDisabled,
      agedDependentsCount: employee.agedDependentsCount ?? DEFAULT_RELIEF_VALUES.agedDependentsCount,
    });
    setEditingId(employee.id);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setFormData({});
    setEditingId(null);
    setSaving(false);
  }, []);

  const validateForm = useCallback((input) => {
    if (!input.name || !input.email) return 'Name and email are required.';
    if (isNaN(Number(input.basicSalary)) || Number(input.basicSalary) < 0) return 'Basic salary must be a valid positive number.';
    if (input.age !== undefined && (isNaN(Number(input.age)) || Number(input.age) < 18 || Number(input.age) > 70)) {
      return 'Age must be between 18 and 70.';
    }
    if (input.childrenCount !== undefined && (Number(input.childrenCount) < 0 || Number(input.childrenCount) > 3)) {
      return 'Children count for relief purposes cannot exceed 3 (GRA cap).';
    }
    if (input.agedDependentsCount !== undefined && (Number(input.agedDependentsCount) < 0 || Number(input.agedDependentsCount) > 2)) {
      return 'Aged dependents for relief purposes cannot exceed 2 (GRA cap).';
    }
    return null;
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setUserError(null);

    // FIXED (2026-07-05): input now carries the full set of GRA
    // relief fields plus banking details through to createEmployee/
    // updateEmployee - these are the exact fields typeDefs.js's
    // EmployeeInput/UpdateEmployeeInput already declared, but which the
    // form never collected and the resolvers never persisted.
    const input = {
      name: formData.name,
      email: formData.email,
      basicSalary: parseFloat(formData.basicSalary || 0),
      ssnitNumber: formData.ssnitNumber,
      ghanaCardPin: formData.ghanaCardPin,
      position: formData.position || 'Staff',
      bankName: formData.bankName || undefined,
      bankAccount: formData.bankAccount || undefined,
      age: formData.age !== undefined && formData.age !== '' ? Number(formData.age) : DEFAULT_RELIEF_VALUES.age,
      isMarried: !!formData.isMarried,
      hasResponsibility: !!formData.hasResponsibility,
      childrenCount: formData.childrenCount !== undefined && formData.childrenCount !== '' ? Number(formData.childrenCount) : DEFAULT_RELIEF_VALUES.childrenCount,
      isDisabled: !!formData.isDisabled,
      agedDependentsCount: formData.agedDependentsCount !== undefined && formData.agedDependentsCount !== '' ? Number(formData.agedDependentsCount) : DEFAULT_RELIEF_VALUES.agedDependentsCount,
    };

    const validationError = validateForm(input);
    if (validationError) {
      setUserError(validationError);
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await updateEmployee({
          variables: { id: editingId, input },
          optimisticResponse: {
            updateEmployee: {
              __typename: 'Employee',
              id: editingId,
              companyId,
              isActive: true,
              ...input,
            },
          },
          update: (cache, { data: mutationData }) => {
            try {
              const queryVars = { companyId, page, limit, search: debouncedSearch };
              const existing = cache.readQuery({ query: GET_EMPLOYEES, variables: queryVars });
              
              if (!existing?.employees?.items) return;

              const updatedItems = existing.employees.items.map((emp) =>
                emp.id === editingId ? mutationData.updateEmployee : emp
              );

              cache.writeQuery({
                query: GET_EMPLOYEES,
                variables: queryVars,
                data: {
                  employees: {
                    ...existing.employees,
                    items: updatedItems,
                  },
                },
              });
            } catch (err) {
              console.warn('Cache update failed for updateEmployee', err);
            }
          },
        });
      } else {
        const tempId = `temp-${Date.now()}`;
        await createEmployee({
          variables: { input },
          optimisticResponse: {
            createEmployee: {
              __typename: 'Employee',
              id: tempId,
              companyId,
              isActive: true,
              ...input,
            },
          },
          update: (cache, { data: mutationData }) => {
            try {
              const queryVars = { companyId, page, limit, search: debouncedSearch };
              const existing = cache.readQuery({ query: GET_EMPLOYEES, variables: queryVars });
              
              const newEmployee = mutationData.createEmployee;
              if (existing?.employees?.items) {
                cache.writeQuery({
                  query: GET_EMPLOYEES,
                  variables: queryVars,
                  data: {
                    employees: {
                      ...existing.employees,
                      items: [newEmployee, ...existing.employees.items],
                    },
                  },
                });
              }
            } catch (err) {
              console.warn('Cache update failed for createEmployee', err);
            }
          },
        });
      }

      closeModal();
      refetch();
    } catch (mutationError) {
      console.error('Mutation error:', mutationError);
      setUserError('Failed to save employee. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [createEmployee, updateEmployee, editingId, formData, validateForm, closeModal, companyId, page, limit, debouncedSearch, refetch]);

  const loadNextPage = useCallback(() => {
    const next = page + 1;
    setPage(next);
    fetchMore({
      variables: { companyId, page: next, limit, search: debouncedSearch },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult) return prev;
        return {
          employees: {
            ...fetchMoreResult.employees,
            items: [...prev.employees.items, ...fetchMoreResult.employees.items],
          },
        };
      },
    }).catch((err) => {
      console.warn('fetchMore error', err);
    });
  }, [page, fetchMore, limit, debouncedSearch, companyId]);

  if (loading && !data) return <Loader message="Decrypting employee records..." />;

  return (
    <div className="safe-area-inset p-4 md:p-8 space-y-6 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Staff Directory</h1>
          <p className="text-slate-400 text-sm">Manage payroll profiles and tax reliefs</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative group">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors"
              size={18}
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-900/50 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-primary/50 outline-none w-full md:w-64"
              aria-label="Search staff"
            />
          </div>

          <button
            onClick={() => {
              setFormData({ position: 'Staff', ...DEFAULT_RELIEF_VALUES });
              setEditingId(null);
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-primary/20 active:scale-95"
            aria-label="Add staff"
          >
            <Plus size={18} />
            <span className="hidden md:block">Add Staff</span>
          </button>
        </div>
      </div>

      {userError && (
        <div role="alert" className="rounded-md bg-rose-900/80 text-rose-100 p-3 text-sm">
          {userError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence>
          {employees.length === 0 && !loading ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card className="p-6 text-center">
                <p className="text-slate-400">No staff found. Add your first staff member.</p>
              </Card>
            </motion.div>
          ) : (
            employees.map((emp, idx) => (
              <motion.div
                key={emp.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
              >
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
                            <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 font-medium">
                              {emp.position}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                          <span className="flex items-center gap-1"><Mail size={14} /> {emp.email}</span>
                          <span className="hidden md:flex items-center gap-1 text-slate-500">
                            <ShieldCheck size={14} /> {maskPII(emp.ghanaCardPin)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 border-white/5 pt-4 md:pt-0">
                      <div className="text-left md:text-right">
                        <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Basic Salary</p>
                        <p className="text-lg font-bold text-emerald-400 font-mono">{formatGHS(emp.basicSalary)}</p>
                      </div>
                      <button
                        onClick={() => handleEdit(emp)}
                        className="p-3 bg-white/5 hover:bg-primary/20 text-slate-300 hover:text-primary rounded-xl transition-all active:scale-90"
                        aria-label={`Edit ${emp.name}`}
                      >
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
          <button
            onClick={loadNextPage}
            className="px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Update Staff Profile' : 'Register New Staff'}
        ariaLabel={editingId ? 'Update staff profile modal' : 'Register new staff modal'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-6" aria-disabled={saving}>
          {/* --- Identity --- */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Full Name</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                required
                aria-required="true"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Job Title / Position</label>
              <input
                type="text"
                value={formData.position || ''}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                placeholder="e.g. Engineer"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email Address</label>
            <input
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
              required
              aria-required="true"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Basic Salary (GHS)</label>
              <input
                type="number"
                value={formData.basicSalary || ''}
                onChange={(e) => setFormData({ ...formData, basicSalary: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                required
                aria-required="true"
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">SSNIT Number</label>
              <input
                type="text"
                value={formData.ssnitNumber || ''}
                onChange={(e) => setFormData({ ...formData, ssnitNumber: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                placeholder="S123456789012"
                aria-label="SSNIT number"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Ghana Card PIN</label>
              <input
                type="text"
                value={formData.ghanaCardPin || ''}
                onChange={(e) => setFormData({ ...formData, ghanaCardPin: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                placeholder="GHA-000000000-0"
                aria-label="Ghana Card PIN"
              />
            </div>
          </div>

          {/* --- Banking --- */}
          <div className="space-y-3 border-t border-white/5 pt-5">
            <div className="flex items-center gap-2 text-slate-400">
              <Landmark size={16} />
              <h3 className="text-xs font-bold uppercase tracking-widest">Banking Details</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Bank Name</label>
                <input
                  type="text"
                  value={formData.bankName || ''}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                  placeholder="e.g. GCB Bank"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Account Number</label>
                <input
                  type="text"
                  value={formData.bankAccount || ''}
                  onChange={(e) => setFormData({ ...formData, bankAccount: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                  placeholder="5-20 digits"
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>

          {/* --- GRA Tax Relief --- */}
          <div className="space-y-3 border-t border-white/5 pt-5">
            <div className="flex items-center gap-2 text-slate-400">
              <UsersIcon size={16} />
              <h3 className="text-xs font-bold uppercase tracking-widest">GRA Tax Relief Details</h3>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              These directly affect PAYE relief calculated on every payroll run - please confirm with the employee rather than leaving defaults if any of these don't apply.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Age</label>
                <input
                  type="number"
                  value={formData.age ?? DEFAULT_RELIEF_VALUES.age}
                  onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                  min="18"
                  max="70"
                />
                <p className="text-[10px] text-slate-600 ml-1">60+ qualifies for old-age relief</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Children (relief, max 3)</label>
                <input
                  type="number"
                  value={formData.childrenCount ?? DEFAULT_RELIEF_VALUES.childrenCount}
                  onChange={(e) => setFormData({ ...formData, childrenCount: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                  min="0"
                  max="3"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Aged Dependents (max 2)</label>
                <input
                  type="number"
                  value={formData.agedDependentsCount ?? DEFAULT_RELIEF_VALUES.agedDependentsCount}
                  onChange={(e) => setFormData({ ...formData, agedDependentsCount: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                  min="0"
                  max="2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {[
                { key: 'isMarried', label: 'Married' },
                { key: 'hasResponsibility', label: 'Responsible for a dependent spouse' },
                { key: 'isDisabled', label: 'Registered disability' },
              ].map((toggle) => (
                <label
                  key={toggle.key}
                  className="flex items-center gap-3 bg-slate-950 border border-white/10 rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={!!formData[toggle.key]}
                    onChange={(e) => setFormData({ ...formData, [toggle.key]: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-slate-900 text-primary focus:ring-primary/50"
                  />
                  <span className="text-sm text-slate-300">{toggle.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full mt-2 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60"
            disabled={saving}
            aria-disabled={saving}
          >
            {saving ? 'Saving...' : (editingId ? 'Synchronize Updates' : 'Confirm Registration')}
          </button>
        </form>
      </Modal>
    </div>
  );
};

export default Employees;