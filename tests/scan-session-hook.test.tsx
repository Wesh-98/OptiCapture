// @vitest-environment jsdom
/**
 * tests/scan-session-hook.test.tsx — the desktop scan session hook, mounted
 *
 * tests/scan-helpers.test.ts covers the pure helpers useScanSession is built from, and
 * tests/scan-poll-visibility.test.tsx covers the tab-visibility wiring. This file covers
 * the rest of the hook's wiring, which is the heart of the capture flow on the desktop:
 *
 *   - which session the page lands on (a `?session=` link, the one saved in this tab,
 *     or a brand-new one) and when a saved one must be thrown away
 *   - what the live feed does with each poll: the cursor, merging, auto-selection, and
 *     a manual deselect that must survive later polls
 *   - how it reacts when the session is committed elsewhere, expires, or the server drops
 *   - the expiry and long-session reminders
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionItem } from '../src/components/scan/types';

// The real provider fetches on mount; the hook only reads user.store_id. Created once so its
// identity is stable across renders.
vi.mock('../src/context/AuthContext', () => {
  const user = { id: 1, username: 'admin', role: 'owner', store_id: 1, store_name: 'OptiMart' };
  return { useAuth: () => ({ user }) };
});

const { POLL_INTERVAL_MS, useScanSession } = await import('../src/hooks/useScanSession.js');

const NEW_ID = 'new-session';
const SAVED_ID = 'saved-session';
const OTP = 'ABCD2345';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function item(id: number, overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    id,
    upc: `0000000000${id}`,
    quantity: 1,
    product_name: `Item ${id}`,
    brand: null,
    image: null,
    scanned_at: '2026-10-16 09:00:00',
    lookup_status: 'new_candidate',
    source: null,
    exists_in_inventory: 0,
    sale_price: null,
    unit: null,
    updated_at: `2026-10-16 09:00:0${id % 10}`,
    ...overrides,
  };
}

/**
 * A tiny fake of the session API. Each test sets what the server answers; every request is
 * recorded so a test can assert on what the hook asked for.
 */
function fakeServer() {
  const state = {
    createStatus: 200,
    active: [] as Array<{ session_id: string; otp: string; status: string; label?: string | null }>,
    meta: null as null | { status: string; label?: string | null },
    /** Answer for GET /api/session/:id — a status code, a thrown network error, or a body. */
    poll: (_url: string): Response => jsonResponse({ items: [], status: 'active' }),
    requests: [] as string[],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      state.requests.push(url);
      if (url === '/api/session/create') {
        return state.createStatus === 200
          ? jsonResponse({ sessionId: NEW_ID, otp: OTP })
          : jsonResponse({ error: 'nope' }, state.createStatus);
      }
      if (url === '/api/sessions/active') return jsonResponse(state.active);
      if (url.endsWith('/meta')) {
        return state.meta ? jsonResponse(state.meta) : jsonResponse({ error: 'gone' }, 404);
      }
      if (url.startsWith('/api/session/')) return state.poll(url);
      return jsonResponse({});
    })
  );

  return {
    state,
    polls: () =>
      state.requests.filter(
        u => u.startsWith('/api/session/') && !u.endsWith('/meta') && u !== '/api/session/create'
      ),
    created: () => state.requests.filter(u => u === '/api/session/create').length,
  };
}

/** Flush pending promises and advance the fake clock inside React's act(). */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(entry = '/scan') {
  const addToast = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
  const hook = renderHook(() => useScanSession(addToast), { wrapper });
  return { ...hook, addToast };
}

