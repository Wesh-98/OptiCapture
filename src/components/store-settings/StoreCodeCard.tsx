import { Check, Copy, Eye, EyeOff, Hash } from 'lucide-react';

interface StoreCodeCardProps {
  codeCopied: boolean;
  showCode: boolean;
  storeCode: string;
  onCopy: () => void;
  onToggleVisibility: () => void;
}

export function StoreCodeCard({
  codeCopied,
  showCode,
  storeCode,
  onCopy,
  onToggleVisibility,
}: StoreCodeCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-navy-50 flex items-center justify-center">
          <Hash size={18} className="text-navy-700" />
        </div>
        <div>
          <h2 className="text-base font-bold text-navy-900">Store Code</h2>
          <p className="text-xs text-slate-500">
            Share this code with staff so they can log in to your store
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
          <span
            className="text-2xl font-mono font-bold tracking-[0.25em] text-navy-900 transition-all duration-300 select-none"
            style={{ filter: showCode ? 'none' : 'blur(8px)' }}
          >
            {storeCode}
          </span>
          <button
            type="button"
            onClick={onToggleVisibility}
            className="flex items-center gap-1.5 ml-3 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-600 transition-colors whitespace-nowrap"
          >
            {showCode ? (
              <>
                <EyeOff size={13} /> Hide
              </>
            ) : (
              <>
                <Eye size={13} /> View Code
              </>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium text-slate-700 transition-colors whitespace-nowrap"
        >
          {codeCopied ? (
            <>
              <Check size={15} className="text-emerald-600" /> Copied!
            </>
          ) : (
            <>
              <Copy size={15} /> Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}
