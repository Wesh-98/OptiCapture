import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Upload, CheckCircle, Store, Lock, AlertTriangle } from 'lucide-react';

const validateZipcode = (v: string) => !v || /^\d{5}(-\d{4})?$/.test(v);
const validatePhone = (v: string) => !v || /^\d{10}$/.test(v.replace(/\D/g, ''));
const validateEmail = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const validatePassword = (v: string) => v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v);

interface StoreInfo {
  name: string;
  street: string;
  zipcode: string;
  state: string;
  phone: string;
  email: string;
  logo: string;
}

export default function StoreSettings() {
  const [storeInfo, setStoreInfo] = useState<StoreInfo>({
    name: '',
    street: '',
    zipcode: '',
    state: '',
    phone: '',
    email: '',
    logo: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});

  const [storeSaving, setStoreSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [storeSuccess, setStoreSuccess] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [storeError, setStoreError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchStoreSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/store/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStoreInfo({
          name: data.name || '',
          street: data.street || '',
          zipcode: data.zipcode || '',
          state: data.state || '',
          phone: data.phone || '',
          email: data.email || '',
          logo: data.logo || '',
        });
      }
    } catch (error) {
      console.error('Error fetching store settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStoreSettings();
  }, [fetchStoreSettings]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      setStoreInfo({ ...storeInfo, logo: base64String });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setStoreInfo({ ...storeInfo, logo: '' });
  };

  const handleStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStoreError('');
    setStoreSuccess('');

    const errs: Record<string, string> = {};
    if (!storeInfo.name.trim()) errs.name = 'Store name is required';
    if (storeInfo.email && !validateEmail(storeInfo.email)) errs.email = 'Enter a valid email address';
    if (storeInfo.phone && !validatePhone(storeInfo.phone)) errs.phone = 'Phone must be 10 digits';
    if (storeInfo.zipcode && !validateZipcode(storeInfo.zipcode)) errs.zipcode = 'Format: 12345 or 12345-6789';
    if (Object.keys(errs).length) { setInfoErrors(errs); return; }
    setInfoErrors({});

    setStoreSaving(true);

    try {
      const res = await fetch('/api/store/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: storeInfo.name,
          street: storeInfo.street,
          zipcode: storeInfo.zipcode,
          state: storeInfo.state,
          phone: storeInfo.phone,
          email: storeInfo.email,
          logo: storeInfo.logo,
        }),
      });

      if (res.ok) {
        setStoreSuccess('Store information updated.');
        // Clear success message after 3 seconds
        setTimeout(() => setStoreSuccess(''), 3000);
      } else {
        const errorData = await res.json();
        setStoreError(errorData.error || 'Failed to update store information.');
      }
    } catch (error) {
      console.error('Error updating store settings:', error);
      setStoreError('An error occurred while updating store information.');
    } finally {
      setStoreSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Client-side validation
    if (!validatePassword(passwordForm.new_password)) {
      setPasswordError('Min 8 chars, 1 uppercase letter, 1 number');
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setPasswordSaving(true);

    try {
      const res = await fetch('/api/store/password', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        }),
      });

      if (res.ok) {
        setPasswordSuccess('Password updated successfully.');
        setPasswordForm({
          current_password: '',
          new_password: '',
          confirm_password: '',
        });
        // Clear success message after 3 seconds
        setTimeout(() => setPasswordSuccess(''), 3000);
      } else {
        const errorData = await res.json();
        setPasswordError(errorData.error || 'Failed to update password.');
      }
    } catch (error) {
      console.error('Error updating password:', error);
      setPasswordError('An error occurred while updating password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="animate-spin text-navy-900" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Store Settings</h1>
        <p className="text-slate-500 mt-1">Manage your store profile, branding and account security</p>
      </div>

      {/* Store Information Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-navy-50 flex items-center justify-center">
            <Store size={18} className="text-navy-700" />
          </div>
          <div>
            <h2 className="text-base font-bold text-navy-900">Store Information</h2>
            <p className="text-xs text-slate-500">Update your store name, address and contact details</p>
          </div>
        </div>

        <form onSubmit={handleStoreSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Store Logo</label>
            {storeInfo.logo ? (
              <div className="flex flex-col items-start gap-2">
                <img src={storeInfo.logo} alt="Store logo" className="w-24 h-24 rounded-xl border border-slate-200 object-contain" />
                <button type="button" onClick={() => setStoreInfo({...storeInfo, logo: ''})}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors">
                  Remove
                </button>
              </div>
            ) : (
              <div className="relative w-24 h-24">
                <input type="file" accept="image/*" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = ev => setStoreInfo({...storeInfo, logo: ev.target?.result as string});
                    reader.readAsDataURL(file);
                  }
                }} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-slate-400 cursor-pointer gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span className="text-xs">Upload Logo</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Store Name
            </label>
            <input
              type="text"
              value={storeInfo.name}
              onChange={(e) => setStoreInfo({ ...storeInfo, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              required
            />
            {infoErrors.name && <p className="text-xs text-red-500 mt-1">{infoErrors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Street Address</label>
            <input type="text" value={storeInfo.street} onChange={e => setStoreInfo({...storeInfo, street: e.target.value})}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              placeholder="123 Main St" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Zipcode</label>
              <input type="text" value={storeInfo.zipcode} onChange={e => setStoreInfo({...storeInfo, zipcode: e.target.value.replace(/[^\d-]/g, '').slice(0, 10)})}
                maxLength={10}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                placeholder="10001" />
              {infoErrors.zipcode && <p className="text-xs text-red-500 mt-1">{infoErrors.zipcode}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
              <select value={storeInfo.state} onChange={e => setStoreInfo({...storeInfo, state: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent bg-white">
                <option value="">— Select State —</option>
                {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']].map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={storeInfo.phone}
              onChange={(e) => setStoreInfo({ ...storeInfo, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
            />
            {infoErrors.phone && <p className="text-xs text-red-500 mt-1">{infoErrors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={storeInfo.email}
              onChange={(e) => setStoreInfo({ ...storeInfo, email: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
            />
            {infoErrors.email && <p className="text-xs text-red-500 mt-1">{infoErrors.email}</p>}
          </div>

          {storeSuccess && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium">
              <CheckCircle size={16} className="shrink-0" />
              {storeSuccess}
            </div>
          )}

          {storeError && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertTriangle size={16} className="shrink-0" />
              {storeError}
            </div>
          )}

          <button
            type="submit"
            disabled={storeSaving}
            className="flex items-center gap-2 px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {storeSaving && <Loader2 className="animate-spin" size={16} />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Change Password Section */}
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

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Current Password
            </label>
            <input
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              required
              minLength={8}
            />
            <p className="text-xs text-slate-400 mt-1">Min 8 characters, 1 uppercase, 1 number</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              required
            />
          </div>

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
    </div>
  );
}