let visibility: DocumentVisibilityState = 'visible';
async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  sessionStorage.clear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useScanSession — which session the page opens', () => {
  it('creates a new session when nothing is saved, and remembers it for this tab', async () => {
    const api = fakeServer();
    const { result } = mount();
    await advance(0);

    expect(api.created()).toBe(1);
    expect(result.current.sessionId).toBe(NEW_ID);
    expect(result.current.otp).toBe(OTP);
    expect(result.current.sessionStatus).toBe('active');
    expect(result.current.uiStatus).toBe('ready');
    expect(result.current.statusMessage).toBe('Session ready. Scan the QR code with your phone.');
    expect(result.current.sessionLoading).toBe(false);
    expect(sessionStorage.getItem('scan_session_id')).toBe(NEW_ID);
    expect(sessionStorage.getItem('scan_otp')).toBe(OTP);
    expect(sessionStorage.getItem('scan_store_id')).toBe('1');
  });

  it('reports a failed create and leaves nothing saved', async () => {
    const api = fakeServer();
    api.state.createStatus = 500;
    const { result } = mount();
    await advance(0);

    expect(result.current.sessionId).toBeNull();
    expect(result.current.otp).toBeNull();
    expect(result.current.uiStatus).toBe('error');
    expect(result.current.statusMessage).toBe('Could not create scan session.');
    expect(result.current.sessionLoading).toBe(false);
    expect(sessionStorage.getItem('scan_session_id')).toBeNull();
    // Nothing to poll without a session.
    await advance(POLL_INTERVAL_MS * 3);
    expect(api.polls()).toHaveLength(0);
  });

  it('resumes the session saved in this tab instead of creating another', async () => {
    const api = fakeServer();
    sessionStorage.setItem('scan_session_id', SAVED_ID);
    sessionStorage.setItem('scan_otp', OTP);
    sessionStorage.setItem('scan_store_id', '1');
    api.state.active = [{ session_id: SAVED_ID, otp: OTP, status: 'active', label: 'Aisle 4' }];
    const fresh = item(1);
    const known = item(2, { exists_in_inventory: 1, lookup_status: 'matched' });
    api.state.poll = () =>
      jsonResponse({ items: [fresh, known], status: 'active', label: 'Aisle 4' });

    const { result } = mount();
    await advance(0);

    expect(api.created()).toBe(0);
    expect(result.current.sessionId).toBe(SAVED_ID);
    expect(result.current.sessionLabel).toBe('Aisle 4');
    expect(result.current.statusMessage).toBe('Session resumed. Scan the QR code with your phone.');
    expect(result.current.items.map(i => i.id)).toEqual([1, 2]);
    // New products are pre-selected for commit; ones already in inventory are not.
    expect([...result.current.selectedIds]).toEqual([1]);
  });

  it('drops a saved session that belongs to a different store', async () => {
    const api = fakeServer();
    sessionStorage.setItem('scan_session_id', SAVED_ID);
    sessionStorage.setItem('scan_otp', OTP);
    sessionStorage.setItem('scan_store_id', '99');

    const { result } = mount();
    await advance(0);

    // Never even asked about the other store's session.
    expect(api.state.requests.some(u => u.includes(SAVED_ID))).toBe(false);
    expect(api.created()).toBe(1);
    expect(result.current.sessionId).toBe(NEW_ID);
    expect(sessionStorage.getItem('scan_store_id')).toBe('1');
  });

  it('starts fresh when the saved session no longer exists', async () => {
    const api = fakeServer();
    sessionStorage.setItem('scan_session_id', SAVED_ID);
    sessionStorage.setItem('scan_otp', OTP);
    api.state.poll = url =>
      url.includes(SAVED_ID) ? jsonResponse({ error: 'gone' }, 404) : jsonResponse({ items: [] });

    const { result } = mount();
    await advance(0);

    expect(api.created()).toBe(1);
    expect(result.current.sessionId).toBe(NEW_ID);
    expect(sessionStorage.getItem('scan_session_id')).toBe(NEW_ID);
  });

  it('starts fresh when the saved session was already committed', async () => {
    const api = fakeServer();
    sessionStorage.setItem('scan_session_id', SAVED_ID);
    sessionStorage.setItem('scan_otp', OTP);
    api.state.poll = url =>
      url.includes(SAVED_ID)
        ? jsonResponse({ items: [item(1)], status: 'completed' })
        : jsonResponse({ items: [], status: 'active' });

    const { result } = mount();
    await advance(0);

    expect(api.created()).toBe(1);
    expect(result.current.sessionId).toBe(NEW_ID);
  });

  it('opens the session named in a ?session= link when it is still active', async () => {
    const api = fakeServer();
    api.state.active = [{ session_id: SAVED_ID, otp: OTP, status: 'draft', label: 'Back room' }];
    api.state.poll = () => jsonResponse({ items: [item(1)], status: 'draft', label: 'Back room' });

    const { result } = mount(`/scan?session=${SAVED_ID}`);
    await advance(0);

    expect(api.created()).toBe(0);
    expect(result.current.sessionId).toBe(SAVED_ID);
    expect(result.current.sessionStatus).toBe('draft');
    expect(result.current.sessionLabel).toBe('Back room');
    expect(sessionStorage.getItem('scan_session_id')).toBe(SAVED_ID);
  });

  it('opens a committed session from a link as view-only, without polling', async () => {
    const api = fakeServer();
    sessionStorage.setItem('scan_session_id', 'stale');
    sessionStorage.setItem('scan_otp', OTP);
    api.state.meta = { status: 'completed', label: 'Monday delivery' };
    api.state.poll = () =>
      jsonResponse({ items: [item(1)], status: 'completed', label: 'Monday delivery' });

    const { result } = mount(`/scan?session=${SAVED_ID}`);
    await advance(0);

    expect(api.created()).toBe(0);
    expect(result.current.sessionId).toBe(SAVED_ID);
    expect(result.current.sessionStatus).toBe('completed');
    expect(result.current.sessionLabel).toBe('Monday delivery');
    // A committed session cannot be resumed later, so the tab forgets it.
    expect(sessionStorage.getItem('scan_session_id')).toBeNull();
    // One full load of the items to view, then no interval.
    expect(result.current.items.map(i => i.id)).toEqual([1]);
    const loaded = api.polls().length;
    await advance(POLL_INTERVAL_MS * 4);
    expect(api.polls()).toHaveLength(loaded);
  });

  it('falls back to a new session when a ?session= link matches nothing', async () => {
    const api = fakeServer();
    const { result } = mount('/scan?session=unknown');
    await advance(0);

    expect(api.created()).toBe(1);
    expect(result.current.sessionId).toBe(NEW_ID);
  });
});

