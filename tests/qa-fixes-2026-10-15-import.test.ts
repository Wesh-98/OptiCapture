/**
 * Regression tests for the import findings of the 2026-10-15 QA run. Each test drives the
 * real upload and confirm routes the way the import screen does: upload, take the headers
 * and suggested mapping the screen would show, send them back.
 */
import ExcelJS from 'exceljs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/server/db.js';
import { normalizeUpc, upcVariants } from '../src/server/helpers.js';
import { autoDetect, confirmImport, uploadFile } from '../src/components/import/importApi.js';
import { cellText, suggestCategoryName } from '../src/components/import/mapping.js';
import { isKnownHeader } from '../src/shared/importHeaders.js';
import { createTestApp, registerStore } from './helpers.js';

const request = createTestApp();
let cookie: string;
let storeId: number;

beforeAll(async () => {
  const store = await registerStore(request, { storeName: 'QA Import Mart', username: 'qaimport' });
  cookie = store.cookie;
  storeId = store.storeId;
});

function upload(buffer: Buffer, filename: string) {
  return request
    .post('/api/inventory/batch-upload')
    .set('Cookie', cookie)
    .attach('file', buffer, { filename, contentType: 'application/octet-stream' });
}

// What the import screen sends back for an uploaded file, before the owner changes anything.
function screenSheets(body: any) {
  return body.sheets.map((sheet: any) => {
    const headers = (sheet.headers as string[]).map(header => header.trim()).filter(Boolean);
    return {
      sheetName: sheet.name,
      categoryName: suggestCategoryName(sheet.name),
      rows: sheet.rows,
      rowNumbers: sheet.rowNumbers,
      mapping: autoDetect(headers),
    };
  });
}

function confirm(sheetsData: unknown[]) {
  return request.post('/api/inventory/batch-confirm').set('Cookie', cookie).send({ sheetsData });
}

async function importFile(buffer: Buffer, filename: string) {
  const up = await upload(buffer, filename);
  expect(up.status).toBe(200);
  return confirm(screenSheets(up.body));
}

async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const item = (upc: string) =>
  db
    .prepare(
      `SELECT i.*, c.name AS category FROM inventory i
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE i.store_id = ? AND i.upc = ?`
    )
    .get(storeId, upc) as Record<string, any> | undefined;

const categoryNames = () =>
  (
    db.prepare('SELECT name FROM categories WHERE store_id = ?').all(storeId) as Array<{
      name: string;
    }>
  ).map(row => row.name);

describe('H1: headers with surrounding spaces', () => {
  it('imports a CSV whose headers are padded', async () => {
    const csv = Buffer.from(' UPC , Item Name ,Price\n110000000001,Padded Chips,2.50\n');
    const up = await upload(csv, 'padded.csv');
    // The rows carry the same trimmed names the screen maps.
    expect(up.body.sheets[0].headers).toEqual(['UPC', 'Item Name', 'Price']);
    expect(Object.keys(up.body.sheets[0].rows[0])).toEqual(['UPC', 'Item Name', 'Price']);
    const res = await confirm(screenSheets(up.body));
    expect(res.body).toMatchObject({ added: 1, skipped: 0 });
    expect(item('110000000001')).toMatchObject({ item_name: 'Padded Chips', sale_price: 2.5 });
  });

  it('imports a JSON file whose keys are padded', async () => {
    const res = await importFile(
      Buffer.from(JSON.stringify([{ ' upc': '110000000002', 'Item Name ': 'Padded Json' }])),
      'padded.json'
    );
    expect(res.body).toMatchObject({ added: 1, skipped: 0 });
  });

  it('still reads padded row keys sent by an older client that did not trim them', async () => {
    const res = await confirm([
      {
        sheetName: 'Sheet1',
        rows: [{ ' UPC ': '110000000003', ' Name ': 'Old Client Row' }],
        mapping: { UPC: 'upc', Name: 'item_name' },
      },
    ]);
    expect(res.body.added).toBe(1);
  });
});

