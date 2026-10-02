import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  RefreshCw,
  Tags,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  getMappedColumns,
  getRowsWithoutIdentifiers,
  isIdentifierDestination,
  projectMappedRow,
} from './mapping';
import type { MappingIssue } from './mapping';
import { DEST_FIELDS, IDENTIFIER_DESTINATIONS } from './types';
import type { DestinationField, RowData, SheetData } from './types';

const CATEGORY_VALUE_LIMIT = 12;

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
  mappingIssues: MappingIssue[];
  mappingsReady: boolean;
  onReset: () => void;
  onSelectSheet: (index: number) => void;
  onCategoryNameChange: (index: number, categoryName: string) => void;
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

function MappingIssueNotices({ issues }: Readonly<{ issues: MappingIssue[] }>) {
  const [closedIssues, setClosedIssues] = useState<number[]>([]);
  const visibleIssues = issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ index }) => !closedIssues.includes(index));

  return (
    <section className="mx-5 mb-4" aria-labelledby="mapping-issues-heading">
      <h3 id="mapping-issues-heading" className="text-sm font-semibold text-red-900">
        Mapping needs attention
      </h3>
      {visibleIssues.length > 0 ? (
        <ul className="mt-2 flex max-w-full items-start gap-3 overflow-x-auto px-1 pt-1 pb-3">
          {visibleIssues.map(({ issue, index }) => (
            <li
              key={`${index}-${issue.sheetName}-${issue.message}`}
              className="relative w-fit max-w-[calc(100vw-4rem)] shrink-0 border-2 border-teal-700 bg-white text-black shadow-[4px_4px_0_0,8px_8px_0_0] shadow-teal-700 hover:z-10 focus-within:z-10 sm:max-w-sm"
            >
              <div className="flex items-center justify-between gap-3 bg-teal-300 px-3 py-2">
                <strong className="text-xs/none font-bold uppercase text-red-800">
                  Mapping Issue
                </strong>
                <button
                  type="button"
                  onClick={() => setClosedIssues(current => [...current, index])}
                  aria-label={`Close mapping issue: ${issue.sheetName}: ${issue.message}`}
                  className="flex size-6 items-center justify-center border-2 border-black bg-white hover:bg-teal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  <X size={14} strokeWidth={4} className="text-red-600" aria-hidden="true" />
                </button>
              </div>
              <div className="border-t-2 border-teal-700 px-3 py-2.5">
                <h4 className="text-base font-semibold leading-tight text-teal-700">
                  {issue.category}
                </h4>
                <p className="mt-1 text-sm leading-snug break-words text-pretty">
                  <strong className="font-bold text-teal-700">{issue.sheetName}:</strong>{' '}
                  {issue.message}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setClosedIssues([])}
          className="mt-1 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          Show {issues.length} hidden issue{issues.length !== 1 ? 's' : ''}
        </button>
      )}
    </section>
  );
}

function readCellAsLabel(row: RowData, header: string): string | null {
  const value = row[header];
  if (value === null || value === undefined) return null;

  const label = String(value).trim();
  return label.length > 0 ? label : null;
}

function getCategoryValues(sheet: SheetData, categoryHeaders: readonly string[]): string[] {
  if (categoryHeaders.length === 0) return [];

  const values = new Map<string, string>();

  for (const row of sheet.rows) {
    for (const header of categoryHeaders) {
      const label = readCellAsLabel(row, header);
      if (!label) continue;

      const key = label.toLocaleLowerCase();
      if (!values.has(key)) values.set(key, label);
    }
  }

  return [...values.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
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
  mappingIssues,
  mappingsReady,
  onReset,
  onSelectSheet,
  onCategoryNameChange,
  onApplyToAllSheets,
  onMappingChange,
  onConfirm,
}: Readonly<Props>) {
  const [categoryReview, setCategoryReview] = useState({ key: '', reviewed: false });
  const mappedColumns = useMemo(() => getMappedColumns(activeSheet), [activeSheet]);
  const destinationOwners = useMemo(
    () =>
      new Map<DestinationField, string>(
        mappedColumns.map(column => [column.destination, column.source])
      ),
    [mappedColumns]
  );
  const mappedPreview = useMemo(
    () => activeSheet.preview.map(row => projectMappedRow(row, mappedColumns)),
    [activeSheet.preview, mappedColumns]
  );
  const rowsWithoutIdentifiers = useMemo(
    () => getRowsWithoutIdentifiers(activeSheet),
    [activeSheet]
  );
  const categoryMappingHeaders = useMemo(
    () => activeSheet.headers.filter(header => activeSheet.mapping[header] === 'category'),
    [activeSheet]
  );
  const categoryValues = useMemo(
    () => getCategoryValues(activeSheet, categoryMappingHeaders),
    [activeSheet, categoryMappingHeaders]
  );
  const visibleCategoryValues = categoryValues.slice(0, CATEGORY_VALUE_LIMIT);
  const hiddenCategoryValueCount = Math.max(
    0,
    categoryValues.length - visibleCategoryValues.length
  );
  const activeSheetUsesCategory = Boolean(activeSheet.categoryName?.trim());
  const categorySheetSummaries = sheets.map(sheet => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    mappedHeaders: sheet.headers.filter(header => sheet.mapping[header] === 'category'),
    fallbackCategory: sheet.categoryName?.trim() || null,
  }));
  const categorySheetCount = categorySheetSummaries.filter(
    sheet => sheet.mappedHeaders.length > 0 || sheet.fallbackCategory
  ).length;
  const categoryReviewKey = sheets
    .map(
      sheet =>
        `${sheet.name}:${sheet.categoryName ?? ''}:${sheet.rowCount}:${sheet.headers
          .filter(header => sheet.mapping[header] === 'category')
          .join(',')}`
    )
    .join('|');
  const categoryReviewed = categoryReview.key === categoryReviewKey && categoryReview.reviewed;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <style>{`
        @keyframes importProgress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        .animate-import-progress { animation: importProgress 1.6s ease-in-out infinite; }
        .import-sheet-tabs { scrollbar-color: #ffffff #f1f5f9; scrollbar-width: thin; }
        .import-sheet-tabs::-webkit-scrollbar { height: 8px; }
        .import-sheet-tabs::-webkit-scrollbar-track { background: #f1f5f9; }
        .import-sheet-tabs::-webkit-scrollbar-thumb { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px; }
      `}</style>

      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Workbook file
          </p>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-emerald-600" />
            <span className="font-semibold text-navy-900">
              {fileName ?? 'Unknown workbook name'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {isMultiSheet
              ? `${sheets.length} sheets - ${totalRows} total rows`
              : `${totalRows} rows detected`}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <RefreshCw size={13} /> Change file
        </button>
      </div>

      {isMultiSheet && (
        <div className="import-sheet-tabs flex items-center gap-1 overflow-x-auto px-5 pt-4 pb-0">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => onSelectSheet(index)}
              disabled={isImporting}
              aria-pressed={activeSheetIndex === index}
              className={cn(
                'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition-[background-color,opacity] disabled:opacity-50',
                activeSheetIndex === index
                  ? 'relative z-10 -mb-px border-brand-700 bg-brand-700 ring-1 ring-inset ring-accent-500'
                  : 'border-transparent bg-brand-600 opacity-70 hover:bg-brand-700 hover:opacity-100 focus-visible:opacity-100'
              )}
            >
              {sheet.name}
              <span className="ml-1.5 text-xs">({sheet.rowCount})</span>
            </button>
          ))}
        </div>
      )}

      {parseError && <ErrorBanner message={parseError} className="mx-5 mt-4" />}

      <div className={cn('p-5', isMultiSheet && 'border-t border-slate-200')}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-navy-900">
              Map columns for worksheet:{' '}
              <span className="text-emerald-700">{activeSheet.name}</span>
            </h3>
            {isMultiSheet && (
              <p className="mt-0.5 text-xs text-slate-500">
                {categoryMappingHeaders.length > 0
                  ? `Mapped category values take priority${
                      activeSheetUsesCategory
                        ? `; "${activeSheet.categoryName}" is the fallback`
                        : ''
                    }`
                  : activeSheetUsesCategory
                    ? `Items will use "${activeSheet.categoryName}" as their category`
                    : 'Map a Category column or these rows will be uncategorized'}
              </p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">
              {activeSheet.headers.length} named columns detected from header row{' '}
              {activeSheet.headerRowNumber ?? 'unknown'}.
            </p>
          </div>

          {isMultiSheet && (
            <button
              type="button"
              onClick={onApplyToAllSheets}
              disabled={isImporting}
              className="flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-700 transition-colors hover:border-navy-400 hover:text-navy-900 disabled:opacity-40"
            >
              <Copy size={12} /> Apply to matching headers
            </button>
          )}
        </div>

        <div className="mb-4 max-w-xl">
          <label className="block text-xs font-semibold text-slate-700">
            Category for this worksheet
            <input
              type="text"
              value={activeSheet.categoryName ?? ''}
              onChange={event => onCategoryNameChange(activeSheetIndex, event.target.value)}
              disabled={isImporting}
              maxLength={120}
              placeholder="Uncategorized"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800 focus:border-transparent focus:ring-2 focus:ring-navy-700 disabled:bg-slate-100"
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">
            {categoryMappingHeaders.length > 0
              ? 'Used when a mapped Category value is blank. Clear it to leave those rows uncategorized.'
              : 'Used for this worksheet. Clear it to leave rows uncategorized.'}
          </p>
        </div>
        <div className="mb-4 rounded-xl border border-theme-border bg-theme-subtle p-4">
          <div className="flex items-start gap-2">
            <KeyRound size={16} className="mt-0.5 shrink-0 text-brand-600" />
            <div>
              <h4 className="text-sm font-semibold text-theme-text">
                Available Inventory Portal fields
              </h4>
              <p className="mt-0.5 text-xs text-theme-muted">
                Map each destination once. Every sheet must include at least one identifier marked
                Required.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEST_FIELDS.filter(field => field.value !== '__ignore__').map(field => {
              const isIdentifier = IDENTIFIER_DESTINATIONS.includes(field.value);
              return (
                <span
                  key={field.value}
                  title={field.description}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs font-medium',
                    isIdentifier
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-theme-border bg-white text-theme-muted'
                  )}
                >
                  {field.label}
                  {isIdentifier && (
                    <span className="ml-1 font-bold text-red-700">- Required option</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th
                  scope="col"
                  className="w-[45%] px-4 py-3 text-left text-xs font-semibold tracking-wider text-navy-900 uppercase"
                >
                  Detected Columns
                </th>
                <th
                  scope="col"
                  className="w-[10%] border-x border-slate-200 bg-slate-100/70 px-2 py-3 text-center"
                >
                  <span className="sr-only">Mapping direction</span>
                  <ArrowRight size={16} aria-hidden="true" className="mx-auto text-brand-600" />
                </th>
                <th
                  scope="col"
                  className="w-[45%] px-4 py-3 text-left text-xs font-semibold tracking-wider text-navy-900 uppercase"
                >
                  Maps to
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeSheet.headers.map(header => {
                const currentValue = activeSheet.mapping[header] ?? '__ignore__';
                const sampleValue = activeSheet.preview
                  .map(row => row[header])
                  .find(value => value !== null && value !== undefined && String(value).trim());

                return (
                  <tr key={header} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-sm text-slate-700">{header}</p>
                      <p className="mt-0.5 max-w-[280px] truncate text-xs text-slate-400">
                        Example: {sampleValue === undefined ? '-' : String(sampleValue)}
                      </p>
                    </td>
                    <td className="border-x border-slate-200 bg-slate-50/70 px-2 py-2.5 text-center">
                      <span
                        className={cn(
                          'mx-auto flex h-8 w-8 items-center justify-center rounded-full',
                          currentValue !== '__ignore__'
                            ? 'bg-brand-100 text-brand-700'
                            : 'bg-slate-100 text-slate-400'
                        )}
                      >
                        <ArrowRight size={16} aria-hidden="true" />
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={currentValue}
                        onChange={event =>
                          onMappingChange(header, event.target.value as DestinationField)
                        }
                        disabled={isImporting}
                        aria-label={`Map ${header} to an Inventory Portal field`}
                        className={cn(
                          'w-full rounded-lg border px-3 py-1.5 text-sm focus:border-transparent focus:ring-2 focus:ring-navy-700',
                          currentValue !== '__ignore__'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-slate-300 text-slate-500'
                        )}
                      >
                        {DEST_FIELDS.map(field => {
                          const owner = destinationOwners.get(field.value);
                          const unavailable =
                            field.value !== '__ignore__' && owner !== undefined && owner !== header;
                          return (
                            <option key={field.value} value={field.value} disabled={unavailable}>
                              {field.label}
                              {isIdentifierDestination(field.value) ? ' - identifier' : ''}
                              {unavailable ? ` - already mapped from ${owner}` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-navy-900">
              Source data preview: {activeSheet.name}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Raw worksheet values before any Inventory Portal mapping.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            Showing {activeSheet.preview.length} of {activeSheet.rowCount} data rows
          </span>
        </div>
        {activeSheet.preview.length > 0 && activeSheet.headers.length > 0 ? (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {activeSheet.headers.map(header => (
                    <th
                      key={header}
                      className="px-3 py-2 text-left font-mono font-semibold text-slate-600 whitespace-nowrap"
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
                        className="max-w-[180px] truncate px-3 py-2 text-slate-600 whitespace-nowrap"
                        title={String(row[header] ?? '')}
                      >
                        {String(row[header] ?? '') || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            No source rows or named columns were detected for this worksheet.
          </div>
        )}
      </div>

      <div className="px-5 pb-2">
        <h3 className="mb-0.5 text-sm font-semibold text-navy-900">
          Mapped preview (first 5 rows)
        </h3>
        <p className="mb-2 text-xs text-slate-500">
          Inventory Portal fields are shown above their source columns.
        </p>
        {mappedPreview.length > 0 && mappedColumns.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {mappedColumns.map(column => (
                    <th
                      key={column.source}
                      className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap"
                    >
                      <span className="block font-semibold text-navy-900">{column.label}</span>
                      <span className="font-mono text-[10px] font-normal text-slate-400">
                        from {column.source}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappedPreview.map((row, index) => (
                  <tr
                    key={
                      mappedColumns.map(column => String(row[column.destination] ?? '')).join('|') +
                      index
                    }
                    className="border-t border-slate-100"
                  >
                    {mappedColumns.map(column => (
                      <td
                        key={column.source}
                        className="max-w-[160px] truncate px-3 py-2 text-slate-600 whitespace-nowrap"
                      >
                        {String(row[column.destination] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {mappedColumns.length === 0
              ? 'Map at least one column to see the Inventory Portal preview.'
              : 'No row preview is available for this sheet.'}
          </div>
        )}
        {mappedColumns.some(column => isIdentifierDestination(column.destination)) &&
          rowsWithoutIdentifiers > 0 && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {rowsWithoutIdentifiers} row{rowsWithoutIdentifiers !== 1 ? 's' : ''} on this sheet
              will be skipped because all mapped identifier values are blank.
            </div>
          )}
      </div>

      <div className="mx-5 mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-950">Review category assignment</p>
            {isMultiSheet ? (
              <>
                <p className="mt-1 text-sm text-amber-900">
                  A mapped Category value is used first. If it is blank, the reviewed category for
                  that worksheet is used as the fallback.
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-900 uppercase">
                  <Tags size={13} /> Category names
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {categorySheetSummaries.map(sheet => (
                    <span
                      key={sheet.name}
                      className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-950"
                    >
                      {sheet.mappedHeaders.length > 0
                        ? `${sheet.name}: mapped from ${sheet.mappedHeaders.join(', ')}${
                            sheet.fallbackCategory
                              ? `; fallback ${sheet.fallbackCategory}`
                              : '; blank values uncategorized'
                          } (${sheet.rowCount})`
                        : sheet.fallbackCategory
                          ? `${sheet.name}: fallback category (${sheet.rowCount})`
                          : `${sheet.name}: uncategorized (${sheet.rowCount})`}
                    </span>
                  ))}
                </div>
                {categorySheetCount === 0 && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                    No mapped or worksheet category names were found.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-amber-900">
                  {categoryMappingHeaders.length > 0
                    ? `Rows will use the mapped category column: ${categoryMappingHeaders.join(', ')}.${
                        activeSheetUsesCategory
                          ? ` Blank values fall back to "${activeSheet.categoryName}".`
                          : ''
                      }`
                    : activeSheetUsesCategory
                      ? `No Category column is mapped, so rows will use "${activeSheet.categoryName}".`
                      : 'No Category column or worksheet category is available, so rows will be uncategorized.'}
                </p>
                {categoryMappingHeaders.length > 0 && (
                  <div className="mt-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-900 uppercase">
                      <Tags size={13} /> Category names found
                    </p>
                    {categoryValues.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {visibleCategoryValues.map(category => (
                          <span
                            key={category}
                            className="max-w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium break-words text-amber-950"
                          >
                            {category}
                          </span>
                        ))}
                        {hiddenCategoryValueCount > 0 && (
                          <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-950">
                            +{hiddenCategoryValueCount} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                        No category names were found in the mapped column.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            <label className="mt-4 flex items-start gap-2 text-sm font-medium text-amber-950">
              <input
                type="checkbox"
                checked={categoryReviewed}
                onChange={event =>
                  setCategoryReview({ key: categoryReviewKey, reviewed: event.target.checked })
                }
                disabled={isImporting}
                className="mt-0.5 h-4 w-4 rounded border-amber-400 text-navy-900 focus:ring-navy-700"
              />
              <span>I reviewed the category assignment for this import.</span>
            </label>
          </div>
        </div>
      </div>

      {mappingIssues.length > 0 && (
        <MappingIssueNotices key={JSON.stringify(mappingIssues)} issues={mappingIssues} />
      )}

      {isImporting && (
        <div className="mx-5 mb-4 rounded-xl border border-navy-200 bg-navy-50 p-4">
          <div className="mb-3 flex items-center gap-3">
            <Loader2 size={18} className="shrink-0 animate-spin text-brand-600" />
            <div>
              <p className="text-sm font-semibold text-navy-900">
                Importing {totalRows} row{totalRows !== 1 ? 's' : ''}...
              </p>
              <p className="mt-0.5 text-xs text-navy-600">Please wait - do not close this tab</p>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-navy-200">
            <div className="animate-import-progress h-full w-1/2 rounded-full bg-brand-400" />
          </div>
        </div>
      )}

      <div className="flex flex-col items-start justify-between gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center">
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
          disabled={!mappingsReady || !categoryReviewed || isImporting}
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
