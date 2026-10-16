// @vitest-environment jsdom
/**
 * tests/import-workflow-hook.test.tsx — the import wizard end to end in the browser layer
 *
 * Import is how a store brings its existing catalogue in. tests/import-mapping.test.ts covers
 * the header auto-detection, and tests/import-workflow-stale.test.tsx the stale-answer guard.
 * This file walks the wizard itself: upload → map (sheet switching, per-sheet categories,
 * "apply to all sheets") → confirm → conflict choices, plus how importApi reads every kind of
 * server answer, good, partial or broken.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useImportWorkflow } from '../src/hooks/useImportWorkflow';
import {
  applyFileIdentifiers,
  confirmImport,
  uploadFile,
} from '../src/components/import/importApi';
import {
  cellText,
  getRowsWithoutIdentifiers,
  projectMappedRow,
} from '../src/components/import/mapping';
import type { SheetData } from '../src/components/import/types';

type Call = { url: string; body: any };

function stubFetch(route: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return route(url);
    })
  );
  return calls;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const drinksSheet = {
  name: 'Drinks',
  headers: ['UPC', 'Item Name', 'Qty'],
  preview: [{ UPC: '111', 'Item Name': 'Cola', Qty: 4 }],
  rows: [
    { UPC: '111', 'Item Name': 'Cola', Qty: 4 },
    { UPC: '222', 'Item Name': 'Seltzer', Qty: 2 },
  ],
  rowNumbers: [2, 3],
  rowCount: 2,
  headerRowNumber: 1,
  sourceColumnCount: 3,
};
const snacksSheet = {
  name: 'Sheet2',
  headers: ['upc', 'Name', 'Price'],
  preview: [],
  rows: [{ upc: '333', Name: 'Chips', Price: 1.99 }],
  rowCount: 1,
};

const importResult = {
  added: 2,
  updated: 1,
  skipped: 0,
  errors: [],
  skipped_rows: [],
  conflicts: [],
  conflict_rows: [],
};

const file = (name = 'stock.xlsx') => new File(['x'], name);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── The wizard ───────────────────────────────────────────────────────────────

describe('useImportWorkflow', () => {
  function mountWithUpload(sheets: unknown[] = [drinksSheet, snacksSheet], confirm = importResult) {
    const calls = stubFetch(url =>
      url.endsWith('batch-upload') ? json({ sheets, hiddenSheets: ['Notes'] }) : json(confirm)
    );
    const hook = renderHook(() => useImportWorkflow());
    return { ...hook, calls };
  }

  it('parses an upload into sheets and moves to mapping', async () => {
    const { result, calls } = mountWithUpload();

    await act(() => result.current.handleFile(file()));

    expect(calls[0].url).toBe('/api/inventory/batch-upload');
    expect(calls[0].body).toBeInstanceOf(FormData);
    const { state } = result.current;
    expect(state.step).toBe('map');
    expect(state.isParsing).toBe(false);
    expect(state.hiddenSheets).toEqual(['Notes']);
    expect(state.sheets.map(s => s.name)).toEqual(['Drinks', 'Sheet2']);
    // A named sheet suggests its category; "Sheet2" does not.
    expect(state.sheets.map(s => s.categoryName)).toEqual(['Drinks', null]);
    expect(state.sheets[0].mapping).toEqual({
      UPC: 'upc',
      'Item Name': 'item_name',
      Qty: 'quantity',
    });
    expect(result.current.isMultiSheet).toBe(true);
    expect(result.current.totalRows).toBe(3);
    expect(result.current.mappedCount).toBe(3);
    expect(result.current.mappingsReady).toBe(true);
  });

  it('shows the parse error and stays on upload when the server refuses the file', async () => {
    stubFetch(() =>
      json({ error: 'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.' }, 400)
    );
    const { result } = renderHook(() => useImportWorkflow());

    await act(() => result.current.handleFile(file()));

    expect(result.current.state.step).toBe('upload');
    expect(result.current.state.isParsing).toBe(false);
    expect(result.current.state.parseError).toBe(
      'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.'
    );
    expect(result.current.activeSheet).toBeNull();
    expect(result.current.mappingsReady).toBe(false);
  });

  it('reads the file from the picker, then clears the picker so the same file can be chosen again', async () => {
    const { result, calls } = mountWithUpload();
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file()] });
    Object.defineProperty(input, 'value', { value: 'C:\\fakepath\\stock.xlsx', writable: true });

    await act(() =>
      result.current.handleFileChange({ target: input } as unknown as ChangeEvent<HTMLInputElement>)
    );
    expect(calls).toHaveLength(1);
    expect(input.value).toBe('');

    // A cancelled picker uploads nothing.
    const empty = document.createElement('input');
    Object.defineProperty(empty, 'files', { value: [] });
    await act(() =>
      result.current.handleFileChange({ target: empty } as unknown as ChangeEvent<HTMLInputElement>)
    );
    expect(calls).toHaveLength(1);
  });

  it('remaps a column, moving a destination off the column that had it', async () => {
    const { result } = mountWithUpload();
    await act(() => result.current.handleFile(file()));

    act(() => result.current.handleMappingChange('Qty', 'upc'));
    expect(result.current.state.sheets[0].mapping).toEqual({
      UPC: '__ignore__',
      'Item Name': 'item_name',
      Qty: 'upc',
    });
    expect(result.current.mappedCount).toBe(2);
    // The other sheet is untouched.
    expect(result.current.state.sheets[1].mapping.upc).toBe('upc');

    act(() => result.current.handleMappingChange('Qty', '__ignore__'));
    expect(result.current.mappingIssues.map(i => i.category)).toEqual(['Missing identifier']);
    expect(result.current.mappingsReady).toBe(false);
  });

  it('switches sheets only to ones that exist', async () => {
    const { result } = mountWithUpload();
    await act(() => result.current.handleFile(file()));

    act(() => result.current.setActiveSheet(1));
    expect(result.current.activeSheet?.name).toBe('Sheet2');
    act(() => result.current.setActiveSheet(5));
    act(() => result.current.setActiveSheet(-1));
    expect(result.current.state.activeSheet).toBe(1);
  });

  it('names or clears a sheet category, ignoring an unknown sheet', async () => {
    const { result } = mountWithUpload();
    await act(() => result.current.handleFile(file()));

    act(() => result.current.setSheetCategoryName(1, 'Snacks'));
    expect(result.current.state.sheets[1].categoryName).toBe('Snacks');
    act(() => result.current.setSheetCategoryName(0, ''));
    expect(result.current.state.sheets[0].categoryName).toBeNull();

    const before = result.current.state;
    act(() => result.current.setSheetCategoryName(9, 'Nope'));
    expect(result.current.state).toBe(before);
  });

  it("copies the active sheet's choices to matching headers on other sheets", async () => {
    const { result } = mountWithUpload();
    await act(() => result.current.handleFile(file()));
    act(() => result.current.handleMappingChange('UPC', 'number'));

    act(() => result.current.applyToAllSheets());

    // "upc" matches "UPC" case-insensitively and takes its new choice; the other columns
    // keep what was detected for them.
    expect(result.current.state.sheets[1].mapping).toEqual({
      upc: 'number',
      Name: 'item_name',
      Price: 'sale_price',
    });
  });

  it('applies nothing while no file is loaded', () => {
    stubFetch(() => json({}));
    const { result } = renderHook(() => useImportWorkflow());
    const before = result.current.state;
    act(() => result.current.applyToAllSheets());
    expect(result.current.state).toBe(before);
  });

  it('sends every sheet with its rows, row numbers, category and mapping on confirm', async () => {
    const { result, calls } = mountWithUpload();
    await act(() => result.current.handleFile(file()));
    act(() => result.current.setSheetCategoryName(1, 'Snacks'));

    await act(() => result.current.handleConfirm());

    const confirm = calls[1];
    expect(confirm.url).toBe('/api/inventory/batch-confirm');
    expect(confirm.body.sheetsData).toEqual([
      {
        sheetName: 'Drinks',
        categoryName: 'Drinks',
        rows: drinksSheet.rows,
        rowNumbers: [2, 3],
        mapping: { UPC: 'upc', 'Item Name': 'item_name', Qty: 'quantity' },
      },
      {
        sheetName: 'Sheet2',
        categoryName: 'Snacks',
        rows: snacksSheet.rows,
        mapping: { upc: 'upc', Name: 'item_name', Price: 'sale_price' },
      },
    ]);
    expect(result.current.state.step).toBe('done');
    expect(result.current.state.result).toMatchObject({ added: 2, updated: 1, skipped: 0 });
  });

  it('goes back to mapping with the reason when the import fails', async () => {
    const calls = stubFetch(url =>
      url.endsWith('batch-upload')
        ? json({ sheets: [drinksSheet] })
        : new Response('Import limit reached', { status: 413 })
    );
    const { result } = renderHook(() => useImportWorkflow());
    await act(() => result.current.handleFile(file()));

    await act(() => result.current.handleConfirm());

    expect(calls).toHaveLength(2);
    expect(result.current.state.step).toBe('map');
    expect(result.current.state.parseError).toBe('Import limit reached');
  });

  it('applies conflict choices once, and reports when they cannot be applied', async () => {
    let applyFails = false;
    const calls = stubFetch(url => {
      if (url.endsWith('batch-upload')) return json({ sheets: [drinksSheet] });
      if (applyFails) return json({ error: 'Item changed meanwhile' }, 409);
      return json(importResult);
    });
    const { result } = renderHook(() => useImportWorkflow());
    await act(() => result.current.handleFile(file()));
    await act(() => result.current.handleConfirm());

    // Nothing chosen: nothing sent.
    await act(() => result.current.applyConflictChoices([]));
    expect(calls).toHaveLength(2);

    await act(() => result.current.applyConflictChoices([{ sheet_index: 0, row_index: 1 }]));
    expect(calls[2].body).toEqual({
      sheetsData: [
        {
          sheetName: 'Drinks',
          categoryName: 'Drinks',
          rows: [drinksSheet.rows[1]],
          rowNumbers: [3],
          mapping: { UPC: 'upc', 'Item Name': 'item_name', Qty: 'quantity' },
        },
      ],
      identifierConflicts: 'use_file',
    });
    expect(result.current.state.resolution).toMatchObject({ status: 'done', applied: 1 });

    applyFails = true;
    await act(() => result.current.applyConflictChoices([{ sheet_index: 0, row_index: 0 }]));
    expect(result.current.state.resolution).toEqual({
      status: 'failed',
      error: 'Item changed meanwhile',
    });
  });

  it('ignores a second apply while the first is still running', async () => {
    let release!: (r: Response) => void;
    const calls = stubFetch(url => {
      if (url.endsWith('batch-upload')) return json({ sheets: [drinksSheet] });
      if (calls.length === 2) return json(importResult);
      return new Promise<Response>(resolve => {
        release = resolve;
      });
    });
    const { result } = renderHook(() => useImportWorkflow());
    await act(() => result.current.handleFile(file()));
    await act(() => result.current.handleConfirm());

    let first!: Promise<void>;
    act(() => {
      first = result.current.applyConflictChoices([{ sheet_index: 0, row_index: 0 }]);
    });
    await act(() => result.current.applyConflictChoices([{ sheet_index: 0, row_index: 1 }]));
    expect(calls).toHaveLength(3);

    await act(async () => {
      release(json(importResult));
      await first;
    });
    expect(result.current.state.resolution).toMatchObject({ status: 'done' });
  });

  it('drops a parse answer for a file the owner has already replaced', async () => {
    const releases: Array<(r: Response) => void> = [];
    stubFetch(
      () =>
        new Promise<Response>(resolve => {
          releases.push(resolve);
        })
    );
    const { result } = renderHook(() => useImportWorkflow());

    let firstUpload!: Promise<void>;
    act(() => {
      firstUpload = result.current.handleFile(file('old.xlsx'));
    });
    let secondUpload!: Promise<void>;
    act(() => {
      secondUpload = result.current.handleFile(file('new.xlsx'));
    });

    await act(async () => {
      releases[1](json({ sheets: [drinksSheet] }));
      await secondUpload;
      releases[0](json({ error: 'old file broke' }, 400));
      await firstUpload;
    });

    expect(result.current.state.file?.name).toBe('new.xlsx');
    expect(result.current.state.step).toBe('map');
    expect(result.current.state.parseError).toBeNull();
  });

  it('warns about a sheet with no name column without holding the import back', async () => {
    const priceSheet = {
      name: 'Prices',
      headers: ['UPC', 'Price'],
      rows: [{ UPC: '111', Price: 2 }],
      rowCount: 1,
    };
    const { result } = mountWithUpload([priceSheet]);
    await act(() => result.current.handleFile(file()));

    expect(result.current.mappingWarnings.map(w => w.category)).toEqual(['No item name column']);
    expect(result.current.mappingIssues).toEqual([]);
    expect(result.current.mappingsReady).toBe(true);

    // Mapping a column to the name clears it.
    act(() => result.current.handleMappingChange('Price', 'item_name'));
    expect(result.current.mappingWarnings).toEqual([]);
  });

  it('starts over from a clean slate', async () => {
    const { result } = mountWithUpload();
    await act(() => result.current.handleFile(file()));
    await act(() => result.current.handleConfirm());

    act(() => result.current.reset());

    expect(result.current.state).toMatchObject({
      step: 'upload',
      file: null,
      sheets: [],
      result: null,
      resolution: { status: 'idle' },
    });
  });
});

// ── How importApi reads the server's answers ─────────────────────────────────

describe('importApi response handling', () => {
  it('cleans up sheet data: names, headers, rows, row numbers and counts', async () => {
    stubFetch(() =>
      json({
        sheets: [
          {
            name: '   ',
            headers: [' UPC ', 7, null, '', { x: 1 }],
            preview: [{ UPC: '1' }, 'junk', null],
            rows: [{ UPC: '1' }, [1, 2]],
            rowNumbers: [0],
            rowCount: -3,
            headerRowNumber: 0,
            sourceColumnCount: 'many',
          },
          { headers: 'not a list', rows: [{ a: 1 }, { a: 2 }], rowNumbers: [5, 6], rowCount: 9.7 },
        ],
      })
    );

    const { sheets, hiddenSheets } = await uploadFile(file());

    expect(hiddenSheets).toEqual([]);
    expect(sheets[0]).toMatchObject({
      name: 'Sheet 1',
      categoryName: null,
      headers: ['UPC', '7'],
      preview: [{ UPC: '1' }],
      rows: [{ UPC: '1' }],
      // Row numbers that do not line up one per row are dropped, not guessed at.
      rowNumbers: null,
      rowCount: 1,
      headerRowNumber: null,
      sourceColumnCount: 2,
    });
    expect(sheets[1]).toMatchObject({
      name: 'Sheet 2',
      headers: [],
      rowNumbers: [5, 6],
      rowCount: 9,
    });
  });

  it.each([
    ['a body that is not an object', ['nope']],
    ['no sheets list', { sheets: 'x' }],
    ['a sheet that is not an object', { sheets: ['x'] }],
  ])('rejects an upload answer with %s', async (_label, body) => {
    stubFetch(() => json(body));
    await expect(uploadFile(file())).rejects.toThrow(
      'Invalid response from server while parsing file.'
    );
  });

  it('rejects an upload with no data sheets', async () => {
    stubFetch(() => json({ sheets: [] }));
    await expect(uploadFile(file())).rejects.toThrow(/No data sheets found/);
  });

  it('rejects an upload answer that is not JSON', async () => {
    stubFetch(() => new Response('<html>', { status: 200 }));
    await expect(uploadFile(file())).rejects.toThrow(
      'Invalid response from server while parsing file.'
    );
  });

  it('turns an error reply into a readable message', async () => {
    stubFetch(() => json({ error: 'Too many rows' }, 400));
    await expect(uploadFile(file())).rejects.toThrow('Too many rows');

    // JSON without an error field gets the generic message, not raw JSON.
    stubFetch(() => json({ detail: 'x' }, 400));
    await expect(uploadFile(file())).rejects.toThrow('Failed to parse file');

    // A plain-text reply is shown as written.
    stubFetch(() => new Response('File too large', { status: 413 }));
    await expect(uploadFile(file())).rejects.toThrow('File too large');

    stubFetch(() => new Response('   ', { status: 502 }));
    await expect(uploadFile(file())).rejects.toThrow('Failed to parse file');
  });

  function sheet(overrides: Partial<SheetData> = {}): SheetData {
    return {
      name: 'Drinks',
      categoryName: 'Drinks',
      headers: ['UPC'],
      headerRowNumber: 1,
      sourceColumnCount: 1,
      preview: [],
      rows: [{ UPC: '1' }, { UPC: '2' }],
      rowNumbers: null,
      rowCount: 2,
      mapping: { UPC: 'upc' },
      ...overrides,
    };
  }

  it('reads a full import result, cleaning up every list', async () => {
    stubFetch(() =>
      json({
        added: 3.9,
        updated: 0,
        skipped: 2,
        errors: [' Row 4: bad price ', 5, ''],
        skipped_rows: [
          { row_num: 4, sheet: ' Drinks ', item_name: ' Cola ' },
          { row_num: 'x' },
          'junk',
        ],
        conflicts: [
          {
            kind: 'different_values',
            sheet: 'Drinks',
            sheet_index: 0,
            row_index: 1,
            item_name: 'Seltzer',
            catalog_item: 'Lime Seltzer',
            message: 'UPC differs',
            differences: [
              { field: 'upc', label: 'UPC', file_value: '2', catalog_value: '9' },
              { field: 'colour', label: 'Colour' },
              'junk',
            ],
          },
          { kind: 'other', sheet_index: 0, row_index: 0 },
          { kind: 'two_items', sheet_index: -1, row_index: 0 },
        ],
        conflict_rows: [
          { kind: 'two_items', sheet_index: 0, row_index: 1 },
          { kind: 'two_items', sheet_index: 0 },
          'junk',
        ],
      })
    );

    const result = await confirmImport([sheet()]);

    expect(result).toEqual({
      added: 3,
      updated: 0,
      skipped: 2,
      errors: ['Row 4: bad price'],
      errors_total: 1,
      skipped_rows: [
        { row_num: 4, sheet: 'Drinks', item_name: 'Cola' },
        { row_num: 0, sheet: 'Unknown sheet', item_name: 'Unknown item' },
      ],
      conflicts: [
        {
          kind: 'different_values',
          sheet: 'Drinks',
          sheet_index: 0,
          row_index: 1,
          // Without a row number, the spreadsheet row is the data row plus the header row.
          row_num: 3,
          item_name: 'Seltzer',
          catalog_item: 'Lime Seltzer',
          message: 'UPC differs',
          differences: [{ field: 'upc', label: 'UPC', file_value: '2', catalog_value: '9' }],
        },
      ],
      conflicts_total: 1,
      conflict_rows: [{ sheet_index: 0, row_index: 1, kind: 'two_items' }],
    });
  });

  it('keeps the server totals when it caps the lists', async () => {
    stubFetch(() =>
      json({ ...importResult, errors: ['a'], errors_total: 250, conflicts_total: 40 })
    );
    const result = await confirmImport([sheet()]);
    expect(result.errors_total).toBe(250);
    expect(result.conflicts_total).toBe(40);
  });

  it.each([
    ['is not an object', 'oops'],
    ['has no added count', { updated: 0, skipped: 0 }],
    ['has a negative count', { added: -1, updated: 0, skipped: 0 }],
  ])('rejects an import result that %s', async (_label, body) => {
    stubFetch(() => json(body));
    await expect(confirmImport([sheet()])).rejects.toThrow(
      'Invalid response from server during import.'
    );
  });

  it('sends only the chosen rows when applying file identifiers, skipping unknown positions', async () => {
    const calls = stubFetch(() => json(importResult));
    const sheets = [
      sheet({ rowNumbers: [10, 11] }),
      sheet({ name: 'Other', categoryName: null, rows: [{ UPC: '3' }] }),
    ];

    await applyFileIdentifiers(sheets, [
      { sheet_index: 0, row_index: 1 },
      { sheet_index: 1, row_index: 0 },
      { sheet_index: 0, row_index: 0 },
      { sheet_index: 4, row_index: 0 },
      { sheet_index: 1, row_index: 7 },
    ]);

    expect(calls[0].body).toEqual({
      sheetsData: [
        {
          sheetName: 'Drinks',
          categoryName: 'Drinks',
          rows: [{ UPC: '2' }, { UPC: '1' }],
          rowNumbers: [11, 10],
          mapping: { UPC: 'upc' },
        },
        { sheetName: 'Other', categoryName: null, rows: [{ UPC: '3' }], mapping: { UPC: 'upc' } },
      ],
      identifierConflicts: 'use_file',
    });
  });
});

describe('import mapping display helpers', () => {
  it('shows each kind of cell as the sheet would', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText('Cola')).toBe('Cola');
    expect(cellText(2.5)).toBe('2.5');
    expect(cellText(false)).toBe('false');
    expect(cellText({ text: 'Open link', hyperlink: 'https://x' })).toBe('Open link');
    expect(cellText({ formula: 'A1' })).toBe('{"formula":"A1"}');
  });

  it('counts rows with no identifier, and projects rows onto the mapped fields', () => {
    const sheet = {
      name: 'S',
      categoryName: null,
      headers: ['UPC', 'SKU', 'Name'],
      headerRowNumber: 1,
      sourceColumnCount: 3,
      preview: [],
      rows: [{ UPC: '1' }, { SKU: ' ' }, { Name: 'x' }, { SKU: 'A-1' }],
      rowNumbers: null,
      rowCount: 4,
      mapping: { UPC: 'upc', SKU: 'number', Name: 'item_name' },
    } as SheetData;
    expect(getRowsWithoutIdentifiers(sheet)).toBe(2);
    expect(
      getRowsWithoutIdentifiers({ ...sheet, mapping: { UPC: '__ignore__', SKU: '__ignore__' } })
    ).toBe(4);

    expect(
      projectMappedRow({ UPC: '1', Name: 'Cola', Junk: 'x' }, [
        { source: 'UPC', destination: 'upc', label: 'UPC / Barcode' },
        { source: 'Name', destination: 'item_name', label: 'Item Name' },
      ])
    ).toEqual({ upc: '1', item_name: 'Cola' });
  });
});
