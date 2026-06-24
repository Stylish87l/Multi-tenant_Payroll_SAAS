import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ArrowLeft, Ghost } from 'lucide-react'; // 2026 Icon Set
import Card from '../components/Card';

const NotFound = () => {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 flex items-center justify-center p-6">
      
      {/* Background visual depth */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg h-96 bg-primary/10 blur-[120px] rounded-full" />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="text-center border-white/10 bg-slate-900/40 backdrop-blur-3xl p-10 shadow-2xl">
          {/* Floating Illustration */}
          <motion.div
            animate={{ y: [0, -15, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="flex justify-center mb-8"
          >
            <div className="relative">
              <span className="text-8xl font-black text-white/5 select-none">404</span>
              <div className="absolute inset-0 flex items-center justify-center text-primary">
                <Ghost size={64} strokeWidth={1.5} />
              </div>
            </div>
          </motion.div>

          {/* Typography */}
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">
            Lost in the Cloud?
          </h1>
          <p className="text-slate-400 text-sm mb-10 leading-relaxed">
            The page you are looking for has been moved or doesn't exist in our 2026 payroll environment.
          </p>

          {/* Action Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link 
              to="/" 
              className="flex items-center justify-center space-x-2 px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
            >
              <Home size={18} />
              <span>Go Home</span>
            </Link>
            
            <button 
              onClick={() => window.history.back()}
              className="flex items-center justify-center space-x-2 px-6 py-3 bg-white/5 border border-white/10 text-slate-300 font-bold rounded-xl hover:bg-white/10 transition-all active:scale-95"
            >
              <ArrowLeft size={18} />
              <span>Back</span>
            </button>
          </div>
        </Card>
      </motion.div>

      {/* Decorative footer text */}
      <div className="absolute bottom-8 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-700">
        Ghana Payroll System • Secure 2026 Core
      </div>
    </div>
  );
};

export default NotFound;