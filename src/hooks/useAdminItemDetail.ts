import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InventoryItem } from '../components/dashboard/types';

export interface AdminItem extends InventoryItem {
  store_id: number;
  created_at: string;
  /** Fingerprint of the item as loaded; an edit sends it back so a stale save is refused. */
  revision: string;
}

/** The same UPC as carried by another store. */
export interface SameUpcEntry {
  item_id: number;
  store_id: number;
  store_name: string;
  store_status: string;
  sale_price: number | null;
  status: string;
}

// One item from one store for the superadmin detail view.
export function useAdminItemDetail(storeId: string | undefined, itemId: string | undefined) {
  const navigate = useNavigate();
  const [item, setItem] = useState<AdminItem | null>(null);
  const [otherStores, setOtherStores] = useState<SameUpcEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!storeId || !itemId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch(`/api/admin/stores/${storeId}/items/${itemId}`, {
          credentials: 'include',
        });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Failed to load item');
        if (cancelled) return;
        setItem(data.item);
        setOtherStores(data.other_stores);
      } catch (err) {
        if (cancelled) return;
        setItem(null);
        setOtherStores([]);
        setError(err instanceof Error ? err.message : 'Failed to load item');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, itemId, navigate, reloadKey]);

  return {
    item,
    otherStores,
    loading,
    error,
    /** Fetch the item again, e.g. after an edit was refused because it changed. */
    reload: () => setReloadKey(key => key + 1),
    /** Show a saved edit without another round trip. */
    applyEdit: (next: Partial<AdminItem>) => setItem(prev => (prev ? { ...prev, ...next } : prev)),
  };
}
