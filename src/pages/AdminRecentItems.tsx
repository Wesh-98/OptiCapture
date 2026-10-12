import { Clock as ClockIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { ItemListPage } from '../components/superadmin/ItemListPage';
import { RecentItemsTable } from '../components/superadmin/RecentItemsTable';
import { HeaderStat, FILTER_SELECT, SelectIcon } from '../components/superadmin/AdminUi';
import { ITEM_LIST_PAGE_SIZE } from '../hooks/useAdminItemList';
import {
  RECENT_WINDOWS,
  RECENT_WINDOW_LABELS,
  useAdminRecentItems,
  type RecentWindow,
} from '../hooks/useAdminRecentItems';

// Superadmin: the items stores have added lately, across every store or one. OptiCapture is
// capture-first, so this is the main thing to keep an eye on.
export default function AdminRecentItems() {
  const view = useAdminRecentItems();
  const windowLabel = RECENT_WINDOW_LABELS[view.days].toLowerCase();

  return (
    <ItemListPage
      title="Recently added"
      subtitle={scope => `New items ${scope}, newest first`}
      stat={
        <HeaderStat
          label={RECENT_WINDOW_LABELS[view.days]}
          value={view.loading && view.items.length === 0 ? '…' : `+${view.total.toLocaleString()}`}
          tone="brand"
        />
      }
      storeId={view.storeId}
      onStoreChange={view.setStoreId}
      onLogout={view.handleLogout}
      idPrefix="recent"
      filters={
        <>
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
        </>
      }
    >
      <RecentItemsTable
        items={view.items}
        total={view.total}
        loading={view.loading}
        error={view.error}
        showStore={view.storeId === null}
        emptyText={`No items added in the ${windowLabel}.`}
        pageSize={ITEM_LIST_PAGE_SIZE}
        currentPage={view.page}
        onPageChange={view.setPage}
      />
    </ItemListPage>
  );
}
