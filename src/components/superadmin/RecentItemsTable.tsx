import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Image as ImageIcon,
  FileSpreadsheet,
  PencilLine,
  ScanBarcode,
  type LucideIcon,
} from 'lucide-react';
import { cn, parseServerDate } from '../../lib/utils';
import { ListPager } from './AdminUi';
import { formatPrice, timeAgo } from './format';
import type { ItemSource, RecentItem } from '../../hooks/useAdminRecentItems';

const SOURCES: Record<ItemSource, { label: string; icon: LucideIcon }> = {
  scan: { label: 'Scan', icon: ScanBarcode },
  manual: { label: 'Manual', icon: PencilLine },
  import: { label: 'Import', icon: FileSpreadsheet },
};

// Scans are the capture flow, so they carry the brand teal; the other two stay grey.
function SourceBadge({ source }: Readonly<{ source: ItemSource | null }>) {
  const entry = source ? SOURCES[source] : undefined;
  if (!entry) return <span className="text-sm text-slate-400">—</span>;
  const { label, icon: Icon } = entry;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        source === 'scan'
          ? 'border-brand-500 text-brand-600'
          : 'border-theme-border text-theme-muted'
      )}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

interface Props {
  items: RecentItem[];
  total: number;
  loading: boolean;
  error: string;
  /** Hides the store column when the list is already one store's. */
  showStore: boolean;
  emptyText: string;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

// A cross-store item list (Recently added, Search), each row linking to its item view and
// its store.
export function RecentItemsTable({
  items,
  total,
  loading,
  error,
  showStore,
  emptyText,
  pageSize,
  currentPage,
  onPageChange,
}: Readonly<Props>) {
  const columns: Array<{ label: string; align?: 'right' }> = [
    { label: 'Item' },
    ...(showStore ? [{ label: 'Store' }] : []),
    { label: 'Category' },
    { label: 'Price', align: 'right' },
    { label: 'Source' },
    { label: 'Added' },
  ];

  let body: ReactNode;
  if (error) {
    body = <div className="p-12 text-center text-sm text-accent-600">{error}</div>;
  } else if (loading && items.length === 0) {
    body = <div className="p-12 text-center text-sm text-theme-muted">Loading items...</div>;
  } else if (items.length === 0) {
    body = <div className="p-12 text-center text-sm text-theme-muted">{emptyText}</div>;
  } else {
    body = (
      <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
        <table className="w-full text-left">
          <thead className="bg-theme-canvas border-b border-theme-border">
            <tr>
              {columns.map(({ label, align }) => (
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
                      <Link
                        to={`/admin/stores/${item.store_id}/items/${item.id}`}
                        className="font-medium text-black hover:text-brand-600 hover:underline"
                      >
                        {item.item_name}
                      </Link>
                      <p className="text-xs text-theme-muted">{item.upc || 'No UPC'}</p>
                    </div>
                  </div>
                </td>
                {showStore && (
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    <Link
                      to={`/admin/stores/${item.store_id}`}
                      className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                    >
                      {item.store_name}
                    </Link>
                    {item.store_status !== 'active' && (
                      <span className="ml-2 text-xs font-semibold text-accent-600">Suspended</span>
                    )}
                  </td>
                )}
                <td className="px-6 py-4">
                  {item.category_name ? (
                    <span className="inline-flex items-center rounded-md border border-brand-500 bg-white px-2.5 py-1 text-xs font-medium text-brand-600 whitespace-nowrap">
                      {item.category_name}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-right font-mono text-theme-text">
                  {formatPrice(item.sale_price)}
                </td>
                <td className="px-6 py-4">
                  <SourceBadge source={item.source} />
                </td>
                <td
                  className="px-6 py-4 text-sm text-theme-muted whitespace-nowrap"
                  title={parseServerDate(item.created_at).toLocaleString()}
                >
                  {timeAgo(item.created_at)}
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

      <ListPager
        total={total}
        pageSize={pageSize}
        currentPage={currentPage}
        onPageChange={onPageChange}
        noun="items"
      />
    </>
  );
}
