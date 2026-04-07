import type { ChangeEvent, FormEvent } from 'react';
import { AlertTriangle, CheckCircle, EyeOff, Loader2, Store, Upload } from 'lucide-react';
import { US_STATES } from '../../lib/constants';
import { SUPPORTED_UPLOAD_IMAGE_ACCEPT } from '../../lib/imageUpload';
import type { StoreInfo, StoreInfoField } from './types';

interface StoreInfoCardProps {
  infoErrors: Record<string, string>;
  isTaker: boolean;
  storeError: string;
  storeInfo: StoreInfo;
  storeSaving: boolean;
  storeSuccess: string;
  onFieldChange: (field: StoreInfoField, value: string) => void;
  onLogoFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onZipcodeChange: (value: string) => void;
}

const textFields: ReadonlyArray<{
  field: 'name' | 'street' | 'phone' | 'email';
  label: string;
  placeholder?: string;
  type: string;
}> = [
  { field: 'name', label: 'Store Name', type: 'text' },
  { field: 'street', label: 'Street Address', type: 'text', placeholder: '123 Main St' },
  { field: 'phone', label: 'Phone', type: 'tel' },
  { field: 'email', label: 'Email', type: 'email' },
];

export function StoreInfoCard({
  infoErrors,
  isTaker,
  storeError,
  storeInfo,
  storeSaving,
  storeSuccess,
  onFieldChange,
  onLogoFileChange,
  onRemoveLogo,
  onSubmit,
  onZipcodeChange,
}: StoreInfoCardProps) {
  const inputClass = (disabled: boolean): string =>
    `w-full px-3 py-2 border rounded-lg text-sm ${
      disabled
        ? 'bg-slate-50 border-slate-200 text-slate-600 cursor-default'
        : 'border-slate-300 focus:ring-2 focus:ring-navy-700 focus:border-transparent'
    }`;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-navy-50 flex items-center justify-center">
          <Store size={18} className="text-navy-700" />
        </div>
        <div>
          <h2 className="text-base font-bold text-navy-900">Store Information</h2>
          <p className="text-xs text-slate-500">
            {isTaker
              ? 'View-only, contact the store owner to make changes'
              : 'Update your store name, address and contact details'}
          </p>
        </div>
      </div>

      {isTaker && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500">
          <EyeOff size={15} className="shrink-0" />
          You have view-only access to store information. Only the store owner can make changes.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Store Logo</label>
          {storeInfo.logo ? (
            <div className="flex flex-col items-start gap-2">
              <img
                src={storeInfo.logo}
                alt="Store logo"
                className="w-24 h-24 rounded-xl border border-slate-200 object-contain"
              />
              {!isTaker && (
                <button
                  type="button"
                  onClick={onRemoveLogo}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          ) : isTaker ? (
            <div className="w-24 h-24 border border-slate-200 rounded-xl flex items-center justify-center text-slate-300 bg-slate-50">
              <Store size={24} />
            </div>
          ) : (
            <label className="relative w-24 h-24 block">
              <input
                type="file"
                accept={SUPPORTED_UPLOAD_IMAGE_ACCEPT}
                onChange={onLogoFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-slate-400 cursor-pointer gap-1">
                <Upload size={18} />
                <span className="text-xs">Upload Logo</span>
              </div>
            </label>
          )}
        </div>

        {textFields.map(({ field, label, placeholder, type }) => (
          <div key={field}>
            <label
              htmlFor={`ss-${field}`}
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {label}
            </label>
            <input
              id={`ss-${field}`}
              type={type}
              value={storeInfo[field]}
              readOnly={isTaker}
              onChange={isTaker ? undefined : event => onFieldChange(field, event.target.value)}
              placeholder={placeholder}
              className={inputClass(isTaker)}
            />
            {!isTaker && infoErrors[field] && (
              <p className="text-xs text-red-500 mt-1">{infoErrors[field]}</p>
            )}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ss-zipcode" className="block text-sm font-medium text-slate-700 mb-1">
              Zipcode
            </label>
            <input
              id="ss-zipcode"
              type="text"
              value={storeInfo.zipcode}
              readOnly={isTaker}
              onChange={isTaker ? undefined : event => onZipcodeChange(event.target.value)}
              maxLength={10}
              placeholder="10001"
              className={inputClass(isTaker)}
            />
            {!isTaker && infoErrors.zipcode && (
              <p className="text-xs text-red-500 mt-1">{infoErrors.zipcode}</p>
            )}
          </div>

          <div>
            <label htmlFor="ss-state" className="block text-sm font-medium text-slate-700 mb-1">
              State
            </label>
            <select
              id="ss-state"
              value={storeInfo.state}
              disabled={isTaker}
              onChange={isTaker ? undefined : event => onFieldChange('state', event.target.value)}
              className={`${inputClass(isTaker)} bg-white`}
            >
              <option value="">- Select State -</option>
              {US_STATES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!isTaker && storeSuccess && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium">
            <CheckCircle size={16} className="shrink-0" />
            {storeSuccess}
          </div>
        )}

        {storeError && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0" />
            {storeError}
          </div>
        )}

        {!isTaker && (
          <button
            type="submit"
            disabled={storeSaving}
            className="flex items-center gap-2 px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {storeSaving && <Loader2 className="animate-spin" size={16} />}
            Save Changes
          </button>
        )}
      </form>
    </div>
  );
}
