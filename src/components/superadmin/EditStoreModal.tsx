import React from 'react';
import { Building2, ImagePlus, Store, Upload, X } from 'lucide-react';
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
  const logoLabelClass = 'flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1';

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div>
                <label
                  htmlFor="sa-edit-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Store size={14} className="text-slate-400" />
                    Store Name *
                  </span>
                </label>
                <input
                  id="sa-edit-name"
                  type="text"
                  value={store.name}
                  className={inputClass}
                  onChange={e => onChange({ ...store, name: e.target.value })}
                />
                {fieldErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <label className={logoLabelClass}>
                  <ImagePlus size={14} className="text-slate-400" />
                  Logo
                </label>
                {store.logo ? (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <img
                      src={store.logo}
                      alt="Store logo"
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-white"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">Store logo uploaded</p>
                      <button
                        type="button"
                        onClick={onRemoveLogo}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <X size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition-colors hover:border-slate-400 hover:bg-slate-100">
                    <Upload size={18} className="text-slate-400" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-slate-700">Upload store logo</p>
                      <p className="text-xs text-slate-500">PNG, JPG, WebP, or GIF</p>
                    </div>
                    <input
                      type="file"
                      accept={SUPPORTED_UPLOAD_IMAGE_ACCEPT}
                      onChange={onFileUpload}
                      className="sr-only"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {field(
                'sa-edit-street',
                'Street Address',
                <input
                  id="sa-edit-street"
                  type="text"
                  value={store.street || ''}
                  className={inputClass}
                  onChange={e => onChange({ ...store, street: e.target.value })}
                />,
                'street'
              )}
              <div>
                <label
                  htmlFor="sa-edit-city"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={14} className="text-slate-400" />
                    City/Town
                  </span>
                </label>
                <input
                  id="sa-edit-city"
                  type="text"
                  value={store.city || ''}
                  className={inputClass}
                  onChange={e => onChange({ ...store, city: e.target.value })}
                  placeholder="City/Town"
                />
                {fieldErrors.city && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.city}</p>
                )}
              </div>
            </div>

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
