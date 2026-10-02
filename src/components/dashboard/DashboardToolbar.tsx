import { Search, ArrowLeft, Box, Layers } from 'lucide-react';
import type { Category } from './types';

interface Props {
  viewMode: 'categories' | 'items';
  selectedCategory: Category | null;
  search: string;
  statusFilter: '' | 'Active' | 'Inactive';
  onSearchChange: (v: string) => void;
  onStatusFilterChange: (v: '' | 'Active' | 'Inactive') => void;
  onBack: () => void;
}

export function DashboardToolbar({
  viewMode,
  selectedCategory,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onBack,
}: Readonly<Props>) {
  return (
    <div className="p-3 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between bg-slate-50/50">
      <div className="flex items-center gap-3">
        {viewMode === 'items' && (
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          {viewMode === 'categories' ? (
            <>
              <Layers size={20} className="text-slate-400" />
              Categories
            </>
          ) : (
            <>
              <Box size={20} className="text-slate-400" />
              {selectedCategory ? `${selectedCategory.name} Items` : 'All Items'}
            </>
          )}
        </h2>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={statusFilter}
          onChange={e =>
            onStatusFilterChange(e.target.value as '' | 'Active' | 'Inactive')
          }
          aria-label={`Filter ${viewMode === 'categories' ? 'categories' : 'items'} by status`}
          className="min-w-40 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">Select Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">In-Active</option>
        </select>
        <div className="relative w-36 sm:w-48 md:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={viewMode === 'categories' ? 'Search categories...' : 'Search items...'}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
          />
        </div>
      </div>
    </div>
  );
}
