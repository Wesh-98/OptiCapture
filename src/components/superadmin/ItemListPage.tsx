import type { ReactNode } from 'react';
import { Store as StoreIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAdminStoreList } from '../../hooks/useAdminStoreList';
import { AdminLayout } from './AdminLayout';
import { Breadcrumb, FILTER_SELECT, SelectIcon, type Crumb } from './AdminUi';

interface Props {
  title: string;
  /** The line under the title. `scope` reads "in North Mart" or "across every store". */
  subtitle: (scope: string) => string;
  stat?: ReactNode;
  storeId: number | null;
  onStoreChange: (next: number | null) => void;
  onLogout: () => void;
  /** Prefix for the toolbar's control IDs. */
  idPrefix: string;
  /** The page's own toolbar controls, after the store picker. */
  filters: ReactNode;
  children: ReactNode;
}

// The frame of a cross-store item list (Recently added, Search): breadcrumb, title band and
// a card whose toolbar starts with the store picker.
export function ItemListPage({
  title,
  subtitle,
  stat,
  storeId,
  onStoreChange,
  onLogout,
  idPrefix,
  filters,
  children,
}: Readonly<Props>) {
  const stores = useAdminStoreList();
  const store = storeId === null ? undefined : stores?.find(s => s.id === storeId);

  const trail: Crumb[] = [
    { label: 'All stores', to: '/admin' },
    ...(storeId === null
      ? []
      : [{ label: store?.name ?? 'Store', to: `/admin/stores/${storeId}` }]),
    { label: title },
  ];

  return (
    <AdminLayout onLogout={onLogout} bare>
      <section className="bg-white border-b border-theme-border">
        <Breadcrumb className="px-4 md:pl-3 md:pr-6 pt-4" trail={trail} />
        <div className="px-4 md:pl-3 md:pr-6 pt-3 pb-6 flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-black">{title}</h1>
            <p className="mt-1 text-sm text-theme-muted">
              {subtitle(store ? `in ${store.name}` : 'across every store')}
            </p>
          </div>
          {stat}
        </div>
      </section>

      <div className="p-4 md:py-6 md:pr-6 md:pl-3">
        <section className="bg-white rounded-xl border border-theme-border overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center gap-2.5">
            <label className="sr-only" htmlFor={`${idPrefix}-store`}>
              Store
            </label>
            <SelectIcon icon={StoreIcon} className="max-w-full">
              <select
                id={`${idPrefix}-store`}
                value={storeId ?? ''}
                onChange={e => onStoreChange(e.target.value === '' ? null : Number(e.target.value))}
                className={cn('h-10 max-w-full', FILTER_SELECT, 'pl-8')}
              >
                <option value="">All stores</option>
                {/* Keep a store named in the URL selectable while the list loads. */}
                {storeId !== null && !store && <option value={storeId}>Store</option>}
                {(stores ?? []).map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.status === 'active' ? '' : ' (suspended)'}
                  </option>
                ))}
              </select>
            </SelectIcon>
            {filters}
          </div>

          {children}
        </section>
      </div>
    </AdminLayout>
  );
}
