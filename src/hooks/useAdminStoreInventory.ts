import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Category, InventoryItem } from '../components/dashboard/types';

export interface ViewedStore {
  id: number;
  name: string;
  status: string;
  logo: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  item_count: number;
  category_count: number;
  items_added_week: number;
  last_item_added_at: string | null;
  missing_upc_count: number;
}

export type ItemStatusFilter = 'all' | 'Active' | 'Inactive';

export const ITEM_STATUS_LABELS: Record<ItemStatusFilter, string> = {
  all: 'All status',
  Active: 'Active',
  Inactive: 'In-Active',
};
export type PageSize = 50 | 100 | 200;
export type ItemSort = 'recent' | 'name_asc' | 'name_desc';

export const ITEM_SORT_LABELS: Record<ItemSort, string> = {
  recent: 'Recently added',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
};

const SEARCH_DEBOUNCE_MS = 300;

/** The chosen category lives in the URL (`?category=`) so breadcrumbs can link to it. */
export const CATEGORY_PARAM = 'category';

function parseCategory(raw: string | null): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

// Read-only view of one store's inventory for the superadmin. The store comes from the URL;
// the admin routes never fall back to the superadmin's own store.
export function useAdminStoreInventory(storeId: string | undefined) {
  const navigate = useNavigate();

  const [store, setStore] = useState<ViewedStore | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState('');

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = parseCategory(searchParams.get(CATEGORY_PARAM));
  const [statusFilter, setStatusFilter] = useState<ItemStatusFilter>('all');
  const [sort, setSort] = useState<ItemSort>('recent');
  const [pageSize, setPageSize] = useState<PageSize>(50);
  // The page belongs to one store + category. When either changes (a pick, a breadcrumb,
  // or browser back) the old page number is dropped in the same render, never fetched.
  const pageScope = `${storeId}:${categoryId}`;
  const [pageState, setPageState] = useState({ scope: pageScope, page: 1 });
  const page = pageState.scope === pageScope ? pageState.page : 1;
  const setPage = useCallback(
    (next: number) => setPageState({ scope: pageScope, page: next }),
    [pageScope]
  );

  // Shared handling for every admin request: an expired session goes back to login;
  // anything else (including the 403 for the HQ store) surfaces the server's message.
  const readJson = useCallback(
    async <T>(res: Response, fallback: string): Promise<T> => {
      if (res.status === 401) {
        navigate('/login');
        throw new Error(fallback);
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error || fallback);
      return data as T;
    },
    [navigate]
  );

  // Bumped after an edit so the header, category counts and items reload in place.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(key => key + 1), []);

  // Store header + category list: once per store, and again after an edit. Only a new
  // store blanks the page; a refresh swaps the figures in place.
  const loadedStoreId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    if (loadedStoreId.current !== storeId) {
      loadedStoreId.current = storeId;
      setStore(null);
      setCategories([]);
      setLoadError('');
    }
    void (async () => {
      try {
        const [storeRes, categoriesRes] = await Promise.all([
          fetch(`/api/admin/stores/${storeId}`, { credentials: 'include' }),
          fetch(`/api/admin/stores/${storeId}/categories`, { credentials: 'include' }),
        ]);
        const nextStore = await readJson<ViewedStore>(storeRes, 'Failed to load store');
        const nextCategories = await readJson<Category[]>(
          categoriesRes,
          'Failed to load categories'
        );
        if (cancelled) return;
        setStore(nextStore);
        setCategories(nextCategories);
      } catch (error) {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : 'Failed to load store');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, readJson, refreshKey]);

  // Any filter change starts again from the first page. The reset happens with the filter
  // in one render, so the old page number is never fetched under the new filter.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPageState(prev => ({ ...prev, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const selectCategory = useCallback(
    (next: number | null) => {
      setSearchParams(
        params => {
          if (next === null) params.delete(CATEGORY_PARAM);
          else params.set(CATEGORY_PARAM, String(next));
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const selectStatus = (next: ItemStatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  };
  const selectSort = (next: ItemSort) => {
    setSort(next);
    setPage(1);
  };
  const selectPageSize = (next: PageSize) => {
    setPageSize(next);
    setPage(1);
  };

  // Items: refetched whenever a filter or the page changes. A stale response from an
  // earlier filter is dropped so fast typing can't show the wrong page.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize), sort });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (categoryId !== null) params.set('category_id', String(categoryId));
    if (statusFilter !== 'all') params.set('status', statusFilter);

    setItemsLoading(true);
    setItemsError('');
    void (async () => {
      try {
        const res = await fetch(`/api/admin/stores/${storeId}/inventory?${params}`, {
          credentials: 'include',
        });
        const data = await readJson<{ items: InventoryItem[]; total: number }>(
          res,
          'Failed to load items'
        );
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
      } catch (error) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setItemsError(error instanceof Error ? error.message : 'Failed to load items');
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    storeId,
    page,
    pageSize,
    debouncedSearch,
    categoryId,
    statusFilter,
    sort,
    readJson,
    refreshKey,
  ]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  return {
    store,
    categories,
    loadError,
    items,
    total,
    itemsLoading,
    itemsError,
    search,
    setSearch,
    categoryId,
    setCategoryId: selectCategory,
    statusFilter,
    setStatusFilter: selectStatus,
    sort,
    setSort: selectSort,
    pageSize,
    setPageSize: selectPageSize,
    page,
    setPage,
    handleLogout,
    refresh,
  };
}
