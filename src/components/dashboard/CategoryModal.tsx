import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Category } from './types';
import { IMAGE_ICONS, LUCIDE_ICON_PICKS, iconMap, colorMap } from './types';

interface Props {
  isOpen: boolean;
  editingCategory: Category | null;
  catForm: { name: string; icon: string };
  catError: string;
  catSaving: boolean;
  onChange: (form: { name: string; icon: string }) => void;
  onSave: () => void;
  onClose: () => void;
}

export function CategoryModal({ isOpen, editingCategory, catForm, catError, catSaving, onChange, onSave, onClose }: Readonly<Props>) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{editingCategory ? 'Edit Category' : 'Add Category'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="dash-cat-name" className="block text-sm font-medium text-slate-700 mb-1.5">Category Name</label>
            <input
              id="dash-cat-name"
              type="text"
              value={catForm.name}
              onChange={e => onChange({ ...catForm, name: e.target.value })}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent"
              placeholder="e.g. Beverages"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Icon</label>
            <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">Image Icons</p>
            <div className="grid grid-cols-6 gap-1.5 max-h-36 overflow-y-auto p-1">
              {IMAGE_ICONS.map(icon => (
                <button key={icon.src} type="button" title={icon.label}
                  onClick={() => onChange({ ...catForm, icon: icon.src })}
                  className={cn('w-full aspect-square rounded-lg p-1.5 border-2 transition-all flex items-center justify-center',
                    catForm.icon === icon.src ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:border-slate-200 hover:bg-slate-50')}>
                  <img src={icon.src} alt={icon.label} className="w-7 h-7 object-contain" />
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-400 mt-3 mb-2 font-medium uppercase tracking-wide">Generic Icons</p>
            <div className="grid grid-cols-6 gap-1.5 max-h-28 overflow-y-auto p-1">
              {LUCIDE_ICON_PICKS.map(iconName => {
                const IconComp = iconMap[iconName];
                if (!IconComp) return null;
                const col = colorMap[iconName] ?? { bg: 'bg-slate-100', icon: 'text-slate-500' };
                return (
                  <button key={iconName} type="button" title={iconName}
                    onClick={() => onChange({ ...catForm, icon: iconName })}
                    className={cn('w-full aspect-square rounded-lg flex items-center justify-center border-2 transition-all', col.bg,
                      catForm.icon === iconName ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-slate-300')}>
                    <IconComp size={18} className={col.icon} />
                  </button>
                );
              })}
            </div>
          </div>

          {catError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{catError}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button onClick={onSave} disabled={catSaving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-colors bg-navy-900">
            {catSaving ? 'Saving...' : editingCategory ? 'Save Changes' : 'Add Category'}
          </button>
        </div>
      </div>
    </div>
  );
}
