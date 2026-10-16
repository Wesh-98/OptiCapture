// @vitest-environment jsdom
/**
 * tests/admin-hooks.test.tsx — the Super Admin's store, staff and inventory hooks
 *
 * The Super Admin oversees every store: the store list (search, filter, suspend, edit, delete),
 * each store's staff (add, remove, reset a password) and a read-only view of each store's
 * inventory. The admin routes are covered in tests/admin-*.test.ts; these hooks were not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastContext } from '../src/hooks/useToast';
import { useAdminStores } from '../src/hooks/useAdminStores';
import { useAdminStoreList } from '../src/hooks/useAdminStoreList';
import { useStoreUsers } from '../src/hooks/useStoreUsers';
import { useAdminStoreInventory } from '../src/hooks/useAdminStoreInventory';
import type { StoreRow } from '../src/components/superadmin/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; method: string; body: any };

function stubFetch(route: (url: string, method: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return route(url, method);
    })
  );
  return calls;
}

function store(id: number, overrides: Partial<StoreRow> = {}): StoreRow {
  return {
    id,
    name: `Store ${id}`,
    address: '',
    email: `s${id}@shop.com`,
    phone: '',
    status: 'active',
    created_at: `2026-0${id}-01 10:00:00`,
    user_count: 1,
    item_count: 0,
    category_count: 0,
    items_added_week: 0,
    last_item_added_at: null,
    missing_upc_count: 0,
    ...overrides,
  };
}

/** Router + toast provider; `location()` reports where the hook navigated. */
function setup(entry = '/admin') {
  const addToast = vi.fn();
  let location = '';
  const Probe = ({ children }: PropsWithChildren) => {
    const loc = useLocation();
    location = loc.pathname + loc.search;
    return <>{children}</>;
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <ToastContext.Provider value={addToast}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="*" element={<Probe>{children}</Probe>} />
        </Routes>
      </MemoryRouter>
    </ToastContext.Provider>
  );
  return { wrapper, addToast, location: () => location };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── useAdminStores ───────────────────────────────────────────────────────────

describe('useAdminStores', () => {
  const stores = [
    store(1, { name: 'Corner Shop', email: 'corner@shop.com' }),
    store(2, { name: 'Gas & Go', status: 'suspended', email: 'gas@go.com' }),
    store(3, { name: 'Market', email: '' }),
  ];

  async function mount(
    route: (url: string, method: string) => Response = () => jsonResponse(stores)
  ) {
    const calls = stubFetch(route);
    const ctx = setup();
    const hook = renderHook(() => useAdminStores(), { wrapper: ctx.wrapper });
    await act(() => hook.result.current.fetchStores());
    return { ...hook, ...ctx, calls };
  }

  it('loads the stores newest first, and can sort oldest first', async () => {
    const { result } = await mount();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.filteredStores.map(s => s.id)).toEqual([3, 2, 1]);

    act(() => result.current.setJoinedSort('oldest'));
    expect(result.current.filteredStores.map(s => s.id)).toEqual([1, 2, 3]);
  });

  it('searches by name or email, and filters by status', async () => {
    const { result } = await mount();

    act(() => result.current.setStoreSearch('  CORNER '));
    expect(result.current.filteredStores.map(s => s.name)).toEqual(['Corner Shop']);
    act(() => result.current.setStoreSearch('go.com'));
    expect(result.current.filteredStores.map(s => s.name)).toEqual(['Gas & Go']);

    act(() => {
      result.current.setStoreSearch('');
      result.current.setStatusFilter('suspended');
    });
    expect(result.current.filteredStores.map(s => s.id)).toEqual([2]);
  });

  it('sends a signed-out admin back to login', async () => {
    const { location } = await mount(() => jsonResponse({}, 401));
    expect(location()).toBe('/login');
  });

  it('reports a store list that could not be loaded', async () => {
    const failed = await mount(() => jsonResponse({ error: 'Database busy' }, 500));
    expect(failed.result.current.actionError).toBe('Database busy');
    expect(failed.result.current.isLoading).toBe(false);
    cleanup();

    const offline = await mount(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(offline.result.current.actionError).toBe('Failed to load stores');
  });

  it('suspends an active store and reactivates a suspended one', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'PUT' ? jsonResponse({ success: true }) : jsonResponse(stores)
    );

    await act(() => result.current.toggleStatus(stores[0]));
    expect(calls.at(-1)).toMatchObject({
      url: '/api/admin/stores/1/status',
      method: 'PUT',
      body: { status: 'suspended' },
    });
    expect(result.current.stores.find(s => s.id === 1)?.status).toBe('suspended');
    expect(addToast).toHaveBeenCalledWith('success', 'Suspended "Corner Shop"');

    await act(() => result.current.toggleStatus(stores[1]));
    expect(calls.at(-1)?.body).toEqual({ status: 'active' });
    expect(addToast).toHaveBeenLastCalledWith('success', 'Reactivated "Gas & Go"');
    expect(result.current.togglingId).toBeNull();
  });

  it('reports a status change that was refused or never sent', async () => {
    let mode: 'refuse' | 'offline' = 'refuse';
    const { result } = await mount((_url, method) => {
      if (method !== 'PUT') return jsonResponse(stores);
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      return jsonResponse({ error: 'Cannot suspend the HQ store' }, 403);
    });

    await act(() => result.current.toggleStatus(stores[0]));
    expect(result.current.actionError).toBe('Cannot suspend the HQ store');
    expect(result.current.stores[0].status).toBe('active');

    mode = 'offline';
    act(() => result.current.setActionError(''));
    await act(() => result.current.toggleStatus(stores[0]));
    expect(result.current.actionError).toBe('Failed to update store status');
    expect(result.current.togglingId).toBeNull();
  });

  it('validates a store edit before saving', async () => {
    const { result, calls } = await mount();
    act(() => result.current.openEdit(stores[0]));
    act(() =>
      result.current.setEditStore({
        ...result.current.editStore!,
        name: ' ',
        street: 's'.repeat(201),
        email: 'bad',
        phone: '12',
        city: 'c'.repeat(101),
        zipcode: '1',
      })
    );

    await act(() => result.current.handleEditSave());

    expect(Object.keys(result.current.editErrors).sort()).toEqual([
      'city',
      'email',
      'name',
      'phone',
      'street',
      'zipcode',
    ]);
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });

  it('saves a store edit and updates the row', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'PUT'
        ? jsonResponse({ name: 'Corner Shop II', city: 'Springfield' })
        : jsonResponse(stores)
    );
    act(() => result.current.openEdit(stores[0]));
    act(() =>
      result.current.setEditStore({ ...result.current.editStore!, name: ' Corner Shop II ' })
    );

    await act(() => result.current.handleEditSave());

    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/stores/1', method: 'PUT' });
    expect(calls.at(-1)?.body.name).toBe(' Corner Shop II ');
    expect(result.current.stores.find(s => s.id === 1)).toMatchObject({
      name: 'Corner Shop II',
      city: 'Springfield',
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Saved "Corner Shop II"');
    expect(result.current.editStore).toBeNull();
  });

  it('keeps the edit open with the reason when a save fails', async () => {
    let reply = (): Response => jsonResponse({ error: 'Invalid email address' }, 400);
    const { result } = await mount((_url, method) =>
      method === 'PUT' ? reply() : jsonResponse(stores)
    );
    act(() => result.current.openEdit(stores[0]));

    await act(() => result.current.handleEditSave());
    expect(result.current.editError).toBe('Invalid email address');
    expect(result.current.editStore).not.toBeNull();

    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    await act(() => result.current.handleEditSave());
    expect(result.current.editError).toBe('Failed to save changes');
    expect(result.current.editSaving).toBe(false);
  });

  it('checks a new logo for size and format before reading it', async () => {
    const { result } = await mount();
    act(() => result.current.openEdit(stores[0]));
    const pick = (file: File) => {
      const target = { files: [file], value: 'x' };
      act(() =>
        result.current.handleFileUpload({ target } as unknown as ChangeEvent<HTMLInputElement>)
      );
      return target;
    };

    const huge = pick(
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    );
    expect(result.current.editError).toBe('Logo must be under 2 MB');
    expect(huge.value).toBe('');

    pick(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(result.current.editError).toBe('Unsupported image format. Use JPG, PNG, GIF, or WEBP.');

    pick(new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(result.current.editStore?.logo).toMatch(/^data:image\/png;base64,/));

    act(() => result.current.removeLogo());
    expect(result.current.editStore?.logo).toBeNull();
  });

  it('deletes a store only when its name is typed exactly', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'DELETE' ? jsonResponse({ success: true }) : jsonResponse(stores)
    );
    act(() => result.current.openDeleteConfirm(stores[0]));
    act(() => result.current.setDeleteConfirmName('corner shop'));
    await act(() => result.current.handleDeleteStore());
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);

    act(() => result.current.setDeleteConfirmName('Corner Shop'));
    await act(() => result.current.handleDeleteStore());
    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/stores/1', method: 'DELETE' });
    expect(result.current.stores.map(s => s.id)).toEqual([2, 3]);
    expect(addToast).toHaveBeenCalledWith('success', 'Deleted "Corner Shop"');
    expect(result.current.deleteStore).toBeNull();
  });

  it('reports a delete that was refused or never sent', async () => {
    let offline = false;
    const { result } = await mount((_url, method) => {
      if (method !== 'DELETE') return jsonResponse(stores);
      if (offline) throw new TypeError('Failed to fetch');
      return jsonResponse({ error: 'Cannot delete the HQ store' }, 403);
    });

    act(() => result.current.openDeleteConfirm(stores[0]));
    act(() => result.current.setDeleteConfirmName('Corner Shop'));
    await act(() => result.current.handleDeleteStore());
    expect(result.current.actionError).toBe('Cannot delete the HQ store');
    expect(result.current.stores).toHaveLength(3);

    offline = true;
    act(() => result.current.openDeleteConfirm(stores[0]));
    act(() => result.current.setDeleteConfirmName('Corner Shop'));
    await act(() => result.current.handleDeleteStore());
    expect(result.current.actionError).toBe('Failed to delete store');
    expect(result.current.deleting).toBe(false);
  });

  it('logs out and returns to login', async () => {
    const { result, calls, location } = await mount();
    await act(() => result.current.handleLogout());
    expect(calls.some(c => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(true);
    expect(location()).toBe('/login');
  });
});

