const ACTIVE_STORE_STORAGE_KEY = 'active_store_id';
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function isSameOriginApiRequest(url: URL): boolean {
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
}

function buildPatchedRequest(
  input: FetchInput | URL,
  init?: FetchInit
): { input: FetchInput | URL; init?: FetchInit } {
  if (!isBrowser()) {
    return { input, init };
  }

  const activeStoreId = sessionStorage.getItem(ACTIVE_STORE_STORAGE_KEY);
  if (!activeStoreId) {
    return { input, init };
  }

  const rawUrl =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);

  let url: URL;
  try {
    url = new URL(rawUrl, window.location.origin);
  } catch {
    return { input, init };
  }

  if (!isSameOriginApiRequest(url)) {
    return { input, init };
  }

  // Keep the store-context change lean by injecting the active store header
  // centrally instead of rewriting every existing fetch call in the app.
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (headers.has('X-Store-Id')) {
    return { input, init };
  }

  headers.set('X-Store-Id', activeStoreId);

  if (input instanceof Request) {
    return {
      input: new Request(input, {
        ...init,
        headers,
      }),
      init: undefined,
    };
  }

  return {
    input,
    init: {
      ...init,
      headers,
    },
  };
}

let uninstallInterceptor: (() => void) | null = null;

/**
 * Wraps globalThis.fetch so same-origin /api/ calls carry the tab's active store.
 *
 * Must run before the React tree mounts: React fires child effects before parent
 * effects, so installing this from a provider's useEffect leaves any component
 * that fetches on first mount without the X-Store-Id header — which a multi-store
 * user sees as a spurious 409 "Store selection required". main.tsx calls it at
 * module scope instead.
 *
 * Idempotent — repeated calls return the existing uninstaller rather than
 * double-wrapping fetch.
 */
export function installApiFetchInterceptor(): () => void {
  if (uninstallInterceptor) return uninstallInterceptor;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = ((input: FetchInput | URL, init?: FetchInit) => {
    const patched = buildPatchedRequest(input, init);
    return originalFetch(patched.input as FetchInput | URL, patched.init);
  }) as typeof globalThis.fetch;

  uninstallInterceptor = () => {
    globalThis.fetch = originalFetch;
    uninstallInterceptor = null;
  };
  return uninstallInterceptor;
}

export function getActiveStoreId(): number | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = sessionStorage.getItem(ACTIVE_STORE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const storeId = Number.parseInt(raw, 10);
  return Number.isNaN(storeId) ? null : storeId;
}

export function setActiveStoreId(storeId: number): void {
  if (!isBrowser()) {
    return;
  }

  sessionStorage.setItem(ACTIVE_STORE_STORAGE_KEY, String(storeId));
}

export function clearActiveStoreId(): void {
  if (!isBrowser()) {
    return;
  }

  sessionStorage.removeItem(ACTIVE_STORE_STORAGE_KEY);
}

export function clearStoreScopedSessionState(): void {
  if (!isBrowser()) {
    return;
  }

  sessionStorage.removeItem('scan_session_id');
  sessionStorage.removeItem('scan_otp');
  sessionStorage.removeItem('scan_store_id');
}
