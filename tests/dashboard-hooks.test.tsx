// @vitest-environment jsdom
/**
 * tests/dashboard-hooks.test.tsx — the inventory dashboard's hooks, mounted
 *
 * The dashboard is where a store manages what capture has added: listing and paging items,
 * adding, editing and deleting them, exporting, and managing categories (including the bulk
 * actions that rewrite or delete every item in a category). The server side of each call is
 * covered by the route tests; this file covers what the page sends and how it reacts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Category, InventoryItem } from '../src/components/dashboard/types';
import { emptyForm } from '../src/components/dashboard/types';
import { useItemManagement } from '../src/hooks/useItemManagement';
import { useCategoryManagement } from '../src/hooks/useCategoryManagement';
import { useDashboardStats } from '../src/hooks/useDashboardStats';
import { useActiveSessions } from '../src/hooks/useActiveSessions';
import { useServerInfo } from '../src/hooks/useServerInfo';
import { ToastContext } from '../src/hooks/useToast';
import { isSupportedUploadImageType, readFileAsDataUrl } from '../src/lib/imageUpload';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = { url: string; method: string; body?: any };

function stubFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return route(url, init);
    })
  );
  return calls;
}

const prevent = { preventDefault: () => {} };

function inventoryItem(id: number, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id,
    item_name: `Item ${id}`,
    description: '',
    quantity: 3,
    unit: 'each',
    category_id: 5,
    category_name: 'Drinks',
    status: 'Active',
    sale_price: 1.5,
    tax_percent: 0,
    image: '',
    upc: `00000000000${id}`,
    ...overrides,
  } as InventoryItem;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── useItemManagement ────────────────────────────────────────────────────────

describe('useItemManagement', () => {
  function mount(viewMode: 'categories' | 'items' = 'items', categoryId: number | null = 5) {
    const onStatsChange = vi.fn();
    const addToast = vi.fn();
    const hook = renderHook(() =>
      useItemManagement(viewMode, categoryId, 'Active', onStatsChange, addToast)
    );
    return { ...hook, onStatsChange, addToast };
  }

  it('fetches a page of items with the category and status filters', async () => {
    const calls = stubFetch(() => jsonResponse({ items: [inventoryItem(1)], total: 61 }));
    const { result } = mount();

    await act(async () => {
      await result.current.fetchItems(5, 2, 25);
    });

    expect(calls[0].url).toBe('/api/inventory?page=2&limit=25&category_id=5&status=Active');
    expect(result.current.items.map(i => i.id)).toEqual([1]);
    expect(result.current.totalItems).toBe(61);
  });

  it('fetches the whole inventory without a category, and with no status when cleared', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result } = mount();

    await act(async () => {
      await result.current.fetchItems(null, 1, 50, '');
    });

    expect(calls[0].url).toBe('/api/inventory?page=1&limit=50');
    // A body without items or total is read as an empty page.
    expect(result.current.items).toEqual([]);
    expect(result.current.totalItems).toBe(0);
  });

  it('keeps the current list when the fetch fails', async () => {
    let fail = false;
    stubFetch(() =>
      fail
        ? jsonResponse({ error: 'x' }, 500)
        : jsonResponse({ items: [inventoryItem(1)], total: 1 })
    );
    const { result } = mount();
    await act(async () => {
      await result.current.fetchItems(5);
    });

    fail = true;
    await act(async () => {
      await result.current.fetchItems(5, 2);
    });
    expect(result.current.items.map(i => i.id)).toEqual([1]);
  });

  it('names every missing required field before adding, and sends nothing', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result, addToast } = mount();

    await act(async () => {
      await result.current.handleAddItem(prevent);
    });
    expect(addToast).toHaveBeenCalledWith(
      'warning',
      'Please add a name, a UPC, a category before saving.'
    );

    act(() => result.current.setFormData({ ...emptyForm, item_name: 'Cola', upc: '  ' }));
    await act(async () => {
      await result.current.handleAddItem(prevent);
    });
    expect(addToast).toHaveBeenLastCalledWith(
      'warning',
      'Please add a UPC, a category before saving.'
    );
    expect(calls).toHaveLength(0);
  });

  it('adds an item, resets the form and refreshes the list and stats', async () => {
    const calls = stubFetch(url =>
      url === '/api/inventory'
        ? jsonResponse({ id: 9 }, 201)
        : jsonResponse({ items: [], total: 0 })
    );
    const { result, addToast, onStatsChange } = mount();
    const form = { ...emptyForm, item_name: ' Cola ', upc: '012345678905', category_id: '5' };
    act(() => {
      result.current.setFormData(form);
      result.current.setIsAddModalOpen(true);
    });

    await act(async () => {
      await result.current.handleAddItem(prevent);
    });

    expect(calls[0]).toMatchObject({ url: '/api/inventory', method: 'POST', body: form });
    expect(addToast).toHaveBeenCalledWith('success', 'Added "Cola"');
    expect(result.current.isAddModalOpen).toBe(false);
    expect(result.current.formData).toEqual(emptyForm);
    expect(onStatsChange).toHaveBeenCalledTimes(1);
    expect(calls[1].url).toMatch(/^\/api\/inventory\?page=1&limit=50&category_id=5/);
  });

  it('does not reload the item list from the categories view', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 9 }, 201));
    const { result } = mount('categories');
    act(() =>
      result.current.setFormData({ ...emptyForm, item_name: 'Cola', upc: '1', category_id: '5' })
    );

    await act(async () => {
      await result.current.handleAddItem(prevent);
    });
    expect(calls).toHaveLength(1);
  });

  it("shows the server's reason when an add is refused, and keeps the form", async () => {
    stubFetch(() => jsonResponse({ error: 'An item with that UPC or number already exists' }, 409));
    const { result, addToast, onStatsChange } = mount();
    const form = { ...emptyForm, item_name: 'Cola', upc: '1', category_id: '5' };
    act(() => result.current.setFormData(form));

    await act(async () => {
      await result.current.handleAddItem(prevent);
    });

    expect(addToast).toHaveBeenCalledWith(
      'error',
      'An item with that UPC or number already exists'
    );
    expect(result.current.formData).toEqual(form);
    expect(onStatsChange).not.toHaveBeenCalled();
  });

  it('reports a network failure on add', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const { result, addToast } = mount();
    act(() =>
      result.current.setFormData({ ...emptyForm, item_name: 'Cola', upc: '1', category_id: '5' })
    );

    await act(async () => {
      await result.current.handleAddItem(prevent);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'An error occurred');
  });

  it('opens the edit form with defaults for missing values', () => {
    stubFetch(() => jsonResponse({}));
    const { result } = mount();
    const sparse = {
      id: 4,
      item_name: null,
      upc: null,
      category_id: null,
      status: null,
      quantity: null,
    } as unknown as InventoryItem;

    act(() => result.current.openEditModal(sparse));

    expect(result.current.editingItem).toBe(sparse);
    expect(result.current.editFormData).toEqual({
      image: '',
      item_name: '',
      upc: '',
      unit: '',
      quantity: 0,
      category_id: '',
      status: 'Active',
      sale_price: 0,
      tax_percent: 0,
      description: '',
      tag_names: '',
    });
  });

  it('saves an edit with PUT and closes the form', async () => {
    const calls = stubFetch(url =>
      url === '/api/inventory/1' ? jsonResponse({ success: true }) : jsonResponse({ items: [] })
    );
    const { result, addToast, onStatsChange } = mount();
    act(() => result.current.openEditModal(inventoryItem(1)));
    act(() =>
      result.current.setEditFormData({ ...result.current.editFormData, item_name: ' Diet Cola ' })
    );

    await act(async () => {
      await result.current.handleEditItem(prevent);
    });

    expect(calls[0]).toMatchObject({ url: '/api/inventory/1', method: 'PUT' });
    expect(calls[0].body.item_name).toBe(' Diet Cola ');
    expect(calls[0].body.category_id).toBe('5');
    expect(addToast).toHaveBeenCalledWith('success', 'Saved changes to "Diet Cola"');
    expect(result.current.editingItem).toBeNull();
    expect(onStatsChange).toHaveBeenCalled();
  });

  it('keeps the edit form open when the save is refused or fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let mode: 'refuse' | 'throw' = 'refuse';
    stubFetch(() => {
      if (mode === 'throw') throw new TypeError('Failed to fetch');
      return jsonResponse({ error: 'This item was changed since you opened it.' }, 409);
    });
    const { result, addToast } = mount();
    act(() => result.current.openEditModal(inventoryItem(1)));

    await act(async () => {
      await result.current.handleEditItem(prevent);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'This item was changed since you opened it.');
    expect(result.current.editingItem).not.toBeNull();

    mode = 'throw';
    await act(async () => {
      await result.current.handleEditItem(prevent);
    });
    expect(addToast).toHaveBeenLastCalledWith('error', 'An error occurred');
    expect(result.current.editingItem).not.toBeNull();
  });

  it('does nothing on save with no item open', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result } = mount();
    await act(async () => {
      await result.current.handleEditItem(prevent);
    });
    expect(calls).toHaveLength(0);
  });

  it('deletes an item by name and drops it from the list', async () => {
    const calls = stubFetch(url =>
      url.startsWith('/api/inventory?')
        ? jsonResponse({ items: [inventoryItem(1), inventoryItem(2)], total: 2 })
        : jsonResponse({ success: true })
    );
    const { result, addToast, onStatsChange } = mount('categories');
    await act(async () => {
      await result.current.fetchItems(5);
    });
    act(() => result.current.setConfirmDeleteItemId(1));

    await act(async () => {
      await result.current.handleDeleteItem(1);
    });

    expect(calls[1]).toMatchObject({ url: '/api/inventory/1', method: 'DELETE' });
    expect(addToast).toHaveBeenCalledWith('success', 'Deleted "Item 1"');
    expect(result.current.items.map(i => i.id)).toEqual([2]);
    expect(result.current.deletingItemId).toBeNull();
    expect(result.current.confirmDeleteItemId).toBeNull();
    expect(onStatsChange).toHaveBeenCalled();
  });

  it('uses a generic message for an item not on this page', async () => {
    stubFetch(() => jsonResponse({ success: true }));
    const { result, addToast } = mount('categories');
    await act(async () => {
      await result.current.handleDeleteItem(77);
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Item deleted');
  });

  it("shows the server's reason when a delete is refused, and keeps the item", async () => {
    stubFetch(url =>
      url.startsWith('/api/inventory?')
        ? jsonResponse({ items: [inventoryItem(1)], total: 1 })
        : jsonResponse({ error: 'Forbidden' }, 403)
    );
    const { result, addToast } = mount('categories');
    await act(async () => {
      await result.current.fetchItems(5);
    });

    await act(async () => {
      await result.current.handleDeleteItem(1);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'Forbidden');
    expect(result.current.items).toHaveLength(1);
    expect(result.current.confirmDeleteItemId).toBeNull();
  });

  it('falls back to a generic delete error when the reply has no reason', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const { result, addToast } = mount('categories');
    await act(async () => {
      await result.current.handleDeleteItem(1);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete item');
  });

  it('downloads an export in the chosen format', async () => {
    const calls = stubFetch(() => new Response('a,b\n1,2', { status: 200 }));
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result, addToast } = mount();
    act(() => {
      result.current.setExportFormat('csv');
      result.current.setShowExportModal(true);
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleExport();
    });

    expect(ok).toBe(true);
    expect(calls[0].url).toBe('/api/inventory/export?format=csv');
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('inventory.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(addToast).toHaveBeenCalledWith('success', 'Exported inventory as CSV');
    expect(result.current.showExportModal).toBe(false);
    expect(result.current.exporting).toBe(false);
  });

  it('reports a failed export and keeps the dialog open', async () => {
    stubFetch(() => jsonResponse({ error: 'x' }, 500));
    const { result, addToast } = mount();
    act(() => result.current.setShowExportModal(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleExport();
    });

    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith('error', 'Export failed. Please try again.');
    expect(result.current.showExportModal).toBe(true);
    expect(result.current.exporting).toBe(false);
  });

  it('reads a chosen image into the add or the edit form', async () => {
    stubFetch(() => jsonResponse({}));
    const { result } = mount();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'p.png', {
      type: 'image/png',
    });
    const files = { 0: file, length: 1, item: () => file } as unknown as FileList;

    await act(async () => {
      await result.current.handleImageUpload({ target: { files } }, 'add');
    });
    expect(result.current.formData.image).toMatch(/^data:image\/png;base64,/);
    expect(result.current.editFormData.image).toBe('');

    await act(async () => {
      await result.current.handleImageUpload({ target: { files } }, 'edit');
    });
    expect(result.current.editFormData.image).toMatch(/^data:image\/png;base64,/);

    // Cancelling the picker changes nothing.
    await act(async () => {
      await result.current.handleImageUpload({ target: { files: null } }, 'edit');
    });
    expect(result.current.editFormData.image).toMatch(/^data:image\/png;base64,/);
  });
});

// ── useCategoryManagement ────────────────────────────────────────────────────

describe('useCategoryManagement', () => {
  const drinks: Category = {
    id: 5,
    name: 'Drinks',
    status: 'Active',
    icon: 'CupSoda',
    item_count: 2,
    total_stock: 10,
  };

  function mount() {
    const onStatsChange = vi.fn();
    const addToast = vi.fn();
    const hook = renderHook(() => useCategoryManagement(onStatsChange, addToast));
    return { ...hook, onStatsChange, addToast };
  }

  /** Answers category list requests with `list`, and everything else with `other`. */
  function categoriesApi(other: (url: string, init?: RequestInit) => Response, list = [drinks]) {
    return stubFetch((url, init) =>
      url === '/api/categories' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse(list)
        : other(url, init)
    );
  }

  it('loads categories, and keeps the old list when loading fails', async () => {
    let fail = false;
    stubFetch(() => (fail ? jsonResponse({}, 500) : jsonResponse([drinks])));
    const { result } = mount();

    await act(async () => {
      await result.current.fetchCategories();
    });
    expect(result.current.categories).toEqual([drinks]);

    fail = true;
    await act(async () => {
      await result.current.fetchCategories();
    });
    expect(result.current.categories).toEqual([drinks]);
  });

  it('opens a blank form to add, and a filled one to edit', () => {
    stubFetch(() => jsonResponse([]));
    const { result } = mount();

    act(() => result.current.openEditCat({ ...drinks, icon: '' }));
    expect(result.current.showCatModal).toBe(true);
    expect(result.current.editingCategory?.id).toBe(5);
    expect(result.current.catForm).toEqual({ name: 'Drinks', icon: '' });

    act(() => result.current.openAddCat());
    expect(result.current.editingCategory).toBeNull();
    expect(result.current.catForm).toEqual({ name: '', icon: '' });
    expect(result.current.catError).toBe('');
  });

  it('requires a name before saving', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result } = mount();
    act(() => result.current.openAddCat());
    act(() => result.current.setCatForm({ name: '   ', icon: '' }));

    await act(async () => {
      await result.current.handleSaveCategory();
    });

    expect(result.current.catError).toBe('Category name is required');
    expect(calls).toHaveLength(0);
  });

  it('adds a category with a trimmed name and the default icon', async () => {
    const calls = categoriesApi(() => jsonResponse({ id: 6 }, 201));
    const { result, addToast } = mount();
    act(() => result.current.openAddCat());
    act(() => result.current.setCatForm({ name: '  Snacks ', icon: '' }));

    await act(async () => {
      await result.current.handleSaveCategory();
    });

    expect(calls[0]).toMatchObject({
      url: '/api/categories',
      method: 'POST',
      body: { name: 'Snacks', icon: 'Package' },
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Added category "Snacks"');
    expect(result.current.showCatModal).toBe(false);
    expect(result.current.catSaving).toBe(false);
    // The list is reloaded afterwards.
    expect(calls[1]).toMatchObject({ url: '/api/categories', method: 'GET' });
  });

  it('renames an existing category with PUT', async () => {
    const calls = categoriesApi(() => jsonResponse({ success: true }));
    const { result, addToast } = mount();
    act(() => result.current.openEditCat(drinks));
    act(() => result.current.setCatForm({ name: 'Cold Drinks', icon: 'CupSoda' }));

    await act(async () => {
      await result.current.handleSaveCategory();
    });

    expect(calls[0]).toMatchObject({
      url: '/api/categories/5',
      method: 'PUT',
      body: { name: 'Cold Drinks', icon: 'CupSoda' },
    });
    expect(addToast).toHaveBeenCalledWith('success', 'Saved category "Cold Drinks"');
    expect(result.current.editingCategory).toBeNull();
  });

  it("keeps the form open with the server's reason when a save is refused", async () => {
    categoriesApi(() => jsonResponse({ error: 'Category name already exists' }, 409));
    const { result } = mount();
    act(() => result.current.openAddCat());
    act(() => result.current.setCatForm({ name: 'Drinks', icon: '' }));

    await act(async () => {
      await result.current.handleSaveCategory();
    });

    expect(result.current.catError).toBe('Category name already exists');
    expect(result.current.showCatModal).toBe(true);
    expect(result.current.catSaving).toBe(false);
  });

  it('shows a generic error when the save fails outright', async () => {
    categoriesApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = mount();
    act(() => result.current.openAddCat());
    act(() => result.current.setCatForm({ name: 'Snacks', icon: '' }));

    await act(async () => {
      await result.current.handleSaveCategory();
    });
    expect(result.current.catError).toBe('Failed to save category');

    categoriesApi(() => jsonResponse({}, 500));
    await act(async () => {
      await result.current.handleSaveCategory();
    });
    expect(result.current.catError).toBe('Failed to save category');
  });

  it('deletes a category by name and refreshes the stats', async () => {
    const calls = categoriesApi(() => jsonResponse({ success: true }));
    const { result, addToast, onStatsChange } = mount();
    await act(async () => {
      await result.current.fetchCategories();
    });

    await act(async () => {
      await result.current.handleDeleteCategory(5);
    });

    expect(calls[1]).toMatchObject({ url: '/api/categories/5', method: 'DELETE' });
    expect(addToast).toHaveBeenCalledWith('success', 'Deleted category "Drinks"');
    expect(onStatsChange).toHaveBeenCalled();

    await act(async () => {
      await result.current.handleDeleteCategory(99);
    });
    expect(addToast).toHaveBeenLastCalledWith('success', 'Category deleted');
  });

  it("reports a refused category delete with the server's reason, or a fallback", async () => {
    let reply = () => jsonResponse({ error: 'Category has items' }, 409);
    categoriesApi(() => reply());
    const { result, addToast, onStatsChange } = mount();

    await act(async () => {
      await result.current.handleDeleteCategory(5);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'Category has items');

    reply = () => new Response('oops', { status: 500 });
    await act(async () => {
      await result.current.handleDeleteCategory(5);
    });
    expect(addToast).toHaveBeenLastCalledWith('error', 'Failed to delete category');
    expect(onStatsChange).not.toHaveBeenCalled();
  });

  it.each([
    ['activate', 'Active', 'Set all items in "Drinks" Active'],
    ['deactivate', 'Inactive', 'Set all items in "Drinks" In-Active'],
  ] as const)('can %s every item in a category', async (action, status, message) => {
    const calls = categoriesApi(() => jsonResponse({ success: true }));
    const { result, addToast, onStatsChange } = mount();
    await act(async () => {
      await result.current.fetchCategories();
    });

    await act(async () => {
      await result.current.handleCategoryAction(5, action);
    });

    expect(calls[1]).toMatchObject({
      url: '/api/categories/5/status',
      method: 'PUT',
      body: { status },
    });
    expect(addToast).toHaveBeenCalledWith('success', message);
    expect(onStatsChange).toHaveBeenCalled();
  });

  it('can delete every item in a category, keeping the category', async () => {
    const calls = categoriesApi(() => jsonResponse({ success: true }));
    const { result, addToast } = mount();

    await act(async () => {
      await result.current.handleCategoryAction(5, 'deleteItems');
    });

    expect(calls[0]).toMatchObject({ url: '/api/categories/5/items', method: 'DELETE' });
    // The category list was never loaded, so the toast falls back to a generic name.
    expect(addToast).toHaveBeenCalledWith('success', 'Deleted all items in the category');
  });

  it.each([
    ['activate', 'Failed to update category'],
    ['deleteItems', 'Failed to delete category items'],
  ] as const)('reports a failed %s and does not refresh', async (action, fallback) => {
    let reply = () => jsonResponse({ error: 'Store suspended' }, 403);
    categoriesApi(() => reply());
    const { result, addToast, onStatsChange } = mount();

    await act(async () => {
      await result.current.handleCategoryAction(5, action);
    });
    expect(addToast).toHaveBeenCalledWith('error', 'Store suspended');

    reply = () => new Response('', { status: 500 });
    await act(async () => {
      await result.current.handleCategoryAction(5, action);
    });
    expect(addToast).toHaveBeenLastCalledWith('error', fallback);
    expect(onStatsChange).not.toHaveBeenCalled();
  });
});

// ── Smaller dashboard hooks ──────────────────────────────────────────────────

describe('useDashboardStats', () => {
  it('loads store-wide stats, or one category', async () => {
    const stats = { totalCategories: 3, totalItems: 12, inStock: 10, outOfStock: 2 };
    const calls = stubFetch(() => jsonResponse(stats));
    const { result } = renderHook(() => useDashboardStats());
    expect(result.current.stats.totalItems).toBe(0);

    await act(async () => {
      await result.current.fetchStats();
    });
    await act(async () => {
      await result.current.fetchStats(null);
    });
    await act(async () => {
      await result.current.fetchStats(7);
    });

    expect(calls.map(c => c.url)).toEqual([
      '/api/dashboard/stats',
      '/api/dashboard/stats',
      '/api/dashboard/stats?category_id=7',
    ]);
    expect(result.current.stats).toEqual(stats);
  });

  it('keeps the previous numbers when loading fails', async () => {
    stubFetch(() => jsonResponse({ error: 'x' }, 500));
    const { result } = renderHook(() => useDashboardStats());
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.stats).toEqual({
      totalCategories: 0,
      totalItems: 0,
      inStock: 0,
      outOfStock: 0,
    });
  });
});

