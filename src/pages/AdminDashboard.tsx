import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  History,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAdminStores } from '../hooks/useAdminStores';
import { useAdminActivity, type ActivityEntry } from '../hooks/useAdminActivity';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import {
  HeaderStat,
  StoreAvatar,
  StoreStatusBadge,
  FILTER_SELECT,
  FILTER_INPUT,
  SEGMENT_ACTIVE,
} from '../components/superadmin/AdminUi';
import { timeAgo } from '../components/superadmin/format';
import type { StoreRow } from '../components/superadmin/types';

type StatusFilter = 'all' | 'active' | 'suspended';
type SortKey = 'items' | 'name' | 'recent';

const SORTS: Record<SortKey, (a: StoreRow, b: StoreRow) => number> = {
  items: (a, b) => b.item_count - a.item_count,
  name: (a, b) => a.name.localeCompare(b.name),
  recent: (a, b) => (b.last_item_added_at ?? '').localeCompare(a.last_item_added_at ?? ''),
};

interface Attention {
  key: string;
  tone: 'accent' | 'muted';
  title: string;
  detail: string;
  to: string;
}

// Things a superadmin should look at, worked out from the store list alone.
function needsAttention(stores: StoreRow[]): Attention[] {
  const out: Attention[] = [];
  for (const store of stores) {
    if (store.status !== 'active' && store.item_count > 0) {
      out.push({
        key: `suspended-${store.id}`,
        tone: 'accent',
        title: `${store.name} is suspended`,
        detail: `${store.item_count.toLocaleString()} items still in its catalog`,
        to: `/admin/stores/${store.id}`,
      });
    } else if (store.status === 'active' && store.item_count === 0) {
      out.push({
        key: `empty-${store.id}`,
        tone: 'accent',
        title: `${store.name} has no items`,
        detail: 'Nothing captured yet',
        to: `/admin/stores/${store.id}`,
      });
    }
  }
  for (const store of stores) {
    if (store.missing_upc_count > 0) {
      out.push({
        key: `upc-${store.id}`,
        tone: 'muted',
        title: `${store.missing_upc_count.toLocaleString()} ${store.missing_upc_count === 1 ? 'item' : 'items'} missing a UPC`,
        detail: store.name,
        to: `/admin/stores/${store.id}`,
      });
    }
  }
  return out;
}

