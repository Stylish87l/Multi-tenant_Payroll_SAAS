import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Briefcase, Check, CreditCard, Landmark,
  ShieldCheck, UserRound, Wallet,
} from 'lucide-react';

const inputClass = 'mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3.5 py-3 text-sm text-white placeholder:text-slate-600 transition focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15';
const labelClass = 'block text-xs font-semibold text-slate-300';
const helpClass = 'mt-1 text-[11px] leading-4 text-slate-500';

const EmployeeFormWizard = ({
  formData, setField, fieldError, userError, saving, editingId, role, onSubmit, onCancel,
}) => {
  const [step, setStep] = useState(0);
  const isHr = role === 'HR';
  const canManageCompensation = !isHr || !editingId;
  const canManageBank = ['SUPER_ADMIN', 'ADMIN'].includes(role);
  const steps = useMemo(() => [
    { id: 'profile', label: 'Profile', caption: 'Personal & employment', icon: UserRound },
    ...(canManageCompensation ? [{ id: 'pay', label: 'Compensation', caption: 'Salary & allowances', icon: Wallet }] : []),
    ...(canManageBank ? [{ id: 'bank', label: 'Banking', caption: 'Payment destination', icon: Landmark }] : []),
    { id: 'statutory', label: 'Statutory', caption: 'SSNIT & PAYE details', icon: ShieldCheck },
  ], [canManageCompensation, canManageBank]);

  const current = steps[step];
  const set = (key) => (event) => setField(key, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
  const field = (key, label, props = {}, hint = '') => (
    <div className="min-w-0">
      <label className={labelClass} htmlFor={`employee-${key}`}>{label}{props.required && <span className="ml-1 text-rose-400">*</span>}</label>
      <input id={`employee-${key}`} className={inputClass} value={formData[key] ?? ''} onChange={set(key)} {...props} />
      {hint && <p className={helpClass}>{hint}</p>}
      {fieldError(key)}
    </div>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Employee onboarding</p>
            <h3 className="mt-1 text-base font-semibold text-white">{editingId ? 'Update employee details' : 'Build an employee profile'}</h3>
            <p className="mt-1 text-xs text-slate-500">Step {step + 1} of {steps.length} · Complete the sections below</p>
          </div>
          <div className="hidden h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex"><current.icon size={20}/></div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((item, index) => {
            const Icon = item.icon;
            const active = index === step;
            const complete = index < step;
            return (
              <button key={item.id} type="button" onClick={() => setStep(index)} aria-current={active ? 'step' : undefined}
                className={`flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left transition ${active ? 'bg-primary/10 text-white ring-1 ring-primary/25' : complete ? 'text-primary hover:bg-white/5' : 'text-slate-500 hover:bg-white/5'}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-primary text-white' : complete ? 'bg-primary/15 text-primary' : 'bg-white/5'}`}>{complete ? <Check size={14}/> : <Icon size={14}/>}</span>
                <span className="hidden min-w-0 sm:block"><span className="block truncate text-[11px] font-semibold">{item.label}</span><span className="block truncate text-[9px] opacity-60">{item.caption}</span></span>
              </button>
            );
          })}
        </div>
      </div>

      {userError && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{userError}</div>}

      <section className="space-y-4" aria-labelledby="employee-step-title">
        <div>
          <h4 id="employee-step-title" className="text-sm font-semibold text-white">{current.label}</h4>
          <p className="mt-1 text-xs text-slate-500">{current.caption}</p>
        </div>

        {current.id === 'profile' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('name', 'Full legal name', { type: 'text', autoComplete: 'name', required: true, placeholder: 'e.g. Ama Mensah' })}
              {field('position', 'Job title', { type: 'text', required: true, placeholder: 'e.g. Finance Officer' })}
            </div>
            {field('email', 'Work email address', { type: 'email', autoComplete: 'email', required: true, placeholder: 'name@company.com' }, 'Used to match the employee profile to their Paylio login.')}
            <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-3 text-xs leading-5 text-slate-300"><Briefcase size={15} className="mr-2 inline text-sky-300"/>Use the employee’s official name and work email. The email should match their account email if they already have a Paylio login.</div>
          </>
        )}

        {current.id === 'pay' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('basicSalary', 'Basic monthly salary (GHS)', { type: 'number', min: '0', step: '0.01', inputMode: 'decimal', required: true, placeholder: '0.00' }, 'Enter the agreed monthly basic salary before deductions.')}
              <div className="rounded-xl border border-primary/15 bg-primary/5 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-primary">Indicative gross pay</p><p className="mt-2 text-2xl font-semibold tabular-nums text-white">GHS {(['basicSalary','housingAllowance','transportAllowance','otherAllowance'].reduce((sum, key) => sum + (Number(formData[key]) || 0), 0)).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="mt-1 text-[10px] text-slate-500">Basic salary plus listed allowances, before statutory deductions.</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {field('housingAllowance', 'Housing allowance (GHS)', { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' })}
              {field('transportAllowance', 'Transport allowance (GHS)', { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' })}
              {field('otherAllowance', 'Other allowance (GHS)', { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' })}
            </div>
            <p className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">Check that each allowance reflects the employee’s approved compensation. These values feed into payroll calculations.</p>
          </>
        )}

        {current.id === 'bank' && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400"><CreditCard size={15} className="mr-2 inline text-primary"/>Enter the employee’s verified account details. Do not guess a bank or provider code.</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('bankName', 'Bank name', { type: 'text', autoComplete: 'off', placeholder: 'e.g. GCB Bank' })}
              {field('bankCode', 'Bank / payout provider code', { type: 'text', placeholder: 'Provider code' }, 'Use the code required by your configured payout provider.')}
              <div className="sm:col-span-2">{field('bankAccount', 'Account number', { type: 'text', inputMode: 'numeric', autoComplete: 'off', placeholder: 'Enter verified account number' })}</div>
            </div>
          </>
        )}

        {current.id === 'statutory' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('ssnitNumber', 'SSNIT number', { type: 'text', autoComplete: 'off', placeholder: '13-character SSNIT number' })}
              {field('ghanaCardPin', 'Ghana Card PIN', { type: 'text', autoComplete: 'off', placeholder: 'GHA-XXXXXXXXX-X' })}
            </div>
            <div className="border-t border-white/10 pt-4">
              <div className="mb-3"><h5 className="text-sm font-semibold text-white">PAYE relief profile</h5><p className="mt-1 text-xs text-slate-500">Confirm these details with the employee. They can affect PAYE calculations.</p></div>
              <div className="grid gap-4 sm:grid-cols-3">
                {field('age', 'Age', { type: 'number', min: '18', max: '70', step: '1' }, 'Current form validation accepts ages 18–70.')}
                {field('childrenCount', 'Qualifying children', { type: 'number', min: '0', max: '3', step: '1' }, 'Current relief profile limit: 3.')}
                {field('agedDependentsCount', 'Aged dependants', { type: 'number', min: '0', max: '2', step: '1' }, 'Current relief profile limit: 2.')}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  ['isMarried', 'Married'],
                  ['hasResponsibility', 'Responsible for a dependent spouse'],
                  ['isDisabled', 'Registered disability'],
                ].map(([key, label]) => (
                  <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-xs text-slate-300 hover:border-primary/30">
                    <input type="checkbox" checked={!!formData[key]} onChange={set(key)} className="h-4 w-4 rounded border-white/20 bg-slate-900 text-primary focus:ring-primary"/>
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-100/80"><ShieldCheck size={15} className="mr-2 inline"/>Sensitive identifiers are protected by role-based access controls. Only enter details that your role is authorized to manage.</div>
          </>
        )}
      </section>

      <div className="sticky bottom-0 -mx-5 flex items-center justify-between gap-3 border-t border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || saving}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft size={15}/> Back</button>
          <button type="button" onClick={onCancel} disabled={saving}
            className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40">Cancel</button>
        </div>
        {step < steps.length - 1 ? (
          <button type="button" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/15 transition hover:brightness-110">Continue <ArrowRight size={15}/></button>
        ) : (
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{saving ? 'Saving profile…' : editingId ? 'Save changes' : 'Create employee'} <Check size={16}/></button>
        )}
      </div>
    </form>
  );
};

export default EmployeeFormWizard;
