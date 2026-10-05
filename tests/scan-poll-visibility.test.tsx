// @vitest-environment jsdom
/**
 * tests/scan-poll-visibility.test.tsx — the desktop live feed must not poll a hidden tab
 *
 * The rest of the suite runs in Node, so this file opts into jsdom on its own: the
 * behaviour under test is the `visibilitychange` wiring in useScanSession, which needs a
 * real `document` and a renderer to run effects. Without it, deleting that effect or
 * swapping 'visible' for 'hidden' would leave every other test passing.
 *
 * Why it matters: the Scan page polls every 2s, that route is not exempt from the per-IP
 * API limiter, and a storefront shares one public IP — so a few forgotten tabs were enough
 * to exhaust the request budget for everyone in the shop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The real provider fetches on mount and useAuth throws outside it; the hook only reads
// user.store_id. The object is created once so its identity is stable across renders.
vi.mock('../src/context/AuthContext', () => {
  const user = {
    id: 1,
    username: 'admin',
    role: 'owner',
    store_id: 1,
    store_name: 'OptiMart Downtown',
  };
  return { useAuth: () => ({ user }) };
});

const { POLL_INTERVAL_MS, useScanSession } = await import('../src/hooks/useScanSession.js');

const SESSION_ID = 'visibility-session';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('desktop scan polling and tab visibility', () => {
  let pollCount = 0;
  let visibility: DocumentVisibilityState = 'visible';

  const wrapper = ({ children }: PropsWithChildren) => <MemoryRouter>{children}</MemoryRouter>;

  /** Flush pending promises and advance the fake clock inside React's act(). */
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const setVisibility = async (next: DocumentVisibilityState) => {
    visibility = next;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  beforeEach(() => {
    pollCount = 0;
    visibility = 'visible';
    sessionStorage.clear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/session/create')) {
          return jsonResponse({ sessionId: SESSION_ID, otp: 'ABCD2345' });
        }
        if (url.includes('/api/sessions/active')) {
          return jsonResponse([]);
        }
        if (url.includes(`/api/session/${SESSION_ID}`)) {
          pollCount++;
          return jsonResponse({ items: [], expires_at: null, status: 'active', label: null });
        }
        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls while visible, stops while hidden, and catches up on return', async () => {
    const { result, unmount } = renderHook(() => useScanSession(vi.fn()), { wrapper });

    // Session creation plus the first full refresh.
    await advance(0);
    expect(result.current.sessionId).toBe(SESSION_ID);
    expect(pollCount).toBeGreaterThan(0);

    // Visible: the interval keeps firing.
    const beforeVisibleRun = pollCount;
    await advance(POLL_INTERVAL_MS * 2);
    expect(pollCount).toBeGreaterThan(beforeVisibleRun);

    // Hidden: not one more request, however long the tab sits there.
    await setVisibility('hidden');
    const atHide = pollCount;
    await advance(POLL_INTERVAL_MS * 5);
    expect(pollCount).toBe(atHide);

    // Visible again: exactly one immediate catch-up poll, before any interval tick.
    await setVisibility('visible');
    expect(pollCount).toBe(atHide + 1);

    // ...and the interval is running again.
    await advance(POLL_INTERVAL_MS * 2);
    expect(pollCount).toBeGreaterThan(atHide + 1);

    // Unmount detaches the listener and clears the interval.
    unmount();
    const atUnmount = pollCount;
    await advance(POLL_INTERVAL_MS * 3);
    await setVisibility('visible');
    expect(pollCount).toBe(atUnmount);
  });

  it('does not start an interval when the page is already hidden', async () => {
    visibility = 'hidden';

    const { result } = renderHook(() => useScanSession(vi.fn()), { wrapper });

    // The initial full refresh is explicit, not on the interval, so it still runs.
    await advance(0);
    expect(result.current.sessionId).toBe(SESSION_ID);
    const afterMount = pollCount;

    await advance(POLL_INTERVAL_MS * 5);
    expect(pollCount).toBe(afterMount);
  });
});
