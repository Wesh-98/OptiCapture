import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Store,
  Users,
  ShieldCheck,
  ShieldOff,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  Package,
} from 'lucide-react';
import { cn, parseServerDate } from '../../lib/utils';
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
  onInventory: (store: StoreRow) => void;
  onEdit: (store: StoreRow) => void;
  onUsers: (store: StoreRow) => void;
  onToggleStatus: (store: StoreRow) => void;
  onDelete: (store: StoreRow) => void;
  selectedIds: ReadonlySet<number>;
  onToggleStore: (id: number) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;
}

export function StoreTable({
  stores,
  filteredStores,
  isLoading,
  togglingId,
  storeSearch,
  statusFilter,
  joinedSort,
  prefersReducedMotion,
  onSearch,
  onStatusFilter,
  onJoinedSort,
  onRefresh,
  onInventory,
  onEdit,
  onUsers,
  onToggleStatus,
  onDelete,
  selectedIds,
  onToggleStore,
  onToggleAll,
  onClearSelection,
}: Props) {
  // Select All covers the stores the filters currently show.
  const selectedVisible = filteredStores.filter(store => selectedIds.has(store.id)).length;
  const allVisibleSelected = filteredStores.length > 0 && selectedVisible === filteredStores.length;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisible > 0 && !allVisibleSelected;
    }
  }, [selectedVisible, allVisibleSelected]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-theme-border overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-theme-border bg-theme-subtle flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bold text-theme-text flex items-center gap-2 shrink-0">
            <Store size={18} className="text-brand-600" />
            All Stores
            {(storeSearch || statusFilter !== 'all') && (
              <span className="text-xs font-normal text-slate-400">
                ({filteredStores.length} of {stores.length})
              </span>
            )}
          </h2>
          {selectedIds.size > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              {selectedIds.size} selected
              <button onClick={onClearSelection} className="font-semibold hover:text-brand-600">
                Clear
              </button>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={storeSearch}
              onChange={e => onSearch(e.target.value)}
              placeholder="Store name or email…"
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 w-44"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => onStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select
            value={joinedSort}
            onChange={e => onJoinedSort(e.target.value as 'newest' | 'oldest')}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
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
            <thead className="bg-theme-canvas border-b border-theme-border">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-black">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={onToggleAll}
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-400"
                    />
                    Select All
                  </label>
                </th>
                {['Store', 'Contact', 'Address', 'Items', 'Joined', 'Status', 'Actions'].map(h => (
                  <th
                    key={h}
                    className="px-3 py-3 text-xs font-semibold text-black uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStores.map(store => {
                const locality = [store.city, store.state].filter(Boolean).join(', ');
                const addressLine =
                  [store.street, locality, store.zipcode].filter(Boolean).join(' ') ||
                  store.address;

                return (
                  <motion.tr
                    key={store.id}
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={prefersReducedMotion ? {} : { opacity: 1 }}
                    className={cn(
                      'transition-colors',
                      store.status === 'suspended' ? 'bg-accent-50' : 'hover:bg-theme-subtle'
                    )}
                  >
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(store.id)}
                        onChange={() => onToggleStore(store.id)}
                        aria-label={`Select ${store.name}`}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-400"
                      />
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-3">
                        {store.logo ? (
                          <img
                            src={store.logo}
                            alt={store.name}
                            className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm flex-shrink-0">
                            {store.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p
                          className={cn(
                            'font-medium whitespace-nowrap',
                            store.status === 'suspended' ? 'text-brand-700' : 'text-brand-600'
                          )}
                        >
                          {store.name}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-sm">
                      {store.email && <p className="text-slate-700">{store.email}</p>}
                      {store.phone && (
                        <p
                          className={cn(
                            store.status === 'suspended' ? 'text-slate-700' : 'text-slate-600'
                          )}
                        >
                          {store.phone}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-4 text-sm text-slate-600 min-w-[12rem]">
                      {addressLine || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-4 text-sm text-slate-700 font-mono">
                      {store.item_count}
                    </td>
                    <td className="px-3 py-4 text-sm text-slate-600">
                      {parseServerDate(store.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md border bg-white px-2.5 py-1 text-xs font-medium capitalize',
                          store.status === 'active'
                            ? 'border-brand-600 text-brand-700'
                            : 'border-accent-600 text-accent-600'
                        )}
                      >
                        {store.status}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onInventory(store)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-theme-subtle text-brand-600 hover:bg-slate-200 transition-colors"
                        >
                          <Package size={13} /> Inventory
                        </button>
                        <button
                          onClick={() => onEdit(store)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-theme-canvas text-theme-text hover:bg-navy-200 transition-colors"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          onClick={() => onUsers(store)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-theme-subtle text-brand-600 hover:bg-slate-200 transition-colors"
                        >
                          <Users size={13} /> Users
                        </button>
                        <button
                          onClick={() => onToggleStatus(store)}
                          disabled={togglingId === store.id}
                          title={store.status === 'active' ? 'Suspend store' : 'Activate store'}
                          aria-label={`${store.status === 'active' ? 'Suspend' : 'Activate'} ${store.name}`}
                          className={cn(
                            'flex items-center p-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50',
                            store.status === 'active'
                              ? 'bg-accent-50 text-accent-600 hover:bg-accent-100'
                              : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                          )}
                        >
                          {store.status === 'active' ? (
                            <>
                              <ShieldOff size={14} />
                            </>
                          ) : (
                            <>
                              <ShieldCheck size={14} />
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => onDelete(store)}
                          title="Delete store"
                          aria-label={`Delete ${store.name}`}
                          className="flex items-center p-2 rounded-lg text-xs font-medium bg-accent-50 text-accent-600 hover:bg-accent-100 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
