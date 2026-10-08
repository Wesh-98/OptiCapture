import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Pencil,
  Search,
  X,
  ArrowDownUp as ArrowDownUpIcon,
  Filter as FilterIcon,
  Store as StoreIcon,
  Tag as TagIcon,
} from 'lucide-react';
import { cn, parseServerDate } from '../lib/utils';
import { AdminLayout } from '../components/superadmin/AdminLayout';
import {
  Breadcrumb,
  ItemStatusText,
  StoreAvatar,
  StoreStatusBadge,
  FILTER_SELECT,
  FILTER_INPUT,
  SelectIcon,
  ICON_ONLY_SELECT,
} from '../components/superadmin/AdminUi';
import { formatPrice } from '../components/superadmin/format';
import { ItemEditForm } from '../components/superadmin/ItemEditForm';
import {
  CATEGORY_PARAM,
  useAdminStoreInventory,
  ITEM_SORT_LABELS,
  ITEM_STATUS_LABELS as STATUS_LABELS,
  type ItemSort,
  type ItemStatusFilter,
  type ViewedStore,
} from '../hooks/useAdminStoreInventory';
import { useAdminItemDetail } from '../hooks/useAdminItemDetail';
import { useAdminStoreList } from '../hooks/useAdminStoreList';

const PANE_HEADING =
  'px-4 py-3.5 border-b border-theme-border text-xs font-extrabold uppercase tracking-wider text-brand-600';

