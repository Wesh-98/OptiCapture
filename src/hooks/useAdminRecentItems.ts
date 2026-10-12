import { useSearchParams } from 'react-router-dom';
import { useAdminItemList } from './useAdminItemList';

/** How an item first entered the catalog. Null for items added before this was recorded. */
export type ItemSource = 'manual' | 'import' | 'scan';

export interface RecentItem {
  id: number;
  item_name: string;
  upc: string | null;
  image: string | null;
  sale_price: number | null;
  status: string;
  created_at: string;
  source: ItemSource | null;
  store_id: number;
  store_name: string;
  store_status: string;
  category_name: string | null;
}

export const RECENT_WINDOWS = [1, 7, 30] as const;
export type RecentWindow = (typeof RECENT_WINDOWS)[number];

export const RECENT_WINDOW_LABELS: Record<RecentWindow, string> = {
  1: 'Last 24 hours',
  7: 'Last 7 days',
  30: 'Last 30 days',
};

// The window lives in the URL (`?days=`), beside the store, so a shared link lands on the
// same view.
const DAYS_PARAM = 'days';

function parseWindow(raw: string | null): RecentWindow {
  const n = Number(raw);
  return n === 1 || n === 30 ? n : 7;
}

// Items added in the last day, week or month, across every store or one, newest first.
export function useAdminRecentItems() {
  const [searchParams] = useSearchParams();
  const days = parseWindow(searchParams.get(DAYS_PARAM));
  const list = useAdminItemList({
    endpoint: '/api/admin/recent-items',
    filter: { name: DAYS_PARAM, value: String(days) },
    failureText: 'Failed to load items',
  });
  const setDays = (next: RecentWindow) =>
    list.setParam(DAYS_PARAM, next === 7 ? null : String(next));

  return { ...list, days, setDays };
}
