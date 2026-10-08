import { useEffect, useState } from 'react';
import type { StoreRow } from '../components/superadmin/types';

// The store list the Super Admin shell and panes pick from. Read-only; store management
// (edit, suspend, delete) stays in useAdminStores. Null while loading, [] on failure.
export function useAdminStoreList() {
  const [stores, setStores] = useState<StoreRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/stores', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : []))
      .then((rows: StoreRow[]) => {
        if (!cancelled) setStores(rows);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return stores;
}
