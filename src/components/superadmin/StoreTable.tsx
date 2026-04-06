import React from 'react';
import { motion } from 'motion/react';
import {
  Store, Users, ShieldCheck, ShieldOff, Pencil, Trash2, RefreshCw, Search,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { StoreRow } from './types';

interface Props {
  stores: StoreRow[];
  filteredStores: StoreRow[];
  isLoading: boolean;
  togglingId: number | null;
  storeSearch: string;
  statusFilter: 'all' | 'active' | 'suspended';
  joinedSort: 'newest' | 'oldest';
  prefersReducedMotion: boolean | null;
  onSearch: (v: string) => void;
  onStatusFilter: (v: 'all' | 'active' | 'suspended') => void;
  onJoinedSort: (v: 'newest' | 'oldest') => void;
  onRefresh: () => void;
  onEdit: (store: StoreRow) => void;
  onUsers: (store: StoreRow) => void;
  onToggleStatus: (store: StoreRow) => void;
  onDelete: (store: StoreRow) => void;
}

export function StoreTable({
  stores, filteredStores, isLoading, togglingId,
  storeSearch, statusFilter, joinedSort, prefersReducedMotion,
  onSearch, onStatusFilter, onJoinedSort, onRefresh,
  onEdit, onUsers, onToggleStatus, onDelete,
}: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center gap-3 justify-between">
        <h2 className="font-bold text-navy-900 flex items-center gap-2 shrink-0">
          <Store size={18} className="text-slate-400" />
          All Stores
          {(storeSearch || statusFilter !== 'all') && (
            <span className="text-xs font-normal text-slate-400">
              ({filteredStores.length} of {stores.length})
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={storeSearch}
              onChange={e => onSearch(e.target.value)}
              placeholder="Store name or email…"
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-navy-700 w-44"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => onStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-navy-700"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select
            value={joinedSort}
            onChange={e => onJoinedSort(e.target.value as 'newest' | 'oldest')}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-navy-700"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          <button
            onClick={onRefresh}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400">Loading stores...</div>
      ) : stores.length === 0 ? (
        <div className="p-12 text-center text-slate-400">No stores registered yet.</div>
      ) : filteredStores.length === 0 ? (
        <div className="p-12 text-center text-slate-400">No stores match your filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Store', 'Contact', 'Users', 'Items', 'Joined', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStores.map(store => (
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
                        <p className={cn('font-medium', store.status === 'suspended' ? 'text-slate-700' : 'text-navy-900')}>{store.name}</p>
                        {(store.street || store.address) && (
                          <p className={cn('text-xs mt-0.5', store.status === 'suspended' ? 'text-slate-700' : 'text-slate-600')}>
                            {[store.street, store.zipcode, store.state].filter(Boolean).join(', ') || store.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm">
                    {store.email && <p className="text-slate-700">{store.email}</p>}
                    {store.phone && <p className={cn(store.status === 'suspended' ? 'text-slate-700' : 'text-slate-600')}>{store.phone}</p>}
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
                        onClick={() => onEdit(store)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        onClick={() => onUsers(store)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                      >
                        <Users size={13} /> Users
                      </button>
                      <button
                        onClick={() => onToggleStatus(store)}
                        disabled={togglingId === store.id}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50',
                          store.status === 'active'
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        )}
                      >
                        {store.status === 'active'
                          ? <><ShieldOff size={13} /> Suspend</>
                          : <><ShieldCheck size={13} /> Activate</>}
                      </button>
                      <button
                        onClick={() => onDelete(store)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={13} /> Delete
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
  );
}
