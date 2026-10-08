import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export type ActivityKind =
  | 'registered'
  | 'suspended'
  | 'reactivated'
  | 'updated'
  | 'deleted'
  | 'capture';

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  summary: string;
  timestamp: string;
  /** Null once the store has been deleted. */
  store_id: number | null;
  store_name: string;
  username: string | null;
}

const COLLAPSED = 5;
const EXPANDED = 100;

// Store events and new captures across every store, newest first, for the Super Admin
// dashboard. Shows five until the superadmin asks for the rest.
export function useAdminActivity() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/activity?limit=${expanded ? EXPANDED : COLLAPSED}`, {
          credentials: 'include',
        });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        if (!res.ok) throw new Error('Failed to load recent changes');
        const data = (await res.json()) as { items: ActivityEntry[]; total: number };
        if (cancelled) return;
        setEntries(data.items);
        setTotal(data.total);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : 'Failed to load recent changes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, navigate]);

  return {
    entries,
    total,
    loading,
    error,
    expanded,
    canExpand: total > COLLAPSED,
    capped: expanded && total > EXPANDED,
    toggleExpanded: () => setExpanded(open => !open),
  };
}
