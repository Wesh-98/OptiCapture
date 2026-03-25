import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Store, Users, Package, ShieldCheck, ShieldOff, LogOut, RefreshCw, Pencil, X, UserPlus, Trash2, Loader2, KeyRound, Copy, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { US_STATES } from '../lib/constants';

interface StoreRow {
  id: number;
  name: string;
  address: string;
  email: string;
  phone: string;
  plan_tier: string;
  status: string;
  created_at: string;
  user_count: number;
  item_count: number;
  logo?: string | null;
  street?: string;
  zipcode?: string;
  state?: string;
}

interface StoreUser {
  id: number;
  username: string;
  email?: string;
  role: string;
}


// Validation functions
const validateZipcode = (v: string) => !v || /^\d{5}(-\d{4})?$/.test(v);
const validatePhone = (v: string) => !v || /^\d{10}$/.test(v.replace(/\D/g, ''));
const validateEmail = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function SuperAdmin() {
  const prefersReducedMotion = useReducedMotion();

  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editStore, setEditStore] = useState<StoreRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [usersStore, setUsersStore] = useState<StoreRow | null>(null);
  const [storeUsers, setStoreUsers] = useState<StoreUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'owner' | 'taker'>('owner');
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState('');
  const [resetResult, setResetResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  useEffect(() => {
    fetchStores();
  }, []);

  const fetchStores = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/stores', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        navigate('/login');
        return;
      }
      if (res.ok) setStores(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStatus = async (store: StoreRow) => {
    const newStatus = store.status === 'active' ? 'suspended' : 'active';
    setTogglingId(store.id);
    try {
      await fetch(`/api/admin/stores/${store.id}/status`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setStores(prev => prev.map(s => s.id === store.id ? { ...s, status: newStatus } : s));
    } finally {
      setTogglingId(null);
    }
  };

  const openEdit = (store: StoreRow) => {
    setEditStore({ ...store });
    setEditErrors({});
  };

  const openUsers = async (store: StoreRow) => {
    setUsersStore(store);
    setAddError('');
    setNewUsername('');
    setConfirmDeleteUserId(null);
    setUsersLoading(true);
    try {
      const res = await fetch(`/api/admin/stores/${store.id}/users`, { credentials: 'include' });
      if (res.ok) setStoreUsers(await res.json());
    } finally {
      setUsersLoading(false);
    }
  };

  const addUser = async () => {
    if (!usersStore || !newUsername.trim()) return;
    setAddingUser(true);
    setAddError('');
    try {
      const res = await fetch(`/api/admin/stores/${usersStore.id}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error); return; }
      // Refresh list
      const refreshed = await fetch(`/api/admin/stores/${usersStore.id}/users`, { credentials: 'include' });
      if (refreshed.ok) setStoreUsers(await refreshed.json());
      setNewUsername('');
    } finally {
      setAddingUser(false);
    }
  };

  const removeUser = async (userId: number) => {
    if (!usersStore) return;
    const res = await fetch(`/api/admin/stores/${usersStore.id}/users/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) { setActionError(data.error); return; }
    setStoreUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleResetPassword = async (userId: number) => {
    setResettingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setResetResult({ username: data.username, tempPassword: data.tempPassword });
      } else {
        setActionError(data.error || 'Failed to reset password');
      }
    } catch {
      setActionError('Failed to reset password');
    } finally {
      setResettingUserId(null);
    }
  };

  const handleEditSave = async () => {
    if (!editStore) return;

    // Validate before saving
    const errs: Record<string, string> = {};
    if (!editStore.name.trim()) errs.name = 'Store name is required';
    if (editStore.email && !validateEmail(editStore.email)) errs.email = 'Enter a valid email';
    if (editStore.phone && !validatePhone(editStore.phone)) errs.phone = 'Phone must be 10 digits';
    if (editStore.zipcode && !validateZipcode(editStore.zipcode)) errs.zipcode = 'Format: 12345 or 12345-6789';
    if (Object.keys(errs).length) { setEditErrors(errs); return; }
    setEditErrors({});

    setEditSaving(true);
    setEditError('');

    try {
      const res = await fetch(`/api/admin/stores/${editStore.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editStore.name,
          street: editStore.street,
          zipcode: editStore.zipcode,
          state: editStore.state,
          phone: editStore.phone,
          email: editStore.email,
          plan_tier: editStore.plan_tier,
          logo: editStore.logo,
        }),
      });

      if (res.ok) {
        const updatedStore = await res.json();
        setStores(prev => prev.map(s => s.id === editStore.id ? { ...s, ...updatedStore } : s));
        setEditStore(null);
      } else {
        const error = await res.text();
        setEditError(error || 'Failed to save changes');
      }
    } catch (err) {
      setEditError('Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editStore) return;

    const reader = new FileReader();
    reader.onload = () => {
      setEditStore({ ...editStore, logo: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    if (editStore) {
      setEditStore({ ...editStore, logo: null });
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  const active = stores.filter(s => s.status === 'active').length;
  const suspended = stores.filter(s => s.status === 'suspended').length;
  const totalItems = stores.reduce((n, s) => n + (s.item_count || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="h-16 flex items-center justify-between px-6 bg-navy-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center font-bold text-base text-navy-900">
            OC
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">OptiCapture</h1>
            <p className="text-xs text-slate-400 leading-tight">Super Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-white bg-navy-800">
            <ShieldCheck size={15} className="text-emerald-500" />
            <span className="text-sm font-medium">superadmin</span>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-sm px-3 py-1.5 rounded-lg">
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Error Banner */}
        {actionError && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError('')} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Stores', value: stores.length, icon: Store, color: 'text-navy-900' },
            { label: 'Active', value: active, icon: ShieldCheck, color: 'text-emerald-600' },
            { label: 'Suspended', value: suspended, icon: ShieldOff, color: 'text-red-500' },
            { label: 'Total Items', value: totalItems.toLocaleString(), icon: Package, color: 'text-slate-700' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={color} />
                <p className="text-xs text-slate-500 uppercase font-semibold">{label}</p>
              </div>
              <p className={cn('text-2xl font-bold', color)}>{value}</p>
            </div>
          ))}
        </div>

        {/* Stores table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <h2 className="font-bold text-navy-900 flex items-center gap-2">
              <Store size={18} className="text-slate-400" />
              All Stores
            </h2>
            <button
              onClick={fetchStores}
              className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-slate-400">Loading stores...</div>
          ) : stores.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No stores registered yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Store', 'Contact', 'Plan', 'Users', 'Items', 'Joined', 'Status', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stores.map(store => (
                    <motion.tr
                      key={store.id}
                      initial={prefersReducedMotion ? false : { opacity: 0 }}
                      animate={prefersReducedMotion ? {} : { opacity: 1 }}
                      className={cn('transition-colors', store.status === 'suspended' ? 'bg-red-50' : 'hover:bg-slate-50')}
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {store.logo
                            ? <img src={store.logo} alt={store.name} className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                            : <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm flex-shrink-0">
                                {store.name.charAt(0).toUpperCase()}
                              </div>
                          }
                          <div>
                            <p className={cn("font-medium", store.status === 'suspended' ? 'text-slate-700' : 'text-navy-900')}>{store.name}</p>
                            {(store.street || store.address) && (
                              <p className={cn("text-xs mt-0.5", store.status === 'suspended' ? 'text-slate-700' : 'text-slate-600')}>
                                {[store.street, store.zipcode, store.state].filter(Boolean).join(', ') || store.address}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {store.email && <p className={cn(store.status === 'suspended' ? 'text-slate-700' : 'text-slate-700')}>{store.email}</p>}
                        {store.phone && <p className={cn(store.status === 'suspended' ? 'text-slate-700' : 'text-slate-600')}>{store.phone}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 capitalize">
                          {store.plan_tier}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700 font-mono">{store.user_count}</td>
                      <td className="px-4 py-4 text-sm text-slate-700 font-mono">{store.item_count}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {new Date(store.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                          store.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        )}>
                          {store.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(store)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            onClick={() => openUsers(store)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                          >
                            <Users size={13} /> Users
                          </button>
                          <button
                            onClick={() => toggleStatus(store)}
                            disabled={togglingId === store.id}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50',
                              store.status === 'active'
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            )}
                          >
                            {store.status === 'active' ? <><ShieldOff size={13} /> Suspend</> : <><ShieldCheck size={13} /> Activate</>}
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh]">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-navy-900">Edit Store</h3>
                <button
                  onClick={() => setEditStore(null)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {editError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {editError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Store Name *</label>
                  <input
                    type="text"
                    value={editStore.name}
                    onChange={e => setEditStore({ ...editStore, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    required
                  />
                  {editErrors.name && <p className="text-xs text-red-500 mt-1">{editErrors.name}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Street Address</label>
                  <input
                    type="text"
                    value={editStore.street || ''}
                    onChange={e => setEditStore({ ...editStore, street: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Zipcode</label>
                    <input
                      type="text"
                      value={editStore.zipcode || ''}
                      onChange={e => setEditStore({ ...editStore, zipcode: e.target.value.replace(/[^\d-]/g, '').slice(0, 10) })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    />
                    {editErrors.zipcode && <p className="text-xs text-red-500 mt-1">{editErrors.zipcode}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                    <select
                      value={editStore.state || ''}
                      onChange={e => setEditStore({ ...editStore, state: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    >
                      <option value="">Select state</option>
                      {US_STATES.map(([code, name]) => (
                        <option key={code} value={code}>{name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editStore.phone}
                    onChange={e => setEditStore({ ...editStore, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  />
                  {editErrors.phone && <p className="text-xs text-red-500 mt-1">{editErrors.phone}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editStore.email}
                    onChange={e => setEditStore({ ...editStore, email: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  />
                  {editErrors.email && <p className="text-xs text-red-500 mt-1">{editErrors.email}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Plan Tier</label>
                  <select
                    value={editStore.plan_tier}
                    onChange={e => setEditStore({ ...editStore, plan_tier: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  >
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Logo</label>
                  {editStore.logo ? (
                    <div className="flex items-center gap-3">
                      <img src={editStore.logo} alt="Store logo" className="w-15 h-15 rounded-lg object-cover border border-slate-200" />
                      <button
                        onClick={removeLogo}
                        className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setEditStore(null)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editSaving || !editStore.name}
                  className="px-4 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors text-sm disabled:opacity-50"
                >
                  {editSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users Modal */}
      {usersStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Store Access</h3>
                <p className="text-sm text-slate-500 mt-0.5">{usersStore.name}</p>
              </div>
              <button onClick={() => { setUsersStore(null); setConfirmDeleteUserId(null); }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {/* Current users list */}
            <div className="p-5 space-y-3 max-h-64 overflow-y-auto">
              {usersLoading ? (
                <p className="text-sm text-slate-400 text-center py-4">Loading...</p>
              ) : storeUsers.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No users assigned yet.</p>
              ) : storeUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-sm">
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{u.username}</p>
                      {u.email && <p className="text-xs text-slate-400">{u.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                      u.role === 'owner' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                    )}>{u.role}</span>
                    <button
                      onClick={() => handleResetPassword(u.id)}
                      disabled={resettingUserId === u.id}
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40"
                      title="Reset password"
                    >
                      {resettingUserId === u.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <KeyRound size={14} />
                      }
                    </button>
                    {confirmDeleteUserId === u.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { removeUser(u.id); setConfirmDeleteUserId(null); }}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteUserId(null)}
                          className="px-2 py-1 text-xs bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteUserId(u.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove user"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add user form */}
            <div className="p-5 border-t border-slate-200 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Grant Access</p>
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="Username"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                  onKeyDown={e => e.key === 'Enter' && addUser()}
                />
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as 'owner' | 'taker')}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-navy-700"
                >
                  <option value="owner">Owner</option>
                  <option value="taker">Taker</option>
                </select>
              </div>
              <button
                onClick={addUser}
                disabled={addingUser || !newUsername.trim()}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-white bg-navy-900 hover:bg-navy-800 transition-colors disabled:opacity-60"
              >
                {addingUser ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Grant Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Result Modal */}
      <AnimatePresence>
        {resetResult && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            initial={prefersReducedMotion ? false : { opacity: 0 }} animate={prefersReducedMotion ? {} : { opacity: 1 }} exit={prefersReducedMotion ? {} : { opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
              initial={prefersReducedMotion ? false : { scale: 0.95, opacity: 0 }} animate={prefersReducedMotion ? {} : { scale: 1, opacity: 1 }} exit={prefersReducedMotion ? {} : { scale: 0.95, opacity: 0 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <KeyRound size={18} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-navy-900">Password Reset</h3>
                  <p className="text-xs text-slate-500">For user: <span className="font-semibold">{resetResult.username}</span></p>
                </div>
              </div>

              <p className="text-sm text-slate-600 mb-3">Relay this temporary password to the user. They should change it after logging in.</p>

              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-4">
                <code className="flex-1 font-mono text-lg font-bold text-navy-900 tracking-widest">{resetResult.tempPassword}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(resetResult.tempPassword)}
                  className="p-1.5 text-slate-400 hover:text-navy-900 hover:bg-slate-200 rounded-lg transition-colors"
                  title="Copy to clipboard"
                >
                  <Copy size={16} />
                </button>
              </div>

              <p className="text-xs text-amber-600 mb-4 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">⚠</span>
                This password will not be shown again. Copy it before closing.
              </p>

              <button
                onClick={() => setResetResult(null)}
                className="w-full px-4 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}