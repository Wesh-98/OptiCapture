import { useEffect, useRef, useState } from 'react';
import type { InventoryItem } from '../components/dashboard/types';

export function useGlobalSearch() {
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!globalSearch.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory?q=${encodeURIComponent(globalSearch.trim())}`, { credentials: 'include' });
        if (res.ok) setSearchResults(await res.json());
      } catch { /* ignore */ }
      finally { setIsSearching(false); }
    }, 300);
  }, [globalSearch]);

  return { globalSearch, setGlobalSearch, searchResults, isSearching };
}
