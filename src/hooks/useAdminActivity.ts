import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export interface ActivityEntry {
  id: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'BATCH';
  summary: string;
  timestamp: string;
  store_id: number;
  store_name: string;
  username: string | null;
}

// Recent inventory changes across every store, newest first, for the Super Admin dashboard.
export function useAdminActivity(limit = 10) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/activity?limit=${limit}`, { credentials: 'include' });
        if (res.status === 401) {
          navigate('/login');
          return;
        }
        if (!res.ok) throw new Error('Failed to load recent changes');
        const data = (await res.json()) as ActivityEntry[];
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (cancelled) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : 'Failed to load recent changes');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, navigate]);

  return { entries, error };
}