describe('useActiveSessions', () => {
  const addToast = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <ToastContext.Provider value={addToast}>{children}</ToastContext.Provider>
  );
  const sessions = [
    { session_id: 'a', status: 'active' },
    { session_id: 'b', status: 'draft' },
  ];

  it('lists the open sessions, ignoring a failed load', async () => {
    let fail = false;
    stubFetch(() => {
      if (fail) throw new TypeError('Failed to fetch');
      return jsonResponse(sessions);
    });
    const { result } = renderHook(() => useActiveSessions(), { wrapper });

    await act(async () => {
      await result.current.fetchActiveSessions();
    });
    expect(result.current.activeSessions.map(s => s.session_id)).toEqual(['a', 'b']);

    fail = true;
    await act(async () => {
      await result.current.fetchActiveSessions();
    });
    expect(result.current.activeSessions).toHaveLength(2);
  });

  it('removes a deleted session straight away', async () => {
    addToast.mockClear();
    const calls = stubFetch(url =>
      url === '/api/sessions/active' ? jsonResponse(sessions) : jsonResponse({ success: true })
    );
    const { result } = renderHook(() => useActiveSessions(), { wrapper });
    await act(async () => {
      await result.current.fetchActiveSessions();
    });

    await act(async () => {
      await result.current.deleteSession('a');
    });

    expect(calls[1]).toMatchObject({ url: '/api/session/a', method: 'DELETE' });
    expect(result.current.activeSessions.map(s => s.session_id)).toEqual(['b']);
    expect(addToast).toHaveBeenCalledWith('success', 'Scan session deleted');
  });

  it('puts a session back when its delete fails', async () => {
    addToast.mockClear();
    stubFetch((_url, init) =>
      init?.method === 'DELETE' ? jsonResponse({ error: 'no' }, 403) : jsonResponse(sessions)
    );
    const { result } = renderHook(() => useActiveSessions(), { wrapper });
    await act(async () => {
      await result.current.fetchActiveSessions();
    });

    await act(async () => {
      await result.current.deleteSession('a');
    });

    expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete the scan session');
    expect(result.current.activeSessions.map(s => s.session_id)).toEqual(['a', 'b']);
  });

  it('cannot be used outside the toast provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useActiveSessions())).toThrow(
      'useToast must be used inside ToastProvider'
    );
  });
});

