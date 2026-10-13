import { Search } from 'lucide-react';
import { cn, focusOnMount } from '../lib/utils';
import { ItemListPage } from '../components/superadmin/ItemListPage';
import { RecentItemsTable } from '../components/superadmin/RecentItemsTable';
import { HeaderStat, FILTER_INPUT } from '../components/superadmin/AdminUi';
import { ITEM_LIST_PAGE_SIZE } from '../hooks/useAdminItemList';
import { SEARCH_MIN_LENGTH, useAdminItemSearch } from '../hooks/useAdminItemSearch';

// Superadmin: find an item in any store's catalog by name, UPC, brand, category or tag.
export default function AdminItemSearch() {
  const view = useAdminItemSearch();

  return (
    <ItemListPage
      title="Search items"
      subtitle={scope => `Find an item by name, UPC, brand, category or tag ${scope}`}
      stat={
        view.searchable && (
          <HeaderStat
            label="Matches"
            value={view.loading && view.items.length === 0 ? '…' : view.total}
            tone="brand"
          />
        )
      }
      storeId={view.storeId}
      onStoreChange={view.setStoreId}
      onLogout={view.handleLogout}
      idPrefix="search"
      filters={
        <label className="relative flex-[1_1_240px]">
          <span className="sr-only">Search items</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
          <input
            type="search"
            ref={focusOnMount}
            value={view.input}
            onChange={e => view.setInput(e.target.value)}
            placeholder="Name, UPC, brand, category or tag…"
            className={cn('w-full h-10 pl-9 pr-3', FILTER_INPUT)}
          />
        </label>
      }
    >
      {view.searchable ? (
        <RecentItemsTable
          items={view.items}
          total={view.total}
          loading={view.loading}
          error={view.error}
          showStore={view.storeId === null}
          emptyText={`No items match "${view.query}".`}
          pageSize={ITEM_LIST_PAGE_SIZE}
          currentPage={view.page}
          onPageChange={view.setPage}
        />
      ) : (
        <div className="p-12 text-center text-sm text-theme-muted">
          Type at least {SEARCH_MIN_LENGTH} characters to search.
        </div>
      )}
    </ItemListPage>
  );
}
