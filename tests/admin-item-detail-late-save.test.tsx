// @vitest-environment jsdom
/**
 * tests/admin-item-detail-late-save.test.tsx — a slow superadmin save stays with its item
 *
 * The superadmin can save item A and open item B before A's save returns. If B loads
 * first, A's response used to be merged into B and replace B's same-UPC matches, so the
 * detail pane showed A's data under B until the next load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAdminItemDetail, type AdminItem } from '../src/hooks/useAdminItemDetail';

const wrapper = ({ children }: PropsWithChildren) => <MemoryRouter>{children}</MemoryRouter>;

function itemResponse(id: number, name: string, otherStoreId: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      item: { id, item_name: name, revision: `rev-${id}` },
      other_stores: [{ item_id: 99, store_id: otherStoreId, store_name: `Store ${otherStoreId}` }],
    }),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useAdminItemDetail.applyEdit', () => {
  it('ignores a save result for an item that is no longer on screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/items/1') ? itemResponse(1, 'Item A', 10) : itemResponse(2, 'Item B', 20)
      )
    );
    const { result, rerender } = renderHook(({ itemId }) => useAdminItemDetail('5', itemId), {
      wrapper,
      initialProps: { itemId: '1' },
    });
    await waitFor(() => expect(result.current.item?.item_name).toBe('Item A'));

    // The superadmin moves to B; A's save then comes back late.
    rerender({ itemId: '2' });
    await waitFor(() => expect(result.current.item?.item_name).toBe('Item B'));
    act(() => {
      result.current.applyEdit({ id: 1, item_name: 'Item A edited' } as Partial<AdminItem>, [
        { item_id: 98, store_id: 11, store_name: 'Store 11' } as never,
      ]);
    });

    expect(result.current.item).toMatchObject({ id: 2, item_name: 'Item B' });
    expect(result.current.otherStores.map(entry => entry.store_id)).toEqual([20]);
  });

  it('applies a save result to the item it belongs to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => itemResponse(1, 'Item A', 10))
    );
    const { result } = renderHook(() => useAdminItemDetail('5', '1'), { wrapper });
    await waitFor(() => expect(result.current.item?.item_name).toBe('Item A'));

    act(() => {
      result.current.applyEdit({ id: 1, item_name: 'Item A edited' } as Partial<AdminItem>, [
        { item_id: 98, store_id: 11, store_name: 'Store 11' } as never,
      ]);
    });

    expect(result.current.item?.item_name).toBe('Item A edited');
    expect(result.current.otherStores.map(entry => entry.store_id)).toEqual([11]);
  });
});