describe('useAdminStoreList', () => {
  it('is null while loading, then the stores', async () => {
    stubFetch(() => jsonResponse([store(1)]));
    const { result } = renderHook(() => useAdminStoreList());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it('is an empty list when loading fails', async () => {
    stubFetch(() => jsonResponse({}, 500));
    const refused = renderHook(() => useAdminStoreList());
    await waitFor(() => expect(refused.result.current).toEqual([]));

    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const offline = renderHook(() => useAdminStoreList());
    await waitFor(() => expect(offline.result.current).toEqual([]));
  });
});

// ── useStoreUsers ────────────────────────────────────────────────────────────

describe('useStoreUsers', () => {
  const shop = store(4, { name: 'Corner Shop' });
  const staff = [
    { id: 10, username: 'owner', role: 'owner' },
    { id: 11, username: 'clerk', role: 'taker' },
  ];

  async function mount(
    route: (url: string, method: string) => Response = () => jsonResponse(staff)
  ) {
    const calls = stubFetch(route);
    const ctx = setup();
    const hook = renderHook(() => useStoreUsers(), { wrapper: ctx.wrapper });
    await act(() => hook.result.current.openUsers(shop));
    return { ...hook, ...ctx, calls };
  }

  it("opens a store's staff list", async () => {
    const { result, calls } = await mount();
    expect(calls[0].url).toBe('/api/admin/stores/4/users');
    expect(result.current.usersStore?.id).toBe(4);
    expect(result.current.storeUsers.map(u => u.username)).toEqual(['owner', 'clerk']);
    expect(result.current.usersLoading).toBe(false);

    act(() => result.current.closeUsers());
    expect(result.current.usersStore).toBeNull();
  });

  it('shows why the staff list could not load', async () => {
    const refused = await mount(() => jsonResponse({ error: 'Store not found' }, 404));
    expect(refused.result.current.usersError).toBe('Store not found');
    cleanup();
    const blank = await mount(() => new Response('', { status: 500 }));
    expect(blank.result.current.usersError).toBe('Failed to load store users');
  });

  it('treats a non-list answer as no staff', async () => {
    const { result } = await mount(() => jsonResponse({ users: [] }));
    expect(result.current.storeUsers).toEqual([]);
  });

  it('creates a user with a temporary password to hand over', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'POST'
        ? jsonResponse({ username: 'newclerk', tempPassword: 'Temp-1234' }, 201)
        : jsonResponse(staff)
    );
    act(() => {
      result.current.setNewUsername('  newclerk ');
      result.current.setNewEmail(' clerk@shop.com ');
      result.current.setNewRole('taker');
    });

    await act(() => result.current.addUser());

    expect(calls.find(c => c.method === 'POST')).toMatchObject({
      url: '/api/admin/stores/4/users',
      body: { mode: 'create', username: 'newclerk', email: 'clerk@shop.com', role: 'taker' },
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Created "newclerk" as taker');
    expect(result.current.resetResult).toEqual({ username: 'newclerk', tempPassword: 'Temp-1234' });
    expect(result.current.newUsername).toBe('');
    expect(result.current.addingUser).toBe(false);
  });

  it('gives an existing user access without sending an email', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'POST' ? jsonResponse({ success: true }) : jsonResponse(staff)
    );
    act(() => result.current.setNewEmail('ignored@shop.com'));
    act(() => result.current.handleUserActionModeChange('existing'));
    expect(result.current.newEmail).toBe('');
    act(() => result.current.setNewUsername('roamer'));

    await act(() => result.current.addUser());

    const post = calls.find(c => c.method === 'POST')!;
    expect(post.body).toEqual({ mode: 'existing', username: 'roamer', role: 'owner' });
    expect(addToast).toHaveBeenCalledWith('success', 'Gave "roamer" owner access');
    expect(result.current.resetResult).toBeNull();
  });

  it('checks the username and email before adding', async () => {
    const { result, calls } = await mount();
    await act(() => result.current.addUser());
    act(() => {
      result.current.setNewUsername('clerk2');
      result.current.setNewEmail('not-an-email');
    });
    await act(() => result.current.addUser());

    expect(result.current.addError).toBe('Enter a valid email address');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });

  it('shows why an add was refused', async () => {
    let reply = (): Response => jsonResponse({ error: 'Username already taken' }, 409);
    const { result } = await mount((_url, method) =>
      method === 'POST' ? reply() : jsonResponse(staff)
    );
    act(() => result.current.setNewUsername('owner'));

    await act(() => result.current.addUser());
    expect(result.current.addError).toBe('Username already taken');

    reply = () => new Response('', { status: 500 });
    await act(() => result.current.addUser());
    expect(result.current.addError).toBe('Failed to add user');

    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    await act(() => result.current.addUser());
    expect(result.current.addError).toBe('Failed to add user');
  });

  it('does not call an add that succeeded a failure when only the list reload fails', async () => {
    let added = false;
    const { result, addToast } = await mount((_url, method) => {
      if (method === 'POST') {
        added = true;
        return jsonResponse({ success: true }, 201);
      }
      return added ? jsonResponse({ error: 'Database busy' }, 500) : jsonResponse(staff);
    });
    act(() => result.current.setNewUsername('clerk2'));

    await act(() => result.current.addUser());

    expect(result.current.addError).toBe('');
    expect(result.current.usersError).toBe('Database busy');
    expect(addToast).toHaveBeenCalledWith('success', 'Created "clerk2" as owner');
  });

  it('removes a user from the store', async () => {
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'DELETE' ? jsonResponse({ success: true }) : jsonResponse(staff)
    );
    act(() => result.current.setConfirmDeleteUserId(11));

    await act(() => result.current.removeUser(11));

    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/stores/4/users/11', method: 'DELETE' });
    expect(result.current.storeUsers.map(u => u.id)).toEqual([10]);
    expect(addToast).toHaveBeenCalledWith('success', 'Removed "clerk" from Corner Shop');
    expect(result.current.confirmDeleteUserId).toBeNull();
  });

  it('reports a removal that was refused or never sent', async () => {
    let offline = false;
    const { result } = await mount((_url, method) => {
      if (method !== 'DELETE') return jsonResponse(staff);
      if (offline) throw new TypeError('Failed to fetch');
      return jsonResponse({ error: 'Cannot remove the last owner' }, 409);
    });

    await act(() => result.current.removeUser(10));
    expect(result.current.usersError).toBe('Cannot remove the last owner');
    expect(result.current.storeUsers).toHaveLength(2);

    offline = true;
    await act(() => result.current.removeUser(10));
    expect(result.current.usersError).toBe('Failed to remove user');
    expect(result.current.storeUsers).toHaveLength(2);
  });

  it("resets a user's password and shows the temporary one", async () => {
    let reply = (): Response => jsonResponse({ username: 'clerk', tempPassword: 'Temp-9999' });
    const { result, calls, addToast } = await mount((_url, method) =>
      method === 'POST' ? reply() : jsonResponse(staff)
    );

    await act(() => result.current.handleResetPassword(11));
    expect(calls.at(-1)).toMatchObject({
      url: '/api/admin/users/11/reset-password',
      method: 'POST',
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Reset the password for "clerk"');
    expect(result.current.resetResult).toEqual({ username: 'clerk', tempPassword: 'Temp-9999' });
    expect(result.current.resettingUserId).toBeNull();

    reply = () => jsonResponse({ error: 'User not found' }, 404);
    await act(() => result.current.handleResetPassword(99));
    expect(result.current.usersError).toBe('User not found');

    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    await act(() => result.current.handleResetPassword(11));
    expect(result.current.usersError).toBe('Failed to reset password');
  });

  it('does nothing without an open store', async () => {
    const calls = stubFetch(() => jsonResponse([]));
    const { result } = renderHook(() => useStoreUsers(), { wrapper: setup().wrapper });
    act(() => result.current.setNewUsername('x'));
    await act(() => result.current.addUser());
    await act(() => result.current.removeUser(1));
    expect(calls).toHaveLength(0);
  });
});

// ── useAdminStoreInventory ───────────────────────────────────────────────────

describe('useAdminStoreInventory', () => {
  const viewed = { id: 4, name: 'Corner Shop', status: 'active', item_count: 120 };
  const categories = [
    { id: 7, name: 'Drinks', status: 'Active', icon: 'Cup', item_count: 3, total_stock: 9 },
  ];

  function inventoryApi(
    overrides: { store?: () => Response; inventory?: (url: URL) => Response } = {}
  ) {
    const inventory: URL[] = [];
    const calls = stubFetch(url => {
      if (url.endsWith('/categories')) return jsonResponse(categories);
      if (url.includes('/inventory')) {
        const parsed = new URL(url, 'http://x');
        inventory.push(parsed);
        return (
          overrides.inventory?.(parsed) ??
          jsonResponse({ items: [{ id: 1, item_name: 'Cola' }], total: 120 })
        );
      }
      if (url === '/api/auth/logout') return jsonResponse({});
      return overrides.store?.() ?? jsonResponse(viewed);
    });
    return { calls, inventory };
  }

  function mount(entry = '/admin/stores/4', storeId: string | null = '4') {
    const ctx = setup(entry);
    const hook = renderHook(() => useAdminStoreInventory(storeId ?? undefined), {
      wrapper: ctx.wrapper,
    });
    return { ...hook, ...ctx };
  }

  it('loads the store header, its categories and the first page of its items', async () => {
    const { inventory } = inventoryApi();
    const { result } = mount();

    await waitFor(() => expect(result.current.itemsLoading).toBe(false));
    await waitFor(() => expect(result.current.store?.name).toBe('Corner Shop'));
    expect(result.current.categories.map(c => c.name)).toEqual(['Drinks']);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(120);
    expect(Object.fromEntries(inventory[0].searchParams)).toEqual({
      page: '1',
      limit: '50',
      sort: 'recent',
    });
  });

  it('asks for nothing without a store id', async () => {
    const { calls } = inventoryApi();
    mount('/admin', null);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(0);
  });

  it('keeps the chosen category in the URL and filters by it', async () => {
    const { inventory } = inventoryApi();
    const { result, location } = mount('/admin/stores/4?category=7');
    await waitFor(() => expect(result.current.itemsLoading).toBe(false));
    expect(result.current.categoryId).toBe(7);
    expect(inventory.at(-1)!.searchParams.get('category_id')).toBe('7');

    act(() => result.current.setCategoryId(null));
    await waitFor(() => expect(location()).toBe('/admin/stores/4'));
    await waitFor(() => expect(inventory.at(-1)!.searchParams.has('category_id')).toBe(false));
  });

  it('ignores a category in the URL that is not a positive whole number', async () => {
    inventoryApi();
    const { result } = mount('/admin/stores/4?category=-3');
    await waitFor(() => expect(result.current.itemsLoading).toBe(false));
    expect(result.current.categoryId).toBeNull();
  });

  it('applies status, sort and page size, each going back to page 1', async () => {
    const { inventory } = inventoryApi();
    const { result } = mount();
    await waitFor(() => expect(result.current.itemsLoading).toBe(false));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(inventory.at(-1)!.searchParams.get('page')).toBe('3'));

    act(() => result.current.setStatusFilter('Inactive'));
    await waitFor(() => expect(inventory.at(-1)!.searchParams.get('status')).toBe('Inactive'));
    expect(inventory.at(-1)!.searchParams.get('page')).toBe('1');

    act(() => result.current.setSort('name_desc'));
    act(() => result.current.setPageSize(200));
    await waitFor(() => expect(inventory.at(-1)!.searchParams.get('limit')).toBe('200'));
    expect(inventory.at(-1)!.searchParams.get('sort')).toBe('name_desc');
    expect(result.current.page).toBe(1);
  });

  it('searches after typing pauses', async () => {
    const { inventory } = inventoryApi();
    const { result } = mount();
    await waitFor(() => expect(result.current.itemsLoading).toBe(false));
    const before = inventory.length;

    act(() => result.current.setSearch('  cola '));
    expect(inventory).toHaveLength(before);
    await waitFor(() => expect(inventory.at(-1)!.searchParams.get('q')).toBe('cola'));
  });

  it("shows the server's reason when the store cannot be viewed", async () => {
    inventoryApi({
      store: () => jsonResponse({ error: 'The HQ store has no inventory view' }, 403),
    });
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.loadError).toBe('The HQ store has no inventory view')
    );
  });

  it('clears the items and explains a failed item load', async () => {
    inventoryApi({ inventory: () => jsonResponse({}, 500) });
    const { result } = mount();
    await waitFor(() => expect(result.current.itemsError).toBe('Failed to load items'));
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('sends a signed-out admin to login', async () => {
    inventoryApi({ inventory: () => jsonResponse({}, 401) });
    const { location } = mount();
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('reloads everything in place after an edit', async () => {
    const { calls } = inventoryApi();
    const { result } = mount();
    await waitFor(() => expect(result.current.store).not.toBeNull());
    const before = calls.length;

    act(() => result.current.refresh());
    await waitFor(() => expect(calls.length).toBe(before + 3));
    // A refresh does not blank the header while it reloads.
    expect(result.current.store).not.toBeNull();
  });

  it('logs out', async () => {
    const { calls } = inventoryApi();
    const { result, location } = mount();
    await waitFor(() => expect(result.current.itemsLoading).toBe(false));
    await act(() => result.current.handleLogout());
    expect(calls.some(c => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(true);
    expect(location()).toBe('/login');
  });
});
