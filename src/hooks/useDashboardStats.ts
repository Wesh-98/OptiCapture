import { useState } from 'react';
import type { DashboardStats } from '../components/dashboard/types';

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats>({
    totalCategories: 0, totalItems: 0, inStock: 0, outOfStock: 0,
  });

  const fetchStats = async () => {
    const res = await fetch('/api/dashboard/stats', { credentials: 'include' });
    if (res.ok) setStats(await res.json());
  };

  return { stats, fetchStats };
}
