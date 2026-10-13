import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { RecentItem } from './useAdminRecentItems';

export const ITEM_LIST_PAGE_SIZE = 50;

const STORE_PARAM = 'store';

function parseStore(raw: string | null): number | null {
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

interface Options {
  /** The list's API path, e.g. `/api/admin/search`. */
  endpoint: string;
  /** The list's own filter, sent alongside `store` and `page`. */
  filter: { name: string; value: string };
  failureText: string;
  /** False while there is nothing to ask for yet; the list stays empty. */
  enabled?: boolean;
}

// A cross-store list (Recently added, Search, Activity log): one page of rows across every
// store or the one in `?store=`. The store lives in the URL so the sidebar, breadcrumbs and a
// shared link all land on the same view. `Extra` is anything the endpoint returns beside the
// rows and their total.
export function useAdminItemList<Row = RecentItem, Extra extends object = object>({
  endpoint,
  filter,
  failureText,
  enabled = true,
}: Options) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = parseStore(searchParams.get(STORE_PARAM));
  const { name: filterName, value: filterValue } = filter;

  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(key => key + 1), []);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  // The page belongs to one store + filter; changing either drops back to page 1 in the
  // same render, so the old page number is never fetched under the new filter.
  const pageScope = `${storeId}:${filterValue}`;
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

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ [filterName]: filterValue, page: String(page) });
    if (storeId !== null) params.set(STORE_PARAM, String(storeId));

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch(`${endpoint}?${params}`, { credentials: 'include' });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data as { error?: string } | null)?.error || failureText);
        }
        if (cancelled) return;
        const {
          items: rows,
          total: count,
          ...rest
        } = data as { items: Row[]; total: number } & Extra;
        setItems(rows);
        setTotal(count);
        setExtra(rest as unknown as Extra);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : failureText);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, endpoint, filterName, filterValue, failureText, storeId, page, navigate, reloadKey]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  return {
    storeId,
    setStoreId,
    setParam,
    items,
    total,
    extra,
    reload,
    loading,
    error,
    page,
    setPage,
    handleLogout,
  };
}
