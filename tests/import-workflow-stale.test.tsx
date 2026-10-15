// @vitest-environment jsdom
/**
 * tests/import-workflow-stale.test.tsx — answers that arrive after the owner has moved on
 * to another import are dropped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useImportWorkflow } from '../src/hooks/useImportWorkflow';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const uploadBody = {
  sheets: [
    {
      name: 'Sheet1',
      headers: ['UPC', 'SKU'],
      headerRowNumber: 1,
      sourceColumnCount: 2,
      preview: [],
      rows: [{ UPC: '049000028911', SKU: '5001' }],
      rowNumbers: [2],
      rowCount: 1,
    },
  ],
  totalRows: 1,
  hiddenSheets: [],
};

const conflict = {
  kind: 'different_values',
  sheet: 'Sheet1',
  sheet_index: 0,
  row_index: 0,
  row_num: 2,
  item_name: 'Coke',
  catalog_item: 'Coke',
  message: 'differs',
  differences: [{ field: 'number', label: 'SKU', file_value: '5001', catalog_value: '100' }],
};

const importBody = {
  added: 0,
  updated: 0,
  skipped: 0,
  errors: [],
  skipped_rows: [],
  conflicts: [conflict],
  conflicts_total: 1,
  conflict_rows: [{ sheet_index: 0, row_index: 0, kind: 'different_values' }],
};

/** fetch that answers uploads and the first import at once, and holds every later request. */
function stubFetch() {
  const held: Array<(response: Response) => void> = [];
  let imports = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/batch-upload')) return Promise.resolve(Response.json(uploadBody));
      imports += 1;
      if (imports === 1) return Promise.resolve(Response.json(importBody));
      return new Promise<Response>(resolve => held.push(resolve));
    })
  );
  return held;
}

describe('useImportWorkflow', () => {
  it('drops a "choices applied" answer that arrives after Import Another File', async () => {
    const held = stubFetch();
    const { result } = renderHook(() => useImportWorkflow());

    await act(() => result.current.handleFile(new File(['x'], 'a.csv')));
    await act(() => result.current.handleConfirm());
    expect(result.current.state.result?.conflicts_total).toBe(1);

    let applying!: Promise<void>;
    act(() => {
      applying = result.current.applyConflictChoices([{ sheet_index: 0, row_index: 0 }]);
    });
    expect(result.current.state.resolution.status).toBe('applying');

    act(() => result.current.reset());
    await act(async () => {
      held[0](Response.json({ ...importBody, updated: 1, conflicts: [], conflicts_total: 0 }));
      await applying;
    });

    expect(result.current.state.step).toBe('upload');
    expect(result.current.state.resolution).toEqual({ status: 'idle' });
    expect(result.current.state.result).toBeNull();
  });

  it('drops an import answer that arrives after the owner started over', async () => {
    const held = stubFetch();
    const { result } = renderHook(() => useImportWorkflow());
    await act(() => result.current.handleFile(new File(['x'], 'a.csv')));
    // The first import answers at once; take that, then hold the second.
    await act(() => result.current.handleConfirm());
    act(() => result.current.reset());
    await act(() => result.current.handleFile(new File(['x'], 'b.csv')));

    let importing!: Promise<void>;
    act(() => {
      importing = result.current.handleConfirm();
    });
    act(() => result.current.reset());
    await act(async () => {
      held[0](Response.json(importBody));
      await importing;
    });

    expect(result.current.state.step).toBe('upload');
    expect(result.current.state.result).toBeNull();
  });
});
