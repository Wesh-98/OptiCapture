import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminItemList } from './useAdminItemList';

export const SEARCH_MIN_LENGTH = 2;

// The search text lives in the URL (`?q=`), beside the store, so a shared link lands on the
// same results.
const QUERY_PARAM = 'q';
const SEARCH_DEBOUNCE_MS = 300;

// Items matching a name, UPC, brand, category or tag, across every store or one.
export function useAdminItemSearch() {
  const [searchParams] = useSearchParams();
  const query = (searchParams.get(QUERY_PARAM) ?? '').trim();
  const searchable = query.length >= SEARCH_MIN_LENGTH;
  const list = useAdminItemList({
    endpoint: '/api/admin/search',
    filter: { name: QUERY_PARAM, value: query },
    failureText: 'Failed to search items',
    enabled: searchable,
  });
  const { setParam } = list;

  // Typing settles into the URL after a pause. A search that arrives from outside (the
  // sidebar link, back/forward) replaces the box; one this hook wrote itself does not, so
  // it never overwrites what was typed since.
  const [input, setInput] = useState(query);
  const [writtenQuery, setWrittenQuery] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) {
    setSeenQuery(query);
    if (query !== writtenQuery) {
      setWrittenQuery(query);
      setInput(query);
    }
  }
  useEffect(() => {
    const next = input.trim();
    if (next === writtenQuery) return;
    const timer = setTimeout(() => {
      setWrittenQuery(next);
      setParam(QUERY_PARAM, next === '' ? null : next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, writtenQuery, setParam]);

  return { ...list, input, setInput, query, searchable };
}