describe('H2: finding the header row of a worksheet', () => {
  it('keeps the header when one data row has a note in a spare column', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Snacks');
      ws.addRow(['UPC', 'Item Name', 'Price']);
      ws.addRow(['120000000001', 'Pretzels', 2]);
      ws.addRow(['120000000002', 'Popcorn', 3, '', 'note: discontinued']);
    });
    const up = await upload(buffer, 'wide.xlsx');
    expect(up.body.sheets[0]).toMatchObject({
      headerRowNumber: 1,
      headers: ['UPC', 'Item Name', 'Price'],
    });
  });

  it('keeps a header whose labels contain field names, over a data row holding "UPC"', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Data');
      ws.addRow(['Product Name Details', 'Barcode Value']);
      ws.addRow(['UPC', 'Widget', 'note']);
      ws.addRow(['Gadget', '12345', 'x']);
    });
    const up = await upload(buffer, 'partial.xlsx');
    expect(up.body.sheets[0]).toMatchObject({
      headerRowNumber: 1,
      headers: ['Product Name Details', 'Barcode Value'],
    });
  });

  it('counts exact-only names and whole-word names as headers, but not unimported ones', () => {
    expect(
      ['Item', 'Size', 'Active', 'Product Name Details', 'UPC Code'].map(isKnownHeader)
    ).toEqual([true, true, true, true, true]);
    expect(['Unit Cost', 'Inactive Date', 'Item Type', 'Vendor Name'].map(isKnownHeader)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps a header with unfamiliar labels and an unlabeled column', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Data');
      ws.addRow(['Barcode #', 'Product Description', '', 'Retail']);
      ws.addRow(['120000000011', 'Thing One', 'x', 2]);
    });
    const up = await upload(buffer, 'nohint.xlsx');
    expect(up.body.sheets[0].headerRowNumber).toBe(1);
  });
});

