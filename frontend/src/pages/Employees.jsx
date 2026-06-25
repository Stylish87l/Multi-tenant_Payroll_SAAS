// src/pages/Employees.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, ShieldCheck, Mail } from 'lucide-react';

import { GET_EMPLOYEES } from '../graphql/queries';
import { CREATE_EMPLOYEE, UPDATE_EMPLOYEE } from '../graphql/mutations';

import Card from '../components/Card';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { formatGHS } from '../utils/formatCurrency';

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

  // Auth context placeholder
  const companyId = '1'; 

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
  });

  // Mutations
  const [createEmployee] = useMutation(CREATE_EMPLOYEE);
  const [updateEmployee] = useMutation(UPDATE_EMPLOYEE);

  // PII Masking Helper
  const maskPII = useCallback((value, type = 'ssnit') => {
    if (!value) return 'N/A';
    const first = value.slice(0, 1);
    const last = value.slice(-4);
    return `${first}****${last}`;
  }, []);

  // Derived employees list tracking the clean backend connection items shape
  const employees = useMemo(() => data?.employees?.items ?? [], [data]);

  // Page info flags
  const hasNextPage = data?.employees?.pageInfo?.hasNextPage ?? false;

  // Error logging monitor
  useEffect(() => {
    if (error) {
      console.error('Employees query error:', error);
      setUserError('Unable to load employees. Please try again.');
    } else {
      setUserError(null);
    }
  }, [error]);

  // Edit action state hydrate handlers
  const handleEdit = useCallback((employee) => {
    setFormData({
      name: employee.name ?? '',
      email: employee.email ?? '',
      basicSalary: employee.basicSalary ?? '',
      ssnitNumber: employee.ssnitNumber ?? '',
      ghanaCardPIN: employee.ghanaCardPIN ?? '', // FIXED: Updated to uppercase PIN casing
      position: employee.position ?? 'Staff',   // FIXED: Added position property binding
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

  // Validation boundaries
  const validateForm = useCallback((input) => {
    if (!input.name || !input.email) return 'Name and email are required.';
    if (isNaN(Number(input.basicSalary)) || Number(input.basicSalary) < 0) return 'Basic salary must be a valid positive number.';
    return null;
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setUserError(null);

    const input = {
      name: formData.name,
      email: formData.email,
      basicSalary: parseFloat(formData.basicSalary || 0),
      ssnitNumber: formData.ssnitNumber,
      ghanaCardPIN: formData.ghanaCardPIN, // FIXED: Correct casing matching backend schema definition
      position: formData.position || 'Staff', // FIXED: Provided property placeholder mapping
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
      {/* Header Panel */}
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
              setFormData({ position: 'Staff' }); // Default position key assigned
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

      {/* Alert banners */}
      {userError && (
        <div role="alert" className="rounded-md bg-rose-900/80 text-rose-100 p-3 text-sm">
          {userError}
        </div>
      )}

      {/* Grid container lists */}
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
                            <ShieldCheck size={14} /> {maskPII(emp.ssnitNumber)}
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

      {/* Infinite loader indicators */}
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

      {/* Overlay Drawer Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Update Staff Profile' : 'Register New Staff'}
        ariaLabel={editingId ? 'Update staff profile modal' : 'Register new staff modal'}
      >
        <form onSubmit={handleSubmit} className="space-y-4" aria-disabled={saving}>
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
                value={formData.ghanaCardPIN || ''} // FIXED: Form field syncs seamlessly with correct casing
                onChange={(e) => setFormData({ ...formData, ghanaCardPIN: e.target.value })}
                className="w-full bg-slate-950 border border-white/10 p-3 rounded-xl text-white outline-none focus:border-primary"
                placeholder="GHA-000000000-0"
                aria-label="Ghana Card PIN"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full mt-4 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60"
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