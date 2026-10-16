// @vitest-environment jsdom
/**
 * tests/api-fetch.test.ts — the fetch wrapper that carries the tab's active store
 *
 * A user with access to several stores picks one per tab; every same-origin /api/ call must
 * then say which store it is for (X-Store-Id), or the server answers 409 "Store selection
 * required". main.tsx installs this wrapper once, so if it stops adding the header — or adds
 * it to a third-party request — every page breaks or leaks the store id. Nothing tested it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveStoreId,
  clearStoreScopedSessionState,
  getActiveStoreId,
  installApiFetchInterceptor,
  setActiveStoreId,
} from '../src/lib/apiFetch';

let underlying: ReturnType<typeof vi.fn>;
let uninstall: (() => void) | null = null;

/** The headers the real fetch would have received for its last call. */
function sentHeaders(): Headers {
  const [input, init] = underlying.mock.calls.at(-1)!;
  if (input instanceof Request) return input.headers;
  return new Headers(init?.headers);
}

beforeEach(() => {
  sessionStorage.clear();
  underlying = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', underlying);
  uninstall = installApiFetchInterceptor();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.unstubAllGlobals();
});

describe('installApiFetchInterceptor', () => {
  it('adds X-Store-Id to same-origin /api/ calls once a store is chosen', async () => {
    setActiveStoreId(42);

    await fetch('/api/inventory', { credentials: 'include' });

    expect(sentHeaders().get('X-Store-Id')).toBe('42');
    // The caller's own options are kept.
    expect(underlying.mock.calls[0][1].credentials).toBe('include');
  });

  it('keeps headers the caller already set', async () => {
    setActiveStoreId(42);

    await fetch('/api/session/abc/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scan-Otp': 'ABCD2345' },
    });

    const headers = sentHeaders();
    expect(headers.get('X-Store-Id')).toBe('42');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Scan-Otp')).toBe('ABCD2345');
  });

  it('works for an absolute same-origin URL and for a Request object', async () => {
    setActiveStoreId(7);

    await fetch(`${window.location.origin}/api/categories`);
    expect(sentHeaders().get('X-Store-Id')).toBe('7');

    await fetch(new Request(`${window.location.origin}/api/logs`, { headers: { A: 'b' } }));
    const headers = sentHeaders();
    expect(headers.get('X-Store-Id')).toBe('7');
    expect(headers.get('A')).toBe('b');
  });

  it('does not override a store the caller named explicitly', async () => {
    setActiveStoreId(42);

    await fetch('/api/auth/switch-store', { headers: { 'X-Store-Id': '9' } });

    expect(sentHeaders().get('X-Store-Id')).toBe('9');
  });

  it('never sends the store id to another origin or to non-API paths', async () => {
    setActiveStoreId(42);

    await fetch('https://world.openfoodfacts.org/api/v2/product/123.json');
    expect(sentHeaders().has('X-Store-Id')).toBe(false);

    await fetch('/uploads/logo.png');
    expect(sentHeaders().has('X-Store-Id')).toBe(false);
  });

  it('leaves requests untouched until a store is chosen', async () => {
    await fetch('/api/inventory', { method: 'GET' });

    expect(underlying.mock.calls[0][1]).toEqual({ method: 'GET' });
    expect(sentHeaders().has('X-Store-Id')).toBe(false);
  });

  it('is installed once however often it is called, and uninstalls cleanly', async () => {
    const again = installApiFetchInterceptor();
    expect(again).toBe(uninstall);

    setActiveStoreId(1);
    await fetch('/api/x');
    // Wrapped once: the real fetch saw exactly one call.
    expect(underlying).toHaveBeenCalledTimes(1);

    uninstall!();
    uninstall = null;
    await fetch('/api/x');
    expect(underlying).toHaveBeenCalledTimes(2);
    expect(sentHeaders().has('X-Store-Id')).toBe(false);
  });
});

describe('active store helpers', () => {
  it('stores, reads and clears the active store id', () => {
    expect(getActiveStoreId()).toBeNull();
    setActiveStoreId(12);
    expect(getActiveStoreId()).toBe(12);
    clearActiveStoreId();
    expect(getActiveStoreId()).toBeNull();
  });

  it('treats a garbled stored value as no store', () => {
    sessionStorage.setItem('active_store_id', 'abc');
    expect(getActiveStoreId()).toBeNull();
  });

  it('forgets the scan session when the store changes, but nothing else', () => {
    sessionStorage.setItem('scan_session_id', 's');
    sessionStorage.setItem('scan_otp', 'o');
    sessionStorage.setItem('scan_store_id', '1');
    sessionStorage.setItem('scan_input_mode', 'hardware');
    setActiveStoreId(3);

    clearStoreScopedSessionState();

    expect(sessionStorage.getItem('scan_session_id')).toBeNull();
    expect(sessionStorage.getItem('scan_otp')).toBeNull();
    expect(sessionStorage.getItem('scan_store_id')).toBeNull();
    expect(sessionStorage.getItem('scan_input_mode')).toBe('hardware');
    expect(getActiveStoreId()).toBe(3);
  });
});
