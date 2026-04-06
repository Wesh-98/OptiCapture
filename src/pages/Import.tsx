import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Upload, FileSpreadsheet, ChevronRight, Check, AlertTriangle, RefreshCw, Loader2, Lock, Copy } from 'lucide-react';
import { cn } from '../lib/utils';

// OptiCapture destination fields and their display labels
const DEST_FIELDS: { value: string; label: string }[] = [
  { value: '__ignore__',  label: '— ignore —' },
  { value: 'item_name',   label: 'Item Name' },
  { value: 'quantity',    label: 'Stock Quantity (# units in stock)' },
  { value: 'upc',         label: 'UPC / Barcode' },
  { value: 'number',      label: 'SKU / Item Number' },
  { value: 'sale_price',  label: 'Sale Price ($)' },
  { value: 'unit',        label: 'Unit of Measure (e.g. 3oz, 1ct, 1L)' },
  { value: 'category',    label: 'Category (locked in multi-sheet mode)' },
  { value: 'status',      label: 'Status' },
  { value: 'tax_percent', label: 'Tax (%)' },
  { value: 'tag_names',   label: 'Tags' },
  { value: 'description', label: 'Description' },
  { value: 'image',       label: 'Image URL (https:// or Google Drive link)' },
];

const SYNONYMS: Record<string, string[]> = {
  item_name:   ['item description', 'product name', 'name', 'title', 'item name', 'description'],
  quantity:    ['quantity', 'qty', 'stock', 'on hand', 'count', 'units on hand'],
  upc:         ['upc', 'barcode', 'ean', 'gtin', 'upc code'],
  number:      ['number', 'sku', 'item number', 'part number', 'product id', 'item #'],
  sale_price:  ['sale price', 'price', 'retail price', 'msrp', 'unit price', 'sell price'],
  unit:        ['unit', 'uom', 'unit of measure'],
  category:    ['category', 'department', 'section', 'type', 'category name'],
  status:      ['status', 'active', 'availability'],
  tax_percent: ['tax', 'tax %', 'tax rate', 'vat', 'tax percent'],
  tag_names:   ['tags', 'tag names', 'labels'],
  description: ['notes', 'memo', 'detail', 'long description', 'product description'],
  image:       ['image', 'image url', 'photo', 'picture', 'img'],
};

function autoDetect(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedDest = new Set<string>();

  for (const header of headers) {
    const lower = header.toLowerCase().trim();
    let matched = '__ignore__';

    for (const [dest, synonyms] of Object.entries(SYNONYMS)) {
      if (!usedDest.has(dest) && synonyms.some(s => lower === s || lower.includes(s))) {
        matched = dest;
        usedDest.add(dest);
        break;
      }
    }

    mapping[header] = matched;
  }

  return mapping;
}

interface SheetData {
  name: string;
  headers: string[];
  preview: Record<string, any>[];
  rows: Record<string, any>[];
  rowCount: number;
  mapping: Record<string, string>;
}

interface ImportState {
  step: 'upload' | 'map' | 'importing' | 'done';
  file: File | null;
  sheets: SheetData[];
  activeSheet: number;
  result: {
    added: number; updated: number; skipped: number; errors: string[];
    skipped_rows: { row_num: number; sheet: string; item_name: string }[];
  } | null;
  parseError: string | null;
  isParsing: boolean;
}

const initialState: ImportState = {
  step: 'upload',
  file: null,
  sheets: [],
  activeSheet: 0,
  result: null,
  parseError: null,
  isParsing: false,
};

