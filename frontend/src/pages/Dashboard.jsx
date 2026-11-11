import React, { useMemo } from 'react';
import { useQuery, useSubscription } from '@apollo/client';
import { motion } from 'framer-motion';
import { Users, CreditCard, Bell, Activity } from 'lucide-react';
import { GET_DASHBOARD_DATA } from '../graphql/queries';
import { PAYROLL_UPDATED_SUB } from '../graphql/subscriptions';
import Card from '../components/Card';
import Loader from '../components/Loader';
import { useAuth } from '../context/AuthContext';

const Dashboard = () => {
  const { user } = useAuth();

  // SUPER_ADMIN's JWT has no tenant; their companyId comes from the navbar tenant switcher (or their platform company).
  const canQuery = user?.role === 'SUPER_ADMIN' || !!user?.companyId;

  const { loading, error, data, refetch } = useQuery(GET_DASHBOARD_DATA, {
    variables: { companyId: user?.companyId || null },
    fetchPolicy: 'cache-and-network',
    skip: !canQuery,
  });

  // The subscription payload is partial and un-normalised; writing it into the cache by hand produced
  // "missing field" warnings. A refetch keeps the dashboard exactly in sync with the server.
  useSubscription(PAYROLL_UPDATED_SUB, {
    variables: { companyId: user?.companyId },
    skip: !user?.companyId,
    onData: () => { refetch().catch(() => {}); },
  });

  const metrics = useMemo(() => [
    { label: 'Total employees', value: data?.stats ?? 0, icon: Users, color: 'from-blue-500 to-cyan-400' },
    { label: 'Latest payroll', value: data?.recentRuns?.[0] ? String(data.recentRuns[0].month).slice(0, 7) : 'Not run', icon: CreditCard, color: 'from-emerald-500 to-teal-400' },
    { label: 'Unread notifications', value: data?.notificationsCount ?? 0, icon: Bell, color: 'from-rose-500 to-orange-400' },
  ], [data]);

  // `loading && !data`: with cache-and-network, `loading` is true on every background refetch and used to
  // replace the whole dashboard with a spinner each time.
  if (loading && !data) return <Loader message="Loading your organization..." />;
  if (error && !data) {
    return <div role="alert" className="p-8 text-rose-500 bg-rose-500/10 rounded-xl border border-rose-500/20">Error: {error.message}</div>;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="safe-area-inset p-4 md:p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          {user?.role === 'SUPER_ADMIN' ? 'Viewing: ' : 'Organization: '}
          <span className="text-white font-medium">{user?.companyName || '—'}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {metrics.map((stat, idx) => (
          <motion.div key={stat.label} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}>
            <Card className="group relative overflow-hidden h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold tracking-wider text-slate-500">{stat.label}</p>
                  <p className="text-4xl font-bold text-white mt-4 tracking-tighter">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-2xl bg-gradient-to-br ${stat.color} shadow-lg opacity-80 group-hover:opacity-100 transition-opacity`}>
                  <stat.icon size={24} className="text-white" />
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="bg-slate-950/20 border-white/5">
        <div className="flex items-center space-x-4 text-sm text-slate-400">
          <Activity size={18} className="text-primary" />
          <p>This page updates automatically when a payroll run changes.</p>
        </div>
      </Card>
    </motion.div>
  );
};

export default Dashboard;
