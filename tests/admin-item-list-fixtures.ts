/**
 * tests/admin-item-list-fixtures.ts — shared data for the Super Admin cross-store item list
 * pages (Recently added, Search).
 */
import { vi } from 'vitest';

export const stores = [
  { id: 5, name: 'North Mart', status: 'active', item_count: 3 },
  { id: 6, name: 'South Mart', status: 'suspended', item_count: 1 },
];

export const item = {
  id: 41,
  item_name: 'Fresh Cola',
  upc: '0123',
  image: null,
  sale_price: 1.5,
  status: 'Active',
  created_at: '2026-10-09 08:00:00',
  store_id: 5,
  store_name: 'North Mart',
  store_status: 'active',
  category_name: 'Drinks',
};

/** Stubs fetch so the store list and any item list answer; returns the mock. */
export function stubItemListFetch(items = [item]) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/admin/stores') ? stores : { items, total: items.length, page: 1 },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The URLs the page fetched under `prefix`, in order. */
export const fetchedUrls = (fetchMock: ReturnType<typeof stubItemListFetch>, prefix: string) =>
  fetchMock.mock.calls.map(([url]) => url).filter(url => url.startsWith(prefix));