describe('H3: identifiers that disagree with the catalog', () => {
  const resend = (rows: Array<{ sheet_index: number; row_index: number }>, sheets: any[]) =>
    request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', cookie)
      .send({
        identifierConflicts: 'use_file',
        sheetsData: sheets.map((sheet, index) => {
          const picked = rows.filter(row => row.sheet_index === index).map(row => row.row_index);
          return {
            ...sheet,
            rows: picked.map(i => sheet.rows[i]),
            rowNumbers: picked.map(i => sheet.rowNumbers[i]),
          };
        }),
      });

  it('holds back a row whose SKU belongs to an item with a different UPC', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, number, quantity, store_id) VALUES ('Original A', '130000000001', 'SKU-A', 5, ?)"
    ).run(storeId);
    const res = await importFile(
      Buffer.from('UPC,SKU,Item Name,Qty\n130000000002,SKU-A,Different Product,9\n'),
      'conflict.csv'
    );
    expect(res.body).toMatchObject({ updated: 0, errors_total: 0, conflicts_total: 1 });
    expect(res.body.conflicts[0]).toMatchObject({
      kind: 'different_values',
      sheet: 'Sheet1',
      sheet_index: 0,
      row_index: 0,
      row_num: 2,
      catalog_item: 'Original A',
      differences: [
        { field: 'upc', label: 'UPC', file_value: '130000000002', catalog_value: '130000000001' },
      ],
    });
    expect(res.body.conflict_rows).toEqual([
      { sheet_index: 0, row_index: 0, kind: 'different_values' },
    ]);
    expect(item('130000000001')).toMatchObject({ item_name: 'Original A', quantity: 5 });
    expect(item('130000000002')).toBeUndefined();
  });

  it('gives the item the file’s values when the owner chooses that for the row', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, number, quantity, store_id) VALUES ('Renumbered', '130000000031', 'OLD-1', 5, ?)"
    ).run(storeId);
    const up = await upload(
      Buffer.from(
        'UPC,SKU,Item Name,Qty\n130000000099,UNRELATED,Untouched,1\n130000000031,NEW-1,Renumbered,24\n'
      ),
      'renumber.csv'
    );
    const sheets = screenSheets(up.body);
    const first = await confirm(sheets);
    expect(first.body.conflicts[0]).toMatchObject({
      row_index: 1,
      differences: [{ field: 'number', file_value: 'NEW-1', catalog_value: 'OLD-1' }],
    });

    const second = await resend(first.body.conflict_rows, sheets);
    expect(second.body).toMatchObject({ added: 0, updated: 1, conflicts_total: 0, errors: [] });
    expect(item('130000000031')).toMatchObject({ number: 'NEW-1', quantity: 24 });
  });

  it('holds back a row whose identifiers belong to two different items, even on request', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Item X', '130000000011', 1, ?)"
    ).run(storeId);
    db.prepare(
      "INSERT INTO inventory (item_name, upc, external_system, external_item_id, quantity, store_id) VALUES ('Item Y', '130000000012', 'pos', 'EXT-Y', 1, ?)"
    ).run(storeId);
    const up = await upload(
      Buffer.from(
        'UPC,Item Name,External System,External Item ID\n130000000011,Renamed,pos,EXT-Y\n'
      ),
      'xy.csv'
    );
    const sheets = screenSheets(up.body);
    const first = await confirm(sheets);
    expect(first.body.conflicts[0]).toMatchObject({ kind: 'two_items', differences: [] });
    expect(first.body.conflicts[0].message).toContain('belongs to "Item Y"');
    expect(first.body.conflicts[0].message).toContain('belongs to "Item X"');

    const second = await resend(first.body.conflict_rows, sheets);
    expect(second.body).toMatchObject({ updated: 0, conflicts_total: 1 });
    expect(item('130000000011')?.item_name).toBe('Item X');
    expect(item('130000000012')?.item_name).toBe('Item Y');
  });

  it('refuses an unknown conflict choice', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', cookie)
      .send({
        identifierConflicts: 'overwrite',
        sheetsData: [{ sheetName: 'S', rows: [{ UPC: '1' }], mapping: { UPC: 'upc' } }],
      });
    expect(res.status).toBe(400);
  });

  it('lists every conflicting row even past the detail cap', async () => {
    const insert = db.prepare(
      'INSERT INTO inventory (item_name, upc, number, quantity, store_id) VALUES (?, ?, ?, 1, ?)'
    );
    const lines = ['UPC,SKU'];
    for (let i = 0; i < 510; i++) {
      const upc = `7${String(i).padStart(11, '0')}`;
      insert.run(`Cap ${i}`, upc, `CAP-OLD-${i}`, storeId);
      lines.push(`${upc},CAP-NEW-${i}`);
    }
    const res = await importFile(Buffer.from(lines.join('\n')), 'cap.csv');
    expect(res.body.conflicts_total).toBe(510);
    expect(res.body.conflicts).toHaveLength(500);
    expect(res.body.conflict_rows).toHaveLength(510);
  });

  it('fills in an identifier the matched item does not have yet', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, number, quantity, store_id) VALUES ('No UPC Yet', 'SKU-FILL', 1, ?)"
    ).run(storeId);
    const res = await importFile(
      Buffer.from('UPC,SKU,Item Name\n130000000021,SKU-FILL,No UPC Yet\n'),
      'fill.csv'
    );
    expect(res.body).toMatchObject({ updated: 1, errors: [], conflicts_total: 0 });
    expect(item('130000000021')?.number).toBe('SKU-FILL');
  });

  it('refuses a second row that reaches the same item by another identifier', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, number, quantity, store_id) VALUES ('Two Ways', '130000000041', 'TWO-WAYS', 1, ?)"
    ).run(storeId);
    const res = await importFile(
      Buffer.from('UPC,SKU,Item Name,Qty\n130000000041,,By UPC,5\n,TWO-WAYS,By SKU,9\n'),
      'twoways.csv'
    );
    expect(res.body.updated).toBe(1);
    expect(res.body.errors[0]).toContain('already in this file at Sheet "Sheet1" row 2');
    expect(item('130000000041')).toMatchObject({ item_name: 'By UPC', quantity: 5 });
  });
});

