// @vitest-environment jsdom
/**
 * tests/categories-table-filter.test.tsx — a filtered-out row must take its armed action
 * with it
 *
 * The open menu and the armed bulk action are held above CategoriesTable, so hiding the row
 * with a search or status filter used to leave both set: the row came back already armed,
 * one click from a bulk overwrite, without the arming step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CategoriesTable } from '../src/components/dashboard/CategoriesTable';
import type { Category } from '../src/components/dashboard/types';

const categories: Category[] = [
  { id: 1, name: 'Beverages', status: 'Active', icon: 'Package', item_count: 3, total_stock: 9 },
  { id: 2, name: 'Snacks', status: 'Inactive', icon: 'Package', item_count: 1, total_stock: 2 },
];

function renderTable(overrides: { search?: string; statusFilter?: '' | 'Active' | 'Inactive' }) {
  const setActiveActionMenu = vi.fn();
  const setPendingCategoryAction = vi.fn();
  const props = {
    categories,
    search: '',
    statusFilter: '' as const,
    isOwner: true,
    activeActionMenu: 1,
    setActiveActionMenu,
    pendingCategoryAction: { id: 1, action: 'deactivate' as const },
    setPendingCategoryAction,
    onViewItems: vi.fn(),
    onEditCategory: vi.fn(),
    onCategoryAction: vi.fn(),
    onDeleteCategory: vi.fn(),
  };
  const view = render(<CategoriesTable {...props} />);
  view.rerender(<CategoriesTable {...props} {...overrides} />);
  return { setActiveActionMenu, setPendingCategoryAction, container: view.container };
}

describe('CategoriesTable armed action and filtering', () => {
  afterEach(cleanup);

  it('closes and disarms when a search hides the armed row', () => {
    const { setActiveActionMenu, setPendingCategoryAction, container } = renderTable({
      search: 'snack',
    });

    expect(setActiveActionMenu).toHaveBeenCalledWith(null);
    expect(setPendingCategoryAction).toHaveBeenCalledWith(null);
    // No invisible click-catcher left over the page for a menu nobody can see.
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('closes and disarms when a status filter hides the armed row', () => {
    const { setActiveActionMenu, setPendingCategoryAction } = renderTable({
      statusFilter: 'Inactive',
    });

    expect(setActiveActionMenu).toHaveBeenCalledWith(null);
    expect(setPendingCategoryAction).toHaveBeenCalledWith(null);
  });

  it('leaves the armed action alone while its row is still listed', () => {
    const { setActiveActionMenu, setPendingCategoryAction, container } = renderTable({
      search: 'bev',
    });

    expect(setActiveActionMenu).not.toHaveBeenCalled();
    expect(setPendingCategoryAction).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Beverages/);
  });
});
