import { useParams } from 'react-router-dom';
import {
  Eye,
  Search,
  ArrowDownUp as ArrowDownUpIcon,
  Filter as FilterIcon,
  Tag as TagIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import { StoreInventoryTable } from '../components/superadmin/StoreInventoryTable';
import {
  Breadcrumb,
  HeaderStat,
  StoreAvatar,
  StoreStatusBadge,
  FILTER_SELECT,
  FILTER_INPUT,
  SelectIcon,
} from '../components/superadmin/AdminUi';
import {
  CATEGORY_PARAM,
  useAdminStoreInventory,
  ITEM_SORT_LABELS,
  type ItemSort,
  type ItemStatusFilter,
} from '../hooks/useAdminStoreInventory';

// Superadmin: read-only view of one store's OptiCapture inventory. Edits come later and
// will be logged to the store; this page only reads.
export default function AdminStoreInventory() {
  const { id } = useParams<{ id: string }>();
  const view = useAdminStoreInventory(id);
  const { store, categories } = view;

  const storeHref = `/admin/stores/${id}`;
  const selectedCategory = categories.find(c => c.id === view.categoryId);
  const categoryQuery = view.categoryId === null ? '' : `?${CATEGORY_PARAM}=${view.categoryId}`;

  const filtered =
    Boolean(view.search.trim()) || view.categoryId !== null || view.statusFilter !== 'all';
  const address = store
    ? [store.street, store.city, [store.state, store.zipcode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <AdminLayout onLogout={view.handleLogout} bare>
      {view.loadError ? (
        <div className="m-4 md:m-6 bg-white rounded-xl border border-theme-border p-12 text-center">
          <p className="text-sm font-medium text-accent-600">{view.loadError}</p>
        </div>
      ) : (
        <>
          {/* Store header band */}
          <section className="bg-white border-b border-theme-border">
            <Breadcrumb
              className="px-4 md:pl-3 md:pr-6 pt-4"
              trail={[
                { label: 'All stores', to: '/admin' },
                { label: store?.name ?? 'Store', to: storeHref },
                ...(view.categoryId === null
                  ? []
                  : [{ label: selectedCategory?.name ?? 'Category' }]),
              ]}
            />
            <div className="px-4 md:pl-3 md:pr-6 pt-3 pb-6 flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-4 min-w-0">
                <StoreAvatar name={store?.name ?? ''} logo={store?.logo} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="text-2xl font-bold text-black truncate">
                      {store?.name ?? 'Loading store…'}
                    </h1>
                    {store && <StoreStatusBadge status={store.status} />}
                  </div>
                  <p className="mt-1 text-sm text-theme-muted">{address || 'Store inventory'}</p>
                </div>
              </div>
              {store && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <HeaderStat label="Items" value={store.item_count} />
                  <HeaderStat label="Categories" value={store.category_count} />
                  <HeaderStat
                    label="This week"
                    value={`+${store.items_added_week.toLocaleString()}`}
                    tone="brand"
                  />
                  <HeaderStat label="No UPC" value={store.missing_upc_count} tone="accent" />
                </div>
              )}
            </div>
          </section>

          <div className="p-4 md:py-6 md:pr-6 md:pl-3">
            <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
              <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center gap-2.5">
                <label className="sr-only" htmlFor="item-category">
                  Category
                </label>
                <SelectIcon icon={TagIcon} className="max-w-full">
                  <select
                    id="item-category"
                    value={view.categoryId ?? ''}
                    onChange={e =>
                      view.setCategoryId(e.target.value === '' ? null : Number(e.target.value))
                    }
                    className={cn('h-10 max-w-full pl-8', FILTER_SELECT)}
                  >
                    <option value="">Select Category</option>
                    {categories.map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name} ({category.item_count.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </SelectIcon>
                <label className="relative flex-[1_1_260px] max-w-md">
                  <span className="sr-only">Search items</span>
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted"
                  />
                  <input
                    type="search"
                    value={view.search}
                    onChange={e => view.setSearch(e.target.value)}
                    placeholder="Name, UPC or category…"
                    className={cn('w-full h-10 pl-9 pr-3', FILTER_INPUT)}
                  />
                </label>
                <label className="sr-only" htmlFor="item-status">
                  Item status
                </label>
                <SelectIcon icon={FilterIcon}>
                  <select
                    id="item-status"
                    value={view.statusFilter}
                    onChange={e => view.setStatusFilter(e.target.value as ItemStatusFilter)}
                    className={cn('h-10 pl-8', FILTER_SELECT)}
                  >
                    <option value="all">All status</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">In-Active</option>
                  </select>
                </SelectIcon>
                <label className="sr-only" htmlFor="item-sort">
                  Sort items
                </label>
                <SelectIcon icon={ArrowDownUpIcon}>
                  <select
                    id="item-sort"
                    value={view.sort}
                    onChange={e => view.setSort(e.target.value as ItemSort)}
                    className={cn('h-10 pl-8', FILTER_SELECT)}
                  >
                    {(Object.keys(ITEM_SORT_LABELS) as ItemSort[]).map(value => (
                      <option key={value} value={value}>
                        {ITEM_SORT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </SelectIcon>
                <div className="flex-1" />
                <span className="inline-flex items-center gap-1.5 text-sm text-theme-muted">
                  <Eye size={15} className="text-brand-600" />
                  Read-only
                </span>
              </div>

              <StoreInventoryTable
                items={view.items}
                total={view.total}
                loading={view.itemsLoading}
                error={view.itemsError}
                filtered={filtered}
                pageSize={view.pageSize}
                currentPage={view.page}
                onPageSizeChange={view.setPageSize}
                onPageChange={view.setPage}
                itemHref={item => `${storeHref}/items/${item.id}${categoryQuery}`}
              />
            </section>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