describe('H4: barcodes that lost their leading zero', () => {
  it('upcVariants links the 11-, 12- and 13-digit forms', () => {
    expect(upcVariants('12345678905')).toEqual(['12345678905', '012345678905', '0012345678905']);
    expect(upcVariants('012345678905')).toEqual(['012345678905', '0012345678905', '12345678905']);
    expect(upcVariants('0012345678905')).toEqual(['0012345678905', '012345678905', '12345678905']);
  });

  it('restores the zero of a UPC Excel stored as a number', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Products');
      ws.addRow(['UPC', 'Item Name']);
      ws.addRow([36000291452, 'Number Cell UPC']); // typed as 036000291452
    });
    const res = await importFile(buffer, 'zero.xlsx');
    expect(res.body.added).toBe(1);
    expect(item('036000291452')?.item_name).toBe('Number Cell UPC');
  });

  it('refuses a manual add of a code already stored without its zero', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Stored 11 digit', '49000028911', 1, ?)"
    ).run(storeId);
    const res = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Same product', upc: '049000028911' });
    expect(res.status).toBe(409);
  });
});

describe('M2: UPC values a spreadsheet mangled', () => {
  it('normalizeUpc strips separators from numeric codes and refuses number formats', () => {
    expect(normalizeUpc(' 0 12345 67890 5 ')).toEqual({ value: '012345678905' });
    expect(normalizeUpc('012345-678905')).toEqual({ value: '012345678905' });
    expect(normalizeUpc('ABC-123')).toEqual({ value: 'ABC-123' });
    expect(normalizeUpc('1.23457E+11')).toHaveProperty('error');
    expect(normalizeUpc('12345678905.0')).toHaveProperty('error');
    expect(normalizeUpc('12\u00003')).toHaveProperty('error');
  });

  it('stores an import UPC without separators and refuses a scientific one', async () => {
    const res = await importFile(
      Buffer.from('UPC,Item Name\n0 70847 81116 9,Spaced\n7.08478E+11,Scientific\n'),
      'upcfmt.csv'
    );
    expect(res.body.added).toBe(1);
    expect(item('070847811169')?.item_name).toBe('Spaced');
    expect(res.body.errors[0]).toContain('looks like a number Excel reformatted');
  });

  it('normalises the UPC on manual add and edit', async () => {
    const add = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Typed with spaces', upc: '0 41000 00526 4' });
    expect(add.status).toBe(200);
    expect(item('041000005264')?.item_name).toBe('Typed with spaces');

    const edit = await request
      .put(`/api/inventory/${add.body.id}`)
      .set('Cookie', cookie)
      .send({ upc: '4.1E+11' });
    expect(edit.status).toBe(400);
  });
});

describe('M3: re-importing an export', () => {
  it('creates no categories from export sheet names', async () => {
    const longName = 'A Category Name Longer Than Thirty One Characters';
    const catId = db
      .prepare("INSERT INTO categories (name, icon, store_id) VALUES (?, 'Package', ?)")
      .run(longName, storeId).lastInsertRowid;
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, category_id, store_id) VALUES ('Long cat item', '140000000001', 1, ?, ?)"
    ).run(catId, storeId);
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('No category', '140000000002', 1, ?)"
    ).run(storeId);

    const before = categoryNames();
    const exported = await request
      .get('/api/inventory/export?format=xlsx')
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const res = await importFile(exported.body as Buffer, 'export.xlsx');

    expect(res.body.errors).toEqual([]);
    expect(categoryNames()).toEqual(before);
    expect(item('140000000001')?.category).toBe(longName);
    expect(item('140000000002')?.category).toBeNull();
  });

  it('does not offer "Uncategorized" as a sheet category', () => {
    expect(suggestCategoryName('Uncategorized')).toBeNull();
  });
});

describe('M4: the CSV export formula guard', () => {
  it('drops the guard apostrophe on re-import', async () => {
    const res = await importFile(
      Buffer.from(`UPC,Item Name,Tags\n150000000001,'+1 Energy,'@promo\n`),
      'guard.csv'
    );
    expect(res.body.added).toBe(1);
    expect(item('150000000001')).toMatchObject({ item_name: '+1 Energy', tag_names: '@promo' });
  });
});

describe('M5: CSV encodings', () => {
  it('reads a Windows-1252 CSV', async () => {
    const bytes = Buffer.concat([
      Buffer.from('UPC,Item Name,Price\n160000000001,Caf'),
      Buffer.from([0xe9]),
      Buffer.from(','),
      Buffer.from([0xa3]),
      Buffer.from('3.99\n'),
    ]);
    const res = await importFile(bytes, 'ansi.csv');
    expect(res.body.added).toBe(1);
    expect(item('160000000001')).toMatchObject({ item_name: 'Café', sale_price: 3.99 });
  });
});