// Super Admin landing page: every store's inventory at a glance, with a way into each one.
export default function AdminDashboard() {
  const admin = useAdminStores();
  const { fetchStores } = admin;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('items');

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const stores = admin.stores;
  const active = stores.filter(s => s.status === 'active').length;
  const totalItems = stores.reduce((n, s) => n + (s.item_count || 0), 0);
  const addedWeek = stores.reduce((n, s) => n + (s.items_added_week || 0), 0);
  const missingUpc = stores.reduce((n, s) => n + (s.missing_upc_count || 0), 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return stores
      .filter(s => statusFilter === 'all' || s.status === statusFilter)
      .filter(s => !needle || s.name.toLowerCase().includes(needle))
      .sort(SORTS[sort]);
  }, [stores, search, statusFilter, sort]);

  const attention = useMemo(() => needsAttention(stores), [stores]);

  return (
    <AdminLayout onLogout={admin.handleLogout} bare>
      {/* Header band */}
      <section className="bg-white border-b border-theme-border">
        <div className="px-4 md:pl-3 md:pr-6 py-6 flex flex-wrap items-center justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-black">All stores</h1>
            <p className="mt-1 text-sm text-theme-muted">
              Every store's OptiCapture inventory, in one place
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <HeaderStat label="Stores" value={stores.length} />
            <HeaderStat label="Active" value={active} tone="brand" />
            <HeaderStat label="Suspended" value={stores.length - active} tone="accent" />
            <HeaderStat label="Items" value={totalItems} />
            <HeaderStat label="This week" value={`+${addedWeek.toLocaleString()}`} tone="brand" />
            <HeaderStat label="No UPC" value={missingUpc} tone="accent" />
          </div>
        </div>
      </section>

      <div className="p-4 md:py-6 md:pr-6 md:pl-3 flex flex-wrap items-start gap-4">
        {/* Store table */}
        <section className="flex-[999_1_560px] min-w-0 bg-white rounded-xl border border-theme-border overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center gap-2.5">
            <label className="relative flex-[1_1_240px] max-w-sm">
              <span className="sr-only">Search store name</span>
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted"
              />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search Store Name"
                className={cn('w-full h-10 pl-9 pr-3', FILTER_INPUT)}
              />
            </label>
            <div
              role="group"
              aria-label="Status filter"
              className="flex gap-1 rounded-lg bg-theme-canvas p-1"
            >
              {(['all', 'active', 'suspended'] as const).map(value => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm capitalize transition-colors',
                    statusFilter === value
                      ? SEGMENT_ACTIVE
                      : 'text-theme-muted hover:text-theme-text'
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <label className="sr-only" htmlFor="store-sort">
              Sort stores
            </label>
            <select
              id="store-sort"
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className={cn('h-10', FILTER_SELECT)}
            >
              <option value="items">Most items</option>
              <option value="name">Name A–Z</option>
              <option value="recent">Last capture</option>
            </select>
          </div>

          {admin.isLoading ? (
            <p className="p-12 text-center text-sm text-theme-muted">Loading stores...</p>
          ) : visible.length === 0 ? (
            <p className="p-12 text-center text-sm text-theme-muted">
              {stores.length === 0 ? 'No stores registered yet.' : 'No stores match.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-theme-canvas border-b border-theme-border">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-theme-muted">
                    <th className="px-4 py-2.5">Store</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Items</th>
                    <th className="px-4 py-2.5 text-right">Categories</th>
                    <th className="px-4 py-2.5 text-right">This week</th>
                    <th className="px-4 py-2.5">Last capture</th>
                    <th className="px-4 py-2.5">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border/60">
                  {visible.map(store => (
                    <tr key={store.id} className="hover:bg-theme-subtle transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StoreAvatar name={store.name} logo={store.logo} />
                          <div className="min-w-0">
                            <Link
                              to={`/admin/stores/${store.id}`}
                              className="font-semibold text-brand-600 hover:text-brand-700"
                            >
                              {store.name}
                            </Link>
                            {store.city && <p className="text-xs text-theme-muted">{store.city}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StoreStatusBadge status={store.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-black">
                        {store.item_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {store.category_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-brand-600">
                        {store.items_added_week > 0 ? `+${store.items_added_week}` : '0'}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-muted whitespace-nowrap">
                        {timeAgo(store.last_item_added_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/stores/${store.id}`}
                          aria-label={`Open ${store.name} inventory`}
                          className="inline-flex w-8 h-8 items-center justify-center rounded-lg text-theme-muted hover:bg-brand-50 hover:text-brand-600"
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!admin.isLoading && stores.length > 0 && (
            <p className="px-4 py-3 border-t border-theme-border text-sm text-theme-muted">
              Showing {visible.length} of {stores.length} stores
            </p>
          )}
        </section>

        <div className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
          {/* Needs attention */}
          <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
            <h2 className="px-4 py-3.5 border-b border-theme-border flex items-center gap-2 font-bold text-black">
              <AlertTriangle size={18} className="text-accent-600" />
              Needs attention
            </h2>
            {attention.length === 0 ? (
              <p className="px-4 py-6 text-sm text-theme-muted">
                {admin.isLoading ? 'Checking stores...' : 'Nothing needs attention right now.'}
              </p>
            ) : (
              <ul className="divide-y divide-theme-border/60">
                {attention.map(entry => (
                  <li key={entry.key}>
                    <Link
                      to={entry.to}
                      className="flex gap-3 px-4 py-3 hover:bg-theme-subtle transition-colors"
                    >
                      <span
                        className={cn(
                          'mt-1.5 w-2 h-2 rounded-full shrink-0',
                          entry.tone === 'accent' ? 'bg-accent-600' : 'bg-slate-400'
                        )}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-black">
                          {entry.title}
                        </span>
                        <span className="block text-sm text-theme-muted">{entry.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <RecentChanges />
        </div>
      </div>
    </AdminLayout>
  );
}

const CHANGE_ICONS: Record<ActivityEntry['action'], { icon: LucideIcon; tone: string }> = {
  CREATE: { icon: Plus, tone: 'bg-brand-50 text-brand-600' },
  BATCH: { icon: ScanLine, tone: 'bg-brand-50 text-brand-600' },
  IMPORT: { icon: Upload, tone: 'bg-brand-50 text-brand-600' },
  UPDATE: { icon: Pencil, tone: 'bg-theme-subtle text-theme-muted' },
  DELETE: { icon: Trash2, tone: 'bg-accent-50 text-accent-600' },
};

// What changed lately across all stores: items added, edited, removed, imported or scanned in.
function RecentChanges() {
  const { entries, error } = useAdminActivity(10);

  return (
    <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
      <h2 className="px-4 py-3.5 border-b border-theme-border flex items-center gap-2 font-bold text-black">
        <History size={18} className="text-brand-600" />
        Recent changes
      </h2>
      {error ? (
        <p className="px-4 py-6 text-sm text-accent-600">{error}</p>
      ) : entries === null ? (
        <p className="px-4 py-6 text-sm text-theme-muted">Loading changes...</p>
      ) : entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-theme-muted">No changes yet.</p>
      ) : (
        <ul className="divide-y divide-theme-border/60">
          {entries.map(entry => {
            const { icon: Icon, tone } = CHANGE_ICONS[entry.action] ?? CHANGE_ICONS.UPDATE;
            return (
              <li key={entry.id}>
                <Link
                  to={`/admin/stores/${entry.store_id}`}
                  className="flex gap-3 px-4 py-3 hover:bg-theme-subtle transition-colors"
                >
                  <span
                    className={cn(
                      'mt-0.5 w-7 h-7 rounded-lg shrink-0 flex items-center justify-center',
                      tone
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-black break-words">
                      {entry.summary}
                    </span>
                    <span className="block text-sm text-theme-muted">
                      <span className="text-brand-600">{entry.store_name}</span>
                      {entry.username && ` · ${entry.username}`} · {timeAgo(entry.timestamp)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
