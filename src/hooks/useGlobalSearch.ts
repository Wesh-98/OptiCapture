import { useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '../components/dashboard/types';

export function useGlobalSearch() {
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (!globalSearch.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const res = await fetch(`/api/inventory?q=${encodeURIComponent(globalSearch.trim())}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.ok) setSearchResults(await res.json());
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [globalSearch]);

  return { globalSearch, setGlobalSearch, searchResults, isSearching };
}
