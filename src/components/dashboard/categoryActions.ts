import type {
  CategoryActionKind,
  PendingCategoryAction,
} from '../../hooks/useCategoryManagement';
import type { Category } from './types';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Copy for each armed category action. Every one of these rewrites or deletes rows in bulk
 * and cannot be undone, so the confirmation has to say exactly what is about to change —
 * "Confirm Delete?" on its own never told the owner that the category's items go with it,
 * and the status actions had no confirmation at all even though they overwrite the status
 * of every item in the category.
 */
export function describeCategoryAction(
  action: CategoryActionKind,
  cat: Pick<Category, 'name' | 'item_count'>
): { title: string; detail: string; confirmLabel: string } {
  const items = plural(cat.item_count ?? 0, 'item');
  switch (action) {
    case 'deactivate':
      return {
        title: 'Set all items In-Active?',
        detail: `${items} in "${cat.name}" will be set In-Active. This overwrites each item's own status and cannot be undone.`,
        confirmLabel: 'Set all In-Active',
      };
    case 'activate':
      return {
        title: 'Set all items Active?',
        detail: `${items} in "${cat.name}" will be set Active. This overwrites each item's own status and cannot be undone.`,
        confirmLabel: 'Set all Active',
      };
    case 'deleteItems':
      return {
        title: 'Delete all items?',
        detail: `${items} in "${cat.name}" will be permanently deleted. The category itself stays.`,
        confirmLabel: 'Delete all items',
      };
    case 'deleteCategory':
      return {
        title: 'Delete category?',
        detail: `"${cat.name}" and ${items} inside it will be permanently deleted.`,
        confirmLabel: 'Delete category',
      };
  }
}

/**
 * The row-menu state machine.
 *
 * An armed action is a loaded destructive operation, so its lifetime must be exactly the
 * lifetime of the open menu. Previously the arming outlived the menu: dismissing the menu by
 * clicking the backdrop left the action armed, so reopening it presented the confirmation
 * directly and a single click ran a cascade that was supposed to take two. Confirming also
 * left it armed until the request settled, so reopening the menu offered the same confirm
 * button a second time.
 *
 * Every transition goes through this reducer so that invariant holds in one place:
 *   - any change to which menu is open disarms
 *   - confirming disarms at dispatch time, not when the response lands
 *   - cancelling disarms but leaves the menu open
 */
export interface CategoryMenuState {
  activeActionMenu: number | null;
  pendingCategoryAction: PendingCategoryAction | null;
}

export type CategoryMenuEvent =
  | { type: 'toggleMenu'; categoryId: number }
  | { type: 'closeMenu' }
  | { type: 'arm'; categoryId: number; action: CategoryActionKind }
  | { type: 'cancelArm' }
  | { type: 'confirm' };

export function categoryMenuReducer(
  state: CategoryMenuState,
  event: CategoryMenuEvent
): CategoryMenuState {
  switch (event.type) {
    case 'toggleMenu':
      return {
        activeActionMenu: state.activeActionMenu === event.categoryId ? null : event.categoryId,
        pendingCategoryAction: null,
      };
    case 'closeMenu':
      return { activeActionMenu: null, pendingCategoryAction: null };
    case 'arm':
      return {
        activeActionMenu: event.categoryId,
        pendingCategoryAction: { id: event.categoryId, action: event.action },
      };
    case 'cancelArm':
      // The menu stays open so the user lands back on the list they came from.
      return { activeActionMenu: state.activeActionMenu, pendingCategoryAction: null };
    case 'confirm':
      return { activeActionMenu: null, pendingCategoryAction: null };
  }
}

/** The action a confirm click should dispatch, or null when nothing is armed. */
export function armedActionFor(
  pending: PendingCategoryAction | null,
  categoryId: number
): CategoryActionKind | null {
  return pending?.id === categoryId ? pending.action : null;
}
