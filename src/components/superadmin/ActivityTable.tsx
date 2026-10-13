import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn, parseServerDate } from '../../lib/utils';
import { ListPager } from './AdminUi';
import { ACTIVITY_KIND_STYLES } from './activityKinds';
import { timeAgo } from './format';
import type { ActivityEntry } from '../../hooks/useAdminActivity';

/** The tile that tells one kind of change from another at a glance. */
export function ActivityIcon({
  kind,
  className,
}: Readonly<{ kind: ActivityEntry['kind']; className?: string }>) {
  const { icon: Icon, tone } = ACTIVITY_KIND_STYLES[kind] ?? ACTIVITY_KIND_STYLES.updated;
  return (
    <span
      className={cn(
        'w-7 h-7 rounded-lg shrink-0 flex items-center justify-center',
        tone,
        className
      )}
    >
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

/** The teal dot on a change this superadmin has not marked as seen. */
export function NewDot({ seen }: Readonly<{ seen: boolean }>) {
  if (seen) return null;
  return (
    <span className="inline-flex items-center">
      <span className="w-2 h-2 rounded-full bg-brand-600" aria-hidden="true" />
      <span className="sr-only">New</span>
    </span>
  );
}

interface Props {
  entries: ActivityEntry[];
  total: number;
  loading: boolean;
  error: string;
  /** Hides the store column when the list is already one store's. */
  showStore: boolean;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

// The Activity log: store events and captures, each row linking to its store.
export function ActivityTable({
  entries,
  total,
  loading,
  error,
  showStore,
  pageSize,
  currentPage,
  onPageChange,
}: Readonly<Props>) {
  const columns = ['Change', ...(showStore ? ['Store'] : []), 'By', 'When'];

  let body: ReactNode;
  if (error) {
    body = <div className="p-12 text-center text-sm text-accent-600">{error}</div>;
  } else if (loading && entries.length === 0) {
    body = <div className="p-12 text-center text-sm text-theme-muted">Loading changes...</div>;
  } else if (entries.length === 0) {
    body = (
      <div className="p-12 text-center text-sm text-theme-muted">
        No changes match in the last 90 days.
      </div>
    );
  } else {
    body = (
      <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
        <table className="w-full text-left">
          <thead className="bg-theme-canvas border-b border-theme-border">
            <tr>
              {columns.map(label => (
                <th
                  key={label}
                  className="px-6 py-4 text-xs font-semibold text-black uppercase tracking-wider whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map(entry => (
              <tr key={entry.id} className="hover:bg-theme-subtle transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <ActivityIcon kind={entry.kind} />
                    <span
                      className={cn(
                        'text-sm text-black whitespace-nowrap',
                        entry.seen ? 'font-medium' : 'font-semibold'
                      )}
                    >
                      {entry.summary}
                    </span>
                    <NewDot seen={entry.seen} />
                  </div>
                </td>
                {showStore && (
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    {entry.store_id === null ? (
                      // A deleted store has no page left to open.
                      <span className="text-theme-muted">{entry.store_name}</span>
                    ) : (
                      <Link
                        to={`/admin/stores/${entry.store_id}`}
                        className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        {entry.store_name}
                      </Link>
                    )}
                  </td>
                )}
                <td className="px-6 py-4 text-sm text-theme-text whitespace-nowrap">
                  {entry.username ?? <span className="text-slate-400">—</span>}
                </td>
                <td
                  className="px-6 py-4 text-sm text-theme-muted whitespace-nowrap"
                  title={parseServerDate(entry.timestamp).toLocaleString()}
                >
                  {timeAgo(entry.timestamp)}
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
        noun="changes"
      />
    </>
  );
}
