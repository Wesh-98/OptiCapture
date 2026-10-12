import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/** How an item first entered the catalog. Null for items added before this was recorded. */
export type ItemSource = 'manual' | 'import' | 'scan';

export interface RecentItem {
  id: number;
  item_name: string;
  upc: string | null;
  image: string | null;
  sale_price: number | null;
  status: string;
  created_at: string;
  source: ItemSource | null;
  store_id: number;
  store_name: string;
  store_status: string;
  category_name: string | null;
}

export const RECENT_WINDOWS = [1, 7, 30] as const;
export type RecentWindow = (typeof RECENT_WINDOWS)[number];

export const RECENT_WINDOW_LABELS: Record<RecentWindow, string> = {
  1: 'Last 24 hours',
  7: 'Last 7 days',
  30: 'Last 30 days',
};

export const RECENT_PAGE_SIZE = 50;

// The store and window live in the URL (`?store=&days=`) so the sidebar, breadcrumbs and a
// shared link all land on the same view.
export const STORE_PARAM = 'store';
const DAYS_PARAM = 'days';

function parseStore(raw: string | null): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function parseWindow(raw: string | null): RecentWindow {
  const n = Number(raw);
  return n === 1 || n === 30 ? n : 7;
}

// Items added in the last day, week or month, across every store or one, newest first.
export function useAdminRecentItems() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = parseStore(searchParams.get(STORE_PARAM));
  const days = parseWindow(searchParams.get(DAYS_PARAM));

  const [items, setItems] = useState<RecentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The page belongs to one store + window; changing either drops back to page 1 in the
  // same render, so the old page number is never fetched under the new filter.
  const pageScope = `${storeId}:${days}`;
  const [pageState, setPageState] = useState({ scope: pageScope, page: 1 });
  const page = pageState.scope === pageScope ? pageState.page : 1;
  const setPage = useCallback(
    (next: number) => setPageState({ scope: pageScope, page: next }),
    [pageScope]
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        params => {
          if (value === null) params.delete(key);
          else params.set(key, value);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const setStoreId = (next: number | null) =>
    setParam(STORE_PARAM, next === null ? null : String(next));
  const setDays = (next: RecentWindow) => setParam(DAYS_PARAM, next === 7 ? null : String(next));

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ days: String(days), page: String(page) });
    if (storeId !== null) params.set('store', String(storeId));

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch(`/api/admin/recent-items?${params}`, { credentials: 'include' });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data as { error?: string } | null)?.error || 'Failed to load items');
        }
        if (cancelled) return;
        const { items: rows, total: count } = data as { items: RecentItem[]; total: number };
        setItems(rows);
        setTotal(count);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to load items');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, days, page, navigate]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  return {
    storeId,
    setStoreId,
    days,
    setDays,
    items,
    total,
    loading,
    error,
    page,
    setPage,
    handleLogout,
  };
}
