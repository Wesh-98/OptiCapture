import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportMappingPanel } from '../src/components/import/ImportMappingPanel.js';
import {
  applyMappingToMatchingHeaders,
  getImportMappingIssues,
  getMappedColumns,
  getRowsWithoutIdentifiers,
  projectMappedRow,
  setMappingDestination,
  suggestCategoryName,
} from '../src/components/import/mapping.js';
import type { SheetData } from '../src/components/import/types.js';

function makeSheet(overrides: Partial<SheetData> = {}): SheetData {
  return {
    name: 'Inventory',
    categoryName: null,
    headers: ['Product', 'UPC', 'Qty'],
    headerRowNumber: 1,
    sourceColumnCount: 3,
    preview: [{ Product: 'Tea', UPC: '123', Qty: '4' }],
    rows: [{ Product: 'Tea', UPC: '123', Qty: '4' }],
    rowCount: 1,
    mapping: { Product: 'item_name', UPC: 'upc', Qty: 'quantity' },
    ...overrides,
  };
}

describe('import mapping helpers', () => {
  it('keeps destination mappings one-to-one when a field is reassigned', () => {
    const sheet = makeSheet();

    expect(setMappingDestination(sheet, 'Product', 'upc')).toEqual({
      Product: 'upc',
      UPC: '__ignore__',
      Qty: 'quantity',
    });
  });

  it('suggests categories from meaningful worksheet names', () => {
    expect(suggestCategoryName('Beverages')).toBe('Beverages');
    expect(suggestCategoryName('Inventory')).toBeNull();
    expect(suggestCategoryName('Sheet 1')).toBeNull();
  });

  it('applies choices only to matching headers and retains mappings for different headers', () => {
    const source = makeSheet({
      mapping: { Product: 'description', UPC: 'upc', Qty: '__ignore__' },
    });
    const target = makeSheet({
      name: 'Drinks',
      headers: ['product', 'Barcode', 'Stock'],
      preview: [],
      rows: [],
      rowCount: 0,
      mapping: { product: 'item_name', Barcode: 'upc', Stock: 'quantity' },
    });

    const result = applyMappingToMatchingHeaders([source, target], 0);

    expect(result[1].mapping).toEqual({
      product: 'description',
      Barcode: 'upc',
      Stock: 'quantity',
    });
    expect(result[1].mapping).not.toHaveProperty('Product');
    expect(result[1].mapping).not.toHaveProperty('UPC');
  });

  it('validates identifiers across every sheet and reports blank identifier rows', () => {
    const valid = makeSheet({
      rows: [
        { Product: 'Tea', UPC: '123', Qty: '4' },
        { Product: 'Blank', UPC: '', Qty: '2' },
      ],
      rowCount: 2,
    });
    const invalid = makeSheet({
      name: 'No identifier',
      mapping: { Product: 'item_name', UPC: '__ignore__', Qty: 'quantity' },
    });

    expect(getImportMappingIssues([valid])).toEqual([]);
    expect(getImportMappingIssues([valid, invalid])).toEqual([
      {
        category: 'Missing identifier',
        sheetName: 'No identifier',
        message: 'map UPC / Barcode, SKU / Item Number, External Item ID, or External SKU.',
      },
    ]);
    expect(getRowsWithoutIdentifiers(valid)).toBe(1);
  });

  it('blocks import when the worksheet uses more columns than have named headers', () => {
    const mismatch = makeSheet({
      headers: ['external_system'],
      sourceColumnCount: 19,
      mapping: { external_system: 'external_system' },
    });

    expect(getImportMappingIssues([mismatch])).toContainEqual({
      category: 'Missing column headers',
      sheetName: 'Inventory',
      message: 'the worksheet uses 19 columns, but only 1 named header was detected.',
    });
  });

  it('categorizes duplicate destination mappings', () => {
    const duplicate = makeSheet({
      mapping: { Product: 'item_name', UPC: 'upc', Qty: 'upc' },
    });

    expect(getImportMappingIssues([duplicate])).toContainEqual({
      category: 'Duplicate field mapping',
      sheetName: 'Inventory',
      message: 'each Inventory Portal field can only be mapped once (UPC / Barcode is duplicated).',
    });
  });

  it('builds the mapped preview from destination fields', () => {
    const sheet = makeSheet();
    const columns = getMappedColumns(sheet);

    expect(projectMappedRow(sheet.preview[0], columns)).toEqual({
      item_name: 'Tea',
      upc: '123',
      quantity: '4',
    });
  });

  it('renders the field catalog, current mappings, validation, and mapped preview', () => {
    const previewRows = Array.from({ length: 5 }, (_, index) => ({
      Product: `Tea ${index + 1}`,
      UPC: `123-${index + 1}`,
      Qty: String(index + 1),
    }));
    const sheet = makeSheet({ preview: previewRows, rows: previewRows, rowCount: 5 });
    const secondSheet = makeSheet({
      name: 'Beverages',
      categoryName: 'Beverages',
      headers: ['Title', 'Barcode'],
      sourceColumnCount: 2,
      preview: [{ Title: 'Soda', Barcode: '456' }],
      rows: [{ Title: 'Soda', Barcode: '456' }],
      mapping: { Title: 'item_name', Barcode: 'upc' },
    });
    const markup = renderToStaticMarkup(
      createElement(ImportMappingPanel, {
        fileName: 'category-workbook.xlsx',
        sheets: [sheet, secondSheet],
        activeSheet: sheet,
        activeSheetIndex: 0,
        isMultiSheet: true,
        isImporting: false,
        parseError: null,
        totalRows: 6,
        mappedCount: 3,
        mappingIssues: [
          {
            category: 'Missing identifier',
            sheetName: 'Inventory',
            message: 'map a UPC or SKU column.',
          },
        ],
        mappingsReady: true,
        onReset: () => undefined,
        onSelectSheet: () => undefined,
        onCategoryNameChange: () => undefined,
        onApplyToAllSheets: () => undefined,
        onMappingChange: () => undefined,
        onConfirm: () => undefined,
      })
    );

    expect(markup).toContain('Available Inventory Portal fields');
    expect(markup).toContain('Workbook file');
    expect(markup).toContain('category-workbook.xlsx');
    expect(markup).toContain('2 sheets');
    expect(markup).toContain('Beverages');
    expect(markup).toContain('Detected Columns');
    expect(markup).toContain('Barcode');
    expect(markup).toContain('Source data preview: Inventory');
    expect(markup).toContain('Showing 5 of 5 data rows');
    expect(markup).toContain('Mapped preview');
    expect(markup).toContain('from Product');
    expect(markup).toContain('UPC / Barcode');
    expect(markup).toContain('Required option');
    expect(markup).toContain('Mapping Issue');
    expect(markup).toContain('Missing identifier');
    expect(markup).toContain('font-bold text-teal-700">Inventory:</strong>');
    expect(markup).toContain('text-red-600');
    expect(markup).not.toContain('size-3 border-2 border-teal-700');
    expect(markup).not.toContain('System Message');
  });
});
