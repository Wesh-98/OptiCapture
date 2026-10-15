import { useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { ConflictResolution, ConflictRow, ImportConflict, ImportResult } from './types';

interface Props {
  result: ImportResult;
  resolution: ConflictResolution;
  onApply: (rows: ReadonlyArray<Pick<ConflictRow, 'sheet_index' | 'row_index'>>) => void;
}

const rowKey = (row: Pick<ConflictRow, 'sheet_index' | 'row_index'>) =>
  `${row.sheet_index}:${row.row_index}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ConflictChoice({
  conflict,
  useFile,
  disabled,
  onChoose,
}: Readonly<{
  conflict: ImportConflict;
  useFile: boolean;
  disabled: boolean;
  onChoose: (useFile: boolean) => void;
}>) {
  const name = `conflict-${rowKey(conflict)}`;
  return (
    <li className="rounded-lg border border-amber-200 bg-white p-3">
      <fieldset disabled={disabled}>
        <legend className="text-xs text-slate-500">
          {conflict.sheet} row {conflict.row_num}
        </legend>
        <p className="mt-0.5 text-sm font-medium text-navy-900">
          {conflict.item_name}
          <span className="font-normal text-slate-500"> matches “{conflict.catalog_item}”</span>
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {conflict.differences.map(difference => (
            <li key={difference.field}>
              {difference.label}: file <span className="font-mono">{difference.file_value}</span> ·
              catalog <span className="font-mono">{difference.catalog_value}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={useFile} onChange={() => onChoose(true)} />
            <span>Use the file’s values</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={!useFile} onChange={() => onChoose(false)} />
            <span>Skip this row</span>
          </label>
        </div>
      </fieldset>
    </li>
  );
}

function ResolutionStatus({ resolution }: Readonly<{ resolution: ConflictResolution }>) {
  if (resolution.status === 'applying') {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <Loader2 size={14} className="animate-spin" /> Applying your choices…
      </p>
    );
  }
  if (resolution.status === 'failed') {
    return <p className="mt-3 text-sm text-red-600">{resolution.error}</p>;
  }
  if (resolution.status !== 'done') return null;
  const { result } = resolution;
  const problems = [...result.conflicts.map(conflict => conflict.message), ...result.errors];
  return (
    <div className="mt-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-emerald-700">
        <Check size={16} /> Updated {plural(result.updated, 'item')} with the file’s values.
      </p>
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-xs text-red-600">
          {problems.map(problem => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Rows an import held back because their identifiers disagree with the catalog. For each
 * row that matched one item the owner chooses: give the item the file's values, or skip the
 * row. Rows that match two different items can only be fixed in the file.
 */
export function ImportConflictsPanel({ result, resolution, onApply }: Readonly<Props>) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  // "Use the file's values for all" also covers rows past the listed ones.
  const [allChosen, setAllChosen] = useState(false);

  const listed = result.conflicts.filter(conflict => conflict.kind === 'different_values');
  const twoItems = result.conflicts.filter(conflict => conflict.kind === 'two_items');
  const resolvableRows = result.conflict_rows.filter(row => row.kind === 'different_values');
  const twoItemsTotal = result.conflict_rows.length - resolvableRows.length;
  const locked = resolution.status === 'applying' || resolution.status === 'done';

  const isChosen = (conflict: ImportConflict) => allChosen || chosen.has(rowKey(conflict));
  const choose = (conflict: ImportConflict, useFile: boolean) => {
    const next = new Set(allChosen ? listed.map(rowKey) : chosen);
    if (useFile) next.add(rowKey(conflict));
    else next.delete(rowKey(conflict));
    setAllChosen(false);
    setChosen(next);
  };
  const rowsToApply = allChosen ? resolvableRows : listed.filter(isChosen);

  return (
    <section
      aria-labelledby="import-conflicts-heading"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <h4
        id="import-conflicts-heading"
        className="flex items-center gap-2 font-medium text-amber-800"
      >
        <AlertTriangle size={16} />
        {plural(result.conflicts_total, 'row')} held back: they disagree with your catalog
      </h4>

      {resolvableRows.length > 0 && (
        <>
          <p className="mt-2 text-sm text-amber-900">
            Each of these rows matched an item you already have, but the file gives it a different
            barcode, SKU or external ID. Choose whether to update the item to the file’s values.
            Skipped rows change nothing.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={locked}
              onClick={() => setAllChosen(true)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Use the file’s values for all {resolvableRows.length}
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setAllChosen(false);
                setChosen(new Set());
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Skip all
            </button>
          </div>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {listed.map(conflict => (
              <ConflictChoice
                key={rowKey(conflict)}
                conflict={conflict}
                useFile={isChosen(conflict)}
                disabled={locked}
                onChoose={useFile => choose(conflict, useFile)}
              />
            ))}
          </ul>
          {resolvableRows.length > listed.length && (
            <p className="mt-2 text-xs text-amber-800">
              Showing the first {listed.length} of {resolvableRows.length}. “Use the file’s values
              for all” covers every one of them.
            </p>
          )}
          <button
            type="button"
            disabled={locked || rowsToApply.length === 0}
            onClick={() => onApply(rowsToApply)}
            className="mt-3 rounded-xl bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Update {plural(rowsToApply.length, 'item')}
          </button>
          <ResolutionStatus resolution={resolution} />
        </>
      )}

      {twoItemsTotal > 0 && (
        <div className="mt-4">
          <p className="text-sm text-amber-900">
            {plural(twoItemsTotal, 'row')} {twoItemsTotal === 1 ? 'matches' : 'match'} two different
            items, so there is no single item to update. Correct{' '}
            {twoItemsTotal === 1 ? 'it' : 'them'} in the file and import again:
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-amber-900">
            {twoItems.map(conflict => (
              <li key={rowKey(conflict)}>
                {conflict.sheet} row {conflict.row_num}: {conflict.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