describe('useScanSession — the live feed', () => {
  it('polls with the cursor of the newest item and merges what comes back', async () => {
    const api = fakeServer();
    const first = item(1, { updated_at: '2026-10-16 09:00:01' });
    const second = item(2, { updated_at: '2026-10-16 09:00:05' });
    let feed: SessionItem[] = [first];
    api.state.poll = () => jsonResponse({ items: feed, status: 'active' });

    const { result } = mount();
    await advance(0);
    expect(result.current.items.map(i => i.id)).toEqual([1]);
    // The very first load is a full refresh, with no cursor.
    expect(api.polls()[0]).toBe(`/api/session/${NEW_ID}`);

    feed = [second];
    await advance(POLL_INTERVAL_MS);
    const latest = api.polls().at(-1)!;
    expect(latest).toContain(`since_updated_at=${encodeURIComponent('2026-10-16 09:00:01')}`);
    expect(latest).toContain('since_id=1');
    // Incremental answers are merged, newest first, not substituted.
    expect(result.current.items.map(i => i.id)).toEqual([2, 1]);
    expect([...result.current.selectedIds].sort()).toEqual([1, 2]);

    // An empty incremental answer leaves the feed alone.
    feed = [];
    await advance(POLL_INTERVAL_MS);
    expect(result.current.items.map(i => i.id)).toEqual([2, 1]);
    expect(api.polls().at(-1)).toContain('since_id=2');
  });

  it('keeps an item the user deselected deselected when it updates again', async () => {
    const api = fakeServer();
    let feed = [item(1, { updated_at: '2026-10-16 09:00:01' })];
    api.state.poll = () => jsonResponse({ items: feed, status: 'active' });

    const { result } = mount();
    await advance(0);
    expect(result.current.selectedIds.has(1)).toBe(true);

    act(() => result.current.toggleItem(1));
    expect(result.current.selectedIds.has(1)).toBe(false);

    // The phone scans the same product again: the row comes back with a new quantity.
    feed = [item(1, { quantity: 2, updated_at: '2026-10-16 09:00:09' })];
    await advance(POLL_INTERVAL_MS);
    expect(result.current.items[0].quantity).toBe(2);
    expect(result.current.selectedIds.has(1)).toBe(false);

    // Selecting it again by hand is honoured.
    act(() => result.current.toggleItem(1));
    expect(result.current.selectedIds.has(1)).toBe(true);
  });

  it('switches to view-only when the session is committed from somewhere else', async () => {
    const api = fakeServer();
    let status = 'active';
    api.state.poll = () => jsonResponse({ items: [item(1)], status });

    const { result } = mount();
    await advance(0);
    expect(result.current.selectedIds.size).toBe(1);

    status = 'completed';
    await advance(POLL_INTERVAL_MS);
    expect(result.current.sessionStatus).toBe('completed');
    expect(result.current.statusMessage).toBe('Session committed to inventory. View only.');
    expect(result.current.selectedIds.size).toBe(0);
    expect(sessionStorage.getItem('scan_session_id')).toBeNull();

    // At most the one full refresh that comes with the status change, then nothing.
    await advance(POLL_INTERVAL_MS);
    const settled = api.polls().length;
    await advance(POLL_INTERVAL_MS * 4);
    expect(api.polls()).toHaveLength(settled);
  });

  it('rides out two dropped polls and gives up as offline on the third', async () => {
    const api = fakeServer();
    let down = false;
    api.state.poll = () => {
      if (down) throw new TypeError('Failed to fetch');
      return jsonResponse({ items: [], status: 'active' });
    };

    const { result } = mount();
    await advance(0);

    down = true;
    await advance(POLL_INTERVAL_MS);
    expect(result.current.pollError).toBe('Could not refresh live scan feed.');
    expect(result.current.uiStatus).toBe('ready');

    // A successful poll in between resets the strike count and clears the banner.
    down = false;
    await advance(POLL_INTERVAL_MS);
    expect(result.current.pollError).toBeNull();

    down = true;
    await advance(POLL_INTERVAL_MS * 2);
    expect(result.current.uiStatus).toBe('ready');
    await advance(POLL_INTERVAL_MS);
    expect(result.current.uiStatus).toBe('error');
    expect(result.current.statusMessage).toBe('Server is offline or unreachable.');
    expect(result.current.pollError).toMatch(/polling stopped/);

    const stopped = api.polls().length;
    await advance(POLL_INTERVAL_MS * 5);
    expect(api.polls()).toHaveLength(stopped);
  });

  it('keeps polling through a rate limit, without calling the server offline', async () => {
    const api = fakeServer();
    let limited = false;
    api.state.poll = () =>
      limited ? jsonResponse({ error: 'slow down' }, 429) : jsonResponse({ items: [] });

    const { result } = mount();
    await advance(0);

    limited = true;
    // Well past the three strikes a network failure would get.
    await advance(POLL_INTERVAL_MS * 4);
    expect(result.current.pollError).toMatch(/Too many requests/);
    expect(result.current.uiStatus).toBe('ready');

    limited = false;
    const before = api.polls().length;
    await advance(POLL_INTERVAL_MS);
    expect(api.polls().length).toBeGreaterThan(before);
    expect(result.current.pollError).toBeNull();
  });

  it.each([
    [401, 'Your session has ended. Please log in again.'],
    [403, 'This scan session is no longer available.'],
    [409, 'Select a store to continue.'],
  ])('stops polling with a specific message on a %i', async (status, message) => {
    const api = fakeServer();
    let answer = 200;
    api.state.poll = () =>
      answer === 200 ? jsonResponse({ items: [] }) : jsonResponse({ error: 'x' }, answer);

    const { result } = mount();
    await advance(0);

    answer = status;
    await advance(POLL_INTERVAL_MS);
    expect(result.current.uiStatus).toBe('error');
    expect(result.current.statusMessage).toBe(message);
    expect(result.current.pollError).not.toMatch(/offline/i);

    const stopped = api.polls().length;
    await advance(POLL_INTERVAL_MS * 4);
    expect(api.polls()).toHaveLength(stopped);
  });

  it('starts a clean session on reset, with no selection carried over', async () => {
    const api = fakeServer();
    api.state.poll = url =>
      url.includes('second') ? jsonResponse({ items: [] }) : jsonResponse({ items: [item(1)] });

    const { result } = mount();
    await advance(0);
    expect(result.current.selectedIds.size).toBe(1);

    vi.mocked(fetch).mockImplementationOnce(async () =>
      jsonResponse({ sessionId: 'second', otp: 'ZZZZ9999' })
    );
    await act(async () => {
      await result.current.handleResetSession();
    });
    await advance(0);

    expect(result.current.sessionId).toBe('second');
    expect(result.current.otp).toBe('ZZZZ9999');
    expect(result.current.items).toEqual([]);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.isRefreshing).toBe(false);
    expect(sessionStorage.getItem('scan_session_id')).toBe('second');
  });
});

