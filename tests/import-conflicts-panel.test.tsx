// @vitest-environment jsdom
/**
 * tests/import-conflicts-panel.test.tsx — choosing what happens to rows an import held back
 * because their identifiers disagree with the catalog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportConflictsPanel } from '../src/components/import/ImportConflictsPanel';
import { applyFileIdentifiers } from '../src/components/import/importApi';
import type {
  ConflictResolution,
  ImportConflict,
  ImportResult,
  SheetData,
} from '../src/components/import/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function conflict(rowIndex: number, overrides: Partial<ImportConflict> = {}): ImportConflict {
  return {
    kind: 'different_values',
    sheet: 'Sheet1',
    sheet_index: 0,
    row_index: rowIndex,
    row_num: rowIndex + 2,
    item_name: `Row ${rowIndex}`,
    catalog_item: `Item ${rowIndex}`,
    message: `Row ${rowIndex} disagrees`,
    differences: [
      { field: 'number', label: 'SKU', file_value: `NEW-${rowIndex}`, catalog_value: 'OLD' },
    ],
    ...overrides,
  };
}

function result(conflicts: ImportConflict[], extraRows = 0): ImportResult {
  const rows = conflicts.map(({ sheet_index, row_index, kind }) => ({
    sheet_index,
    row_index,
    kind,
  }));
  for (let i = 0; i < extraRows; i++) {
    rows.push({ sheet_index: 0, row_index: 100 + i, kind: 'different_values' });
  }
  return {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    errors_total: 0,
    skipped_rows: [],
    conflicts,
    conflicts_total: rows.length,
    conflict_rows: rows,
  };
}

function renderPanel(
  importResult: ImportResult,
  resolution: ConflictResolution = { status: 'idle' }
) {
  const onApply = vi.fn();
  render(<ImportConflictsPanel result={importResult} resolution={resolution} onApply={onApply} />);
  return onApply;
}

describe('ImportConflictsPanel', () => {
  it('skips every row until the owner chooses otherwise', () => {
    const onApply = renderPanel(result([conflict(0), conflict(1)]));
    const update = screen.getByRole('button', { name: /Update 0 items/ });
    expect((update as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(update);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies the file’s values to the rows the owner picks', () => {
    const onApply = renderPanel(result([conflict(0), conflict(1)]));
    fireEvent.click(screen.getAllByLabelText('Use the file’s values')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Update 1 item/ }));
    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({ sheet_index: 0, row_index: 1 }),
    ]);
  });

  it('“for all” also covers rows past the listed ones', () => {
    const onApply = renderPanel(result([conflict(0)], 3));
    fireEvent.click(screen.getByRole('button', { name: /Use the file’s values for all 4/ }));
    fireEvent.click(screen.getByRole('button', { name: /Update 4 items/ }));
    expect(onApply.mock.calls[0][0]).toHaveLength(4);
  });

  it('lists rows that match two items without offering a choice', () => {
    renderPanel(
      result([
        conflict(0, {
          kind: 'two_items',
          message: 'UPC belongs to A but SKU belongs to B',
          differences: [],
        }),
      ])
    );
    expect(screen.getByText(/UPC belongs to A but SKU belongs to B/)).toBeTruthy();
    expect(screen.queryByLabelText('Use the file’s values')).toBeNull();
  });

  it('locks the choices once they are applied', () => {
    renderPanel(result([conflict(0)]), {
      status: 'done',
      applied: 1,
      result: { ...result([]), updated: 1 },
    });
    expect(screen.getByText(/Updated 1 item with the file’s values/)).toBeTruthy();
    expect(screen.getByLabelText('Use the file’s values').matches(':disabled')).toBe(true);
  });
});

describe('applyFileIdentifiers', () => {
  it('sends only the chosen rows, with their file rows, and asks for the file’s values', async () => {
    let sent: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ added: 0, updated: 1, skipped: 0, errors: [] });
      })
    );
    const sheets: SheetData[] = [
      {
        name: 'A',
        categoryName: null,
        headers: ['UPC'],
        headerRowNumber: 1,
        sourceColumnCount: 1,
        preview: [],
        rows: [{ UPC: '1' }, { UPC: '2' }, { UPC: '3' }],
        rowNumbers: [2, 3, 4],
        rowCount: 3,
        mapping: { UPC: 'upc' },
      },
      {
        name: 'B',
        categoryName: null,
        headers: ['UPC'],
        headerRowNumber: 1,
        sourceColumnCount: 1,
        preview: [],
        rows: [{ UPC: '9' }],
        rowNumbers: [2],
        rowCount: 1,
        mapping: { UPC: 'upc' },
      },
    ];

    const outcome = await applyFileIdentifiers(sheets, [{ sheet_index: 0, row_index: 2 }]);

    expect(outcome.updated).toBe(1);
    expect(sent).toEqual({
      identifierConflicts: 'use_file',
      sheetsData: [
        {
          sheetName: 'A',
          categoryName: null,
          rows: [{ UPC: '3' }],
          rowNumbers: [4],
          mapping: { UPC: 'upc' },
        },
      ],
    });
  });
});
