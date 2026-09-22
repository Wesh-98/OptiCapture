import ExcelJS from 'exceljs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

const request = createTestApp();

function binaryParser(res: any, callback: (err: Error | null, data?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  );
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (err: Error) => callback(err));
}

let adminCookie: string;
let takerCookie: string;

beforeAll(async () => {
  const adminStoreCode = getStoreCode(1);
  adminCookie = await login(request, 'admin', 'admin123', adminStoreCode);
  takerCookie = await login(request, 'taker', 'taker123', adminStoreCode);
});

beforeEach(() => {
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
  db.prepare(
    "DELETE FROM categories WHERE store_id = 1 AND name IN ('Beverages', 'Inventory', 'Imported Department', 'Sheet Department')"
  ).run();
});

describe('inventory listing and export', () => {
  it('filters inventory by search query and category', async () => {
    const categories = db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 2')
      .all() as Array<{ id: number }>;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Cola Bottle', 5, categories[0].id, 'inv-filter-1');
    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Potato Chips', 3, categories[1].id, 'inv-filter-2');

    const searchRes = await request
      .get('/api/inventory')
      .set('Cookie', adminCookie)
      .query({ q: 'cola' });
    const categoryRes = await request
      .get('/api/inventory')
      .set('Cookie', adminCookie)
      .query({ category_id: String(categories[1].id) });

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items).toHaveLength(1);
    expect(searchRes.body.items[0].item_name).toBe('Cola Bottle');

    expect(categoryRes.status).toBe(200);
    expect(categoryRes.body.items).toHaveLength(1);
    expect(categoryRes.body.items[0].item_name).toBe('Potato Chips');
  });

  it('treats LIKE metacharacters in search query as literals', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id) VALUES (?, ?, ?, 'Active', ?, 1)`
    ).run('50% Off Special', 1, categoryId, 'like-wildcard-1');
    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id) VALUES (?, ?, ?, 'Active', ?, 1)`
    ).run('Regular Item', 2, categoryId, 'like-wildcard-2');

    // '%' would match everything without escaping — should only match the one item that literally contains '%'
    const res = await request.get('/api/inventory').set('Cookie', adminCookie).query({ q: '50%' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].item_name).toBe('50% Off Special');
  });

  it('exports inventory as JSON for owners', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, number, store_id)
      VALUES (?, ?, ?, 'Active', ?, ?, 1)
    `
    ).run('Exported Item', 7, categoryId, 'inv-export-1', 'store-sku-1');

    const res = await request
      .get('/api/inventory/export')
      .set('Cookie', adminCookie)
      .query({ format: 'json' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].item_name).toBe('Exported Item');
    expect(res.body.items[0].sku).toBe('store-sku-1');
    expect(res.body.items[0]).not.toHaveProperty('number');
  });

  it('exports inventory as CSV with category grouping markers', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('CSV Export Item', 2, categoryId, 'inv-export-csv');

    const res = await request
      .get('/api/inventory/export')
      .set('Cookie', adminCookie)
      .query({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('"external_system","external_store_id","external_category_id"');
    expect(res.text).toContain('"upc","sku","tag_names"');
    expect(res.text).not.toContain('"number"');
    expect(res.text).toContain('"CSV Export Item"');
    expect(res.text).toContain('"### ');
  });

  it('exports inventory as PDF for owners', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('PDF Export Item', 4, categoryId, 'inv-export-pdf');

    const res = await request
      .get('/api/inventory/export')
      .set('Cookie', adminCookie)
      .query({ format: 'pdf' })
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(100);
  }, 15000);

  it('defaults to XLSX export and sanitizes sheet names', async () => {
    const categoryInfo = db
      .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, 1)')
      .run('Very Long Category []:*?/ Name 1234567890', 'Package');
    const categoryId = Number(categoryInfo.lastInsertRowid);

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('XLSX Export Item', 6, categoryId, 'inv-export-xlsx');

    const res = await request
      .get('/api/inventory/export')
      .set('Cookie', adminCookie)
      .query({ format: 'unknown-format' })
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe('Very Long Category  Name 123456');
    expect(workbook.worksheets[0].getRow(1).getCell(13).value).toBe('sku');
    expect(workbook.worksheets[0].getRow(2).getCell(6).value).toBe('XLSX Export Item');
  });
});

describe('inventory batch routes', () => {
  it('returns 404 when deleting an item that does not exist in the current store', async () => {
    const res = await request.delete('/api/inventory/999999').set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  it('adds new items and updates existing quantities in batch mode', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Existing Item', 3, categoryId, 'batch-upc-1');

    const res = await request
      .post('/api/inventory/batch')
      .set('Cookie', adminCookie)
      .send({
        items: [
          { upc: 'batch-upc-1', quantity: 2, description: 'Existing Item' },
          { upc: 'batch-upc-2', quantity: 5, description: 'New Batch Item', tag_names: 'cold' },
          { quantity: 9, description: 'Missing UPC row' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1, updated: 1 });
    expect(
      (db.prepare('SELECT quantity FROM inventory WHERE upc = ?').get('batch-upc-1') as any)
        .quantity
    ).toBe(5);
    expect(
      (db.prepare('SELECT item_name FROM inventory WHERE upc = ?').get('batch-upc-2') as any)
        .item_name
    ).toBe('New Batch Item');
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM logs WHERE action = 'BATCH'").get() as any).count
    ).toBe(1);
  });

  it('normalizes invalid and negative quantities in batch mode', async () => {
    const res = await request
      .post('/api/inventory/batch')
      .set('Cookie', adminCookie)
      .send({
        items: [
          { upc: 'batch-invalid-quantity', quantity: 'not-a-number', description: 'Invalid Qty' },
          { upc: 'batch-negative-quantity', quantity: -5, description: 'Negative Qty' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 2, updated: 0 });
    const rows = db
      .prepare('SELECT upc, quantity FROM inventory WHERE upc IN (?, ?) ORDER BY upc')
      .all('batch-invalid-quantity', 'batch-negative-quantity') as Array<{
      upc: string;
      quantity: number;
    }>;
    expect(rows.map(row => row.quantity)).toEqual([1, 1]);
  });

  it('returns 400 when items is not an array', async () => {
    const objectBodyRes = await request
      .post('/api/inventory/batch')
      .set('Cookie', adminCookie)
      .send({ items: { upc: 'not-an-array', quantity: 1 } });
    expect(objectBodyRes.status).toBe(400);
    expect(objectBodyRes.body.error).toMatch(/array/i);

    const nullBodyRes = await request
      .post('/api/inventory/batch')
      .set('Cookie', adminCookie)
      .send({ items: null });
    expect(nullBodyRes.status).toBe(400);

    const emptyArrayRes = await request
      .post('/api/inventory/batch')
      .set('Cookie', adminCookie)
      .send({ items: [] });
    expect(emptyArrayRes.status).toBe(400);
  });

  it('rejects invalid status values on POST and PUT /inventory', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    const badCreateRes = await request
      .post('/api/inventory')
      .set('Cookie', adminCookie)
      .send({ item_name: 'Status Test', quantity: 1, category_id: categoryId, status: 'archived' });
    expect(badCreateRes.status).toBe(400);
    expect(badCreateRes.body.error).toMatch(/Active or Inactive/i);

    const goodCreateRes = await request.post('/api/inventory').set('Cookie', adminCookie).send({
      item_name: 'Status Valid Item',
      quantity: 1,
      category_id: categoryId,
      status: 'Active',
    });
    expect(goodCreateRes.status).toBe(200);

    const badPutRes = await request
      .put(`/api/inventory/${goodCreateRes.body.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'deleted' });
    expect(badPutRes.status).toBe(400);
  });

  it('requires owner access for batch operations', async () => {
    const res = await request
      .post('/api/inventory/batch')
      .set('Cookie', takerCookie)
      .send({ items: [{ upc: 'blocked', quantity: 1 }] });

    expect(res.status).toBe(403);
  });
});

