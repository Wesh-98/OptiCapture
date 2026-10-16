// @vitest-environment jsdom
/**
 * tests/logs-page-hook.test.tsx — the activity log page's hook and API client
 *
 * The route itself is covered in tests/categories-logs.test.ts. This file covers what the
 * page asks for (filters, local-day date range, search debounce, paging) and what it shows
 * — including that an answer for a filter the owner has already left never replaces the
 * answer for the filter they are looking at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLogsPage } from '../src/hooks/useLogsPage';
import { fetchActivityLogs, localDayRangeUtc } from '../src/components/logs/logsApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const entry = (id: number, action = 'CREATE') => ({
  id,
  action,
  details: `Detail ${id}`,
  username: 'admin',
  timestamp: '2026-10-16 09:00:00',
});

let requests: URL[] = [];

function stubLogs(reply: (url: URL) => Response | Promise<Response>) {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      requests.push(url);
      return reply(url);
    })
  );
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLogsPage', () => {
  it('loads the first page of everything', async () => {
    stubLogs(() => jsonResponse({ items: [entry(1), entry(2)], total: 2, store_total: 40 }));
    const { result } = renderHook(() => useLogsPage());
    expect(result.current.isLoading).toBe(true);
    await flush();

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ page: '1', limit: '50' });
    expect(result.current.logs.map(l => l.id)).toEqual([1, 2]);
    expect(result.current.resultCount).toBe(2);
    expect(result.current.logsCount).toBe(40);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('filters by action, and clears back to all', async () => {
    stubLogs(() => jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(() => useLogsPage());
    await flush();

    act(() => result.current.toggleFilterOpen());
    expect(result.current.filterOpen).toBe(true);
    act(() => result.current.selectActionFilter('DELETE'));
    expect(result.current.filterOpen).toBe(false);
    await flush();
    expect(requests.at(-1)!.searchParams.get('action')).toBe('DELETE');

    act(() => result.current.clearActionFilter());
    await flush();
    expect(requests.at(-1)!.searchParams.has('action')).toBe(false);
  });

  it('waits for typing to pause before searching', async () => {
    stubLogs(() => jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(() => useLogsPage());
    await flush();

    act(() => result.current.setSearch('c'));
    await flush(100);
    act(() => result.current.setSearch('co'));
    await flush(100);
    act(() => result.current.setSearch('cola '));
    await flush(299);
    expect(requests).toHaveLength(1);

    await flush(1);
    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get('q')).toBe('cola');
  });

  it('sends the picked days as local-midnight instants, and can clear them', async () => {
    stubLogs(() => jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(() => useLogsPage());
    await flush();

    act(() => {
      result.current.setDateFrom('2026-10-01');
      result.current.setDateTo('2026-10-03');
    });
    await flush();
    const params = requests.at(-1)!.searchParams;
    expect(params.get('from_utc')).toBe(new Date(2026, 9, 1).toISOString());
    expect(params.get('to_utc')).toBe(new Date(2026, 9, 4).toISOString());

    act(() => result.current.clearDateRange());
    await flush();
    expect(result.current.dateFrom).toBe('');
    expect(requests.at(-1)!.searchParams.has('from_utc')).toBe(false);
  });

  it('pages through results, staying within the first and last page', async () => {
    stubLogs(url =>
      jsonResponse({ items: [entry(Number(url.searchParams.get('page')))], total: 120 })
    );
    const { result } = renderHook(() => useLogsPage());
    await flush();
    expect(result.current.totalPages).toBe(3);

    act(() => result.current.goToPreviousPage());
    expect(result.current.currentPage).toBe(1);

    act(() => result.current.goToNextPage());
    await flush();
    act(() => result.current.goToNextPage());
    await flush();
    act(() => result.current.goToNextPage());
    await flush();
    expect(result.current.currentPage).toBe(3);
    expect(result.current.logs.map(l => l.id)).toEqual([3]);

    // A bigger page size means fewer pages, and starts again from page 1.
    act(() => result.current.setPageSize(200));
    await flush();
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(requests.at(-1)!.searchParams.get('limit')).toBe('200');
  });

  it('goes back to page 1 when a filter changes', async () => {
    stubLogs(() => jsonResponse({ items: [], total: 500 }));
    const { result } = renderHook(() => useLogsPage());
    await flush();
    act(() => result.current.goToNextPage());
    await flush();
    expect(result.current.currentPage).toBe(2);

    act(() => result.current.selectActionFilter('LOGIN'));
    await flush();
    expect(result.current.currentPage).toBe(1);
    expect(requests.at(-1)!.searchParams.get('page')).toBe('1');
  });

  it('shows only the answer for the filter currently chosen, whatever order answers arrive in', async () => {
    const pending: Array<{ action: string | null; resolve: (r: Response) => void }> = [];
    stubLogs(
      url =>
        new Promise<Response>(resolve => {
          pending.push({ action: url.searchParams.get('action'), resolve });
        })
    );
    const { result } = renderHook(() => useLogsPage());
    await flush();
    await act(async () => {
      pending[0].resolve(jsonResponse({ items: [entry(1)], total: 1 }));
    });

    act(() => result.current.selectActionFilter('DELETE'));
    await flush();
    act(() => result.current.selectActionFilter('CREATE'));
    await flush();

    const slowDelete = pending.find(p => p.action === 'DELETE')!;
    const fastCreate = pending.find(p => p.action === 'CREATE')!;
    await act(async () => {
      fastCreate.resolve(jsonResponse({ items: [entry(30, 'CREATE')], total: 1 }));
    });
    await act(async () => {
      slowDelete.resolve(jsonResponse({ items: [entry(20, 'DELETE')], total: 1 }));
    });

    expect(result.current.actionFilter).toBe('CREATE');
    expect(result.current.logs.map(l => l.action)).toEqual(['CREATE']);
    expect(result.current.isLoading).toBe(false);
  });

  it('shows a load failure', async () => {
    stubLogs(() => jsonResponse({ error: 'Store selection required' }, 409));
    const { result } = renderHook(() => useLogsPage());
    await flush();
    expect(result.current.fetchError).toBe('Store selection required');
    expect(result.current.isLoading).toBe(false);
  });

  it('closes the filter menu on a click outside it, but not inside', async () => {
    stubLogs(() => jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(() => useLogsPage());
    await flush();
    const menu = document.createElement('div');
    const inside = document.createElement('button');
    menu.appendChild(inside);
    document.body.appendChild(menu);
    (result.current.filterRef as { current: HTMLDivElement | null }).current = menu;

    act(() => result.current.toggleFilterOpen());
    act(() => {
      inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.filterOpen).toBe(true);

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.filterOpen).toBe(false);
    menu.remove();
  });
});

describe('logsApi', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('cleans up entries and counts', async () => {
    stubLogs(() =>
      jsonResponse({
        items: [
          { id: 4.7, action: '  ', details: 5, username: '', timestamp: null },
          { id: 'x' },
          'junk',
          entry(2),
        ],
        total: -1,
      })
    );

    const page = await fetchActivityLogs({ page: 1, limit: 50 });

    expect(page).toEqual({
      items: [
        { id: 4, action: 'UNKNOWN', details: '', username: 'Unknown user', timestamp: '' },
        entry(2),
      ],
      total: 0,
      storeTotal: 0,
    });
  });

  it.each([
    [
      'a body with no item list',
      () => jsonResponse({ total: 1 }),
      'Invalid response while loading activity logs.',
    ],
    [
      'a non-JSON success',
      () => new Response('<html>'),
      'Invalid response while loading activity logs.',
    ],
    ['a text error', () => new Response('Bad gateway', { status: 502 }), 'Bad gateway'],
    ['an empty error', () => new Response('', { status: 500 }), 'Could not load activity logs.'],
  ])('rejects %s', async (_label, reply, message) => {
    stubLogs(reply);
    await expect(fetchActivityLogs({ page: 1, limit: 50 })).rejects.toThrow(message);
  });

  it('turns picked days into local-midnight instants, ignoring malformed dates', () => {
    expect(localDayRangeUtc()).toEqual({});
    expect(localDayRangeUtc('2026-02-28', '2026-02-28')).toEqual({
      from_utc: new Date(2026, 1, 28).toISOString(),
      to_utc: new Date(2026, 2, 1).toISOString(),
    });
    expect(localDayRangeUtc('28/02/2026', 'yesterday')).toEqual({
      from_utc: undefined,
      to_utc: undefined,
    });
  });
});
