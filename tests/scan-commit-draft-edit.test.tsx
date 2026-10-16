// @vitest-environment jsdom
/**
 * tests/scan-commit-draft-edit.test.tsx — the desktop review step, mounted
 *
 * After the phone captures items, the desktop reviews them: edits a staged row, removes one,
 * parks the session as a draft, and finally commits the selection into inventory. The pure
 * selection helpers in useCommitModal are covered in tests/scan-helpers.test.ts; this file
 * covers what the three review hooks actually send to the server and how they react to its
 * answers, which nothing else exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { SessionItem } from '../src/components/scan/types';
import { useCommitModal } from '../src/hooks/useCommitModal';
import { useDraftManagement } from '../src/hooks/useDraftManagement';
import { useEditItem } from '../src/hooks/useEditItem';

const SESSION_ID = 'review-session';

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
    ...overrides,
  };
}

type Call = { url: string; init?: RequestInit; body?: any };

/** Records every request and answers with whatever the route handler returns. */
function stubFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return route(url, init);
    })
  );
  return calls;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── useCommitModal ───────────────────────────────────────────────────────────

describe('useCommitModal', () => {
  const categories = [
    { id: 10, name: 'Drinks', icon: 'Cup', status: 'Active' },
    { id: 11, name: 'Old stock', icon: 'Box', status: 'Inactive' },
  ];

  function mount(items: SessionItem[], selected: number[]) {
    const deps = {
      sessionId: SESSION_ID as string | null,
      selectedIds: new Set(selected),
      items,
      isBusyRef: { current: false },
      lastPollCursorRef: { current: { updatedAt: '2026-10-16 09:00:00', id: 1 } } as {
        current: { updatedAt: string; id: number } | null;
      },
      refreshSession: vi.fn(async () => {}),
      setUiStatus: vi.fn(),
      setStatusMessage: vi.fn(),
      addToast: vi.fn(),
    };
    const hook = renderHook(() => useCommitModal(deps));
    return { ...hook, deps };
  }

  it('commits only-existing items straight away as "seen", without asking for categories', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ inserted: 0, verified: 1, skipped: 0, status: 'completed' })
    );
    const existing = item(2, { exists_in_inventory: 1, lookup_status: 'matched' });
    const { result, deps } = mount([existing], [2]);

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(calls.map(c => c.url)).toEqual([`/api/session/${SESSION_ID}/commit`]);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].body).toEqual({ assignments: [], verifyIds: [2] });
    expect(result.current.showCommitModal).toBe(false);
    expect(deps.addToast).toHaveBeenCalledWith('success', '0 added - 1 marked as seen');
    // The feed is reloaded from scratch after a commit.
    expect(deps.lastPollCursorRef.current).toBeNull();
    expect(deps.refreshSession).toHaveBeenCalledWith(true);
    expect(deps.setUiStatus).toHaveBeenLastCalledWith('ready');
    expect(deps.setStatusMessage).toHaveBeenLastCalledWith(
      'Session committed to inventory. View only.'
    );
    expect(deps.isBusyRef.current).toBe(false);
  });

  it('warns and sends nothing when the selection holds nothing committable', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    // A row whose lookup failed is neither new nor known.
    const { result, deps } = mount([item(1, { lookup_status: 'error' })], [1]);

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(calls).toHaveLength(0);
    expect(deps.addToast).toHaveBeenCalledWith(
      'warning',
      'Select at least one new or existing item before committing.'
    );
  });

  it('does nothing with an empty selection or while another action is running', async () => {
    const calls = stubFetch(() => jsonResponse(categories));
    const empty = mount([item(1)], []);
    await act(async () => {
      await empty.result.current.openCommitModal();
    });

    const busy = mount([item(1)], [1]);
    busy.deps.isBusyRef.current = true;
    await act(async () => {
      await busy.result.current.openCommitModal();
    });

    expect(calls).toHaveLength(0);
  });

  it('opens the modal with only the active categories when new items are selected', async () => {
    stubFetch(() => jsonResponse(categories));
    const { result } = mount([item(1)], [1]);

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(result.current.showCommitModal).toBe(true);
    expect(result.current.categories.map(c => c.name)).toEqual(['Drinks']);
    expect(result.current.categoriesLoading).toBe(false);
  });

  it('refuses to open when the store has no active category', async () => {
    stubFetch(() => jsonResponse([categories[1]]));
    const { result, deps } = mount([item(1)], [1]);

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(result.current.showCommitModal).toBe(false);
    expect(deps.addToast).toHaveBeenCalledWith(
      'error',
      'No active categories found. Create a category before committing.'
    );
  });

  it('reports a failed category load', async () => {
    stubFetch(() => jsonResponse({ error: 'x' }, 500));
    const { result, deps } = mount([item(1)], [1]);

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(deps.addToast).toHaveBeenCalledWith('error', 'Failed to load categories');
    expect(result.current.showCommitModal).toBe(false);
  });

  it('will not commit until every new item has a category', async () => {
    const calls = stubFetch(() => jsonResponse(categories));
    const { result, deps } = mount([item(1), item(3)], [1, 3]);
    await act(async () => {
      await result.current.openCommitModal();
    });
    act(() => result.current.setItemCategories(new Map([[1, 10]])));

    await act(async () => {
      await result.current.confirmCommit();
    });

    expect(deps.addToast).toHaveBeenCalledWith(
      'warning',
      'Assign a category to every new item before committing.'
    );
    expect(calls.filter(c => c.url.endsWith('/commit'))).toHaveLength(0);
    expect(result.current.showCommitModal).toBe(true);
  });

  it('commits new items with their categories alongside existing ones, and reports leftovers', async () => {
    const calls = stubFetch(url =>
      url === '/api/categories'
        ? jsonResponse(categories)
        : jsonResponse({ inserted: 1, verified: 1, skipped: 1, status: 'draft' })
    );
    const items = [
      item(1),
      item(2, { exists_in_inventory: 1, lookup_status: 'matched' }),
      item(3), // staged but not selected — must not be sent
    ];
    const { result, deps } = mount(items, [1, 2]);
    await act(async () => {
      await result.current.openCommitModal();
    });
    act(() => result.current.setItemCategories(new Map([[1, 10]])));

    await act(async () => {
      await result.current.confirmCommit();
    });

    const commit = calls.find(c => c.url.endsWith('/commit'))!;
    expect(commit.body).toEqual({ assignments: [{ id: 1, category_id: 10 }], verifyIds: [2] });
    expect(result.current.showCommitModal).toBe(false);
    expect(result.current.itemCategories.size).toBe(0);
    expect(deps.addToast).toHaveBeenCalledWith(
      'success',
      '1 added - 1 marked as seen - 1 left in session'
    );
    expect(deps.setStatusMessage).toHaveBeenLastCalledWith(
      'Draft mode. Resume scanning when you are ready.'
    );
  });

  it('flags a commit that changed nothing as a warning, not a success', async () => {
    stubFetch(() => jsonResponse({ inserted: 0, verified: 0, skipped: 1, status: 'active' }));
    const { result, deps } = mount(
      [item(2, { exists_in_inventory: 1, lookup_status: 'matched' })],
      [2]
    );

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(deps.addToast).toHaveBeenCalledWith(
      'warning',
      '0 added - 0 marked as seen - 1 left in session'
    );
    expect(deps.setStatusMessage).toHaveBeenLastCalledWith(
      'Session ready. Scan the QR code with your phone.'
    );
  });

  it('shows an error and frees the page when the commit fails', async () => {
    stubFetch(() => jsonResponse({ error: 'boom' }, 500));
    const { result, deps } = mount(
      [item(2, { exists_in_inventory: 1, lookup_status: 'matched' })],
      [2]
    );

    await act(async () => {
      await result.current.openCommitModal();
    });

    expect(deps.setUiStatus).toHaveBeenLastCalledWith('error');
    expect(deps.setStatusMessage).toHaveBeenLastCalledWith('Failed to commit session.');
    expect(deps.addToast).toHaveBeenCalledWith('error', 'Failed to commit items to inventory.');
    expect(deps.refreshSession).not.toHaveBeenCalled();
    expect(deps.isBusyRef.current).toBe(false);
  });
});