describe('useScanSession — reminders', () => {
  it('warns once when the session is within 30 minutes of expiring', async () => {
    const api = fakeServer();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    api.state.poll = () => jsonResponse({ items: [], status: 'active', expires_at: expiresAt });

    const { addToast } = mount();
    await advance(0);

    expect(addToast).toHaveBeenCalledWith(
      'warning',
      'Session expires in 10 min - save as draft or commit soon'
    );
    // The check runs every minute, but the warning is not repeated.
    await advance(3 * 60 * 1000);
    expect(addToast.mock.calls.filter(([type]) => type === 'warning')).toHaveLength(1);
  });

  it('does not warn about a session with hours left', async () => {
    const api = fakeServer();
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    api.state.poll = () => jsonResponse({ items: [], status: 'active', expires_at: expiresAt });

    const { addToast } = mount();
    await advance(0);
    await advance(60_000);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('suggests saving a draft once a session has been scanning for 30 minutes', async () => {
    const api = fakeServer();
    let feed: SessionItem[] = [];
    api.state.poll = () => jsonResponse({ items: feed, status: 'active' });

    const { result } = mount();
    await advance(0);
    expect(result.current.draftAlert.visible).toBe(false);

    // Park the tab so the clock can jump without thousands of polls, then come back to a
    // fresh scan.
    await setVisibility('hidden');
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    feed = [item(1, { updated_at: '2026-10-16 09:31:00' })];
    await setVisibility('visible');

    expect(result.current.draftAlert).toEqual({
      visible: true,
      message: "You've been scanning for 31 min - save as draft to protect your progress.",
    });
  });
});
