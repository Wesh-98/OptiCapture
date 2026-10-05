import type { CategoryActionKind } from '../../hooks/useCategoryManagement';
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
