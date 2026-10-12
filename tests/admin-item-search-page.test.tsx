// @vitest-environment jsdom
/**
 * tests/admin-item-search-page.test.tsx — the Super Admin "Search items" page
 *
 * The search text and store come from the URL, so the sidebar's per-store link and a
 * shared link open the same results.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminItemSearch from '../src/pages/AdminItemSearch';

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'superadmin', role: 'superadmin' } }),
}));

const stores = [
  { id: 5, name: 'North Mart', status: 'active', item_count: 3 },
  { id: 6, name: 'South Mart', status: 'suspended', item_count: 1 },
];
const item = {
  id: 41,
  item_name: 'Fresh Cola',
  upc: '0123',
  image: null,
  sale_price: 1.5,
  status: 'Active',
  created_at: '2026-10-09 08:00:00',
  source: 'scan',
  store_id: 5,
  store_name: 'North Mart',
  store_status: 'active',
  category_name: 'Drinks',
};

function stubFetch(items = [item]) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/admin/stores') ? stores : { items, total: items.length, page: 1 },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const searchCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/admin/search'));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminItemSearch />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminItemSearch', () => {
  it('asks for a search before fetching anything', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/search');

    expect(screen.getByText('Type at least 2 characters to search.')).toBeTruthy();
    await screen.findByRole('option', { name: 'North Mart' });
    expect(searchCalls(fetchMock)).toEqual([]);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Search items').getAttribute('aria-current')).toBe('page');
  });

  it('opens on the search and store in the URL, linking items and stores', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/search?q=cola');

    const link = await screen.findByRole('link', { name: 'Fresh Cola' });
    expect(link.getAttribute('href')).toBe('/admin/stores/5/items/41');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'North Mart' }).getAttribute('href')).toBe(
      '/admin/stores/5'
    );
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('cola');
    expect(searchCalls(fetchMock)).toEqual(['/api/admin/search?q=cola&page=1']);
  });

  it('limits the search to the store in the URL', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/search?q=cola&store=5');

    await screen.findByRole('link', { name: 'Fresh Cola' });
    expect(searchCalls(fetchMock)).toEqual(['/api/admin/search?q=cola&page=1&store=5']);
    // One store's list does not repeat the store on every row.
    expect(screen.queryByRole('columnheader', { name: 'Store' })).toBeNull();
  });

  it('searches once typing pauses, and again when the store changes', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/search');

    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'c' } });
    fireEvent.change(box, { target: { value: ' cola ' } });
    await waitFor(() =>
      expect(searchCalls(fetchMock)).toEqual(['/api/admin/search?q=cola&page=1'])
    );
    // Settling into the URL leaves what was typed alone.
    expect((box as HTMLInputElement).value).toBe(' cola ');

    await screen.findByRole('option', { name: 'South Mart (suspended)' });
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: '6' } });
    await waitFor(() =>
      expect(searchCalls(fetchMock)).toContain('/api/admin/search?q=cola&page=1&store=6')
    );
  });

  it('says so when nothing matches', async () => {
    stubFetch([]);
    renderAt('/admin/search?q=zzz');
    expect(await screen.findByText('No items match "zzz".')).toBeTruthy();
  });
});
