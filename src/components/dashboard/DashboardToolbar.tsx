import type React from 'react';
import { Search, Plus, ArrowLeft, Box, Layers } from 'lucide-react';
import type { Category } from './types';

interface Props {
  viewMode: 'categories' | 'items';
  selectedCategory: Category | null;
  isOwner: boolean;
  canEditItems: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onBack: () => void;
  onAddCategory: () => void;
  onAddItem: () => void;
}

export function DashboardToolbar({
  viewMode, selectedCategory, isOwner, canEditItems, search, onSearchChange,
  onBack, onAddCategory, onAddItem,
}: Readonly<Props>) {
  return (
    <div className="p-3 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between bg-slate-50/50">
      <div className="flex items-center gap-3">
        {viewMode === 'items' && (
          <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors">
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          {viewMode === 'categories' ? (
            <><Layers size={20} className="text-slate-400" />Categories</>
          ) : (
            <><Box size={20} className="text-slate-400" />{selectedCategory?.name} Items</>
          )}
        </h2>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {viewMode === 'categories' && isOwner && (
          <>
            <button
              onClick={onAddCategory}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-900 hover:bg-navy-800 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Add Category</span>
              <span className="sm:hidden">Category</span>
            </button>
            <button
              onClick={onAddItem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-900 hover:bg-navy-800 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Add New Item</span>
              <span className="sm:hidden">Item</span>
            </button>
          </>
        )}
        {viewMode === 'items' && canEditItems && (
          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-900 hover:bg-navy-800 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">Add Item</span>
            <span className="sm:hidden">Add</span>
          </button>
        )}
        <div className="relative w-36 sm:w-48 md:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={viewMode === 'categories' ? 'Search categories...' : 'Search items...'}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
          />
        </div>
      </div>
    </div>
  );
}
