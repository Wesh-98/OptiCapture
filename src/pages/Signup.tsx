import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Lock, User, Store, Phone, Mail, MapPin, BarChart3, Smartphone, Layers, AlertTriangle, Copy, Check } from 'lucide-react';
import { US_STATES } from '../lib/constants';

// Validation functions
const validateZipcode = (v: string) => !v || /^\d{5}(-\d{4})?$/.test(v);
const validatePhone = (v: string) => !v || /^\d{10}$/.test(v.replaceAll(/\D/g, ''));
const validateEmail = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validatePassword = (v: string) => v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v);

export default function Signup() {
  const prefersReducedMotion = useReducedMotion();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingKey = searchParams.get('pending');

  const [storeName, setStoreName] = useState('');
  const [street, setStreet] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [state, setState] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGooglePrefilled, setIsGooglePrefilled] = useState(false);
  const [registeredCode, setRegisteredCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Pre-fill from Google OAuth pending session
  useEffect(() => {
    if (!pendingKey) return;
    fetch(`/api/auth/google/pending?key=${pendingKey}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return;
        if (data.email) setEmail(data.email);
        if (data.name) setStoreName(data.name);
        setIsGooglePrefilled(true);
      })
      .catch(() => {});
  }, [pendingKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    const errs: Record<string, string> = {};
    if (!storeName.trim()) errs.storeName = 'Store name is required';
    if (email && !validateEmail(email)) errs.email = 'Enter a valid email address';
    if (phone && !validatePhone(phone)) errs.phone = 'Phone must be 10 digits';
    if (zipcode && !validateZipcode(zipcode)) errs.zipcode = 'Format: 12345 or 12345-6789';
    if (!isGooglePrefilled) {
      if (!validatePassword(password)) errs.password = 'Min 8 chars, 1 uppercase letter, 1 number';
      if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});

    setIsSubmitting(true);
    try {
      const body: Record<string, string> = { store_name: storeName, street, zipcode, state, phone, email, username, password };
      if (pendingKey) body.oauth_key = pendingKey;

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.redirect) {
          navigate(data.redirect); // OAuth signup — already logged in
        } else {
          setRegisteredCode(data.store_code);
        }
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = "w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div className="min-h-screen flex bg-navy-900">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 bg-navy-900">
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
      <div className="w-full lg:w-3/5 flex items-start justify-center p-6 bg-slate-50 overflow-y-auto">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
          className="w-full max-w-lg py-8"
        >
          {/* Store code success screen */}
          {registeredCode && (
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Store Created!</h2>
              <p className="text-slate-500 text-sm mb-6">Save your store code — you'll need it every time you log in.</p>

              <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-5 mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Your Store Code</p>
                <p className="text-4xl font-mono font-bold tracking-[0.3em] text-navy-900">{registeredCode}</p>
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(registeredCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 2000);
                }}
                className="flex items-center gap-2 mx-auto mb-6 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors"
              >
                {codeCopied ? <><Check size={15} className="text-emerald-600" /> Copied!</> : <><Copy size={15} /> Copy Code</>}
              </button>

              <p className="text-xs text-slate-400 mb-6">Share this code with your staff so they can log in to your store.</p>

              <button
                onClick={() => navigate('/login')}
                className="w-full py-2.5 rounded-xl font-semibold text-white bg-navy-900 hover:bg-navy-800 transition-colors text-sm"
              >
                Continue to Login
              </button>
            </div>
          )}

          {/* Mobile logo */}
          {!registeredCode && <div className="lg:hidden text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-navy-900">OptiCapture</h1>
            <p className="text-slate-500 mt-1">Create your store account</p>
          </div>}

          {!registeredCode && <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Create your store</h2>
              <p className="text-slate-500 mt-1 text-sm">Get started with OptiCapture in minutes</p>
            </div>

            {isGooglePrefilled && (
              <div className="mb-4 bg-blue-50 text-blue-700 p-3 rounded-xl text-sm border border-blue-100 flex items-center gap-2">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-4 h-4" alt="" />
                Signed in with Google — fill in store details to finish setup
              </div>
            )}

            {error && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            {/* Google signup button — only show if not already coming from Google */}
            {!isGooglePrefilled && (
              <>
                <button
                  type="button"
                  onClick={() => globalThis.location.href = '/api/auth/google?intent=signup'}
                  className="w-full flex items-center justify-center gap-3 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 mb-4"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                  Sign up with Google
                </button>

                <div className="relative flex items-center gap-3 mb-5">
                  <div className="flex-1 border-t border-slate-200" />
                  <span className="text-xs text-slate-400 font-medium">or fill in manually</span>
                  <div className="flex-1 border-t border-slate-200" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Store Details */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 bg-navy-900 rounded-full" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Store Details</p>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                    <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)}
                      className={inputClass} placeholder="Store name *" required />
                  </div>
                  {errors.storeName && <p className="text-xs text-red-500 mt-1 pl-1">{errors.storeName}</p>}
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                    <input type="text" value={street} onChange={e => setStreet(e.target.value)}
                      className={inputClass} placeholder="Street address" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <input type="text" value={zipcode} onChange={e => setZipcode(e.target.value.replaceAll(/[^\d-]/g, '').slice(0, 10))}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        placeholder="Zipcode" maxLength={10} />
                      {errors.zipcode && <p className="text-xs text-red-500 mt-1 pl-1">{errors.zipcode}</p>}
                    </div>
                    <select value={state} onChange={e => setState(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed">
                      <option value="">State</option>
                      {US_STATES.map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replaceAll(/\D/g, '').slice(0, 10))}
                          className={inputClass} placeholder="Phone" />
                      </div>
                      {errors.phone && <p className="text-xs text-red-500 mt-1 pl-1">{errors.phone}</p>}
                    </div>
                    <div>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                          className={`${inputClass} ${isGooglePrefilled ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''}`} placeholder="Email"
                          readOnly={isGooglePrefilled} />
                      </div>
                      {errors.email && <p className="text-xs text-red-500 mt-1 pl-1">{errors.email}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100" />

              {/* Admin Account */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 bg-navy-900 rounded-full" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Admin Account</p>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                    <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                      className={inputClass} placeholder="Username *" required />
                  </div>
                  {!isGooglePrefilled && (
                    <>
                      <div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                            className={inputClass} placeholder="Password *" required />
                        </div>
                        <p className="text-xs text-slate-400 pl-1 mt-1">Min 8 characters, 1 uppercase, 1 number</p>
                        {errors.password && <p className="text-xs text-red-500 mt-1 pl-1">{errors.password}</p>}
                      </div>
                      <div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                            className={inputClass} placeholder="Confirm password *" required />
                        </div>
                        {errors.confirmPassword && <p className="text-xs text-red-500 mt-1 pl-1">{errors.confirmPassword}</p>}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl font-semibold text-white transition-colors hover:bg-navy-800 active:scale-[0.99] disabled:opacity-60 text-sm bg-navy-900"
              >
                {isSubmitting ? 'Creating account...' : 'Create Store Account'}
              </button>
            </form>

            <p className="text-center text-sm text-slate-500 mt-5">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold hover:underline text-navy-700 hover:text-navy-900">
                Sign in
              </Link>
            </p>
          </div>}
        </motion.div>
      </div>
    </div>
  );
}