describe('useServerInfo', () => {
  it('loads the address the phone should open, and refreshes it every 30 seconds', async () => {
    vi.useFakeTimers();
    const calls = stubFetch(() =>
      jsonResponse({
        ip: '192.168.1.20',
        port: 3443,
        protocol: 'https',
        mobileUrl: 'https://192.168.1.20:3443',
        tunnelUrl: 'https://shop.trycloudflare.com',
      })
    );
    const { result } = renderHook(() => useServerInfo());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.serverInfo).toEqual({
      ip: '192.168.1.20',
      port: 3443,
      protocol: 'https',
      mobileUrl: 'https://192.168.1.20:3443',
      tunnelUrl: 'https://shop.trycloudflare.com',
    });
    expect(result.current.ipLoading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls).toHaveLength(2);
  });

  it('fills gaps in the answer with local defaults', async () => {
    stubFetch(() => jsonResponse({}));
    const { result } = renderHook(() => useServerInfo());
    await act(async () => {
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.serverInfo).not.toBeNull());
    expect(result.current.serverInfo).toEqual({
      ip: 'localhost',
      port: 3000,
      protocol: 'http',
      mobileUrl: undefined,
      tunnelUrl: null,
    });
  });

  it('falls back to localhost when the server cannot say', async () => {
    stubFetch(() => jsonResponse({ error: 'x' }, 500));
    const { result } = renderHook(() => useServerInfo());
    await vi.waitFor(() =>
      expect(result.current.serverInfo).toEqual({ ip: 'localhost', port: 3000, protocol: 'http' })
    );
    expect(result.current.ipLoading).toBe(false);
  });

  it('gives up on a request that hangs for 5 seconds', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );
    const { result } = renderHook(() => useServerInfo());
    expect(result.current.ipLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.serverInfo).toEqual({ ip: 'localhost', port: 3000, protocol: 'http' });
    expect(result.current.ipLoading).toBe(false);
  });
});

