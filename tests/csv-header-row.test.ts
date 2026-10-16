/**
 * tests/csv-header-row.test.ts — a CSV's header row is found the way a workbook's is
 *
 * CSV uploads used to take line 1 as the header, always. Many POS and spreadsheet exports
 * start with a title or "Exported on …" line, and such a file came back as one column named
 * after the title, with every real header shown as data. CSV now goes through the same
 * header-row search as worksheets, and its row numbers are the rows the store sees when it
 * opens the file — they used to drift whenever the file had a blank line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { autoDetect } from '../src/components/import/importApi.js';
import { suggestCategoryName } from '../src/components/import/mapping.js';
import { createTestApp, registerStore, type RegisteredStore } from './helpers.js';

const request = createTestApp();
let store: RegisteredStore;

beforeAll(async () => {
  store = await registerStore(request, { storeName: 'CSV Header Mart', username: 'csvheader' });
});

function upload(csv: string) {
  return request
    .post('/api/inventory/batch-upload')
    .set('Cookie', store.cookie)
    .attach('file', Buffer.from(csv), { filename: 'stock.csv', contentType: 'text/csv' });
}

/** What the import screen sends back for an upload, with its suggested mapping. */
function confirm(body: any) {
  return request
    .post('/api/inventory/batch-confirm')
    .set('Cookie', store.cookie)
    .send({
      sheetsData: body.sheets.map((sheet: any) => ({
        sheetName: sheet.name,
        categoryName: suggestCategoryName(sheet.name),
        rows: sheet.rows,
        rowNumbers: sheet.rowNumbers,
        mapping: autoDetect(sheet.headers),
      })),
    });
}

describe('CSV header row', () => {
  it('still reads an ordinary CSV with its header on line 1', async () => {
    const res = await upload('UPC,Item Name,Qty\n036000291452,Cola,4\n012345678905,Chips,2\n');

    expect(res.status).toBe(200);
    const [sheet] = res.body.sheets;
    expect(sheet.headerRowNumber).toBe(1);
    expect(sheet.headers).toEqual(['UPC', 'Item Name', 'Qty']);
    expect(sheet.rows).toEqual([
      { UPC: '036000291452', 'Item Name': 'Cola', Qty: '4' },
      { UPC: '012345678905', 'Item Name': 'Chips', Qty: '2' },
    ]);
    expect(sheet.rowNumbers).toEqual([2, 3]);
    expect(sheet.rowCount).toBe(2);
  });

  it('skips a title and an export-date line above the headers', async () => {
    const csv = [
      'Corner Shop - Inventory Export',
      'Exported on,2026-10-16',
      '',
      'Product,UPC,Qty,Price',
      'Cola,036000291452,4,1.99',
      'Chips,012345678905,2,2.49',
    ].join('\n');

    const res = await upload(csv);

    expect(res.status).toBe(200);
    const [sheet] = res.body.sheets;
    expect(sheet.headerRowNumber).toBe(4);
    expect(sheet.headers).toEqual(['Product', 'UPC', 'Qty', 'Price']);
    expect(sheet.rows.map((row: any) => row.Product)).toEqual(['Cola', 'Chips']);
    expect(sheet.rowNumbers).toEqual([5, 6]);
    expect(autoDetect(sheet.headers)).toEqual({
      Product: 'item_name',
      UPC: 'upc',
      Qty: 'quantity',
      Price: 'sale_price',
    });
  });

  it('numbers rows as the file does, across blank lines', async () => {
    const res = await upload('UPC,Item Name\n036000291452,Cola\n\n\n012345678905,Chips\n');
    expect(res.body.sheets[0].rowNumbers).toEqual([2, 5]);
  });

  it('numbers a row with a line break inside a quoted cell as one row', async () => {
    const res = await upload('UPC,Item Name\n036000291452,"Cola\n330ml"\n012345678905,Chips\n');
    const [sheet] = res.body.sheets;
    expect(sheet.rows[0]['Item Name']).toBe('Cola\n330ml');
    expect(sheet.rowNumbers).toEqual([2, 3]);
  });

  it('trims headers, renames repeats, and ignores cells past the last header', async () => {
    const res = await upload(' UPC ,Name,name,\n036000291452,Cola,Cola Can,,extra\n');
    const [sheet] = res.body.sheets;
    expect(sheet.headers).toEqual(['UPC', 'Name', 'name (2)']);
    expect(sheet.rows).toEqual([{ UPC: '036000291452', Name: 'Cola', 'name (2)': 'Cola Can' }]);
    // The widest row is still reported, so the screen can warn about unlabelled columns.
    expect(sheet.sourceColumnCount).toBe(5);
  });

  it('drops rows that are blank under every header', async () => {
    const res = await upload('UPC,Item Name\n036000291452,Cola\n,\n , \n');
    expect(res.body.sheets[0].rowCount).toBe(1);
  });

  it('keeps line 1 as the header when no row looks more like one', async () => {
    const res = await upload('Alpha,Beta\nx,y\nz,w\n');
    const [sheet] = res.body.sheets;
    expect(sheet.headerRowNumber).toBe(1);
    expect(sheet.headers).toEqual(['Alpha', 'Beta']);
  });

  it('reads a UTF-8 file with a byte-order mark', async () => {
    const res = await upload('﻿UPC,Item Name\n036000291452,Cola\n');
    expect(res.body.sheets[0].headers).toEqual(['UPC', 'Item Name']);
  });

  it('still refuses a file with a header and no data, or nothing at all', async () => {
    const headerOnly = await upload('Title line\nUPC,Item Name\n');
    expect(headerOnly.status).toBe(400);
    expect(headerOnly.body.error).toBe('File is empty or has no data rows');

    const empty = await upload('\n\n');
    expect(empty.status).toBe(400);
  });

  it('imports a titled CSV end to end, reporting a skipped row by its row in the file', async () => {
    const csv = [
      'Corner Shop - Inventory Export',
      '',
      'Product,UPC,Qty',
      'Titled Cola,036000291452,4',
      'No Barcode Snack,,3',
    ].join('\n');
    const up = await upload(csv);
    expect(up.status).toBe(200);

    const res = await confirm(up.body);

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.skipped_rows).toEqual([
      { row_num: 5, sheet: 'Sheet1', item_name: 'No Barcode Snack' },
    ]);
  });
});
