import type { ChangeEventHandler } from 'react';
import { AlertTriangle, Loader2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DEST_FIELDS } from './types';

const ACCEPTED_FIELDS = DEST_FIELDS.filter(
  field => field.value !== '__ignore__' && field.value !== 'category'
);

interface Props {
  isParsing: boolean;
  parseError: string | null;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
}

export function ImportUploadPanel({ isParsing, parseError, onFileChange }: Readonly<Props>) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <label
        className={cn(
          'flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors',
          isParsing
            ? 'cursor-not-allowed border-slate-200 bg-slate-50'
            : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
        )}
      >
        <div className="flex flex-col items-center justify-center px-6 pt-5 pb-6 text-center">
          {isParsing ? (
            <>
              <Loader2 className="mb-4 h-12 w-12 animate-spin text-navy-700" />
              <p className="text-sm font-medium text-slate-500">Parsing file...</p>
            </>
          ) : (
            <>
              <Upload className="mb-4 h-12 w-12 text-slate-400" />
              <p className="mb-2 text-sm text-slate-500">
                <span className="font-semibold text-navy-900">Click to upload</span> or drag and
                drop
              </p>
              <p className="text-xs text-slate-400">Excel (.xlsx, .xls), CSV, or JSON - max 20MB</p>
              <p className="mt-1 text-xs text-slate-400">
                Multi-sheet Excel supported - each sheet = one category
              </p>
            </>
          )}
        </div>
        <input
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.xls,.json"
          onChange={onFileChange}
          disabled={isParsing}
        />
      </label>

      {parseError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {parseError}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="mb-2 font-bold">Accepted columns (any order, auto-detected):</p>
        <div className="grid grid-cols-2 gap-1 font-mono text-xs opacity-80 md:grid-cols-3">
          {ACCEPTED_FIELDS.map(field => (
            <span key={field.value}>{field.label.split(' (')[0]}</span>
          ))}
        </div>
        <p className="mt-2 opacity-70">
          At least UPC or SKU required per row. Multi-sheet: sheet name used as category.
        </p>
      </div>
    </div>
  );
}