describe('M7: error and link cells', () => {
  it('treats #N/A as empty and keeps a link cell’s text unless the column is Image', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Cells');
      ws.addRow(['UPC', 'Item Name', 'Description', 'Image']);
      ws.addRow([
        '170000000001',
        { text: 'Linked Name', hyperlink: 'https://example.com/product' },
        { formula: 'VLOOKUP(A2,X:Y,2,0)', result: { error: '#N/A' } },
        { text: 'photo', hyperlink: 'https://example.com/p.png' },
      ] as any[]);
    });
    const up = await upload(buffer, 'cells.xlsx');
    expect(cellText(up.body.sheets[0].preview[0]['Item Name'])).toBe('Linked Name');
    const res = await confirm(screenSheets(up.body));
    expect(res.body.added).toBe(1);
    expect(item('170000000001')).toMatchObject({
      item_name: 'Linked Name',
      description: '',
      image: 'https://example.com/p.png',
    });
  });
});

describe('M8: status spellings', () => {
  it('accepts common spellings of Active and Inactive', async () => {
    const res = await importFile(
      Buffer.from(
        'UPC,Item Name,Status\n180000000001,a,active\n180000000002,b,NO\n180000000003,c,TRUE\n180000000004,d,maybe\n'
      ),
      'status.csv'
    );
    expect(res.body.added).toBe(3);
    expect(item('180000000002')?.status).toBe('Inactive');
    expect(item('180000000003')?.status).toBe('Active');
    expect(res.body.errors[0]).toContain('Status "maybe"');
  });
});

describe('M9: suggested mappings', () => {
  it('does not map cost, discount or vendor columns to inventory fields', () => {
    expect(autoDetect(['UPC', 'Vendor Name', 'Product Name'])).toMatchObject({
      'Vendor Name': '__ignore__',
      'Product Name': 'item_name',
    });
    expect(autoDetect(['UPC', 'Cost Price', 'Retail Price'])).toMatchObject({
      'Cost Price': '__ignore__',
      'Retail Price': 'sale_price',
    });
    expect(autoDetect(['Discount', 'On Hand', 'Unit Cost', 'Country'])).toEqual({
      Discount: '__ignore__',
      'On Hand': 'quantity',
      'Unit Cost': '__ignore__',
      Country: '__ignore__',
    });
    expect(autoDetect(['Barcode', 'Item Type', 'Category'])).toMatchObject({
      'Item Type': '__ignore__',
      Category: 'category',
    });
  });

  it('uses Description as the name when no other column names the item', () => {
    expect(autoDetect(['UPC', 'Description', 'Price'])).toMatchObject({
      Description: 'item_name',
    });
    expect(autoDetect(['UPC', 'Name', 'Description'])).toMatchObject({
      Name: 'item_name',
      Description: 'description',
    });
  });

  it('recognises PLU, Item and Retail', () => {
    expect(autoDetect(['PLU', 'Item', 'Retail'])).toEqual({
      PLU: 'number',
      Item: 'item_name',
      Retail: 'sale_price',
    });
  });
});

describe('M10: brand', () => {
  it('imports a brand column for new and existing items', async () => {
    const first = await importFile(
      Buffer.from('UPC,Item Name,Brand\n190000000001,Branded,Acme\n'),
      'brand.csv'
    );
    expect(first.body.added).toBe(1);
    expect(item('190000000001')?.brand).toBe('Acme');
    await importFile(Buffer.from('UPC,Brand\n190000000001,Acme Foods\n'), 'brand2.csv');
    expect(item('190000000001')?.brand).toBe('Acme Foods');
  });
});

