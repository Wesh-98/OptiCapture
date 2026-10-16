// @vitest-environment jsdom
/**
 * tests/store-switcher-and-search.test.tsx — the store switcher and the dashboard item search
 *
 * Store switcher: a user with access to an active and a suspended store clicked the suspended
 * one in the top bar and nothing happened. The server refuses it on purpose, but the menu
 * offered it like any other and swallowed the refusal. Suspended stores are now greyed out,
 * and a refused switch says why. The Choose Store page shows the server's reason too.
 *
 * Item search: the dashboard's search box only filtered the page already loaded, by name.
 * It now asks the server (the same tag-aware search the Super Admin uses), and only the answer
 * to the latest search may fill the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PropsWithChildren } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastContext, type AddToast } from '../src/hooks/useToast';

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('../src/context/AuthContext', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/context/AuthContext')>()),
  useAuth: () => auth.value,
}));

const { default: Layout } = await import('../src/components/Layout');
const { default: StorePicker } = await import('../src/pages/StorePicker');
const { AuthProvider } = await import('../src/context/AuthContext');
const { useItemManagement } = await import('../src/hooks/useItemManagement');

const user = {
  id: 5,
  username: 'adminComrade',
  role: 'owner',
  store_id: 1,
  store_name: 'Jawad Inc',
  store_logo: null,
  must_reset_password: false,
  needs_store_selection: false,
};
const stores = [
  { id: 1, name: 'Jawad Inc', logo: null, status: 'active', role: 'owner' },
  { id: 2, name: 'Comrade Stores', logo: null, status: 'suspended', role: 'owner' },
  { id: 3, name: 'Corner Shop', logo: null, status: 'active', role: 'taker' },
];

let addToast: Mock<AddToast>;
let switchStore: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;

function renderLayout() {
  return render(
    <ToastContext.Provider value={addToast}>
      <MemoryRouter>
        <Layout>
          <p>page</p>
        </Layout>
      </MemoryRouter>
    </ToastContext.Provider>
  );
}

beforeEach(() => {
  addToast = vi.fn<AddToast>();
  switchStore = vi.fn(async () => {});
  reload = vi.fn();
  auth.value = {
    user,
    myStores: stores,
    activeStoreId: 1,
    switchStore,
    logout: vi.fn(),
    leaveCurrentStore: vi.fn(),
  };
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { ...globalThis.location, reload },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Top-bar store switcher ───────────────────────────────────────────────────

describe('top-bar store switcher', () => {
  const openDesktopMenu = () =>
    fireEvent.click(screen.getAllByText('Jawad Inc')[0].closest('button')!);
  // A store's row in the open desktop dropdown (the one under "Your Stores").
  const storeButton = (name: string) => {
    const menu = screen.getByText('Your Stores').parentElement!;
    return [...menu.querySelectorAll('button')].find(button => button.textContent?.includes(name))!;
  };

  it('greys out a suspended store and says it is suspended', () => {
    renderLayout();
    openDesktopMenu();

    const suspended = storeButton('Comrade Stores');
    expect(suspended?.disabled).toBe(true);
    expect(suspended.title).toBe('This store is suspended');
    expect(suspended.textContent).toContain('owner · suspended');

    expect(storeButton('Corner Shop')?.disabled).toBe(false);
    expect(storeButton('Corner Shop').textContent).not.toContain('suspended');
  });

  it('does not try to switch into a suspended store', () => {
    renderLayout();
    openDesktopMenu();
    fireEvent.click(storeButton('Comrade Stores'));
    expect(switchStore).not.toHaveBeenCalled();
  });

  it('switches into an active store and reloads', async () => {
    renderLayout();
    openDesktopMenu();
    fireEvent.click(storeButton('Corner Shop'));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(switchStore).toHaveBeenCalledWith(3);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a switch is refused, and stays put", async () => {
    // Suspended after this page loaded: the menu still thinks it is active.
    switchStore.mockRejectedValue(new Error('Store is suspended'));
    renderLayout();
    openDesktopMenu();
    fireEvent.click(storeButton('Corner Shop'));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('error', 'Store is suspended'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('greys out a suspended store in the mobile menu too', () => {
    const { container } = renderLayout();
    fireEvent.click(
      container.querySelector('header button.md\\:hidden, header .md\\:hidden button')!
    );

    const mobile = screen.getByText('Switch Store').parentElement!;
    const suspended = [...mobile.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Comrade Stores')
    )!;
    expect(suspended?.disabled).toBe(true);
    expect(suspended.textContent).toContain('suspended');
  });

  it('never greys out the store already open, whatever its status', () => {
    auth.value = {
      ...auth.value,
      activeStoreId: 2,
      user: { ...user, store_id: 2, store_name: 'Comrade Stores' },
    };
    renderLayout();
    fireEvent.click(screen.getAllByText('Comrade Stores')[0].closest('button')!);
    expect(storeButton('Comrade Stores')?.disabled).toBe(false);
  });
});

// ── switchStore and the Choose Store page ────────────────────────────────────

describe('switchStore', () => {
  it("throws the server's reason, or a plain fallback", async () => {
    vi.doUnmock('../src/context/AuthContext');
    let reply = () => Response.json({ error: 'Store is suspended' }, { status: 403 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return Response.json(user);
        if (url === '/api/auth/my-stores') return Response.json(stores);
        return reply();
      })
    );
    const { useAuth: realUseAuth } = await vi.importActual<
      typeof import('../src/context/AuthContext')
    >('../src/context/AuthContext');
    const wrapper = ({ children }: PropsWithChildren) => (
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    );
    const { result } = renderHook(() => realUseAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await expect(result.current.switchStore(2)).rejects.toThrow('Store is suspended');

    reply = () => new Response('', { status: 500 });
    await expect(result.current.switchStore(2)).rejects.toThrow(
      'Could not open that store. Please try again.'
    );
  });

  it('shows the reason on the Choose Store page', async () => {
    switchStore.mockRejectedValue(new Error('No access to that store'));
    render(
      <MemoryRouter>
        <StorePicker />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('Corner Shop').closest('button')!);
    await waitFor(() => expect(screen.getByText('No access to that store')).toBeTruthy());
    // The suspended store is greyed out there already.
    expect(screen.getByText('Comrade Stores').closest('button')?.disabled).toBe(true);
  });
});

// ── Item search in the dashboard hook ────────────────────────────────────────

describe('useItemManagement — searching items', () => {
  const response = (items: Array<{ id: number; item_name: string }>) =>
    Response.json({ items, total: items.length });

  it('sends the search to the server, with the category and status', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return response([{ id: 1, item_name: 'Cola' }]);
      })
    );
    const { result } = renderHook(() =>
      useItemManagement('items', 5, 'Active', vi.fn(), vi.fn(), 'cola')
    );

    await act(() => result.current.fetchItems(5));
    expect(urls[0]).toBe('/api/inventory?page=1&limit=50&category_id=5&status=Active&q=cola');

    // From the categories view, the search is store-wide.
    await act(() => result.current.fetchItems(null));
    expect(urls[1]).toBe('/api/inventory?page=1&limit=50&status=Active&q=cola');
  });

  it('shows only the answer to the latest search, whatever order answers arrive in', async () => {
    const pending: Array<(r: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(resolve => pending.push(resolve)))
    );
    const { result } = renderHook(() =>
      useItemManagement('categories', null, '', vi.fn(), vi.fn(), 'co')
    );

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.fetchItems(null, 1, 50, '', 'co');
      newer = result.current.fetchItems(null, 1, 50, '', 'cola');
    });
    await act(async () => {
      pending[1](response([{ id: 2, item_name: 'Cola' }]));
      await newer;
      pending[0](
        response([
          { id: 1, item_name: 'Cocoa' },
          { id: 2, item_name: 'Cola' },
        ])
      );
      await older;
    });

    expect(result.current.items.map(i => i.item_name)).toEqual(['Cola']);
    expect(result.current.totalItems).toBe(1);
  });

  it('drops an answer whose body was still being read when a newer search started', async () => {
    let finishOlderBody!: (body: unknown) => void;
    const olderBody = new Promise(resolve => {
      finishOlderBody = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => olderBody })
      .mockResolvedValueOnce(response([{ id: 2, item_name: 'Cola' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useItemManagement('categories', null, '', vi.fn(), vi.fn())
    );

    let older!: Promise<void>;
    await act(async () => {
      older = result.current.fetchItems(null, 1, 50, '', 'co');
      await Promise.resolve();
      await Promise.resolve();
    });
    // The older answer has arrived and is being read; now the user types more.
    await act(() => result.current.fetchItems(null, 1, 50, '', 'cola'));
    await act(async () => {
      finishOlderBody({ items: [{ id: 1, item_name: 'Cocoa' }], total: 1 });
      await older;
    });

    expect(result.current.items.map(i => i.item_name)).toEqual(['Cola']);
  });

  it('refreshes the search results after an item is saved from them', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(`${init?.method ?? 'GET'} ${url}`);
        return init?.method === 'PUT' ? Response.json({ success: true }) : response([]);
      })
    );
    const { result } = renderHook(() =>
      useItemManagement('categories', null, '', vi.fn(), vi.fn(), 'cola')
    );
    act(() => result.current.openEditModal({ id: 1, item_name: 'Cola', category_id: 5 } as never));

    await act(() => result.current.handleEditItem({ preventDefault: () => {} }));

    expect(urls).toEqual(['PUT /api/inventory/1', 'GET /api/inventory?page=1&limit=50&q=cola']);
  });

  it('does not refresh a list that is not shown', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return Response.json({ success: true });
      })
    );
    const { result } = renderHook(() =>
      useItemManagement('categories', null, '', vi.fn(), vi.fn())
    );
    act(() => result.current.openEditModal({ id: 1, item_name: 'Cola' } as never));
    await act(() => result.current.handleEditItem({ preventDefault: () => {} }));
    expect(urls).toEqual(['/api/inventory/1']);
  });
});
