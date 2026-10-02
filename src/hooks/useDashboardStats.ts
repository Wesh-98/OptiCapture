import { useState } from 'react';
import type { DashboardStats } from '../components/dashboard/types';

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats>({
    totalCategories: 0,
    totalItems: 0,
    inStock: 0,
    outOfStock: 0,
  });

  const fetchStats = async (categoryId?: number | null) => {
    const params = new URLSearchParams();
    if (categoryId !== undefined && categoryId !== null) {
      params.set('category_id', String(categoryId));
    }
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const res = await fetch(`/api/dashboard/stats${query}`, { credentials: 'include' });
    if (res.ok) setStats(await res.json());
  };

  return { stats, fetchStats };
}
