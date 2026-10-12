import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RECENT_PAGE_SIZE, STORE_PARAM, parseStore, type RecentItem } from './useAdminRecentItems';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_PAGE_SIZE = RECENT_PAGE_SIZE;

// The search text and store live in the URL (`?q=&store=`) so the sidebar, breadcrumbs and
// a shared link all land on the same results.
const QUERY_PARAM = 'q';
const SEARCH_DEBOUNCE_MS = 300;

// Items matching a name, UPC, brand, category or tag, across every store or one.
export function useAdminItemSearch() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = parseStore(searchParams.get(STORE_PARAM));
  const query = (searchParams.get(QUERY_PARAM) ?? '').trim();
  const searchable = query.length >= SEARCH_MIN_LENGTH;

  const [input, setInput] = useState(query);
  const [items, setItems] = useState<RecentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(searchable);
  const [error, setError] = useState('');

  // The page belongs to one store + search; changing either drops back to page 1 in the
  // same render, so the old page number is never fetched under the new filter.
  const pageScope = `${storeId}:${query}`;
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

  // Typing settles into the URL after a pause. A search that arrives from outside (the
  // sidebar link, back/forward) replaces the box; one this hook wrote itself does not, so
  // it never overwrites what was typed since.
  const writtenQuery = useRef(query);
  useEffect(() => {
    const next = input.trim();
    if (next === writtenQuery.current) return;
    const timer = setTimeout(() => {
      writtenQuery.current = next;
      setParam(QUERY_PARAM, next === '' ? null : next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, setParam]);
  useEffect(() => {
    if (query === writtenQuery.current) return;
    writtenQuery.current = query;
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!searchable) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ q: query, page: String(page) });
    if (storeId !== null) params.set('store', String(storeId));

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch(`/api/admin/search?${params}`, { credentials: 'include' });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data as { error?: string } | null)?.error || 'Failed to search items');
        }
        if (cancelled) return;
        const { items: rows, total: count } = data as { items: RecentItem[]; total: number };
        setItems(rows);
        setTotal(count);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to search items');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchable, query, storeId, page, navigate]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    navigate('/login');
  };

  return {
    storeId,
    setStoreId,
    input,
    setInput,
    query,
    searchable,
    items,
    total,
    loading,
    error,
    page,
    setPage,
    handleLogout,
  };
}