export default function Import() {
  const prefersReducedMotion = useReducedMotion();

  const [state, setState] = useState<ImportState>(initialState);
  const [showSkipped, setShowSkipped] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setState(prev => ({ ...prev, file, isParsing: true, parseError: null }));

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/inventory/batch-upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });

      if (!res.ok) {
        const err = await res.json();
        setState(prev => ({ ...prev, isParsing: false, parseError: err.error || 'Failed to parse file' }));
        return;
      }

      const data = await res.json();
      const sheets: SheetData[] = (data.sheets || []).map((s: any) => ({
        ...s,
        mapping: autoDetect(s.headers),
      }));

      if (sheets.length === 0) {
        setState(prev => ({ ...prev, isParsing: false, parseError: 'No data sheets found in file. Please check the file and try again.' }));
        return;
      }

      setState(prev => ({ ...prev, step: 'map', sheets, activeSheet: 0, isParsing: false }));
    } catch {
      setState(prev => ({ ...prev, isParsing: false, parseError: 'Network error — could not reach server' }));
    }

    e.target.value = '';
  };

  const handleMappingChange = (header: string, dest: string) => {
    setState(prev => {
      const sheets = prev.sheets.map((s, i) =>
        i === prev.activeSheet
          ? { ...s, mapping: { ...s.mapping, [header]: dest } }
          : s
      );
      return { ...prev, sheets };
    });
  };

  const applyToAllSheets = () => {
    const sourceMapping = state.sheets[state.activeSheet]?.mapping ?? {};
    setState(prev => ({
      ...prev,
      sheets: prev.sheets.map(s => ({ ...s, mapping: { ...sourceMapping } })),
    }));
  };

  const handleConfirm = async () => {
    setState(prev => ({ ...prev, step: 'importing', parseError: null }));

    const sheetsData = state.sheets.map(s => ({
      sheetName: s.name,
      rows: s.rows,
      mapping: s.mapping,
    }));

    try {
      const res = await fetch('/api/inventory/batch-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsData }),
      });

      const result = await res.json();
      if (!res.ok) {
        setState(prev => ({ ...prev, step: 'map', parseError: result.error || 'Import failed' }));
        return;
      }

      setState(prev => ({ ...prev, step: 'done', result }));
    } catch {
      setState(prev => ({ ...prev, step: 'map', parseError: 'Network error during import' }));
    }
  };

  const reset = () => setState(initialState);

  const activeSheet = state.sheets[state.activeSheet];
  const isMultiSheet = state.sheets.length > 1;
  const mappedCount = activeSheet
    ? Object.values(activeSheet.mapping).filter(v => v !== '__ignore__').length
    : 0;
  const totalRows = state.sheets.reduce((n, s) => n + s.rowCount, 0);

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes importProgress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        .animate-import-progress { animation: importProgress 1.6s ease-in-out infinite; }
      `}</style>
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Import Wizard</h2>
        <p className="text-slate-500">Upload Excel, CSV, or JSON files to bulk sync inventory</p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'map', 'done'] as const).map((s, i) => {
          const stepLabel = s === 'upload' ? 'Upload File' : s === 'map' ? 'Map Columns' : 'Done';
          return (
            <React.Fragment key={s}>
              <div className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-colors',
                state.step === s || (state.step === 'importing' && s === 'map')
                  ? 'bg-navy-900 text-white'
                  : state.step === 'done' || (s === 'upload' && state.step !== 'upload')
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
              )}>
                {(state.step === 'done' && s !== 'done') || (s === 'upload' && state.step !== 'upload')
                  ? <Check size={13} />
                  : <span>{i + 1}</span>}
                {stepLabel}
              </div>
              {i < 2 && <ChevronRight size={16} className="text-slate-300" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1 — Upload */}
      {state.step === 'upload' && (
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <label className={cn(
            'flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
            state.isParsing ? 'border-slate-200 bg-slate-50 cursor-not-allowed' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
          )}>
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {state.isParsing ? (
                <>
                  <Loader2 className="w-12 h-12 text-navy-700 mb-4 animate-spin" />
                  <p className="text-sm text-slate-500 font-medium">Parsing file...</p>
                </>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-slate-400 mb-4" />
                  <p className="mb-2 text-sm text-slate-500">
                    <span className="font-semibold text-navy-900">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-400">Excel (.xlsx, .xls), CSV, or JSON — max 20MB</p>
                  <p className="text-xs text-slate-400 mt-1">Multi-sheet Excel supported — each sheet = one category</p>
                </>
              )}
            </div>
            <input
              type="file"
              className="hidden"
              accept=".csv,.xlsx,.xls,.json"
              onChange={handleFileChange}
              disabled={state.isParsing}
            />
          </label>

          {state.parseError && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertTriangle size={16} />
              {state.parseError}
            </div>
          )}

          <div className="mt-6 bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800">
            <p className="font-bold mb-2">Accepted columns (any order, auto-detected):</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1 opacity-80 text-xs font-mono">
              {DEST_FIELDS.filter(f => f.value !== '__ignore__' && f.value !== 'category').map(f => (
                <span key={f.value}>{f.label.split(' (')[0]}</span>
              ))}
            </div>
            <p className="mt-2 opacity-70">At least UPC or SKU required per row. Multi-sheet: sheet name used as category.</p>
          </div>
        </div>
      )}

      {/* Step 2 — Column Mapping */}
      {(state.step === 'map' || state.step === 'importing') && activeSheet && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* File info header */}
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-emerald-600" />
                <span className="font-semibold text-navy-900">{state.file?.name}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isMultiSheet
                  ? `${state.sheets.length} sheets · ${totalRows} total rows`
                  : `${totalRows} rows detected`}
              </p>
            </div>
            <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              <RefreshCw size={13} /> Change file
            </button>
          </div>

          {/* Sheet tabs (multi-sheet only) */}
          {isMultiSheet && (
            <div className="flex items-center gap-1 px-5 pt-4 pb-0 overflow-x-auto">
              {state.sheets.map((sheet, i) => (
                <button
                  key={sheet.name}
                  onClick={() => setState(prev => ({ ...prev, activeSheet: i }))}
                  disabled={state.step === 'importing'}
                  className={cn(
                    'px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap border border-b-0 transition-colors',
                    state.activeSheet === i
                      ? 'bg-white border-slate-200 text-navy-900 -mb-px relative z-10'
                      : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  {sheet.name}
                  <span className="ml-1.5 text-xs opacity-60">({sheet.rowCount})</span>
                </button>
              ))}
            </div>
          )}

          {state.parseError && (
            <div className="mx-5 mt-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertTriangle size={16} />
              {state.parseError}
            </div>
          )}

          {/* Column mapping table */}
          <div className={cn('p-5', isMultiSheet && 'border-t border-slate-200')}>
            {isMultiSheet && (
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-navy-900">
                    Map columns for sheet: <span className="text-emerald-700">{activeSheet.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Items will be assigned to category "{activeSheet.name}"</p>
                </div>
                <button
                  onClick={applyToAllSheets}
                  disabled={state.step === 'importing'}
                  className="flex items-center gap-1.5 text-xs text-navy-700 hover:text-navy-900 border border-navy-200 hover:border-navy-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Copy size={12} /> Apply to all sheets
                </button>
              </div>
            )}
            {!isMultiSheet && (
              <h3 className="text-sm font-semibold text-navy-900 mb-3">Map your columns to OptiCapture fields</h3>
            )}

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/2">Your Column</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/2">Maps to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeSheet.headers.map(header => {
                    const currentVal = activeSheet.mapping[header] ?? '__ignore__';
                    const isLockedCategory = isMultiSheet && currentVal === 'category';

                    return (
                      <tr key={header} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-sm text-slate-700">{header}</td>
                        <td className="px-4 py-2.5">
                          {isLockedCategory ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400 italic px-3 py-1.5">
                              <Lock size={13} />
                              Sheet name used as category
                            </div>
                          ) : (
                            <select
                              value={currentVal}
                              onChange={e => handleMappingChange(header, e.target.value)}
                              disabled={state.step === 'importing'}
                              className={cn(
                                'w-full px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-navy-700 focus:border-transparent',
                                currentVal && currentVal !== '__ignore__'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-300 text-slate-500'
                              )}
                            >
                              {DEST_FIELDS
                                .filter(f => !(isMultiSheet && f.value === 'category'))
                                .map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
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

          {/* Preview */}
          {activeSheet.preview.length > 0 && (
            <div className="px-5 pb-2">
              <h3 className="text-sm font-semibold text-navy-900 mb-2">Preview (first 5 rows)</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {activeSheet.headers.map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.preview.map((row, i) => (
                      <tr key={activeSheet.headers.map(h => String(row[h] ?? '')).join('|') + i} className="border-t border-slate-100">
                        {activeSheet.headers.map(h => (
                          <td key={h} className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[160px] truncate">{String(row[h] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Importing progress banner */}
          {state.step === 'importing' && (
            <div className="mx-5 mb-4 rounded-xl border border-navy-200 bg-navy-50 p-4">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 size={18} className="animate-spin text-navy-700 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-navy-900">Importing {totalRows} row{totalRows !== 1 ? 's' : ''}…</p>
                  <p className="text-xs text-navy-600 mt-0.5">Please wait — do not close this tab</p>
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-navy-200 overflow-hidden">
                <div className="h-full w-1/2 rounded-full bg-navy-700 animate-import-progress" />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-5 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-500 space-y-0.5">
              <p>{mappedCount} column{mappedCount !== 1 ? 's' : ''} mapped on this sheet · {totalRows} total rows</p>
              {isMultiSheet && (
                <p className="text-slate-400">
                  {state.sheets.map(s => `${s.name} (${s.rowCount})`).join(' · ')}
                </p>
              )}
            </div>
            <button
              onClick={handleConfirm}
              disabled={mappedCount === 0 || state.step === 'importing'}
              className="flex items-center gap-2 bg-navy-900 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.step === 'importing' ? (
                <><Loader2 size={16} className="animate-spin" /> Importing...</>
              ) : (
                <><Check size={16} /> Start Import</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Done */}
      {state.step === 'done' && state.result && (
        <AnimatePresence>
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <Check size={24} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-navy-900">Import Complete</h3>
                <p className="text-slate-500 text-sm">{state.file?.name}</p>
              </div>
            </div>

            {/* Per-sheet breakdown */}
            {isMultiSheet && (
              <div className="mb-5 bg-slate-50 rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sheets Processed</p>
                <div className="flex flex-wrap gap-2">
                  {state.sheets.map(s => (
                    <span key={s.name} className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-slate-400 ml-1">({s.rowCount} rows)</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-center">
                <p className="text-3xl font-bold text-emerald-700">{state.result.added}</p>
                <p className="text-sm text-emerald-600 font-medium mt-1">New Items Added</p>
              </div>
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                <p className="text-3xl font-bold text-blue-700">{state.result.updated}</p>
                <p className="text-sm text-blue-600 font-medium mt-1">Items Updated</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                <p className="text-3xl font-bold text-slate-600">{state.result.skipped}</p>
                <p className="text-sm text-slate-500 font-medium mt-1">Skipped (no ID)</p>
              </div>
            </div>

            {state.result.errors.length > 0 && (
              <div className="mb-6 bg-red-50 border border-red-100 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                  <AlertTriangle size={16} />
                  {state.result.errors.length} row{state.result.errors.length !== 1 ? 's' : ''} failed
                </div>
                <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-red-600 font-mono">
                  {state.result.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}

            {(state.result.skipped_rows?.length ?? 0) > 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-100 rounded-xl p-4">
                <button
                  onClick={() => setShowSkipped(p => !p)}
                  className="flex items-center justify-between w-full text-amber-700 font-medium"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} />
                    {state.result.skipped_rows!.length} row{state.result.skipped_rows!.length !== 1 ? 's' : ''} skipped (no UPC or SKU)
                  </div>
                  <ChevronRight size={16} className={cn('transition-transform', showSkipped && 'rotate-90')} />
                </button>
                {showSkipped && (
                  <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto text-xs text-amber-800 font-mono">
                    {state.result.skipped_rows!.map((r) => (
                      <li key={`${r.sheet}-${r.row_num}`} className="flex gap-2">
                        <span className="text-amber-400 shrink-0">{r.sheet} row {r.row_num}</span>
                        <span className="truncate">{r.item_name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              onClick={reset}
              className="flex items-center gap-2 bg-navy-900 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-navy-800 transition-colors"
            >
              <RefreshCw size={16} /> Import Another File
            </button>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
