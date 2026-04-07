import {
  AlertTriangle,
  Check,
  Copy,
  FileSpreadsheet,
  Loader2,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { DEST_FIELDS } from './types';
import type { DestinationField, SheetData } from './types';

interface Props {
  fileName: string | null;
  sheets: SheetData[];
  activeSheet: SheetData;
  activeSheetIndex: number;
  isMultiSheet: boolean;
  isImporting: boolean;
  parseError: string | null;
  totalRows: number;
  mappedCount: number;
  onReset: () => void;
  onSelectSheet: (index: number) => void;
  onApplyToAllSheets: () => void;
  onMappingChange: (header: string, destination: DestinationField) => void;
  onConfirm: () => void;
}

function ErrorBanner({ message, className }: Readonly<{ message: string; className?: string }>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700',
        className
      )}
    >
      <AlertTriangle size={16} />
      {message}
    </div>
  );
}

export function ImportMappingPanel({
  fileName,
  sheets,
  activeSheet,
  activeSheetIndex,
  isMultiSheet,
  isImporting,
  parseError,
  totalRows,
  mappedCount,
  onReset,
  onSelectSheet,
  onApplyToAllSheets,
  onMappingChange,
  onConfirm,
}: Readonly<Props>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <style>{`
        @keyframes importProgress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        .animate-import-progress { animation: importProgress 1.6s ease-in-out infinite; }
      `}</style>

      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-emerald-600" />
            <span className="font-semibold text-navy-900">{fileName ?? 'Selected file'}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {isMultiSheet
              ? `${sheets.length} sheets - ${totalRows} total rows`
              : `${totalRows} rows detected`}
          </p>
        </div>
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        >
          <RefreshCw size={13} /> Change file
        </button>
      </div>

      {isMultiSheet && (
        <div className="flex items-center gap-1 overflow-x-auto px-5 pt-4 pb-0">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              onClick={() => onSelectSheet(index)}
              disabled={isImporting}
              className={cn(
                'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                activeSheetIndex === index
                  ? 'relative z-10 -mb-px border-slate-200 bg-white text-navy-900'
                  : 'border-transparent bg-slate-50 text-slate-500 hover:text-slate-700'
              )}
            >
              {sheet.name}
              <span className="ml-1.5 text-xs opacity-60">({sheet.rowCount})</span>
            </button>
          ))}
        </div>
      )}

      {parseError && <ErrorBanner message={parseError} className="mx-5 mt-4" />}

      <div className={cn('p-5', isMultiSheet && 'border-t border-slate-200')}>
        {isMultiSheet ? (
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-navy-900">
                Map columns for sheet: <span className="text-emerald-700">{activeSheet.name}</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Items will be assigned to category "{activeSheet.name}"
              </p>
            </div>
            <button
              onClick={onApplyToAllSheets}
              disabled={isImporting}
              className="flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-700 transition-colors hover:border-navy-400 hover:text-navy-900 disabled:opacity-40"
            >
              <Copy size={12} /> Apply to all sheets
            </button>
          </div>
        ) : (
          <h3 className="mb-3 text-sm font-semibold text-navy-900">
            Map your columns to OptiCapture fields
          </h3>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-1/2 px-4 py-3 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  Your Column
                </th>
                <th className="w-1/2 px-4 py-3 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  Maps to
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeSheet.headers.map(header => {
                const currentValue = activeSheet.mapping[header] ?? '__ignore__';
                const isLockedCategory = isMultiSheet && currentValue === 'category';

                return (
                  <tr key={header} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-sm text-slate-700">{header}</td>
                    <td className="px-4 py-2.5">
                      {isLockedCategory ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-sm italic text-slate-400">
                          <Lock size={13} />
                          Sheet name used as category
                        </div>
                      ) : (
                        <select
                          value={currentValue}
                          onChange={event =>
                            onMappingChange(header, event.target.value as DestinationField)
                          }
                          disabled={isImporting}
                          className={cn(
                            'w-full rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent',
                            currentValue !== '__ignore__'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-slate-300 text-slate-500'
                          )}
                        >
                          {DEST_FIELDS.filter(
                            field => !(isMultiSheet && field.value === 'category')
                          ).map(field => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {activeSheet.preview.length > 0 && (
        <div className="px-5 pb-2">
          <h3 className="mb-2 text-sm font-semibold text-navy-900">Preview (first 5 rows)</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {activeSheet.headers.map(header => (
                    <th
                      key={header}
                      className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSheet.preview.map((row, index) => (
                  <tr
                    key={
                      activeSheet.headers.map(header => String(row[header] ?? '')).join('|') + index
                    }
                    className="border-t border-slate-100"
                  >
                    {activeSheet.headers.map(header => (
                      <td
                        key={header}
                        className="max-w-[160px] truncate px-3 py-2 text-slate-600 whitespace-nowrap"
                      >
                        {String(row[header] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isImporting && (
        <div className="mx-5 mb-4 rounded-xl border border-navy-200 bg-navy-50 p-4">
          <div className="mb-3 flex items-center gap-3">
            <Loader2 size={18} className="shrink-0 animate-spin text-navy-700" />
            <div>
              <p className="text-sm font-semibold text-navy-900">
                Importing {totalRows} row{totalRows !== 1 ? 's' : ''}...
              </p>
              <p className="mt-0.5 text-xs text-navy-600">Please wait - do not close this tab</p>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-navy-200">
            <div className="animate-import-progress h-full w-1/2 rounded-full bg-navy-700" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 p-5">
        <div className="space-y-0.5 text-xs text-slate-500">
          <p>
            {mappedCount} column{mappedCount !== 1 ? 's' : ''} mapped on this sheet - {totalRows}{' '}
            total rows
          </p>
          {isMultiSheet && (
            <p className="text-slate-400">
              {sheets.map(sheet => `${sheet.name} (${sheet.rowCount})`).join(' | ')}
            </p>
          )}
        </div>
        <button
          onClick={onConfirm}
          disabled={mappedCount === 0 || isImporting}
          className="flex items-center gap-2 rounded-xl bg-navy-900 px-6 py-2.5 font-medium text-white transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isImporting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Importing...
            </>
          ) : (
            <>
              <Check size={16} /> Start Import
            </>
          )}
        </button>
      </div>
    </div>
  );
}
