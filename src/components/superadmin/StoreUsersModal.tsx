import React from 'react';
import { X, UserPlus, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { StoreRow, StoreUser } from './types';

interface Props {
  store: StoreRow;
  users: StoreUser[];
  loading: boolean;
  error: string;
  newUsername: string;
  newRole: 'owner' | 'taker';
  addingUser: boolean;
  addError: string;
  resettingUserId: number | null;
  confirmDeleteUserId: number | null;
  onNewUsername: (v: string) => void;
  onNewRole: (v: 'owner' | 'taker') => void;
  onAddUser: () => void;
  onRemoveUser: (id: number) => void;
  onResetPassword: (id: number) => void;
  onConfirmDelete: (id: number | null) => void;
  onClose: () => void;
}

export function StoreUsersModal({
  store, users, loading, error,
  newUsername, newRole, addingUser, addError,
  resettingUserId, confirmDeleteUserId,
  onNewUsername, onNewRole, onAddUser, onRemoveUser,
  onResetPassword, onConfirmDelete, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Store Access</h3>
            <p className="text-sm text-slate-500 mt-0.5">{store.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="p-5 space-y-3 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-4">Loading...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No users assigned yet.</p>
          ) : users.map(u => (
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
                  onClick={() => onResetPassword(u.id)}
                  disabled={resettingUserId === u.id}
                  className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40"
                  title="Reset password"
                >
                  {resettingUserId === u.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <KeyRound size={14} />}
                </button>
                {confirmDeleteUserId === u.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRemoveUser(u.id)}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => onConfirmDelete(null)}
                      className="px-2 py-1 text-xs bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onConfirmDelete(u.id)}
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

        <div className="p-5 border-t border-slate-200 space-y-3">
          <p className="text-sm font-semibold text-slate-700">Grant Access</p>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newUsername}
              onChange={e => onNewUsername(e.target.value)}
              placeholder="Username"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              onKeyDown={e => e.key === 'Enter' && onAddUser()}
            />
            <select
              value={newRole}
              onChange={e => onNewRole(e.target.value as 'owner' | 'taker')}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-navy-700"
            >
              <option value="owner">Owner</option>
              <option value="taker">Taker</option>
            </select>
          </div>
          <button
            onClick={onAddUser}
            disabled={addingUser || !newUsername.trim()}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-white bg-navy-900 hover:bg-navy-800 transition-colors disabled:opacity-60"
          >
            {addingUser ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Grant Access
          </button>
        </div>
      </div>
    </div>
  );
}
