// @vitest-environment jsdom
/**
 * tests/admin-recent-items-page.test.tsx — the Super Admin "Recently added" page
 *
 * The store and window come from the URL, so the sidebar's per-store link and a shared
 * link open the same filtered view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fetchedUrls, stubItemListFetch } from './admin-item-list-fixtures';
import AdminRecentItems from '../src/pages/AdminRecentItems';

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'superadmin', role: 'superadmin' } }),
}));

const stubFetch = stubItemListFetch;
const recentCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchedUrls(fetchMock, '/api/admin/recent-items');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminRecentItems />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminRecentItems', () => {
  it('lists every store over the last 7 days by default, linking items and stores', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/recent');

    const link = await screen.findByRole('link', { name: 'Fresh Cola' });
    expect(link.getAttribute('href')).toBe('/admin/stores/5/items/41');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'North Mart' }).getAttribute('href')).toBe(
      '/admin/stores/5'
    );
    expect(recentCalls(fetchMock)).toEqual(['/api/admin/recent-items?days=7&page=1']);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Recently added').getAttribute('aria-current')).toBe('page');
  });

  it('opens filtered to the store in the URL, with the store in the breadcrumb', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/recent?store=5&days=30');

    await screen.findByRole('link', { name: 'Fresh Cola' });
    expect(recentCalls(fetchMock)).toEqual(['/api/admin/recent-items?days=30&page=1&store=5']);
    // One store's list does not repeat the store on every row.
    expect(screen.queryByRole('columnheader', { name: 'Store' })).toBeNull();
    // The phone back link and the full trail both point up to the store.
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await waitFor(() => {
      const links = within(crumbs).getAllByRole('link', { name: 'North Mart' });
      expect(links.map(link => link.getAttribute('href'))).toEqual([
        '/admin/stores/5',
        '/admin/stores/5',
      ]);
    });
  });

  it('refetches when the window or store changes', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/recent');
    await screen.findByRole('link', { name: 'Fresh Cola' });

    fireEvent.change(screen.getByLabelText('Added within'), { target: { value: '1' } });
    await waitFor(() =>
      expect(recentCalls(fetchMock)).toContain('/api/admin/recent-items?days=1&page=1')
    );
    await screen.findByRole('option', { name: 'South Mart (suspended)' });
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: '6' } });
    await waitFor(() =>
      expect(recentCalls(fetchMock)).toContain('/api/admin/recent-items?days=1&page=1&store=6')
    );
  });
});