// ── useDraftManagement ───────────────────────────────────────────────────────

describe('useDraftManagement', () => {
  function mount(overrides: { sessionId?: string | null; sessionLabel?: string | null } = {}) {
    const deps = {
      sessionId: (overrides.sessionId === undefined ? SESSION_ID : overrides.sessionId) as
        | string
        | null,
      sessionLabel: overrides.sessionLabel ?? null,
      setSessionStatus: vi.fn(),
      setSessionLabel: vi.fn(),
      setDraftAlert: vi.fn(),
      setItems: vi.fn(),
      setSelectedIds: vi.fn(),
      manuallyDeselectedRef: { current: new Set([7]) },
      sessionStartTimeRef: { current: 0 as number | null },
      idleAlertFiredRef: { current: true },
      lastLongSessionAlertRef: { current: 123 as number | null },
      createSession: vi.fn(async () => {}),
      addToast: vi.fn(),
    };
    const hook = renderHook(() => useDraftManagement(deps));
    return { ...hook, deps };
  }

  it('saves the session as a draft and pauses scanning', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleSaveDraft();
    });

    expect(calls[0].url).toBe(`/api/session/${SESSION_ID}/status`);
    expect(calls[0].init?.method).toBe('PATCH');
    expect(calls[0].body).toEqual({ status: 'draft' });
    expect(deps.setSessionStatus).toHaveBeenCalledWith('draft');
    expect(deps.setDraftAlert).toHaveBeenCalledWith({ message: '', visible: false });
    expect(deps.addToast).toHaveBeenCalledWith(
      'success',
      'Session saved as draft — scanning paused'
    );
  });

  it("shows the server's reason when a draft cannot be saved, and changes nothing", async () => {
    stubFetch(() => jsonResponse({ error: 'Cannot change a committed session' }, 409));
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleSaveDraft();
    });

    expect(deps.addToast).toHaveBeenCalledWith('error', 'Cannot change a committed session');
    expect(deps.setSessionStatus).not.toHaveBeenCalled();
  });

  it('blames the connection when the request never reaches the server', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleResumeScan();
    });

    expect(deps.addToast).toHaveBeenCalledWith(
      'error',
      'Failed to resume scanning — check your connection'
    );
    expect(deps.setSessionStatus).not.toHaveBeenCalled();
  });

  it('names a draft with a trimmed label, or none when left blank', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, deps } = mount();

    act(() => result.current.setShowDraftPopover(true));
    await act(async () => {
      await result.current.handleConfirmDraft('  Aisle 4  ');
    });
    await act(async () => {
      await result.current.handleConfirmDraft('   ');
    });

    expect(calls.map(c => c.body)).toEqual([
      { status: 'draft', label: 'Aisle 4' },
      { status: 'draft', label: null },
    ]);
    expect(deps.setSessionLabel.mock.calls).toEqual([['Aisle 4'], [null]]);
    expect(result.current.showDraftPopover).toBe(false);
  });

  it('prefills the draft name with the existing label, or a generated one', () => {
    const labelled = mount({ sessionLabel: 'Back room' });
    act(() => labelled.result.current.openDraftPopover());
    expect(labelled.result.current.showDraftPopover).toBe(true);
    expect(labelled.result.current.draftNameInput).toBe('Back room');

    const unlabelled = mount();
    act(() => unlabelled.result.current.openDraftPopover());
    expect(unlabelled.result.current.draftNameInput).toMatch(/^Scan · \w{3} \d{1,2}:\d{2}/);
  });

  it('resumes scanning and restarts the session reminders', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleResumeScan();
    });

    expect(calls[0].body).toEqual({ status: 'active' });
    expect(deps.setSessionStatus).toHaveBeenCalledWith('active');
    expect(deps.sessionStartTimeRef.current).toBeGreaterThan(0);
    expect(deps.idleAlertFiredRef.current).toBe(false);
    expect(deps.lastLongSessionAlertRef.current).toBeNull();
  });

  it('clears every staged item only after the confirm step', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, deps } = mount();

    act(() => result.current.handleClearAllItems());
    expect(result.current.clearItemsConfirmPending).toBe(true);
    expect(calls).toHaveLength(0);

    await act(async () => {
      await result.current.handleConfirmClearAllItems();
    });

    expect(calls[0]).toMatchObject({ url: `/api/session/${SESSION_ID}/items` });
    expect(calls[0].init?.method).toBe('DELETE');
    expect(deps.setItems).toHaveBeenCalledWith([]);
    expect(deps.setSelectedIds).toHaveBeenCalledWith(new Set());
    expect(deps.manuallyDeselectedRef.current.size).toBe(0);
    expect(result.current.clearItemsConfirmPending).toBe(false);
  });

  it('keeps the items when clearing fails', async () => {
    stubFetch(() => jsonResponse({ error: 'no' }, 403));
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleConfirmClearAllItems();
    });

    expect(deps.addToast).toHaveBeenCalledWith('error', 'Failed to clear items');
    expect(deps.setItems).not.toHaveBeenCalled();
  });

  it('deletes a draft after confirmation and opens a fresh session', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, deps } = mount();

    act(() => result.current.handleDeleteDraft());
    expect(result.current.deleteDraftConfirmPending).toBe(true);
    await act(async () => {
      await result.current.handleConfirmDeleteDraft();
    });

    expect(calls[0].url).toBe(`/api/session/${SESSION_ID}`);
    expect(calls[0].init?.method).toBe('DELETE');
    expect(deps.addToast).toHaveBeenCalledWith('success', 'Draft deleted');
    expect(deps.createSession).toHaveBeenCalledTimes(1);
  });

  it('does not open a new session when the draft could not be deleted', async () => {
    stubFetch(() => jsonResponse({ error: 'no' }, 500));
    const { result, deps } = mount();

    await act(async () => {
      await result.current.handleConfirmDeleteDraft();
    });

    expect(deps.addToast).toHaveBeenCalledWith('error', 'Failed to delete draft');
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it('does nothing at all without a session', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const { result } = mount({ sessionId: null });

    act(() => result.current.handleClearAllItems());
    act(() => result.current.handleDeleteDraft());
    await act(async () => {
      await result.current.handleSaveDraft();
      await result.current.handleConfirmDraft('x');
      await result.current.handleConfirmClearAllItems();
      await result.current.handleConfirmDeleteDraft();
    });

    expect(calls).toHaveLength(0);
    expect(result.current.clearItemsConfirmPending).toBe(false);
    expect(result.current.deleteDraftConfirmPending).toBe(false);
  });
});

