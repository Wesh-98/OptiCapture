import React from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { StoreRow } from './types';

interface Props {
  store: StoreRow;
  confirmName: string;
  deleting: boolean;
  onConfirmNameChange: (v: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function DeleteStoreModal({ store, confirmName, deleting, onConfirmNameChange, onDelete, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <Trash2 size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Delete Store</h3>
              <p className="text-sm text-slate-500">This action is permanent and cannot be undone.</p>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-sm text-red-700 space-y-1">
            <p className="font-semibold">The following will be permanently deleted:</p>
            <ul className="list-disc list-inside space-y-0.5 text-red-600 mt-1">
              <li>All inventory items ({store.item_count} items)</li>
              <li>All categories, logs, and scan sessions</li>
              <li>All user accounts ({store.user_count} users)</li>
              <li>The store record itself</li>
            </ul>
          </div>

          <p className="text-sm text-slate-600 mb-2">
            Type <span className="font-mono font-semibold text-slate-800">{store.name}</span> to confirm:
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={e => onConfirmNameChange(e.target.value)}
            placeholder={store.name}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-5"
            autoFocus
          />

          <div className="flex items-center gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              disabled={confirmName !== store.name || deleting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting
                ? <><Loader2 size={14} className="animate-spin" /> Deleting…</>
                : <><Trash2 size={14} /> Delete Store</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
