import { Search, Store as StoreIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import { RecentItemsTable } from '../components/superadmin/RecentItemsTable';
import {
  Breadcrumb,
  HeaderStat,
  FILTER_INPUT,
  FILTER_SELECT,
  SelectIcon,
  type Crumb,
} from '../components/superadmin/AdminUi';
import { useAdminStoreList } from '../hooks/useAdminStoreList';
import {
  SEARCH_MIN_LENGTH,
  SEARCH_PAGE_SIZE,
  useAdminItemSearch,
} from '../hooks/useAdminItemSearch';

// Superadmin: find an item in any store's catalog by name, UPC, brand, category or tag.
export default function AdminItemSearch() {
  const view = useAdminItemSearch();
  const stores = useAdminStoreList();
  const store = view.storeId === null ? undefined : stores?.find(s => s.id === view.storeId);

  const trail: Crumb[] = [
    { label: 'All stores', to: '/admin' },
    ...(view.storeId === null
      ? []
      : [{ label: store?.name ?? 'Store', to: `/admin/stores/${view.storeId}` }]),
    { label: 'Search items' },
  ];

  return (
    <AdminLayout onLogout={view.handleLogout} bare>
      <section className="bg-white border-b border-theme-border">
        <Breadcrumb className="px-4 md:pl-3 md:pr-6 pt-4" trail={trail} />
        <div className="px-4 md:pl-3 md:pr-6 pt-3 pb-6 flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-black">Search items</h1>
            <p className="mt-1 text-sm text-theme-muted">
              Find an item by name, UPC, brand, category or tag{' '}
              {store ? `in ${store.name}` : 'across every store'}
            </p>
          </div>
          {view.searchable && (
            <HeaderStat
              label="Matches"
              value={view.loading && view.items.length === 0 ? '…' : view.total}
              tone="brand"
            />
          )}
        </div>
      </section>

      <div className="p-4 md:py-6 md:pr-6 md:pl-3">
        <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center gap-2.5">
            <label className="sr-only" htmlFor="search-store">
              Store
            </label>
            <SelectIcon icon={StoreIcon} className="max-w-full">
              <select
                id="search-store"
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
            <label className="relative flex-[1_1_240px]">
              <span className="sr-only">Search items</span>
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted"
              />
              <input
                type="search"
                autoFocus
                value={view.input}
                onChange={e => view.setInput(e.target.value)}
                placeholder="Name, UPC, brand, category or tag…"
                className={cn('w-full h-10 pl-9 pr-3', FILTER_INPUT)}
              />
            </label>
          </div>

          {view.searchable ? (
            <RecentItemsTable
              items={view.items}
              total={view.total}
              loading={view.loading}
              error={view.error}
              showStore={view.storeId === null}
              emptyText={`No items match "${view.query}".`}
              pageSize={SEARCH_PAGE_SIZE}
              currentPage={view.page}
              onPageChange={view.setPage}
            />
          ) : (
            <div className="p-12 text-center text-sm text-theme-muted">
              Type at least {SEARCH_MIN_LENGTH} characters to search.
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
