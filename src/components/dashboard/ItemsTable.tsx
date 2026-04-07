import { Image as ImageIcon, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { InventoryItem } from './types';

interface Props {
  items: InventoryItem[];
  search: string;
  canEditItems: boolean;
  pageSize: 50 | 100 | 200;
  currentPage: number;
  confirmDeleteItemId: number | null;
  deletingItemId: number | null;
  onPageSizeChange: (size: 50 | 100 | 200) => void;
  onPageChange: (page: number) => void;
  onConfirmDelete: (id: number | null) => void;
  onDelete: (id: number) => void;
  onEdit: (item: InventoryItem) => void;
}

export function ItemsTable({
  items, search, canEditItems, pageSize, currentPage,
  confirmDeleteItemId, deletingItemId,
  onPageSizeChange, onPageChange, onConfirmDelete, onDelete, onEdit,
}: Readonly<Props>) {
  const filteredItems = items.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 w-10">
                <input type="checkbox" className="rounded border-slate-300 text-navy-900 focus:ring-navy-700" />
              </th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Item</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Price</th>
              <th className="px-6 py-4 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagedItems.map(item => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <input type="checkbox" className="rounded border-slate-300 text-navy-900 focus:ring-navy-700" />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
                      {item.image ? (
                        <img src={item.image} alt={item.item_name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <ImageIcon size={16} />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-navy-900">{item.item_name}</p>
                      <p className="text-xs text-slate-500">{item.upc || 'No UPC'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{item.unit || '-'}</td>
                <td className="px-6 py-4 text-sm font-mono font-medium text-navy-900">{item.quantity}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{item.category_name}</td>
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
                  {canEditItems && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => onEdit(item)}
                        className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-navy-900 transition-colors">
                        <Pencil size={15} />
                      </button>
                      {confirmDeleteItemId === item.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => onDelete(item.id)} disabled={deletingItemId === item.id}
                            className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                            {deletingItemId === item.id ? '…' : 'Delete'}
                          </button>
                          <button onClick={() => onConfirmDelete(null)}
                            className="px-2 py-1 text-xs font-medium bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => onConfirmDelete(item.id)}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-slate-500">
          {filteredItems.length === 0 ? 'No items' : (
            <>Showing <span className="font-semibold text-slate-700">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)}</span> of <span className="font-semibold text-slate-700">{filteredItems.length}</span> items</>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
            {([50, 100, 200] as const).map(size => (
              <button key={size} onClick={() => onPageSizeChange(size)}
                className={cn('px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                  pageSize === size ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-navy-900 hover:bg-slate-100')}>
                {size}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
              className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-xs font-semibold text-navy-900 min-w-[5rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <button onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