describe('inventory batch upload parsing', () => {
  it('rejects missing files and unsupported upload types', async () => {
    const missingRes = await request.post('/api/inventory/batch-upload').set('Cookie', adminCookie);
    expect(missingRes.status).toBe(400);

    const invalidTypeRes = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(invalidTypeRes.status).toBe(400);
  });

  it('parses JSON uploads into sheets metadata', async () => {
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', adminCookie)
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            items: [
              { item_name: 'JSON Item', upc: 'json-1' },
              { item_name: 'JSON Item 2', upc: 'json-2' },
            ],
          })
        ),
        {
          filename: 'inventory.json',
          contentType: 'application/json',
        }
      );

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.sheets[0].headers).toEqual(['item_name', 'upc']);
  });

  it('parses CSV uploads into preview rows', async () => {
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('item_name,upc\nCSV Item,csv-1\n'), {
        filename: 'inventory.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.sheets[0].preview[0]).toMatchObject({
      item_name: 'CSV Item',
      upc: 'csv-1',
    });
  });

  it('returns 400 for empty JSON uploads and parses XLSX hyperlinks/rich text', async () => {
    const emptyJsonRes = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from(JSON.stringify({ items: [] })), {
        filename: 'empty.json',
        contentType: 'application/json',
      });
    expect(emptyJsonRes.status).toBe(400);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet 1');
    sheet.addRow(['item_name', 'image', 'description', 'created_at']);
    sheet.getCell('A2').value = {
      richText: [{ text: 'Rich' }, { text: ' Item' }],
    };
    sheet.getCell('B2').value = {
      text: 'Drive Link',
      hyperlink: 'https://drive.google.com/file/d/xlsx123/view?usp=sharing',
    };
    sheet.getCell('C2').value = {
      formula: '1+1',
      result: 'Formula Description',
    };
    sheet.getCell('D2').value = new Date('2026-01-02T10:00:00Z');

    const xlsxBuffer = await workbook.xlsx.writeBuffer();

    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from(xlsxBuffer), {
        filename: 'inventory.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.sheets[0].preview[0]).toMatchObject({
      item_name: 'Rich Item',
      image: 'https://drive.google.com/file/d/xlsx123/view?usp=sharing',
      description: 'Formula Description',
      created_at: '2026-01-02T10:00:00.000Z',
    });
  });
});

