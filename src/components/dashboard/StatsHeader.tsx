import React from 'react';
import { Download } from 'lucide-react';
import type { DashboardStats } from './types';

interface Props {
  stats: DashboardStats;
  isOwner: boolean;
  onExportClick: () => void;
}

export function StatsHeader({ stats, isOwner, onExportClick }: Readonly<Props>) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto flex-1">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-bold">Total Categories</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalCategories}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-bold">Total Items</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalItems}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-bold text-emerald-600">In Stock</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{stats.inStock}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-bold text-red-600">Out of Stock</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{stats.outOfStock}</p>
        </div>
      </div>
      {isOwner && (
        <button
          onClick={onExportClick}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 text-white rounded-xl text-sm font-medium hover:bg-slate-600 transition-colors shadow-md whitespace-nowrap"
        >
          <Download size={16} /> Export
        </button>
      )}
    </div>
  );
}
