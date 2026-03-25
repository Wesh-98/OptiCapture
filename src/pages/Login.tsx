import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion, useReducedMotion } from 'motion/react';
import { Lock, User, BarChart3, Smartphone, Layers } from 'lucide-react';

export default function Login() {
  const prefersReducedMotion = useReducedMotion();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const registered = searchParams.get('registered') === '1';
  const ERROR_MESSAGES: Record<string, string> = {
    oauth_failed: 'Google sign-in failed. Please try again.',
    session_expired: 'Your session has expired. Please sign in again.',
  };
  const oauthError = ERROR_MESSAGES[searchParams.get('error') ?? ''] ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const user = await res.json();
        login(user);
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-navy-900">
      {/* Left brand panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-navy-900">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">OptiCapture</h1>
          <p className="text-slate-400 mt-2 text-lg">Smart inventory for modern stores</p>
        </div>

        <div className="space-y-6">
          {[
            { icon: Layers, title: 'Multi-store ready', desc: 'Manage multiple locations from one platform' },
            { icon: Smartphone, title: 'Barcode scanning', desc: 'Scan via phone camera or USB/Bluetooth scanner' },
            { icon: BarChart3, title: 'Real-time sync', desc: 'Live inventory counts across your team' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-navy-700">
                <Icon size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-white">{title}</p>
                <p className="text-slate-400 text-sm mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-slate-600 text-sm">© {new Date().getFullYear()} OptiCapture. All rights reserved.</p>
      </div>

      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-6 bg-slate-50 overflow-y-auto">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
          className="w-full max-w-md my-auto"
        >
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-4 sm:mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-navy-900">OptiCapture</h1>
            <p className="text-slate-500 mt-1">Smart inventory for modern stores</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
              <p className="text-slate-500 mt-1 text-sm">Sign in to your store account</p>
            </div>

            {registered && (
              <div className="mb-4 bg-emerald-50 text-emerald-700 p-3 rounded-xl text-sm text-center border border-emerald-100">
                Store created! Sign in with your new credentials.
              </div>
            )}
            {(error || oauthError) && (
              <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-xl text-sm text-center border border-red-100">
                {error || oauthError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="Enter username"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="Enter password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60 text-sm bg-navy-900"
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            {/* Divider */}
            <div className="relative flex items-center gap-3 my-4">
              <div className="flex-1 border-t border-slate-200" />
              <span className="text-xs text-slate-400 font-medium">or</span>
              <div className="flex-1 border-t border-slate-200" />
            </div>

            {/* Google button */}
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/google?intent=login'}
              className="w-full flex items-center justify-center gap-3 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700"
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                className="w-5 h-5"
                alt="Google"
              />
              Continue with Google
            </button>

            <p className="text-center text-sm text-slate-500 mt-5">
              New store?{' '}
              <Link to="/signup" className="font-semibold hover:underline text-navy-700 hover:text-navy-900">
                Create an account
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}