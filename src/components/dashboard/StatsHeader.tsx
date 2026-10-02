import type { DashboardStats } from './types';

interface Props {
  stats: DashboardStats;
  showTotalCategories?: boolean;
}

export function StatsHeader({ stats, showTotalCategories = true }: Readonly<Props>) {
  const cardClass =
    'flex min-h-24 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm';

  return (
    <div
      className={`grid w-full gap-3 ${showTotalCategories ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}
    >
      {showTotalCategories && (
        <div className={cardClass}>
          <p className="text-xs text-slate-500 uppercase font-bold">Total Categories</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalCategories}</p>
        </div>
      )}
      <div className={cardClass}>
        <p className="text-xs text-slate-500 uppercase font-bold">Total Items</p>
        <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalItems}</p>
      </div>
      <div className={cardClass}>
        <p className="text-xs text-slate-500 uppercase font-bold text-emerald-600">In Stock</p>
        <p className="text-2xl font-bold text-emerald-700 mt-1">{stats.inStock}</p>
      </div>
      <div className={cardClass}>
        <p className="text-xs text-slate-500 uppercase font-bold text-red-600">Out of Stock</p>
        <p className="text-2xl font-bold text-red-700 mt-1">{stats.outOfStock}</p>
      </div>
    </div>
  );
}
