import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertTriangle, Image as ImageIcon, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SessionItem, Category } from './types';

interface Props {
  show: boolean;
  items: SessionItem[];
  selectedIds: Set<number>;
  categories: Category[];
  categoriesLoading: boolean;
  itemCategories: Map<number, number>;
  modalSelectedIds: Set<number>;
  bulkCategoryId: number | null;
  prefersReducedMotion: boolean | null;
  onClose: () => void;
  onConfirmCommit: () => void;
  onSetItemCategory: (itemId: number, catId: number | undefined) => void;
  onSetModalSelectedIds: (ids: Set<number>) => void;
  onSetBulkCategoryId: (id: number | null) => void;
  onApplyBulk: () => void;
}

export function CommitModal({
  show, items, selectedIds, categories, categoriesLoading, itemCategories,
  modalSelectedIds, bulkCategoryId, prefersReducedMotion,
  onClose, onConfirmCommit, onSetItemCategory, onSetModalSelectedIds,
  onSetBulkCategoryId, onApplyBulk,
}: Readonly<Props>) {
  const commitItems = items.filter(i => selectedIds.has(i.id));
  const assignedCount = commitItems.filter(i => itemCategories.has(i.id)).length;
  const unassigned = commitItems.filter(i => !itemCategories.has(i.id));
  const modalAllSelected = commitItems.length > 0 && commitItems.every(i => modalSelectedIds.has(i.id));

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={prefersReducedMotion ? {} : { opacity: 1 }}
          exit={prefersReducedMotion ? {} : { opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]"
            initial={prefersReducedMotion ? false : { scale: 0.95, opacity: 0 }}
            animate={prefersReducedMotion ? {} : { scale: 1, opacity: 1 }}
            exit={prefersReducedMotion ? {} : { scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-navy-900">Commit to Inventory</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {commitItems.length} item{commitItems.length !== 1 ? 's' : ''} selected — assign a category to each
                  </p>
                </div>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                  <X size={18} />
                </button>
              </div>

              {/* Bulk assign row */}
              <div className="flex items-center gap-2 mt-3">
                <select
                  value={bulkCategoryId ?? ''}
                  onChange={e => onSetBulkCategoryId(Number(e.target.value) || null)}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-700"
                >
                  <option value="">— Apply category to {modalSelectedIds.size > 0 ? `${modalSelectedIds.size} checked` : 'all'} —</option>
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
                <button
                  onClick={onApplyBulk}
                  disabled={!bulkCategoryId}
                  className="px-3 py-1.5 bg-navy-900 text-white rounded-lg text-sm font-medium hover:bg-navy-800 disabled:opacity-40 transition-colors shrink-0"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Item list */}
            <div className="overflow-y-auto flex-1">
              {categoriesLoading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-8">
                  <Loader2 size={16} className="animate-spin" /> Loading categories...
                </div>
              ) : (
                <>
                  {/* Select-all row */}
                  <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-3 text-xs text-slate-500 bg-slate-50">
                    <input
                      type="checkbox"
                      checked={modalAllSelected}
                      onChange={() => onSetModalSelectedIds(modalAllSelected ? new Set() : new Set(commitItems.map(i => i.id)))}
                      className="rounded"
                    />
                    <span>{modalAllSelected ? 'Deselect all' : 'Select all for bulk apply'}</span>
                  </div>

                  {commitItems.map(item => {
                    const catId = itemCategories.get(item.id);
                    const checked = modalSelectedIds.has(item.id);
                    const displayUnit = item.unit?.trim() ?? '';
                    return (
                      <div key={item.id} className={cn('flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50', checked && 'bg-blue-50/40')}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(modalSelectedIds);
                            checked ? next.delete(item.id) : next.add(item.id);
                            onSetModalSelectedIds(next);
                          }}
                          className="rounded shrink-0"
                        />
                        {item.image
                          ? <img src={item.image} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-slate-100" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0 flex items-center justify-center"><ImageIcon size={14} className="text-slate-300" /></div>
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                            <p className="text-sm font-medium text-slate-800">
                              {item.product_name || 'No product name'}
                            </p>
                            {displayUnit && (
                              <span className="text-sm font-medium text-slate-500">{displayUnit}</span>
                            )}
                          </div>
                          <p className="mt-0.5 break-all text-xs font-medium text-slate-500">
                            UPC {item.upc}
                          </p>
                          <p className="text-xs text-slate-400">×{item.quantity}{item.unit ? ` ${item.unit}` : ''}</p>
                        </div>
                        <select
                          value={catId ?? ''}
                          onChange={e => {
                            const val = Number(e.target.value) || undefined;
                            onSetItemCategory(item.id, val);
                          }}
                          className={cn(
                            'text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-navy-700 bg-white shrink-0 max-w-[140px]',
                            catId ? 'border-slate-300 text-slate-700' : 'border-amber-300 text-amber-600'
                          )}
                        >
                          <option value="">— Pick —</option>
                          {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
              {unassigned.length > 0 && (
                <span className="flex-1 text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {unassigned.length} item{unassigned.length !== 1 ? 's' : ''} need a category
                </span>
              )}
              {unassigned.length === 0 && <span className="flex-1 text-xs text-emerald-600">All items have a category ✓</span>}
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={onConfirmCommit}
                disabled={assignedCount === 0 || categoriesLoading}
                className="px-4 py-2 rounded-lg bg-navy-900 text-white text-sm font-medium hover:bg-navy-800 transition-colors disabled:opacity-50"
              >
                Commit {assignedCount > 0 ? `(${assignedCount})` : ''}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
