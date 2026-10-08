import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { InventoryItem } from '../components/dashboard/types';

export interface AdminItem extends InventoryItem {
  store_id: number;
  created_at: string;
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

// One item from one store for the superadmin detail view, read-only.
export function useAdminItemDetail(storeId: string | undefined, itemId: string | undefined) {
  const navigate = useNavigate();
  const [item, setItem] = useState<AdminItem | null>(null);
  const [otherStores, setOtherStores] = useState<SameUpcEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!storeId || !itemId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
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
  }, [storeId, itemId, navigate]);

  return { item, otherStores, loading, error };
}
