import React, { useMemo } from 'react';
import { useQuery, useSubscription } from '@apollo/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, CreditCard, Bell, Activity, ArrowUpRight } from 'lucide-react';
import { GET_DASHBOARD_DATA } from '../graphql/queries';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from "../context/AuthContext";

const Dashboard = () => {
  const { user } = useAuth();

  // Query: fetch dashboard data scoped to tenant
  const { loading, error, data } = useQuery(GET_DASHBOARD_DATA, {
    variables: { companyId: user?.companyId },
    fetchPolicy: 'cache-and-network',
    skip: !user?.companyId, // don’t query until tenant is known
  });

  // Subscription: listen for payroll updates scoped to tenant
  useSubscription(PAYROLL_UPDATED_SUB, {
    variables: { companyId: user?.companyId },
    skip: !user?.companyId,
    onData: ({ client, data: subData }) => {
      const updatedRun = subData?.data?.payrollUpdated;
      if (!updatedRun) return;

      client.cache.modify({
        fields: {
          recentPayrollRuns(existingRuns = []) {
            return [updatedRun, ...existingRuns.filter(r => r.id !== updatedRun.id)];
          },
        },
      });
    },
  });

  // Memoize metrics to avoid recalculation on every subscription ping
  const metrics = useMemo(() => [
    {
      label: 'Total Employees',
      value: data?.employeeCount ?? 0,
      icon: Users,
      color: 'from-blue-500 to-cyan-400',
    },
    {
      label: 'Active Payroll',
      value: data?.recentPayrollRuns?.[0]?.month ?? 'Not Run',
      icon: CreditCard,
      color: 'from-emerald-500 to-teal-400',
    },
    {
      label: 'Pending Tasks',
      value: data?.pendingNotifications ?? 0,
      icon: Bell,
      color: 'from-rose-500 to-orange-400',
    },
  ], [data]);

  if (loading) return <Loader message="Syncing organization data..." />;
  if (error) {
    return (
      <div
        role="alert"
        className="p-8 text-rose-500 bg-rose-500/10 rounded-xl border border-rose-500/20"
      >
        Error: {error.message}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="safe-area-inset p-4 md:p-8 space-y-8"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Executive Summary</h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time monitoring:{" "}
            <span className="text-white font-medium">{user?.companyName}</span>
          </p>
        </div>

        <div
          aria-live="polite"
          className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-full"
        >
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-500">
            Live Sync Active
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {metrics.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card className="group relative overflow-hidden h-full">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                      {stat.label}
                    </p>
                    <p className="text-4xl font-bold text-white mt-4 tracking-tighter">
                      {stat.value}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-2xl bg-gradient-to-br ${stat.color} shadow-lg opacity-80 group-hover:opacity-100 transition-opacity`}
                  >
                    <stat.icon size={24} className="text-white" />
                  </div>
                </div>

                {/* Growth indicator mockup */}
                <div className="mt-6 flex items-center text-xs font-medium text-emerald-400">
                  <ArrowUpRight size={14} className="mr-1" />
                  <span>Update received just now</span>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Activity Monitor */}
      <Card className="bg-slate-950/20 border-white/5">
        <div className="flex items-center space-x-4 text-sm text-slate-400">
          <Activity size={18} className="text-primary animate-pulse" />
          <p>Listening for payroll state changes in the 2026 tax window…</p>
        </div>
      </Card>
    </motion.div>
  );
};

export default Dashboard;