describe('Lows', () => {
  it('L1: reports the file row of a skipped row, and places errors', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Report');
      ws.addRow(['Store Inventory Report']);
      ws.addRow([]);
      ws.addRow(['UPC', 'Item Name', 'Price']);
      ws.addRow(['200000000001', 'Row Four', 1]);
      ws.addRow([]);
      ws.addRow(['', 'Row Six no id', 1]);
      ws.addRow(['200000000007', 'Row Seven', 'free']);
    });
    const res = await importFile(buffer, 'title.xlsx');
    expect(res.body.skipped_rows).toEqual([
      { row_num: 6, sheet: 'Report', item_name: 'Row Six no id' },
    ]);
    expect(res.body.errors[0]).toMatch(/^Sheet "Report" row 7 /);
  });

  it('L2: refuses a second row for the same item in one file', async () => {
    const res = await importFile(
      Buffer.from('UPC,Item Name\n210000000001,First\n210000000001,Second\n'),
      'twice.csv'
    );
    expect(res.body.added).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.errors[0]).toContain('already in this file at Sheet "Sheet1" row 2');
    expect(item('210000000001')?.item_name).toBe('First');
  });

  it('L3: a refused row creates no category', async () => {
    await importFile(
      Buffer.from('UPC,Item Name,Category\n220000000001,,Ghost Category\n'),
      'ghost.csv'
    );
    expect(categoryNames()).not.toContain('Ghost Category');
  });

  it('L4: leaves hidden worksheets out and names them', async () => {
    const buffer = await workbook(wb => {
      const shown = wb.addWorksheet('Shown');
      shown.addRow(['UPC', 'Item Name']);
      shown.addRow(['230000000001', 'Visible']);
      const hidden = wb.addWorksheet('Old Stock');
      hidden.state = 'hidden';
      hidden.addRow(['UPC', 'Item Name']);
      hidden.addRow(['230000000002', 'Hidden']);
    });
    const up = await upload(buffer, 'hidden.xlsx');
    expect(up.body.sheets.map((sheet: any) => sheet.name)).toEqual(['Shown']);
    expect(up.body.hiddenSheets).toEqual(['Old Stock']);
  });

  it('L5: refuses a CSV with a header and no rows', async () => {
    const up = await upload(Buffer.from('UPC,Item Name\n'), 'empty.csv');
    expect(up.status).toBe(400);
  });

  it('L6: drops fields beyond the CSV header', async () => {
    const up = await upload(Buffer.from('UPC,Item Name\n1,x,extra\n'), 'extra.csv');
    expect(up.body.sheets[0].headers).toEqual(['UPC', 'Item Name']);
    expect(up.body.sheets[0].rows[0]).toEqual({ UPC: '1', 'Item Name': 'x' });
  });

  it('L7: refuses hex and exponent numbers', async () => {
    const res = await importFile(
      Buffer.from('UPC,Item Name,Price\n240000000001,Hex,0x10\n240000000002,Exp,1e3\n'),
      'nums.csv'
    );
    expect(res.body.added).toBe(0);
    expect(res.body.errors_total).toBe(2);
  });

  it('L8: treats repeated spaces in a category name as one', async () => {
    await importFile(
      Buffer.from(
        'UPC,Item Name,Category\n250000000001,A,Cold  Drinks\n250000000002,B,Cold Drinks\n'
      ),
      'ws.csv'
    );
    expect(categoryNames().filter(name => /cold/i.test(name))).toEqual(['Cold Drinks']);
  });
});

describe('the import screen’s requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads row numbers and hidden sheets from the upload and sends the row numbers back', async () => {
    const buffer = await workbook(wb => {
      const ws = wb.addWorksheet('Report');
      ws.addRow(['Title']);
      ws.addRow(['UPC', 'Item Name']);
      ws.addRow(['260000000001', 'Screen Row']);
      const hidden = wb.addWorksheet('Old');
      hidden.state = 'hidden';
      hidden.addRow(['UPC']);
      hidden.addRow(['1']);
    });
    const uploadRes = await upload(buffer, 'screen.xlsx');
    let sentBody: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/batch-upload')) return Response.json(uploadRes.body);
        sentBody = JSON.parse(String(init?.body));
        return Response.json({ added: 1, updated: 0, skipped: 0, errors: [], skipped_rows: [] });
      })
    );

    const parsed = await uploadFile(new File(['x'], 'screen.xlsx'));
    expect(parsed.hiddenSheets).toEqual(['Old']);
    expect(parsed.sheets[0].rowNumbers).toEqual([3]);

    await confirmImport(parsed.sheets);
    expect(sentBody.sheetsData[0].rowNumbers).toEqual([3]);
  });
});
