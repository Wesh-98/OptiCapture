import React from 'react';
import { Search, Image as ImageIcon, Loader2, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { InventoryItem } from './types';

interface Props {
  results: InventoryItem[];
  isSearching: boolean;
  globalSearch: string;
  isOwner: boolean;
  confirmDeleteItemId: number | null;
  deletingItemId: number | null;
  onEdit: (item: InventoryItem) => void;
  onConfirmDelete: (id: number | null) => void;
  onDelete: (id: number) => void;
}

export function SearchResultsTable({
  results, isSearching, globalSearch, isOwner,
  confirmDeleteItemId, deletingItemId, onEdit, onConfirmDelete, onDelete,
}: Readonly<Props>) {
  if (isSearching) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Searching...</span>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Search size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">No items match &ldquo;{globalSearch}&rdquo;</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-medium">
        {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{globalSearch}&rdquo;
      </div>
      <table className="w-full text-left">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Item</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Price</th>
            <th className="px-6 py-4 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map(item => (
            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
                    {item.image
                      ? <img src={item.image} alt={item.item_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-400"><ImageIcon size={16} /></div>}
                  </div>
                  <div>
                    <p className="font-medium text-navy-900">{item.item_name}</p>
                    <p className="text-xs text-slate-500 font-mono">{item.upc || 'No UPC'}</p>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-slate-600">{item.category_name || '—'}</td>
              <td className="px-6 py-4 text-sm font-mono font-medium text-navy-900">{item.quantity}</td>
              <td className="px-6 py-4">
                <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  item.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
                  {item.status}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">
                ${item.sale_price?.toFixed(2) || '0.00'}
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-1">
                  {isOwner && (
                    <button onClick={() => onEdit(item)}
                      className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-navy-900 transition-colors">
                      <Pencil size={15} />
                    </button>
                  )}
                  {isOwner && (confirmDeleteItemId === item.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onDelete(item.id)}
                        disabled={deletingItemId === item.id}
                        className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deletingItemId === item.id ? '…' : 'Delete'}
                      </button>
                      <button
                        onClick={() => onConfirmDelete(null)}
                        className="px-2 py-1 text-xs font-medium bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => onConfirmDelete(item.id)}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
