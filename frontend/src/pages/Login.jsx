import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
// 1. Import useAuth instead of useMutation
import { useAuth } from '../context/AuthContext'; 
import Card from '../components/Card';
import Loader from '../components/Loader';
import Modal from '../components/Modal';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Local loading state for mock

  const navigate = useNavigate();
  // 2. Get the mocked login function from our context
  const { login } = useAuth(); 

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setIsSubmitting(true);
    setError(null);

    // 3. Call the context login (which is mocked)
    const result = await login({ email, password });

    if (result.success) {
      setPassword('');
      navigate('/dashboard', { replace: true });
    } else {
      setPassword('');
      setError(result.message || 'Invalid email or password. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 flex items-center justify-center p-4">
      {/* Background Decorative Glows */}
      <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-secondary/10 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <Card className="border-white/10 bg-slate-900/60 backdrop-blur-2xl shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Lock size={28} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Welcome Back</h2>
            <p className="mt-2 text-sm text-slate-400">Login to manage your payroll</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Input */}
            <div className="space-y-2">
              <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-500 ml-1">
                Corporate Email
              </label>
              <div className="relative group">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={18} />
                <input
               id="email"
               name="email" // Added name
               type="email"
               autoComplete="username" // Added for password managers
               value={email}
               onChange={(e) => setEmail(e.target.value)}
               className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
               placeholder="name@company.com"
               required
               />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Password
                </label>
                <button type="button" className="text-xs text-primary hover:underline">Forgot?</button>
              </div>
              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-primary transition-colors" size={18} />
                <input
                id="password"
                name="password" // Added name
                type={showPassword ? "text" : "password"}
                autoComplete="current-password" // Fixes the [DOM] warning
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-3 pl-10 pr-12 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="••••••••"
                required
               />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="relative w-full overflow-hidden rounded-xl bg-primary px-4 py-3 font-bold text-white shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70"
            >
              <AnimatePresence mode="wait">
                {isSubmitting ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-center space-x-2"
                  >
                    <Loader message="Verifying..." />
                  </motion.div>
                ) : (
                  <motion.span key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    Sign In
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </form>
        </Card>
      </motion.div>

      {/* Error Modal */}
      <Modal isOpen={!!error} onClose={() => setError(null)} title="Authentication Failed">
        <div className="flex items-center space-x-3 text-rose-400">
          <AlertCircle size={24} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      </Modal>
    </div>
  );
};

export default Login;