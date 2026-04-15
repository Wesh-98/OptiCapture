import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Lock, Mail, MapPin, Phone, Store, User } from 'lucide-react';
import { US_STATES } from '../../lib/constants';
import type { SignupFormData } from './types';

//Google signup not working yet but set up is there.
interface SignupFormCardProps {
  error: string;
  errors: Record<string, string>;
  formData: SignupFormData;
  isGooglePrefilled: boolean;
  isSubmitting: boolean;
  onFieldChange: (field: keyof SignupFormData, value: string) => void;
  onGoogleSignup: () => void;
  onPhoneChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onZipcodeChange: (value: string) => void;
}

const inputClass =
  'w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed';

export function SignupFormCard({
  error,
  errors,
  formData,
  isGooglePrefilled,
  isSubmitting,
  onFieldChange,
  onGoogleSignup,
  onPhoneChange,
  onSubmit,
  onZipcodeChange,
}: SignupFormCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Create your store</h2>
        <p className="text-slate-500 mt-1 text-sm">Get started with OptiCapture in minutes</p>
      </div>

      {isGooglePrefilled && (
        <div className="mb-4 bg-blue-50 text-blue-700 p-3 rounded-xl text-sm border border-blue-100 flex items-center gap-2">
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            className="w-4 h-4"
            alt=""
          />
          Signed in with Google, fill in store details to finish setup
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {!isGooglePrefilled && (
        <>
          <button
            type="button"
            onClick={onGoogleSignup}
            className="w-full flex items-center justify-center gap-3 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 mb-4"
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              className="w-5 h-5"
              alt="Google"
            />            
            Sign up with Google
          </button>

          <div className="relative flex items-center gap-3 mb-5">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs text-slate-400 font-medium">or fill in manually</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-navy-900 rounded-full" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Store Details
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="relative">
                <Store
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={17}
                />
                <input
                  type="text"
                  value={formData.storeName}
                  onChange={event => onFieldChange('storeName', event.target.value)}
                  className={inputClass}
                  placeholder="Store name *"
                  required
                />
              </div>
              {errors.storeName && (
                <p className="text-xs text-red-500 mt-1 pl-1">{errors.storeName}</p>
              )}
            </div>

            <div className="relative">
              <MapPin
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={17}
              />
              <input
                type="text"
                value={formData.street}
                onChange={event => onFieldChange('street', event.target.value)}
                className={inputClass}
                placeholder="Street address"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  type="text"
                  value={formData.zipcode}
                  onChange={event => onZipcodeChange(event.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="Zipcode"
                  maxLength={10}
                />
                {errors.zipcode && (
                  <p className="text-xs text-red-500 mt-1 pl-1">{errors.zipcode}</p>
                )}
              </div>

              <select
                value={formData.state}
                onChange={event => onFieldChange('state', event.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-navy-700 transition-all text-sm text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">State</option>
                {US_STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="relative">
                  <Phone
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={17}
                  />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={event => onPhoneChange(event.target.value)}
                    className={inputClass}
                    placeholder="Phone"
                  />
                </div>
                {errors.phone && <p className="text-xs text-red-500 mt-1 pl-1">{errors.phone}</p>}
              </div>

              <div>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={17}
                  />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={event => onFieldChange('email', event.target.value)}
                    className={`${inputClass} ${
                      isGooglePrefilled ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''
                    }`}
                    placeholder="Email"
                    readOnly={isGooglePrefilled}
                  />
                </div>
                {errors.email && <p className="text-xs text-red-500 mt-1 pl-1">{errors.email}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100" />

        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-navy-900 rounded-full" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Admin Account
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="relative">
                <User
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={17}
                />
                <input
                  type="text"
                  value={formData.username}
                  onChange={event => onFieldChange('username', event.target.value)}
                  className={inputClass}
                  placeholder="Username *"
                  required
                />
              </div>
              {errors.username && (
                <p className="text-xs text-red-500 mt-1 pl-1">{errors.username}</p>
              )}
            </div>

            {!isGooglePrefilled && (
              <>
                <div>
                  <div className="relative">
                    <Lock
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      size={17}
                    />
                    <input
                      type="password"
                      value={formData.password}
                      onChange={event => onFieldChange('password', event.target.value)}
                      className={inputClass}
                      placeholder="Password *"
                      required
                    />
                  </div>
                  <p className="text-xs text-slate-400 pl-1 mt-1">
                    Min 8 characters, 1 uppercase, 1 number
                  </p>
                  {errors.password && (
                    <p className="text-xs text-red-500 mt-1 pl-1">{errors.password}</p>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <Lock
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      size={17}
                    />
                    <input
                      type="password"
                      value={formData.confirmPassword}
                      onChange={event => onFieldChange('confirmPassword', event.target.value)}
                      className={inputClass}
                      placeholder="Confirm password *"
                      required
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-500 mt-1 pl-1">{errors.confirmPassword}</p>
                  )}
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
        <Link
          to="/login"
          className="font-semibold hover:underline text-navy-700 hover:text-navy-900"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
