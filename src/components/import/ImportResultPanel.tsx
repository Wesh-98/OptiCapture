import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ImportResult, SheetData } from './types';

interface Props {
  fileName: string | null;
  result: ImportResult;
  sheets: SheetData[];
  prefersReducedMotion: boolean | null;
  onReset: () => void;
}

function SummaryCard({
  value,
  label,
  className,
}: Readonly<{ value: number; label: string; className: string }>) {
  return (
    <div className={cn('rounded-xl border p-4 text-center', className)}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
    </div>
  );
}

export function ImportResultPanel({
  fileName,
  result,
  sheets,
  prefersReducedMotion,
  onReset,
}: Readonly<Props>) {
  const [showSkipped, setShowSkipped] = useState(false);
  const isMultiSheet = sheets.length > 1;

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
      className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
          <Check size={24} className="text-emerald-600" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-navy-900">Import Complete</h3>
          <p className="text-sm text-slate-500">{fileName}</p>
        </div>
      </div>

      {isMultiSheet && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
            Sheets Processed
          </p>
          <div className="flex flex-wrap gap-2">
            {sheets.map(sheet => (
              <span
                key={sheet.name}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <span className="font-medium">{sheet.name}</span>
                <span className="ml-1 text-slate-400">({sheet.rowCount} rows)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <SummaryCard
          value={result.added}
          label="New Items Added"
          className="border-emerald-100 bg-emerald-50 text-emerald-700"
        />
        <SummaryCard
          value={result.updated}
          label="Items Updated"
          className="border-blue-100 bg-blue-50 text-blue-700"
        />
        <SummaryCard
          value={result.skipped}
          label="Skipped (no ID)"
          className="border-slate-200 bg-slate-50 text-slate-600"
        />
      </div>

      {result.errors.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-red-700">
            <AlertTriangle size={16} />
            {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} failed
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-red-600">
            {result.errors.map(error => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {result.skipped_rows.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50 p-4">
          <button
            onClick={() => setShowSkipped(previous => !previous)}
            className="flex w-full items-center justify-between font-medium text-amber-700"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {result.skipped_rows.length} row{result.skipped_rows.length !== 1 ? 's' : ''} skipped{' '}
              (no UPC or SKU)
            </div>
            <ChevronRight
              size={16}
              className={cn('transition-transform', showSkipped && 'rotate-90')}
            />
          </button>
          {showSkipped && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-amber-800">
              {result.skipped_rows.map(row => (
                <li key={`${row.sheet}-${row.row_num}`} className="flex gap-2">
                  <span className="shrink-0 text-amber-400">
                    {row.sheet} row {row.row_num}
                  </span>
                  <span className="truncate">{row.item_name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        onClick={onReset}
        className="flex items-center gap-2 rounded-xl bg-navy-900 px-6 py-2.5 font-medium text-white transition-colors hover:bg-navy-800"
      >
        <RefreshCw size={16} /> Import Another File
      </button>
    </motion.div>
  );
}
