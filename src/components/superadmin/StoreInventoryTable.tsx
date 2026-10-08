import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Image as ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, parseServerDate } from '../../lib/utils';
import type { InventoryItem } from '../dashboard/types';
import type { PageSize } from '../../hooks/useAdminStoreInventory';

interface Props {
  items: InventoryItem[];
  total: number;
  loading: boolean;
  error: string;
  filtered: boolean;
  pageSize: PageSize;
  currentPage: number;
  onPageSizeChange: (size: PageSize) => void;
  onPageChange: (page: number) => void;
  /** Where an item's name links to (its detail view). */
  itemHref?: (item: InventoryItem) => string;
}

const COLUMNS: Array<{ label: string; align?: 'right' }> = [
  { label: 'Item' },
  { label: 'Unit' },
  { label: 'Stock' },
  { label: 'Category' },
  { label: 'Status' },
  { label: 'Price', align: 'right' },
  { label: 'Updated' },
];

// Read-only: the superadmin's per-store view has no selection, edit, or delete controls.
export function StoreInventoryTable({
  items,
  total,
  loading,
  error,
  filtered,
  pageSize,
  currentPage,
  onPageSizeChange,
  onPageChange,
  itemHref,
}: Readonly<Props>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let body: ReactNode;
  if (error) {
    body = <div className="p-12 text-center text-sm text-accent-600">{error}</div>;
  } else if (loading && items.length === 0) {
    body = <div className="p-12 text-center text-sm text-theme-muted">Loading items...</div>;
  } else if (items.length === 0) {
    body = (
      <div className="p-12 text-center text-sm text-theme-muted">
        {filtered ? 'No items match these filters.' : 'This store has no items yet.'}
      </div>
    );
  } else {
    body = (
      <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
        <table className="w-full text-left">
          <thead className="bg-theme-canvas border-b border-theme-border">
            <tr>
              {COLUMNS.map(({ label, align }) => (
                <th
                  key={label}
                  className={cn(
                    'px-6 py-4 text-xs font-semibold text-black uppercase tracking-wider whitespace-nowrap',
                    align === 'right' && 'text-right'
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(item => (
              <tr key={item.id} className="hover:bg-theme-subtle transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-theme-canvas overflow-hidden flex-shrink-0 border border-theme-border">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.item_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <ImageIcon size={16} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      {itemHref ? (
                        <Link
                          to={itemHref(item)}
                          className="font-medium text-black hover:text-brand-600 hover:underline"
                        >
                          {item.item_name}
                        </Link>
                      ) : (
                        <p className="font-medium text-black">{item.item_name}</p>
                      )}
                      <p className="text-xs text-theme-muted">{item.upc || 'No UPC'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-theme-muted">{item.unit || '-'}</td>
                <td className="px-6 py-4 text-sm font-mono font-medium text-theme-text">
                  {item.quantity}
                </td>
                <td className="px-6 py-4">
                  {item.category_name ? (
                    <span className="inline-flex items-center rounded-md border border-brand-500 bg-white px-2.5 py-1 text-xs font-medium text-brand-600 whitespace-nowrap">
                      {item.category_name}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border bg-white px-2.5 py-1 text-xs font-medium',
                      item.status === 'Active'
                        ? 'border-brand-600 text-brand-700'
                        : 'border-accent-600 text-accent-600'
                    )}
                  >
                    {item.status === 'Active' ? 'Active' : 'In-Active'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-right font-mono text-theme-text">
                  ${item.sale_price?.toFixed(2) || '0.00'}
                </td>
                <td className="px-6 py-4 text-sm text-theme-muted whitespace-nowrap">
                  {item.updated_at ? parseServerDate(item.updated_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      {body}

      <div className="px-6 py-3 border-t border-theme-border bg-theme-subtle flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-theme-muted">
          {total === 0 ? (
            'No items'
          ) : (
            <>
              Showing{' '}
              <span className="font-semibold text-theme-text">
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)}
              </span>{' '}
              of <span className="font-semibold text-theme-text">{total}</span> items
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-theme-border rounded-lg p-0.5">
            {([50, 100, 200] as const).map(size => (
              <button
                key={size}
                onClick={() => onPageSizeChange(size)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  pageSize === size
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-theme-muted hover:text-theme-text hover:bg-theme-subtle'
                )}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="p-1.5 rounded-lg bg-white border border-theme-border text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-xs font-semibold text-theme-text min-w-[5rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="p-1.5 rounded-lg bg-white border border-theme-border text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
