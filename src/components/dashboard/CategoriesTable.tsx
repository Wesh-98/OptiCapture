import React from 'react';
import { Package, MoreHorizontal, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Category } from './types';
import { iconMap, colorMap } from './types';

interface Props {
  categories: Category[];
  search: string;
  isOwner: boolean;
  activeActionMenu: number | null;
  setActiveActionMenu: (id: number | null) => void;
  deletingCategoryId: number | null;
  setDeletingCategoryId: (id: number | null) => void;
  onViewItems: (cat: Category) => void;
  onEditCategory: (cat: Category) => void;
  onCategoryAction: (id: number, action: 'activate' | 'deactivate' | 'deleteItems') => void;
  onDeleteCategory: (id: number) => void;
}

export function CategoriesTable({
  categories, search, isOwner, activeActionMenu, setActiveActionMenu,
  deletingCategoryId, setDeletingCategoryId,
  onViewItems, onEditCategory, onCategoryAction, onDeleteCategory,
}: Readonly<Props>) {
  const filtered = categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="overflow-x-auto">
      {activeActionMenu !== null && (
        <div role="presentation" aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setActiveActionMenu(null)} />
      )}
      <table className="w-full text-left">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Count</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.map((cat, idx, arr) => {
            const isImageIcon = cat.icon?.startsWith('/') || cat.icon?.startsWith('http');
            const CategoryIcon = !isImageIcon ? (iconMap[cat.icon] ?? Package) : Package;
            const isInactive = cat.status !== 'Active';
            const dropUp = idx >= arr.length - 2;
            return (
              <tr key={cat.id} className={cn('transition-colors group', isInactive ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50')}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const color = isInactive
                        ? { bg: 'bg-red-50', icon: 'text-red-400' }
                        : (colorMap[cat.icon] ?? { bg: 'bg-slate-100', icon: 'text-slate-500' });
                      return (
                        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden', color.bg, !isImageIcon && color.icon)}>
                          {isImageIcon
                            ? <img src={cat.icon} alt={cat.name} className={cn('w-6 h-6 object-contain', isInactive && 'opacity-40')} />
                            : <CategoryIcon size={20} />
                          }
                        </div>
                      );
                    })()}
                    <span className="font-semibold text-slate-900">{cat.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    cat.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700')}>
                    {cat.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 font-mono">{cat.total_stock || 0}</td>
                <td className="px-6 py-4 text-right relative">
                  <button
                    onClick={() => setActiveActionMenu(activeActionMenu === cat.id ? null : cat.id)}
                    className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-navy-900 transition-colors"
                  >
                    <MoreHorizontal size={20} />
                  </button>

                  {activeActionMenu === cat.id && (
                    <div className={cn('absolute right-0 w-52 bg-white rounded-lg shadow-xl border border-slate-100 z-20 py-1 text-left', dropUp ? 'bottom-full mb-1' : 'top-full mt-1')}>
                      <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        onClick={() => { onViewItems(cat); setActiveActionMenu(null); }}>
                        <Eye size={14} /> View Items
                      </button>

                      {isOwner && (
                        <>
                          <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={() => { onEditCategory(cat); setActiveActionMenu(null); }}>
                            <Pencil size={14} /> Edit Category
                          </button>

                          <div className="border-t border-slate-100 my-1" />

                          <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={() => onCategoryAction(cat.id, cat.status === 'Active' ? 'deactivate' : 'activate')}>
                            {cat.status === 'Active' ? <><EyeOff size={14} /> Set All Inactive</> : <><Eye size={14} /> Set All Active</>}
                          </button>

                          <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            onClick={() => onCategoryAction(cat.id, 'deleteItems')}>
                            <Trash2 size={14} /> Delete All Items
                          </button>

                          <div className="border-t border-slate-100 my-1" />

                          {deletingCategoryId === cat.id ? (
                            <button className="w-full text-left px-4 py-2 text-sm text-red-600 font-semibold hover:bg-red-50 flex items-center gap-2"
                              onClick={() => onDeleteCategory(cat.id)}>
                              <Trash2 size={14} /> Confirm Delete?
                            </button>
                          ) : (
                            <button className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
                              onClick={() => setDeletingCategoryId(cat.id)}>
                              <Trash2 size={14} /> Delete Category
                            </button>
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