describe('imageUpload helpers', () => {
  it('accepts only the formats the server can store', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(isSupportedUploadImageType(new File([], 'x', { type }))).toBe(true);
    }
    for (const type of ['image/svg+xml', 'image/heic', 'application/pdf', '']) {
      expect(isSupportedUploadImageType(new File([], 'x', { type }))).toBe(false);
    }
  });

  it('reads a file as a data URL', async () => {
    const url = await readFileAsDataUrl(new File(['hi'], 'a.txt', { type: 'text/plain' }));
    expect(url).toBe('data:text/plain;base64,aGk=');
  });

  it('rejects when the browser cannot read the file', async () => {
    const original = globalThis.FileReader;
    class FailingReader {
      result: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    class ArrayReader extends FailingReader {
      readAsDataURL() {
        this.result = new ArrayBuffer(1);
        queueMicrotask(() => this.onload?.());
      }
    }
    try {
      vi.stubGlobal('FileReader', FailingReader);
      await expect(readFileAsDataUrl(new File(['x'], 'a'))).rejects.toThrow('Could not read file.');
      vi.stubGlobal('FileReader', ArrayReader);
      await expect(readFileAsDataUrl(new File(['x'], 'a'))).rejects.toThrow('Could not read file.');
    } finally {
      vi.stubGlobal('FileReader', original);
    }
  });
});
