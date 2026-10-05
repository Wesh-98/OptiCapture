import { useEffect } from 'react';
import { Package, MoreHorizontal, Eye, EyeOff, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Category } from './types';
import { iconMap, colorMap } from './types';
import type { PendingCategoryAction } from '../../hooks/useCategoryManagement';
import {
  armedActionFor,
  categoryMenuReducer,
  describeCategoryAction,
  type CategoryMenuEvent,
} from './categoryActions';

interface Props {
  categories: Category[];
  search: string;
  statusFilter: '' | 'Active' | 'Inactive';
  isOwner: boolean;
  activeActionMenu: number | null;
  setActiveActionMenu: (id: number | null) => void;
  pendingCategoryAction: PendingCategoryAction | null;
  setPendingCategoryAction: (pending: PendingCategoryAction | null) => void;
  onViewItems: (cat: Category) => void;
  onEditCategory: (cat: Category) => void;
  onCategoryAction: (id: number, action: 'activate' | 'deactivate' | 'deleteItems') => void;
  onDeleteCategory: (id: number) => void;
}

export function CategoriesTable({
  categories,
  search,
  statusFilter,
  isOwner,
  activeActionMenu,
  setActiveActionMenu,
  pendingCategoryAction,
  setPendingCategoryAction,
  onViewItems,
  onEditCategory,
  onCategoryAction,
  onDeleteCategory,
}: Readonly<Props>) {
  // Both halves of the menu state live in different owners (the page holds which menu is
  // open, the hook holds what is armed), so apply the reducer's result to both setters.
  const dispatchMenuEvent = (event: CategoryMenuEvent) => {
    const next = categoryMenuReducer({ activeActionMenu, pendingCategoryAction }, event);
    setActiveActionMenu(next.activeActionMenu);
    setPendingCategoryAction(next.pendingCategoryAction);
  };

  const filtered = categories.filter(
    c =>
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (!statusFilter || c.status === statusFilter)
  );

  // A row that leaves the list (a search, a status filter, a refetch) takes its menu with it,
  // but the open-menu and armed state live above this table and would outlive it: the page
  // would keep an invisible click-catcher, and the row would come back already armed,
  // skipping the arming step. Close and disarm as soon as the row is gone.
  const openRowGone =
    activeActionMenu !== null && !filtered.some(c => c.id === activeActionMenu);
  useEffect(() => {
    if (!openRowGone) return;
    setActiveActionMenu(null);
    setPendingCategoryAction(null);
  }, [openRowGone, setActiveActionMenu, setPendingCategoryAction]);

  return (
    <div className="overflow-x-auto">
      {activeActionMenu !== null && !openRowGone && (
        <div
          role="presentation"
          aria-hidden="true"
          className="fixed inset-0 z-10"
          onClick={() => dispatchMenuEvent({ type: 'closeMenu' })}
        />
      )}
      <table className="w-full min-w-[640px] table-fixed text-left">
        <thead className="bg-theme-canvas border-b border-slate-200">
          <tr>
            <th className="px-6 py-4 text-xs font-semibold text-slate-900 uppercase tracking-wider w-[40%]">
              Category
            </th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-900 uppercase tracking-wider text-center w-[20%]">
              Status
            </th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-900 uppercase tracking-wider text-center w-[20%]">
              Stock Count
            </th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-900 uppercase tracking-wider text-center w-[20%]">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.map((cat, idx, arr) => {
            const isImageIcon = cat.icon?.startsWith('/') || cat.icon?.startsWith('http');
            const CategoryIcon = !isImageIcon ? (iconMap[cat.icon] ?? Package) : Package;
            const isInactive = cat.status !== 'Active';
            const dropUp = idx >= arr.length - 2;
            const armedAction = armedActionFor(pendingCategoryAction, cat.id);
            const armedCopy = armedAction ? describeCategoryAction(armedAction, cat) : null;
            return (
              <tr
                key={cat.id}
                className={cn(
                  'transition-colors group',
                  isInactive ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50'
                )}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const color = isInactive
                        ? { bg: 'bg-red-50', icon: 'text-red-400' }
                        : (colorMap[cat.icon] ?? { bg: 'bg-slate-100', icon: 'text-slate-500' });
                      return (
                        <div
                          className={cn(
                            'w-10 h-10 shrink-0 rounded-lg flex items-center justify-center overflow-hidden',
                            color.bg,
                            !isImageIcon && color.icon
                          )}
                        >
                          {isImageIcon ? (
                            <img
                              src={cat.icon}
                              alt={cat.name}
                              className={cn('w-6 h-6 object-contain', isInactive && 'opacity-40')}
                            />
                          ) : (
                            <CategoryIcon size={20} />
                          )}
                        </div>
                      );
                    })()}
                    <span className="font-semibold text-slate-900 truncate">{cat.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border bg-white px-2.5 py-1 text-xs font-medium',
                      cat.status === 'Active'
                        ? 'border-emerald-600 text-emerald-700'
                        : 'border-red-600 text-red-600'
                    )}
                  >
                    {cat.status === 'Active' ? 'Active' : 'In-Active'}
                  </span>
                </td>
                <td className="px-6 py-4 text-center text-sm text-slate-600 font-mono">
                  {cat.total_stock || 0}
                </td>
                <td className="px-6 py-4 text-center relative">
                  <div className="inline-flex items-center justify-center gap-1">
                    <button
                      onClick={() => onViewItems(cat)}
                      className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-navy-900 transition-colors"
                      title={`View ${cat.name} items`}
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      onClick={() =>
                        dispatchMenuEvent({ type: 'toggleMenu', categoryId: cat.id })
                      }
                      className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-navy-900 transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>

                  {activeActionMenu === cat.id && (
                    <div
                      className={cn(
                        'absolute left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-xl border border-slate-100 z-20 py-1 text-left',
                        armedAction ? 'w-72' : 'w-52',
                        dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
                      )}
                    >
                      {armedCopy ? (
                        <div className="px-4 py-3">
                          <p className="flex items-start gap-2 text-sm font-semibold text-slate-900">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
                            {armedCopy.title}
                          </p>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                            {armedCopy.detail}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                              onClick={() => {
                                // Disarm and close first: the confirmation for an action
                                // already on its way must not be presentable again.
                                dispatchMenuEvent({ type: 'confirm' });
                                if (armedAction === 'deleteCategory') {
                                  onDeleteCategory(cat.id);
                                } else if (armedAction) {
                                  onCategoryAction(cat.id, armedAction);
                                }
                              }}
                            >
                              {armedCopy.confirmLabel}
                            </button>
                            <button
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                              onClick={() => dispatchMenuEvent({ type: 'cancelArm' })}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={() => {
                              onViewItems(cat);
                              dispatchMenuEvent({ type: 'closeMenu' });
                            }}
                          >
                            <Eye size={14} /> View Items
                          </button>

                          {isOwner && (
                            <>
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() => {
                                  onEditCategory(cat);
                                  dispatchMenuEvent({ type: 'closeMenu' });
                                }}
                              >
                                <Pencil size={14} /> Edit Category
                              </button>

                              <div className="border-t border-slate-100 my-1" />

                              <button
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() =>
                                  dispatchMenuEvent({
                                    type: 'arm',
                                    categoryId: cat.id,
                                    action: cat.status === 'Active' ? 'deactivate' : 'activate',
                                  })
                                }
                              >
                                {cat.status === 'Active' ? (
                                  <>
                                    <EyeOff size={14} /> Set All In-Active
                                  </>
                                ) : (
                                  <>
                                    <Eye size={14} /> Set All Active
                                  </>
                                )}
                              </button>

                              <button
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                onClick={() =>
                                  dispatchMenuEvent({
                                    type: 'arm',
                                    categoryId: cat.id,
                                    action: 'deleteItems',
                                  })
                                }
                              >
                                <Trash2 size={14} /> Delete All Items
                              </button>

                              <div className="border-t border-slate-100 my-1" />

                              <button
                                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
                                onClick={() =>
                                  dispatchMenuEvent({
                                    type: 'arm',
                                    categoryId: cat.id,
                                    action: 'deleteCategory',
                                  })
                                }
                              >
                                <Trash2 size={14} /> Delete Category
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
