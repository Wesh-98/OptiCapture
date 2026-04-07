import type { FormEvent } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Lock } from 'lucide-react';
import type { PasswordField, PasswordForm } from './types';

interface StorePasswordCardProps {
  passwordError: string;
  passwordForm: PasswordForm;
  passwordSaving: boolean;
  passwordSuccess: string;
  onFieldChange: (field: PasswordField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const passwordFields: ReadonlyArray<{
  field: PasswordField;
  label: string;
  minLength?: number;
}> = [
  { field: 'current_password', label: 'Current Password' },
  { field: 'new_password', label: 'New Password', minLength: 8 },
  { field: 'confirm_password', label: 'Confirm New Password' },
];

export function StorePasswordCard({
  passwordError,
  passwordForm,
  passwordSaving,
  passwordSuccess,
  onFieldChange,
  onSubmit,
}: StorePasswordCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-navy-50 flex items-center justify-center">
          <Lock size={18} className="text-navy-700" />
        </div>
        <div>
          <h2 className="text-base font-bold text-navy-900">Change Password</h2>
          <p className="text-xs text-slate-500">Update your account password</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {passwordFields.map(({ field, label, minLength }) => (
          <div key={field}>
            <label
              htmlFor={`ss-${field}`}
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {label}
            </label>
            <input
              id={`ss-${field}`}
              type="password"
              value={passwordForm[field]}
              onChange={event => onFieldChange(field, event.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              required
              minLength={minLength}
            />
            {field === 'new_password' && (
              <p className="text-xs text-slate-400 mt-1">Min 8 characters, 1 uppercase, 1 number</p>
            )}
          </div>
        ))}

        {passwordSuccess && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium">
            <CheckCircle size={16} className="shrink-0" />
            {passwordSuccess}
          </div>
        )}

        {passwordError && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0" />
            {passwordError}
          </div>
        )}

        <button
          type="submit"
          disabled={passwordSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {passwordSaving && <Loader2 className="animate-spin" size={16} />}
          Update Password
        </button>
      </form>
    </div>
  );
}
