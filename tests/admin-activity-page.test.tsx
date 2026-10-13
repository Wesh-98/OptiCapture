// @vitest-environment jsdom
/**
 * tests/admin-activity-page.test.tsx — the Super Admin "Activity log" page and the
 * dashboard's Recent changes card
 *
 * The store and kind come from the URL, like the other cross-store lists. "Mark all as seen"
 * sends back the newest change the server reported, whatever filter is on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { stores } from './admin-item-list-fixtures';
import { ToastProvider } from '../src/context/ToastContext';
import AdminActivity from '../src/pages/AdminActivity';
import AdminDashboard from '../src/pages/AdminDashboard';

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'superadmin', role: 'superadmin' } }),
}));

const entries = [
  {
    id: 90,
    kind: 'capture',
    summary: 'Captured 3 new items',
    timestamp: '2026-10-12 09:00:00',
    store_id: 5,
    store_name: 'North Mart',
    username: 'northowner',
    seen: false,
  },
  {
    id: 80,
    kind: 'deleted',
    summary: 'Store deleted',
    timestamp: '2026-10-11 09:00:00',
    store_id: null,
    store_name: 'Gone Mart',
    username: 'superadmin',
    seen: true,
  },
];

// The dashboard's store table reads more of each store than the list pages do.
const storeRows = stores.map(store => ({
  ...store,
  address: '',
  email: '',
  phone: '',
  created_at: '2026-10-01 08:00:00',
  user_count: 1,
  category_count: 2,
  items_added_week: 0,
  last_item_added_at: null,
  missing_upc_count: 0,
}));

/** Stubs the store list, the activity feed and mark-as-seen; returns the mock. */
function stubFetch() {
  let seen = false;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    let body: unknown;
    if (url.startsWith('/api/admin/stores')) {
      body = storeRows;
    } else if (init?.method === 'POST') {
      seen = true;
      body = { unseen: 0, newest: 90 };
    } else {
      body = {
        items: entries.map(entry => ({ ...entry, seen: seen || entry.seen })),
        total: entries.length,
        unseen: seen ? 0 : 1,
        newest: 90,
      };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const activityGets = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url.startsWith('/api/admin/activity') && init?.method !== 'POST')
    .map(([url]) => url);

const seenPosts = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/admin/activity/seen' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)));

function renderAt(path: string, page = <AdminActivity />) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </ToastProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminActivity', () => {
  it('lists every change, linking live stores and flagging the new ones', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/activity');

    const newRow = (await screen.findByText('Captured 3 new items')).closest('tr')!;
    expect(within(newRow).getByRole('link', { name: 'North Mart' }).getAttribute('href')).toBe(
      '/admin/stores/5'
    );
    expect(within(newRow).getByText('New')).toBeTruthy();

    // A deleted store has no page to open, and a seen change carries no flag.
    const seenRow = screen.getByText('Store deleted').closest('tr')!;
    expect(within(seenRow).queryByRole('link')).toBeNull();
    expect(within(seenRow).queryByText('New')).toBeNull();

    expect(activityGets(fetchMock)).toEqual(['/api/admin/activity?kind=all&page=1']);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Activity log').getAttribute('aria-current')).toBe('page');
  });

  it('opens filtered to the store and kind in the URL, and refetches when they change', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/activity?store=5&kind=capture');

    await screen.findByText('Captured 3 new items');
    expect(activityGets(fetchMock)).toEqual(['/api/admin/activity?kind=capture&page=1&store=5']);
    // One store's log does not repeat the store on every row.
    expect(screen.queryByRole('columnheader', { name: 'Store' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Kind of change'), { target: { value: 'all' } });
    await waitFor(() =>
      expect(activityGets(fetchMock)).toContain('/api/admin/activity?kind=all&page=1&store=5')
    );
  });

  it('offers only the kinds that apply inside one store once a store is picked', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/activity?kind=deleted');

    await screen.findByText('Captured 3 new items');
    const kinds = () =>
      within(screen.getByLabelText('Kind of change'))
        .getAllByRole('option')
        .map(option => option.textContent);
    expect(kinds()).toContain('Stores deleted');
    expect(kinds()).toContain('Stores registered');

    await screen.findByRole('option', { name: 'North Mart' });
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: '5' } });
    // The kind in the URL no longer applies, so the store's whole log is asked for.
    await waitFor(() =>
      expect(activityGets(fetchMock)).toContain('/api/admin/activity?kind=all&page=1&store=5')
    );
    expect(kinds()).toEqual(['All changes', 'Captures']);
  });

  it('marks everything up to the newest change as seen, then reloads', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/activity?kind=deleted');

    await screen.findByText('Captured 3 new items');
    const button = screen.getByRole('button', { name: 'Mark all as seen' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(seenPosts(fetchMock)).toEqual([{ through: 90 }]));
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('New')).toBeNull());
    expect(activityGets(fetchMock)).toHaveLength(2);
    expect(button.disabled).toBe(true);
  });
});

describe('AdminDashboard recent changes card', () => {
  it('counts the new changes, clears them on request and links to the full log', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin', <AdminDashboard />);

    const heading = await screen.findByRole('heading', { name: 'Recent changes' });
    const card = heading.closest('section')!;
    await within(card).findByText('1 new');
    expect(activityGets(fetchMock)).toEqual(['/api/admin/activity?limit=5']);
    expect(within(card).getByRole('link', { name: 'See all' }).getAttribute('href')).toBe(
      '/admin/activity'
    );

    fireEvent.click(within(card).getByRole('button', { name: 'Mark all as seen' }));
    await waitFor(() => expect(seenPosts(fetchMock)).toEqual([{ through: 90 }]));
    await waitFor(() => expect(within(card).queryByText('1 new')).toBeNull());
    expect(within(card).queryByText('New')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Mark all as seen' })).toBeNull();
  });
});