// Superadmin: one item in context. Store | items (by category) | detail, with editing
// for active stores.
// Without an item in the URL the detail pane waits for a pick.
export default function AdminItemDetail() {
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const view = useAdminStoreInventory(id);
  const detail = useAdminItemDetail(id, itemId);
  const stores = useAdminStoreList();

  // The detail hook keeps the previous item until the next one loads; don't treat it as this one.
  const viewedItem = detail.item && String(detail.item.id) === itemId ? detail.item : null;

  // Editing belongs to one item: opening another item leaves the form behind. Suspended
  // stores stay read-only (the server refuses their edits too).
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const editing = editingItemId !== null && editingItemId === itemId;
  const canEdit = Boolean(viewedItem) && view.store?.status === 'active';

  // With no category in the URL, open the items pane on the item's own category, once per
  // store; after that the superadmin's own choice sticks while they move between items.
  const categoryShownFor = useRef<string | undefined>(undefined);
  const { categoryId, setCategoryId } = view;
  // Browsing a store with no item open counts as the superadmin's choice already.
  useEffect(() => {
    if (categoryShownFor.current === id) return;
    if (!itemId) {
      categoryShownFor.current = id;
      return;
    }
    if (!viewedItem) return;
    categoryShownFor.current = id;
    if (categoryId === null && viewedItem.category_id) setCategoryId(viewedItem.category_id);
  }, [viewedItem, id, itemId, categoryId, setCategoryId]);

  const selectedCategory = view.categories.find(c => c.id === view.categoryId);
  const categoryTitle =
    view.categoryId === null
      ? 'All items'
      : (selectedCategory?.name ?? viewedItem?.category_name ?? 'Category');
  const storeHref = `/admin/stores/${id}`;

  // Switching store stays in this view: open the same product there if that store carries
  // its UPC, otherwise show the new store's items with nothing selected.
  const navigate = useNavigate();
  const switchStore = (storeId: number) => {
    if (String(storeId) === id) return;
    const sameItem = viewedItem
      ? detail.otherStores.find(entry => entry.store_id === storeId)
      : undefined;
    navigate(
      sameItem
        ? `/admin/stores/${storeId}/items/${sameItem.item_id}`
        : `/admin/stores/${storeId}/items`
    );
  };
  const categoryQuery = view.categoryId === null ? '' : `?${CATEGORY_PARAM}=${view.categoryId}`;

  return (
    <AdminLayout onLogout={view.handleLogout} bare>
      <div className="flex flex-col lg:h-full lg:min-h-0">
        <Breadcrumb
          className="shrink-0 bg-white border-b border-theme-border px-4 md:pl-3 md:pr-6 py-2"
          trail={[
            { label: 'All stores', to: '/admin' },
            { label: view.store?.name ?? 'Store', to: storeHref },
            ...(viewedItem?.category_id
              ? [
                  {
                    label: viewedItem.category_name || 'Category',
                    to: `${storeHref}?${CATEGORY_PARAM}=${viewedItem.category_id}`,
                  },
                ]
              : []),
            { label: itemId ? (viewedItem?.item_name ?? 'Item') : 'Select an item' },
          ]}
        />
        <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0">
          <StoresPane stores={stores} current={view.store} onSelect={switchStore} />

          {/* Items */}
          <section
            aria-label="Items"
            className="order-2 lg:order-none flex-1 min-w-0 flex flex-col bg-white min-h-0"
          >
            <div className="px-5 py-4 border-b border-theme-border space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-black truncate">
                    {categoryTitle}{' '}
                    <span className="text-sm font-normal text-theme-muted">
                      · {view.total.toLocaleString()} items
                    </span>
                  </h1>
                </div>
                {view.store && view.store.status !== 'active' && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-accent-600">
                    <Eye size={15} />
                    Read-only while suspended
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor="detail-item-category">
                  Category
                </label>
                <SelectIcon icon={TagIcon} className="max-w-full">
                  <select
                    id="detail-item-category"
                    value={view.categoryId ?? ''}
                    onChange={e =>
                      view.setCategoryId(e.target.value === '' ? null : Number(e.target.value))
                    }
                    className={cn('h-9 max-w-full', FILTER_SELECT, 'pl-8')}
                  >
                    <option value="">Select Category</option>
                    {view.categories.map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name} ({category.item_count.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </SelectIcon>
                <label className="relative flex-[1_1_200px]">
                  <span className="sr-only">Search items</span>
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted"
                  />
                  <input
                    type="search"
                    value={view.search}
                    onChange={e => view.setSearch(e.target.value)}
                    placeholder={`Search in ${categoryTitle}…`}
                    className={cn('w-full h-9 pl-9 pr-3', FILTER_INPUT)}
                  />
                </label>
                <label className="sr-only" htmlFor="detail-item-status">
                  Item status
                </label>
                <SelectIcon
                  icon={FilterIcon}
                  iconOnly
                  active={view.statusFilter !== 'all'}
                  title={`Status: ${STATUS_LABELS[view.statusFilter]}`}
                  className="w-9 h-9"
                >
                  <select
                    id="detail-item-status"
                    value={view.statusFilter}
                    onChange={e => view.setStatusFilter(e.target.value as ItemStatusFilter)}
                    className={ICON_ONLY_SELECT}
                  >
                    <option value="all">All status</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">In-Active</option>
                  </select>
                </SelectIcon>
                <label className="sr-only" htmlFor="detail-item-sort">
                  Sort items
                </label>
                <SelectIcon
                  icon={ArrowDownUpIcon}
                  iconOnly
                  active={view.sort !== 'recent'}
                  title={`Sort: ${ITEM_SORT_LABELS[view.sort]}`}
                  className="w-9 h-9"
                >
                  <select
                    id="detail-item-sort"
                    value={view.sort}
                    onChange={e => view.setSort(e.target.value as ItemSort)}
                    className={ICON_ONLY_SELECT}
                  >
                    {(Object.keys(ITEM_SORT_LABELS) as ItemSort[]).map(value => (
                      <option key={value} value={value}>
                        {ITEM_SORT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </SelectIcon>
              </div>
            </div>

            <div className={cn('flex-1 overflow-y-auto', view.itemsLoading && 'opacity-60')}>
              {view.itemsError ? (
                <p className="p-8 text-center text-sm text-accent-600">{view.itemsError}</p>
              ) : view.items.length === 0 ? (
                <p className="p-8 text-center text-sm text-theme-muted">
                  {view.itemsLoading ? 'Loading items...' : 'No items match.'}
                </p>
              ) : (
                <ul>
                  {view.items.map(item => {
                    const selected = String(item.id) === itemId;
                    return (
                      <li key={item.id}>
                        <Link
                          to={`${storeHref}/items/${item.id}${categoryQuery}`}
                          aria-current={selected ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3.5 px-5 py-3 border-b border-theme-border/60 transition-colors',
                            selected
                              ? 'bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand-400)]'
                              : 'hover:bg-theme-subtle'
                          )}
                        >
                          <ItemThumb src={item.image} />
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-sm font-semibold text-black">
                              {item.item_name}
                            </span>
                            <span
                              className={cn(
                                'block font-mono text-xs',
                                item.upc ? 'text-theme-muted' : 'text-accent-600'
                              )}
                            >
                              {item.upc || 'No UPC'}
                            </span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <span className="font-mono text-sm text-black">
                              {formatPrice(item.sale_price)}
                            </span>
                            <ItemStatusText status={item.status} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {view.total > view.pageSize && (
              <div className="px-5 py-2.5 border-t border-theme-border flex items-center justify-between text-xs text-theme-muted">
                <span>
                  Page {view.page} of {Math.ceil(view.total / view.pageSize)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => view.setPage(Math.max(1, view.page - 1))}
                    disabled={view.page === 1}
                    aria-label="Previous page"
                    className="p-1.5 rounded-lg border border-theme-border text-brand-600 hover:bg-brand-50 disabled:opacity-30"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => view.setPage(view.page + 1)}
                    disabled={view.page * view.pageSize >= view.total}
                    aria-label="Next page"
                    className="p-1.5 rounded-lg border border-theme-border text-brand-600 hover:bg-brand-50 disabled:opacity-30"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Item detail */}
          <aside
            aria-label="Item detail"
            className="order-1 lg:order-none w-full lg:w-[340px] shrink-0 bg-white border-b lg:border-b-0 lg:border-l border-theme-border flex flex-col min-h-0"
          >
            <div className={cn(PANE_HEADING, 'flex items-center justify-between gap-2 py-2')}>
              <span>{editing ? 'Edit item' : 'Item detail'}</span>
              <span className="flex items-center gap-1">
                {canEdit && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setSavedFor(null);
                      setEditingItemId(itemId ?? null);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold normal-case tracking-normal text-white hover:bg-brand-700"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                )}
                <Link
                  to={`${storeHref}${categoryQuery}`}
                  aria-label="Close item detail"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-theme-muted hover:bg-theme-subtle"
                >
                  <X size={16} />
                </Link>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {editing && viewedItem && id ? (
                <ItemEditForm
                  // A reload after a refused save brings a new revision: start from it.
                  key={`${viewedItem.id}-${viewedItem.revision}`}
                  storeId={id}
                  item={viewedItem}
                  categories={view.categories}
                  onSaved={(saved, otherStores) => {
                    // This can arrive after the superadmin has opened another item, so every
                    // update is tied to the saved item, not to whatever is on screen.
                    const savedId = String(saved.id);
                    detail.applyEdit(saved, otherStores);
                    view.refresh();
                    setEditingItemId(current => (current === savedId ? null : current));
                    setSavedFor(savedId);
                  }}
                  onCancel={() => setEditingItemId(null)}
                  onReload={detail.reload}
                />
              ) : itemId ? (
                <>
                  {savedFor === itemId && (
                    <p
                      role="status"
                      className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700"
                    >
                      Changes saved and recorded in the store's activity log.
                    </p>
                  )}
                  <ItemDetailBody
                    detail={detail}
                    storeName={view.store?.name}
                    loading={detail.loading}
                  />
                </>
              ) : (
                <p className="text-sm text-theme-muted">
                  Select an item from the list to see its details.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}

// Store choice is a dropdown, not a list of links, so a stray click can't pull the
// superadmin out of the item they are looking at.
function StoresPane({
  stores,
  current,
  onSelect,
}: Readonly<{
  stores: ReturnType<typeof useAdminStoreList>;
  current: ViewedStore | null;
  onSelect: (storeId: number) => void;
}>) {
  const address = current
    ? [current.street, current.city, [current.state, current.zipcode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <section
      aria-label="Stores"
      className="w-full lg:w-[240px] shrink-0 flex flex-col bg-white border-b lg:border-b-0 lg:border-r border-theme-border lg:min-h-0"
    >
      <h2 className={PANE_HEADING}>Store</h2>
      <div className="p-3 space-y-4">
        <label className="sr-only" htmlFor="detail-store">
          Store
        </label>
        <SelectIcon icon={StoreIcon} className="w-full">
          <select
            id="detail-store"
            value={current?.id ?? ''}
            onChange={e => onSelect(Number(e.target.value))}
            disabled={stores === null}
            className={cn('w-full h-10', FILTER_SELECT, 'pl-8')}
          >
            {stores === null && <option value="">Loading stores...</option>}
            {stores?.map(store => (
              <option key={store.id} value={store.id}>
                {store.name}
                {store.status === 'active' ? '' : ' (Suspended)'}
              </option>
            ))}
          </select>
        </SelectIcon>

        {current && (
          <div className="hidden lg:block space-y-3">
            <div className="flex items-center gap-2.5">
              <StoreAvatar name={current.name} logo={current.logo} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-black">{current.name}</p>
                <StoreStatusBadge status={current.status} />
              </div>
            </div>
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ['Items', current.item_count.toLocaleString()],
                  ['Categories', current.category_count.toLocaleString()],
                  ['This week', `+${current.items_added_week.toLocaleString()}`],
                  ['No UPC', current.missing_upc_count.toLocaleString()],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-theme-muted">{label}</dt>
                  <dd className="font-mono font-semibold text-black">{value}</dd>
                </div>
              ))}
            </dl>
            {address && <p className="text-xs text-theme-muted">{address}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function ItemThumb({ src, large = false }: Readonly<{ src?: string; large?: boolean }>) {
  const box = large ? 'w-full h-44 rounded-xl' : 'w-11 h-11 rounded-lg';
  return (
    <span
      className={cn(
        box,
        'shrink-0 overflow-hidden border border-theme-border bg-theme-canvas flex items-center justify-center text-slate-400'
      )}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <ImageIcon size={large ? 28 : 16} />
      )}
    </span>
  );
}

function ItemDetailBody({
  detail,
  storeName,
  loading,
}: Readonly<{
  detail: ReturnType<typeof useAdminItemDetail>;
  storeName: string | undefined;
  loading: boolean;
}>) {
  const { item, otherStores, error } = detail;
  if (error) return <p className="text-sm font-medium text-accent-600">{error}</p>;
  if (!item) {
    return <p className="text-sm text-theme-muted">{loading ? 'Loading item...' : ''}</p>;
  }

  const facts: Array<[string, ReactNode]> = [
    ['Category', item.category_name || '—'],
    ['Status', <ItemStatusText key="status" status={item.status} />],
    ['Unit', item.unit || '—'],
    ['Quantity', item.quantity ?? '—'],
    ['Sale price', formatPrice(item.sale_price)],
    ['Tax', item.tax_percent != null ? `${item.tax_percent}%` : '—'],
    ['Captured', item.created_at ? parseServerDate(item.created_at).toLocaleString() : '—'],
    ['Updated', item.updated_at ? parseServerDate(item.updated_at).toLocaleString() : '—'],
  ];

  return (
    <div className={cn('space-y-5', loading && 'opacity-60')}>
      <ItemThumb src={item.image} large />
      <div>
        <h2 className="text-lg font-bold text-black">{item.item_name}</h2>
        <p className={cn('font-mono text-sm', item.upc ? 'text-theme-muted' : 'text-accent-600')}>
          {item.upc ? `UPC ${item.upc}` : 'No UPC'}
        </p>
        {storeName && <p className="mt-0.5 text-xs text-theme-muted">{storeName}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-theme-muted">{label}</dt>
            <dd className="mt-0.5 text-sm text-black">{value}</dd>
          </div>
        ))}
      </dl>
      {item.description && (
        <div>
          <p className="text-xs text-theme-muted">Description</p>
          <p className="mt-0.5 text-sm text-theme-text whitespace-pre-line">{item.description}</p>
        </div>
      )}

      <div className="rounded-xl border border-theme-border overflow-hidden">
        <p className="px-3.5 py-2.5 bg-theme-subtle border-b border-theme-border text-sm font-semibold text-black">
          {!item.upc?.trim()
            ? 'Not matched across stores'
            : otherStores.length === 0
              ? 'No other store carries this UPC'
              : `Same UPC in ${otherStores.length} other ${otherStores.length === 1 ? 'store' : 'stores'}`}
        </p>
        {!item.upc?.trim() ? (
          <p className="px-3.5 py-2.5 text-sm text-theme-muted">
            Items are matched by UPC, and this one has none.
          </p>
        ) : (
          otherStores.map(entry => (
            <Link
              key={entry.item_id}
              to={`/admin/stores/${entry.store_id}/items/${entry.item_id}`}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b last:border-b-0 border-theme-border/60 text-sm hover:bg-theme-subtle"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-brand-600">
                  {entry.store_name}
                </span>
                {entry.store_status !== 'active' && (
                  <span className="block text-xs text-accent-600">Store suspended</span>
                )}
              </span>
              <span className="flex flex-col items-end">
                <span className="font-mono text-black">{formatPrice(entry.sale_price)}</span>
                <ItemStatusText status={entry.status} />
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