describe('inventory batch confirm', () => {
  it('uses mapped row categories for single-sheet imports', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Inventory',
            mapping: {
              Name: 'item_name',
              UPC: 'upc',
              Category: 'category',
            },
            rows: [
              {
                Name: 'Department Routed Item',
                UPC: 'row-category-upc-1',
                Category: 'Imported Department',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1, updated: 0, skipped: 0 });

    const importedItem = db
      .prepare(
        `
        SELECT c.name AS category_name
        FROM inventory i
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE i.upc = ?
      `
      )
      .get('row-category-upc-1') as any;
    expect(importedItem.category_name).toBe('Imported Department');
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM categories WHERE store_id = 1 AND name = 'Inventory'"
          )
          .get() as any
      ).count
    ).toBe(0);
  });

  it('uses sheet names as categories for multi-sheet imports', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Inventory',
            mapping: {
              Name: 'item_name',
              UPC: 'upc',
              Category: 'category',
            },
            rows: [
              {
                Name: 'Inventory Sheet Item',
                UPC: 'multi-sheet-upc-1',
                Category: 'Imported Department',
              },
            ],
          },
          {
            sheetName: 'Sheet Department',
            mapping: {
              Name: 'item_name',
              UPC: 'upc',
            },
            rows: [{ Name: 'Second Sheet Item', UPC: 'multi-sheet-upc-2' }],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 2, updated: 0, skipped: 0 });

    const importedItems = db
      .prepare(
        `
        SELECT i.upc, c.name AS category_name
        FROM inventory i
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE i.upc IN (?, ?)
        ORDER BY i.upc
      `
      )
      .all('multi-sheet-upc-1', 'multi-sheet-upc-2') as Array<{
      upc: string;
      category_name: string;
    }>;

    expect(importedItems).toEqual([
      { upc: 'multi-sheet-upc-1', category_name: null },
      { upc: 'multi-sheet-upc-2', category_name: 'Sheet Department' },
    ]);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM categories WHERE store_id = 1 AND name = 'Inventory'"
          )
          .get() as any
      ).count
    ).toBe(0);
  });

  it('does not create generic worksheet-name categories when no row category is mapped', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Inventory',
            mapping: {
              Name: 'item_name',
              UPC: 'upc',
            },
            rows: [{ Name: 'Generic Sheet Item', UPC: 'generic-sheet-upc-1' }],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1, updated: 0, skipped: 0 });

    const importedItem = db
      .prepare('SELECT category_id FROM inventory WHERE upc = ?')
      .get('generic-sheet-upc-1') as any;
    expect(importedItem.category_id).toBeNull();
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM categories WHERE store_id = 1 AND name = 'Inventory'"
          )
          .get() as any
      ).count
    ).toBe(0);
  });

  it('preserves external item mappings through import updates and export', async () => {
    const importPayload = {
      sheetsData: [
        {
          sheetName: 'Beverages',
          mapping: {
            'External System': 'external_system',
            'External Store ID': 'external_store_id',
            'External Category ID': 'external_category_id',
            'External Item ID': 'external_item_id',
            'External SKU': 'external_sku',
            Name: 'item_name',
            Qty: 'quantity',
          },
          rows: [
            {
              'External System': 'legacy-pos',
              'External Store ID': 'store-42',
              'External Category ID': 'cat-7',
              'External Item ID': 'item-abc',
              'External SKU': 'sku-abc',
              Name: 'Legacy Product',
              Qty: '5',
            },
          ],
        },
      ],
    };

    const firstImport = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send(importPayload);

    const secondImport = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            ...importPayload.sheetsData[0],
            rows: [
              {
                ...importPayload.sheetsData[0].rows[0],
                Name: 'Legacy Product Updated',
                Qty: '9',
              },
            ],
          },
        ],
      });

    expect(firstImport.status).toBe(200);
    expect(firstImport.body).toMatchObject({ added: 1, updated: 0, skipped: 0 });
    expect(secondImport.status).toBe(200);
    expect(secondImport.body).toMatchObject({ added: 0, updated: 1, skipped: 0 });

    const storedItem = db
      .prepare(
        `
        SELECT item_name, quantity, external_system, external_store_id,
               external_category_id, external_item_id, external_sku,
               last_imported_at, sync_status
        FROM inventory
        WHERE external_item_id = ?
      `
      )
      .get('item-abc') as any;
    expect(storedItem).toMatchObject({
      item_name: 'Legacy Product Updated',
      quantity: 9,
      external_system: 'legacy-pos',
      external_store_id: 'store-42',
      external_category_id: 'cat-7',
      external_item_id: 'item-abc',
      external_sku: 'sku-abc',
      sync_status: 'imported',
    });
    expect(storedItem.last_imported_at).toBeTruthy();

    const exportRes = await request
      .get('/api/inventory/export')
      .set('Cookie', adminCookie)
      .query({ format: 'json' });

    expect(exportRes.status).toBe(200);
    expect(exportRes.body.items[0]).toMatchObject({
      external_system: 'legacy-pos',
      external_store_id: 'store-42',
      external_category_id: 'cat-7',
      external_item_id: 'item-abc',
      external_sku: 'sku-abc',
      sync_status: 'exported',
    });
    expect(exportRes.body.items[0].last_exported_at).toBeTruthy();
  });

  it('imports, updates, skips blank rows, and normalizes Google image URLs', async () => {
    const existingCategoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Existing Import Item', 2, existingCategoryId, 'confirm-upc-1');

    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Beverages',
            mapping: {
              Name: 'item_name',
              Qty: 'quantity',
              UPC: 'upc',
              Number: 'number',
              Status: 'status',
              Tags: 'tag_names',
              Image: 'image',
            },
            rows: [
              {
                Name: 'Updated Import Item',
                Qty: '8',
                UPC: 'confirm-upc-1',
                Image: 'https://drive.google.com/file/d/batch123/view?usp=sharing',
              },
              {
                Name: 'Fresh Import Item',
                Qty: '4',
                Number: 'batch-number-2',
                Status: 'Inactive',
                Tags: 'cold,featured',
                Image: 'https://docs.google.com/uc?export=view&id=batch456',
              },
              {
                Name: 'Blank Import Row',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1, updated: 1, skipped: 1 });
    expect(res.body.skipped_rows).toEqual([
      { row_num: 4, sheet: 'Beverages', item_name: 'Blank Import Row' },
    ]);

    const updatedItem = db
      .prepare('SELECT quantity, image FROM inventory WHERE upc = ?')
      .get('confirm-upc-1') as any;
    expect(updatedItem).toMatchObject({
      quantity: 8,
      image: '/api/drive-image/batch123',
    });

    const importedItem = db
      .prepare(
        'SELECT item_name, status, tag_names, image, category_id FROM inventory WHERE number = ?'
      )
      .get('batch-number-2') as any;
    expect(importedItem).toMatchObject({
      item_name: 'Fresh Import Item',
      status: 'Inactive',
      tag_names: 'cold,featured',
      image: '/api/drive-image/batch456',
    });

    const beveragesCategory = db
      .prepare('SELECT id, icon FROM categories WHERE store_id = 1 AND name = ?')
      .get('Beverages') as any;
    expect(beveragesCategory).toMatchObject({ icon: '/icons/soft-drinks.png' });
    expect(importedItem.category_id).toBe(beveragesCategory.id);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM logs WHERE action = 'IMPORT'").get() as any).count
    ).toBe(1);
  });

  it('records row errors instead of storing invalid mapped statuses', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', adminCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Beverages',
            mapping: {
              Name: 'item_name',
              UPC: 'upc',
              Status: 'status',
            },
            rows: [{ Name: 'Invalid Status Import', UPC: 'bad-status-1', Status: 'Archived' }],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 0, updated: 0 });
    expect(res.body.errors[0]).toMatch(/Active or Inactive/i);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM inventory WHERE upc = ?')
          .get('bad-status-1') as any
      ).count
    ).toBe(0);
  });
});
