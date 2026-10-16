/**
 * tests/import-product-header.test.tsx — a bare "Product" column is the item name, and a
 * sheet with no item name column says so before import
 *
 * Many POS exports title the name column just "Product". It used to be left unmapped, and
 * since nothing flagged a sheet with no name column, an owner who missed it saw every new
 * item refused only on the result screen ("Item name is required for a new item").
 */
import ExcelJS from 'exceljs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { autoDetect } from '../src/components/import/importApi.js';
import { ImportMappingPanel } from '../src/components/import/ImportMappingPanel.js';
import {
  getImportMappingIssues,
  getImportMappingWarnings,
} from '../src/components/import/mapping.js';
import type { SheetData } from '../src/components/import/types.js';
import { isKnownHeader } from '../src/shared/importHeaders.js';
import { createTestApp, registerStore, type RegisteredStore } from './helpers.js';

function sheet(headers: string[], overrides: Partial<SheetData> = {}): SheetData {
  return {
    name: 'Drinks',
    categoryName: 'Drinks',
    headers,
    headerRowNumber: 1,
    sourceColumnCount: headers.length,
    preview: [],
    rows: [],
    rowNumbers: null,
    rowCount: 0,
    mapping: autoDetect(headers),
    ...overrides,
  };
}

describe('detecting a "Product" column', () => {
  it('maps a header of exactly "Product" to the item name, in any case or spacing', () => {
    expect(autoDetect(['UPC', 'Product', 'Qty'])).toEqual({
      UPC: 'upc',
      Product: 'item_name',
      Qty: 'quantity',
    });
    expect(autoDetect(['  PRODUCT '])['  PRODUCT ']).toBe('item_name');
  });

  it('leaves longer headers that merely contain "product" to their own rules', () => {
    expect(autoDetect(['Product ID'])).toEqual({ 'Product ID': 'number' });
    expect(autoDetect(['Product Name'])).toEqual({ 'Product Name': 'item_name' });
    expect(autoDetect(['Product Category'])).toEqual({ 'Product Category': 'category' });
    // Beside a name column, "Product Description" stays the description. (Alone, the
    // existing rule promotes a lone description column to the name.)
    expect(autoDetect(['Product', 'Product Description'])).toEqual({
      Product: 'item_name',
      'Product Description': 'description',
    });
    // Not a name, and not anything else we import.
    expect(autoDetect(['Product Type'])).toEqual({ 'Product Type': '__ignore__' });
  });

  it('keeps Description as the description once "Product" supplies the name', () => {
    expect(autoDetect(['Product', 'Description', 'UPC'])).toEqual({
      Product: 'item_name',
      Description: 'description',
      UPC: 'upc',
    });
    // Without a name column, Description is still promoted to the name, as before.
    expect(autoDetect(['Description', 'UPC'])).toEqual({ Description: 'item_name', UPC: 'upc' });
  });

  it('gives the name to the first name-like column and leaves "Product" alone after it', () => {
    expect(autoDetect(['Item Name', 'Product', 'UPC'])).toEqual({
      'Item Name': 'item_name',
      Product: '__ignore__',
      UPC: 'upc',
    });
  });

  it('counts "Product" as a header when the server looks for the header row', () => {
    expect(isKnownHeader('Product')).toBe(true);
    expect(isKnownHeader('Product Type')).toBe(false);
  });
});

describe('warning about a sheet with no item name column', () => {
  it('warns for each sheet without one, and not for sheets that have one', () => {
    const named = sheet(['Product', 'UPC']);
    const priceOnly = sheet(['UPC', 'Price'], { name: 'Price update' });

    expect(getImportMappingWarnings([named])).toEqual([]);
    expect(getImportMappingWarnings([named, priceOnly])).toEqual([
      {
        category: 'No item name column',
        sheetName: 'Price update',
        message:
          'items already in your catalog will update, but new items will be skipped. Map the column that holds product names to Item Name to add them.',
      },
    ]);
  });

  it('is a warning only: a UPC + price sheet has no blocking issue', () => {
    expect(getImportMappingIssues([sheet(['UPC', 'Price'])])).toEqual([]);
  });

  it('goes away once a column is mapped to the item name by hand', () => {
    const unmapped = sheet(['UPC', 'Label']);
    expect(getImportMappingWarnings([unmapped])).toHaveLength(1);
    const mapped = { ...unmapped, mapping: { ...unmapped.mapping, Label: 'item_name' as const } };
    expect(getImportMappingWarnings([mapped])).toEqual([]);
  });

  it('is shown on the mapping screen as a heads-up, beside any real issues', () => {
    const active = sheet(['UPC', 'Price']);
    const render = (warnings: ReturnType<typeof getImportMappingWarnings>) =>
      renderToStaticMarkup(
        createElement(ImportMappingPanel, {
          fileName: 'prices.csv',
          sheets: [active],
          activeSheet: active,
          activeSheetIndex: 0,
          isMultiSheet: false,
          isImporting: false,
          parseError: null,
          totalRows: 0,
          mappedCount: 2,
          mappingIssues: [],
          mappingWarnings: warnings,
          mappingsReady: true,
          onReset: () => undefined,
          onSelectSheet: () => undefined,
          onCategoryNameChange: () => undefined,
          onApplyToAllSheets: () => undefined,
          onMappingChange: () => undefined,
          onConfirm: () => undefined,
        })
      );

    const markup = render(getImportMappingWarnings([active]));
    expect(markup).toContain('Check before importing');
    expect(markup).toContain('Heads Up');
    expect(markup).toContain('No item name column');
    expect(markup).toContain('new items will be skipped');
    expect(markup).not.toContain('Mapping needs attention');

    expect(render([])).not.toContain('Check before importing');
  });
});

describe('server: finding the header row of an export titled "Product"', () => {
  const request = createTestApp();
  let store: RegisteredStore;

  beforeAll(async () => {
    store = await registerStore(request, {
      storeName: 'Product Header Store',
      username: 'prodhdr',
    });
  });

  it('picks the row with "Product" as the header, not a title line above it', async () => {
    // Without "Product" recognised, the title row and the header row score the same (three
    // words each) and the title row, coming first, won.
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Drinks');
    ws.addRow(['Weekly', 'Corner', 'Report']);
    ws.addRow(['Product', 'Aisle', 'Shelf']);
    ws.addRow(['Cola', 'Front', 'Top']);
    ws.addRow(['Chips', 'Back', 'Low']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', store.cookie)
      .attach('file', buffer, 'stock.xlsx');

    expect(res.status).toBe(200);
    const [parsed] = res.body.sheets;
    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.headers).toEqual(['Product', 'Aisle', 'Shelf']);
    expect(parsed.rows.map((row: Record<string, string>) => row.Product)).toEqual([
      'Cola',
      'Chips',
    ]);
    expect(autoDetect(parsed.headers).Product).toBe('item_name');
  });
});
