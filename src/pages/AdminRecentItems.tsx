import { Clock as ClockIcon, Store as StoreIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import { RecentItemsTable } from '../components/superadmin/RecentItemsTable';
import {
  Breadcrumb,
  HeaderStat,
  FILTER_SELECT,
  SelectIcon,
  type Crumb,
} from '../components/superadmin/AdminUi';
import { useAdminStoreList } from '../hooks/useAdminStoreList';
import {
  RECENT_PAGE_SIZE,
  RECENT_WINDOWS,
  RECENT_WINDOW_LABELS,
  useAdminRecentItems,
  type RecentWindow,
} from '../hooks/useAdminRecentItems';

// Superadmin: the items stores have added lately, across every store or one. OptiCapture is
// capture-first, so this is the main thing to keep an eye on.
export default function AdminRecentItems() {
  const view = useAdminRecentItems();
  const stores = useAdminStoreList();
  const store = view.storeId === null ? undefined : stores?.find(s => s.id === view.storeId);

  const windowLabel = RECENT_WINDOW_LABELS[view.days].toLowerCase();
  const trail: Crumb[] = [
    { label: 'All stores', to: '/admin' },
    ...(view.storeId === null
      ? []
      : [{ label: store?.name ?? 'Store', to: `/admin/stores/${view.storeId}` }]),
    { label: 'Recently added' },
  ];

  return (
    <AdminLayout onLogout={view.handleLogout} bare>
      <section className="bg-white border-b border-theme-border">
        <Breadcrumb className="px-4 md:pl-3 md:pr-6 pt-4" trail={trail} />
        <div className="px-4 md:pl-3 md:pr-6 pt-3 pb-6 flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-black">Recently added</h1>
            <p className="mt-1 text-sm text-theme-muted">
              New items {store ? `in ${store.name}` : 'across every store'}, newest first
            </p>
          </div>
          <HeaderStat
            label={RECENT_WINDOW_LABELS[view.days]}
            value={
              view.loading && view.items.length === 0 ? '…' : `+${view.total.toLocaleString()}`
            }
            tone="brand"
          />
        </div>
      </section>

      <div className="p-4 md:py-6 md:pr-6 md:pl-3">
        <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center gap-2.5">
            <label className="sr-only" htmlFor="recent-store">
              Store
            </label>
            <SelectIcon icon={StoreIcon} className="max-w-full">
              <select
                id="recent-store"
                value={view.storeId ?? ''}
                onChange={e =>
                  view.setStoreId(e.target.value === '' ? null : Number(e.target.value))
                }
                className={cn('h-10 max-w-full', FILTER_SELECT, 'pl-8')}
              >
                <option value="">All stores</option>
                {/* Keep a store named in the URL selectable while the list loads. */}
                {view.storeId !== null && !store && <option value={view.storeId}>Store</option>}
                {(stores ?? []).map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.status === 'active' ? '' : ' (suspended)'}
                  </option>
                ))}
              </select>
            </SelectIcon>
            <label className="sr-only" htmlFor="recent-window">
              Added within
            </label>
            <SelectIcon icon={ClockIcon}>
              <select
                id="recent-window"
                value={view.days}
                onChange={e => view.setDays(Number(e.target.value) as RecentWindow)}
                className={cn('h-10', FILTER_SELECT, 'pl-8')}
              >
                {RECENT_WINDOWS.map(days => (
                  <option key={days} value={days}>
                    {RECENT_WINDOW_LABELS[days]}
                  </option>
                ))}
              </select>
            </SelectIcon>
          </div>

          <RecentItemsTable
            items={view.items}
            total={view.total}
            loading={view.loading}
            error={view.error}
            showStore={view.storeId === null}
            emptyText={`No items added in the ${windowLabel}.`}
            pageSize={RECENT_PAGE_SIZE}
            currentPage={view.page}
            onPageChange={view.setPage}
          />
        </section>
      </div>
    </AdminLayout>
  );
}
