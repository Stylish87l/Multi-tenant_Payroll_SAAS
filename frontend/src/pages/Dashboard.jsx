import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useSubscription } from '@apollo/client';
import { motion } from 'framer-motion';
import {
  Activity, ArrowRight, Bell, CalendarDays, CheckCircle2, Clock3,
  CreditCard, FileText, RefreshCw, Users,
} from 'lucide-react';
import { GET_DASHBOARD_DATA } from '../graphql/queries';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';
import { getMyPayslips } from '../services/payslipService';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';

const money = (value) => Number(value ?? 0).toLocaleString('en-GH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const periodLabel = (value) => {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 7)}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 7)
    : date.toLocaleDateString('en-GH', { month: 'long', year: 'numeric' });
};

const MetricCard = ({ label, value, icon: Icon, tone = 'blue', detail }) => {
  const tones = {
    blue: 'bg-blue-500/10 text-blue-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-300',
    rose: 'bg-rose-500/10 text-rose-300',
  };

  return (
    <Card className="group h-full border-white/5 bg-slate-950/40">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-3 break-words text-3xl font-bold tracking-tight text-white">{value}</p>
          {detail && <p className="mt-2 text-xs text-slate-400">{detail}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tones[tone] || tones.blue}`}>
          <Icon size={21} />
        </div>
      </div>
    </Card>
  );
};

const Dashboard = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isEmployee = role === 'EMPLOYEE';
  const canQueryOrganization = role === 'SUPER_ADMIN' || Boolean(user?.companyId);

  const { loading, error, data, refetch } = useQuery(GET_DASHBOARD_DATA, {
    variables: { companyId: user?.companyId || null },
    fetchPolicy: 'cache-and-network',
    skip: !canQueryOrganization,
  });

  // The subscription payload is partial; refetch the dashboard instead of writing incomplete
  // payroll objects into Apollo's normalized cache.
  useSubscription(PAYROLL_UPDATED_SUB, {
    variables: { companyId: user?.companyId },
    skip: isEmployee || !user?.companyId,
    onData: () => { refetch().catch(() => {}); },
  });

  const [myPayslips, setMyPayslips] = useState([]);
  const [payslipsLoading, setPayslipsLoading] = useState(isEmployee);
  const [payslipsError, setPayslipsError] = useState('');

  const loadMyPayslips = useCallback(async (signal) => {
    if (!isEmployee) return;
    setPayslipsLoading(true);
    setPayslipsError('');
    try {
      setMyPayslips(await getMyPayslips({ signal }));
    } catch (err) {
      if (err.name !== 'AbortError') setPayslipsError(err.message || 'Unable to load your payroll summary.');
    } finally {
      if (!signal?.aborted) setPayslipsLoading(false);
    }
  }, [isEmployee]);

  useEffect(() => {
    if (!isEmployee) return undefined;
    const controller = new AbortController();
    loadMyPayslips(controller.signal);
    return () => controller.abort();
  }, [isEmployee, loadMyPayslips]);

  const latestPayslip = myPayslips[0] || null;
  const notificationsCount = data?.notificationsCount ?? 0;

  const organizationMetrics = useMemo(() => {
    const stats = [];
    if (['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT'].includes(role)) {
      stats.push({
        label: 'Total employees',
        value: data?.stats ?? '—',
        icon: Users,
        tone: 'blue',
        detail: 'Employees in the selected organisation',
      });
    }
    if (['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(role)) {
      const latestRun = data?.recentRuns?.[0];
      stats.push({
        label: 'Latest payroll',
        value: latestRun ? periodLabel(latestRun.month) : (loading ? 'Loading…' : 'No finalized run'),
        icon: CreditCard,
        tone: 'emerald',
        detail: latestRun?.status ? `Status: ${String(latestRun.status).toLowerCase()}` : 'Finalized payroll activity',
      });
    }
    stats.push({
      label: 'Unread notifications',
      value: data?.notificationsCount ?? (loading ? '…' : '—'),
      icon: Bell,
      tone: 'rose',
      detail: 'Notifications for your account',
    });
    return stats;
  }, [role, data, loading]);

  if (isEmployee && payslipsLoading && myPayslips.length === 0) {
    return <Loader message="Loading your personal dashboard..." />;
  }

  if (!isEmployee && loading && !data) {
    return <Loader message="Loading your organisation..." />;
  }

  const displayName = user?.name?.trim()?.split(/\s+/)[0] || 'there';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="safe-area-inset space-y-7 p-4 pb-24 md:p-8"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">{isEmployee ? 'Employee workspace' : 'Organisation overview'}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            {isEmployee ? `Welcome back, ${displayName}` : 'Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {isEmployee
              ? 'Your pay, payslips and account notifications in one place.'
              : `${role === 'SUPER_ADMIN' ? 'Viewing' : 'Organisation'}: ${user?.companyName || '—'}`}
          </p>
        </div>
        {isEmployee && (
          <Link
            to="/payslips"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <FileText size={16} /> View payslips <ArrowRight size={15} />
          </Link>
        )}
      </header>

      {isEmployee ? (
        <>
          {payslipsError && (
            <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
              {payslipsError}
              <button type="button" onClick={() => loadMyPayslips()} className="ml-2 underline">Try again</button>
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Personal payroll summary">
            <MetricCard
              label="Latest net pay"
              value={latestPayslip ? `GHS ${money(latestPayslip.netPay)}` : '—'}
              icon={CreditCard}
              tone="emerald"
              detail={latestPayslip ? periodLabel(latestPayslip.month) : 'Appears after payroll is finalized'}
            />
            <MetricCard
              label="Available payslips"
              value={myPayslips.length}
              icon={FileText}
              tone="blue"
              detail="Finalized payroll statements"
            />
            <MetricCard
              label="Unread notifications"
              value={notificationsCount}
              icon={Bell}
              tone="rose"
              detail="Personal account notifications"
            />
          </section>

          <Card className="border-white/5 bg-slate-950/30">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary/10 p-3 text-primary"><CalendarDays size={20} /></div>
                <div>
                  <h2 className="font-semibold text-white">Latest payslip</h2>
                  {latestPayslip ? (
                    <>
                      <p className="mt-1 text-sm text-slate-400">{periodLabel(latestPayslip.month)}</p>
                      <p className="mt-2 text-xl font-bold text-white">GHS {money(latestPayslip.netPay)}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-slate-400">
                      No finalized payslip is available yet. Your statement will appear here after your employer finalizes payroll.
                    </p>
                  )}
                </div>
              </div>
              {latestPayslip && (
                <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${['PAID', 'SENT'].includes(latestPayslip.paymentStatus) ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                  {['PAID', 'SENT'].includes(latestPayslip.paymentStatus) ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                  {String(latestPayslip.paymentStatus || 'PENDING').replaceAll('_', ' ')}
                </span>
              )}
            </div>
            <div className="mt-5 border-t border-white/5 pt-4">
              <Link to="/payslips" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80">
                Open payslip history <ArrowRight size={15} />
              </Link>
            </div>
          </Card>

          <Card className="border-white/5 bg-slate-950/20">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Activity size={18} className="text-primary" />
              <p>Your dashboard only shows your own finalized payroll records and personal notifications.</p>
            </div>
          </Card>
        </>
      ) : (
        <>
          {error && !data && (
            <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
              Unable to load dashboard data: {error.message}
            </div>
          )}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Organisation metrics">
            {organizationMetrics.map((stat, index) => (
              <motion.div key={stat.label} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: index * 0.08 }}>
                <MetricCard {...stat} />
              </motion.div>
            ))}
          </section>
          <Card className="border-white/5 bg-slate-950/20">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Activity size={18} className="text-primary" />
              <p>Organisation metrics are restricted by your role and scoped to the selected tenant.</p>
              {loading && <RefreshCw size={14} className="ml-auto animate-spin" aria-label="Refreshing" />}
            </div>
          </Card>
        </>
      )}
    </motion.div>
  );
};

export default Dashboard;