// ── useEditItem ──────────────────────────────────────────────────────────────

describe('useEditItem', () => {
  /** Mounts the hook over real list/selection state so updates can be asserted on. */
  function mount(
    initial: SessionItem[],
    selected: number[] = [],
    sessionId: string | null = SESSION_ID
  ) {
    const addToast = vi.fn();
    const hook = renderHook(() => {
      const [items, setItems] = useState(initial);
      const [selectedIds, setSelectedIds] = useState(new Set(selected));
      const edit = useEditItem(sessionId, setItems, setSelectedIds, addToast);
      return { items, selectedIds, edit };
    });
    return { ...hook, addToast };
  }

  it('opens an edit form with blanks in place of missing values', () => {
    const { result } = mount([]);
    act(() =>
      result.current.edit.openEdit(
        item(1, { product_name: null, sale_price: null, unit: null, tag_names: 'cold, fizzy' })
      )
    );

    expect(result.current.edit.editItem).toEqual({
      id: 1,
      product_name: '',
      brand: '',
      quantity: 1,
      upc: '00000000001',
      image: '',
      tag_names: 'cold, fizzy',
      sale_price: '',
      unit: '',
    });
  });

  it("saves an edit and shows the server's version of the row, selecting it for commit", async () => {
    const saved = item(1, {
      product_name: 'Cola 330ml',
      quantity: 6,
      lookup_status: 'new_candidate',
    });
    const calls = stubFetch(() => jsonResponse({ success: true, item: saved }));
    const { result, addToast } = mount([item(1), item(2)], [2]);

    act(() => result.current.edit.openEdit(item(1)));
    act(() =>
      result.current.edit.setEditItem({
        ...result.current.edit.editItem!,
        product_name: 'Cola 330ml',
        quantity: 6,
        sale_price: '1.25',
      })
    );
    await act(async () => {
      await result.current.edit.saveEdit();
    });

    expect(calls[0].url).toBe(`/api/session/${SESSION_ID}/items/1`);
    expect(calls[0].init?.method).toBe('PATCH');
    expect(calls[0].body).toMatchObject({
      product_name: 'Cola 330ml',
      quantity: 6,
      sale_price: '1.25',
      unit: null,
    });
    expect(result.current.items[0]).toEqual(saved);
    expect(result.current.items[1].id).toBe(2);
    expect([...result.current.selectedIds].sort()).toEqual([1, 2]);
    expect(addToast).toHaveBeenCalledWith('success', 'Saved "Cola 330ml"');
    expect(result.current.edit.editItem).toBeNull();
    expect(result.current.edit.editSaving).toBe(false);
  });

  it('applies the edit locally when the server does not echo the row', async () => {
    stubFetch(() => jsonResponse({ success: true }));
    const { result } = mount([item(1, { lookup_status: 'error' })]);

    act(() => result.current.edit.openEdit(item(1)));
    act(() =>
      result.current.edit.setEditItem({
        ...result.current.edit.editItem!,
        product_name: 'Seltzer',
        brand: '',
        sale_price: '2.50',
        unit: 'can',
      })
    );
    await act(async () => {
      await result.current.edit.saveEdit();
    });

    expect(result.current.items[0]).toMatchObject({
      product_name: 'Seltzer',
      brand: null,
      sale_price: 2.5,
      unit: 'can',
      // A hand-edited row becomes a new candidate for commit.
      lookup_status: 'new_candidate',
    });
  });

  it('never sends a blank quantity', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result } = mount([item(1)]);

    act(() => result.current.edit.openEdit(item(1)));
    act(() => result.current.edit.setEditItem({ ...result.current.edit.editItem!, quantity: '' }));
    await act(async () => {
      await result.current.edit.saveEdit();
    });

    expect(calls).toHaveLength(0);
    expect(result.current.edit.editItem).not.toBeNull();
  });

  it("keeps the form open with the server's reason when a save is refused", async () => {
    stubFetch(() => jsonResponse({ error: 'That UPC is already staged in this session' }, 409));
    const { result, addToast } = mount([item(1)]);

    act(() => result.current.edit.openEdit(item(1)));
    await act(async () => {
      await result.current.edit.saveEdit();
    });

    expect(addToast).toHaveBeenCalledWith('error', 'That UPC is already staged in this session');
    expect(result.current.edit.editItem).not.toBeNull();
    expect(result.current.edit.editSaving).toBe(false);
    expect(result.current.items[0].product_name).toBe('Item 1');
  });

  it('falls back to a generic message when a refused save has no reason', async () => {
    stubFetch(() => new Response('not json', { status: 500 }));
    const { result, addToast } = mount([item(1)]);

    act(() => result.current.edit.openEdit(item(1)));
    await act(async () => {
      await result.current.edit.saveEdit();
    });

    expect(addToast).toHaveBeenCalledWith('error', 'Save failed');
  });

  it('removes a deleted row from the list and the selection', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true }));
    const { result, addToast } = mount([item(1), item(2)], [1, 2]);

    await act(async () => {
      await result.current.edit.deleteItem(1);
    });

    expect(calls[0].url).toBe(`/api/session/${SESSION_ID}/items/1`);
    expect(calls[0].init?.method).toBe('DELETE');
    expect(result.current.items.map(i => i.id)).toEqual([2]);
    expect([...result.current.selectedIds]).toEqual([2]);
    expect(addToast).toHaveBeenCalledWith('success', 'Removed from the session');
  });

  it('keeps the row when the delete fails', async () => {
    stubFetch(() => jsonResponse({ error: 'no' }, 403));
    const { result, addToast } = mount([item(1)], [1]);

    await act(async () => {
      await result.current.edit.deleteItem(1);
    });

    expect(addToast).toHaveBeenCalledWith('error', 'Failed to delete item');
    expect(result.current.items).toHaveLength(1);
    expect(result.current.selectedIds.has(1)).toBe(true);
  });
});
