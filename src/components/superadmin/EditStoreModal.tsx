import React from 'react';
import { X } from 'lucide-react';
import { US_STATES } from '../../lib/constants';
import { SUPPORTED_UPLOAD_IMAGE_ACCEPT } from '../../lib/imageUpload';
import { StoreRow } from './types';

interface Props {
  store: StoreRow;
  saving: boolean;
  error: string;
  fieldErrors: Record<string, string>;
  onChange: (updated: StoreRow) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function EditStoreModal({
  store,
  saving,
  error,
  fieldErrors,
  onChange,
  onFileUpload,
  onRemoveLogo,
  onSave,
  onClose,
}: Props) {
  const field = (id: string, label: string, content: React.ReactNode, errorKey?: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      {content}
      {errorKey && fieldErrors[errorKey] && (
        <p className="text-xs text-red-500 mt-1">{fieldErrors[errorKey]}</p>
      )}
    </div>
  );

  const inputClass =
    'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh]">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-navy-900">Edit Store</h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {field(
              'sa-edit-name',
              'Store Name *',
              <input
                id="sa-edit-name"
                type="text"
                value={store.name}
                className={inputClass}
                onChange={e => onChange({ ...store, name: e.target.value })}
              />,
              'name'
            )}

            {field(
              'sa-edit-street',
              'Street Address',
              <input
                id="sa-edit-street"
                type="text"
                value={store.street || ''}
                className={inputClass}
                onChange={e => onChange({ ...store, street: e.target.value })}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              {field(
                'sa-edit-zip',
                'Zipcode',
                <input
                  id="sa-edit-zip"
                  type="text"
                  value={store.zipcode || ''}
                  className={inputClass}
                  onChange={e =>
                    onChange({
                      ...store,
                      zipcode: e.target.value.replaceAll(/[^\d-]/g, '').slice(0, 10),
                    })
                  }
                />,
                'zipcode'
              )}
              {field(
                'sa-edit-state',
                'State',
                <select
                  id="sa-edit-state"
                  value={store.state || ''}
                  className={inputClass}
                  onChange={e => onChange({ ...store, state: e.target.value })}
                >
                  <option value="">Select state</option>
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {field(
              'sa-edit-phone',
              'Phone',
              <input
                id="sa-edit-phone"
                type="tel"
                value={store.phone}
                className={inputClass}
                onChange={e =>
                  onChange({ ...store, phone: e.target.value.replaceAll(/\D/g, '').slice(0, 10) })
                }
              />,
              'phone'
            )}

            {field(
              'sa-edit-email',
              'Email',
              <input
                id="sa-edit-email"
                type="email"
                value={store.email}
                className={inputClass}
                onChange={e => onChange({ ...store, email: e.target.value })}
              />,
              'email'
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Logo</label>
              {store.logo ? (
                <div className="flex items-center gap-3">
                  <img
                    src={store.logo}
                    alt="Store logo"
                    className="w-15 h-15 rounded-lg object-cover border border-slate-200"
                  />
                  <button
                    onClick={onRemoveLogo}
                    className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept={SUPPORTED_UPLOAD_IMAGE_ACCEPT}
                  onChange={onFileUpload}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !store.name.trim()}
              className="px-4 py-2 bg-navy-900 text-white font-medium rounded-lg hover:bg-navy-800 transition-colors text-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
