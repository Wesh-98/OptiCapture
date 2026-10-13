import { CheckCheck, ListFilter } from 'lucide-react';
import { cn } from '../lib/utils';
import { ItemListPage } from '../components/superadmin/ItemListPage';
import { ActivityTable } from '../components/superadmin/ActivityTable';
import { ACTIVITY_KIND_STYLES } from '../components/superadmin/activityKinds';
import { HeaderStat, FILTER_SELECT, SelectIcon } from '../components/superadmin/AdminUi';
import { ITEM_LIST_PAGE_SIZE } from '../hooks/useAdminItemList';
import {
  activityKindsFor,
  useAdminActivityLog,
  type ActivityKindFilter,
} from '../hooks/useAdminActivity';

// Superadmin: every store event and capture the log still holds (90 days), across every
// store or one. The dashboard's Recent changes card shows the latest five of these.
export default function AdminActivity() {
  const view = useAdminActivityLog();

  return (
    <ItemListPage
      title="Activity log"
      subtitle={scope => `Store events and captures ${scope}, newest first. Kept for 90 days.`}
      stat={
        <HeaderStat
          label="New"
          value={view.loading && view.items.length === 0 ? '…' : view.unseen}
          tone="brand"
        />
      }
      storeId={view.storeId}
      onStoreChange={view.setStoreId}
      onLogout={view.handleLogout}
      idPrefix="activity"
      filters={
        <>
          <label className="sr-only" htmlFor="activity-kind">
            Kind of change
          </label>
          <SelectIcon icon={ListFilter}>
            <select
              id="activity-kind"
              value={view.kind}
              onChange={e => view.setKind(e.target.value as ActivityKindFilter)}
              className={cn('h-10', FILTER_SELECT, 'pl-8')}
            >
              <option value="all">All changes</option>
              {activityKindsFor(view.storeId !== null).map(kind => (
                <option key={kind} value={kind}>
                  {ACTIVITY_KIND_STYLES[kind].label}
                </option>
              ))}
            </select>
          </SelectIcon>
          <div className="ml-auto flex items-center gap-3">
            {view.markError && (
              <span role="alert" className="text-sm text-accent-600">
                {view.markError}
              </span>
            )}
            <button
              onClick={view.markAllSeen}
              disabled={view.unseen === 0 || view.marking}
              className="h-10 inline-flex items-center gap-2 rounded-lg border border-brand-500 bg-white px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCheck size={16} aria-hidden="true" />
              Mark all as seen
            </button>
          </div>
        </>
      }
    >
      <ActivityTable
        entries={view.items}
        total={view.total}
        loading={view.loading}
        error={view.error}
        showStore={view.storeId === null}
        pageSize={ITEM_LIST_PAGE_SIZE}
        currentPage={view.page}
        onPageChange={view.setPage}
      />
    </ItemListPage>
  );
}
