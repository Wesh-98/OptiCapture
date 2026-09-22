import ExcelJS from 'exceljs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { autoDetect } from '../src/components/import/importApi.js';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();
let ownerCookie: string;

function binaryParser(res: any, callback: (err: Error | null, data?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  );
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error));
}

async function createSession(cookie = ownerCookie) {
  const response = await request.post('/api/session/create').set('Cookie', cookie);
  expect(response.status).toBe(200);
  return response.body as { sessionId: string; otp: string };
}

beforeAll(async () => {
  ownerCookie = await login(request, 'admin', 'admin123', getStoreCode(1));
});

beforeEach(() => {
  db.prepare('DELETE FROM session_items').run();
  db.prepare('DELETE FROM scan_sessions').run();
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
});

describe('audit regression coverage', () => {
  it('keeps the users-to-stores foreign key and removes the redundant UPC index', () => {
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(users)').all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'stores', from: 'store_id', to: 'id' })])
    );

    const indexes = db.prepare('PRAGMA index_list(inventory)').all() as Array<{ name: string }>;
    expect(indexes.some(index => index.name === 'idx_inventory_upc_store')).toBe(false);
  });
  it('rejects malformed registration values and malformed JSON with 400 responses', async () => {
    const invalidField = await request.post('/api/auth/register').send({
      store_name: 'Invalid Input Store',
      username: 'invalidinputowner',
      password: 'Password1',
      phone: { number: '5555555555' },
    });
    expect(invalidField.status).toBe(400);

    const malformedJson = await request
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"store_name":');
    expect(malformedJson.status).toBe(400);
    expect(malformedJson.body.error).toMatch(/malformed json/i);
  });

  it('validates inventory numbers and allows nullable fields to be cleared', async () => {
    for (const body of [
      { item_name: 'Negative quantity', quantity: -1 },
      { item_name: 'Bad price', sale_price: 'nonsense' },
      { item_name: 'Bad tax', tax_percent: -5 },
    ]) {
      const response = await request.post('/api/inventory').set('Cookie', ownerCookie).send(body);
      expect(response.status).toBe(400);
    }

    const create = await request.post('/api/inventory').set('Cookie', ownerCookie).send({
      item_name: 'Clearable fields',
      quantity: 2,
      upc: 'clearable-upc',
      image: 'https://example.com/product.png',
    });
    expect(create.status).toBe(200);

    const update = await request
      .put(`/api/inventory/${create.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ upc: '', image: '' });
    expect(update.status).toBe(200);

    const row = db.prepare('SELECT upc, image FROM inventory WHERE id = ?').get(create.body.id) as {
      upc: string | null;
      image: string | null;
    };
    expect(row).toEqual({ upc: null, image: null });
  });

  it('does not borrow another store category when a legacy batch store has none', async () => {
    const isolated = await registerStore(request, {
      storeName: 'Categoryless Batch Store',
      username: 'categorylessowner',
    });
    db.prepare('DELETE FROM categories WHERE store_id = ?').run(isolated.storeId);

    const response = await request
      .post('/api/inventory/batch')
      .set('Cookie', isolated.cookie)
      .send({ items: [{ upc: 'categoryless-upc', description: 'No category item' }] });
    expect(response.status).toBe(200);

    const row = db
      .prepare('SELECT category_id, store_id FROM inventory WHERE upc = ?')
      .get('categoryless-upc') as { category_id: number | null; store_id: number };
    expect(row).toEqual({ category_id: null, store_id: isolated.storeId });
  });

  it('preserves omitted import values while updating mapped descriptions', async () => {
    db.prepare(
      `INSERT INTO inventory (item_name, description, quantity, status, upc, store_id)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run('Existing import item', 'Old description', 12, 'Inactive', 'preserve-import-upc');

    const response = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Inventory',
            mapping: { UPC: 'upc', Description: 'description' },
            rows: [{ UPC: 'preserve-import-upc', Description: 'New description' }],
          },
        ],
      });
    expect(response.status).toBe(200);

    const row = db
      .prepare('SELECT description, quantity, status FROM inventory WHERE upc = ?')
      .get('preserve-import-upc');
    expect(row).toEqual({ description: 'New description', quantity: 12, status: 'Inactive' });
  });

  it('maps every re-importable export header exactly', () => {
    expect(
      autoDetect([
        'external_category_id',
        'item_name',
        'description',
        'sale_price',
        'tax_percent',
        'sku',
        'tag_names',
        'category',
        'sync_status',
      ])
    ).toEqual({
      external_category_id: 'external_category_id',
      item_name: 'item_name',
      description: 'description',
      sale_price: 'sale_price',
      tax_percent: 'tax_percent',
      sku: 'number',
      tag_names: 'tag_names',
      category: 'category',
      sync_status: '__ignore__',
    });
  });

  it('round-trips exported JSON without losing inventory fields', async () => {
    const category = db
      .prepare('SELECT id, name FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number; name: string };
    db.prepare(
      `INSERT INTO inventory (
        item_name, description, quantity, unit, sale_price, tax_percent, upc, number,
        tag_names, category_id, status, image, store_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      'Round-trip item',
      'Preserved description',
      17,
      'case',
      12.5,
      7.25,
      'round-trip-upc',
      'round-trip-sku',
      'cold,featured',
      category.id,
      'Inactive',
      'https://example.com/round-trip.png'
    );

    const exported = await request
      .get('/api/inventory/export?format=json')
      .set('Cookie', ownerCookie);
    expect(exported.status).toBe(200);
    db.prepare('DELETE FROM inventory WHERE store_id = 1').run();

    const uploaded = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', ownerCookie)
      .attach('file', Buffer.from(JSON.stringify(exported.body)), {
        filename: 'round-trip.json',
        contentType: 'application/json',
      });
    expect(uploaded.status).toBe(200);
    const sheet = uploaded.body.sheets[0] as {
      name: string;
      headers: string[];
      rows: Record<string, unknown>[];
    };

    const confirmed = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send({
        sheetsData: [
          {
            sheetName: sheet.name,
            rows: sheet.rows,
            mapping: autoDetect(sheet.headers),
          },
        ],
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ added: 1, updated: 0, skipped: 0 });

    const restored = db
      .prepare(
        `SELECT i.item_name, i.description, i.quantity, i.unit, i.sale_price,
                i.tax_percent, i.upc, i.number, i.tag_names, i.status, i.image,
                c.name AS category
         FROM inventory i
         LEFT JOIN categories c ON c.id = i.category_id
         WHERE i.upc = ?`
      )
      .get('round-trip-upc');
    expect(restored).toEqual({
      item_name: 'Round-trip item',
      description: 'Preserved description',
      quantity: 17,
      unit: 'case',
      sale_price: 12.5,
      tax_percent: 7.25,
      upc: 'round-trip-upc',
      number: 'round-trip-sku',
      tag_names: 'cold,featured',
      status: 'Inactive',
      image: 'https://example.com/round-trip.png',
      category: category.name,
    });
  });

  it('exports prototype-like and colliding category names to unique worksheets', async () => {
    const first = Number(
      db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, 1)')
        .run('__proto__', 'Package').lastInsertRowid
    );
    const second = Number(
      db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, 1)')
        .run('A/B', 'Package').lastInsertRowid
    );
    const third = Number(
      db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, 1)')
        .run('AB', 'Package').lastInsertRowid
    );
    const insert = db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
       VALUES (?, 1, ?, 'Active', ?, 1)`
    );
    insert.run('Prototype item', first, 'export-prototype');
    insert.run('Slash item', second, 'export-slash');
    insert.run('Plain item', third, 'export-plain');

    const response = await request
      .get('/api/inventory/export?format=xlsx')
      .set('Cookie', ownerCookie)
      .buffer(true)
      .parse(binaryParser);
    expect(response.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['AB', 'AB (2)', '__proto__']);
  });

  it('blocks expired and suspended OTP scans', async () => {
    const expired = await createSession();
    db.prepare('UPDATE scan_sessions SET expires_at = ? WHERE session_id = ?').run(
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expired.sessionId
    );
    const expiredResponse = await request
      .post(`/api/session/${expired.sessionId}/scan`)
      .send({ upc: 'expired-scan', otp: expired.otp });
    expect(expiredResponse.status).toBe(410);

    const suspended = await registerStore(request, {
      storeName: 'Suspended Scanner Store',
      username: 'suspendedscannerowner',
    });
    const suspendedSession = await createSession(suspended.cookie);
    db.prepare("UPDATE stores SET status = 'suspended' WHERE id = ?").run(suspended.storeId);
    const suspendedResponse = await request
      .post(`/api/session/${suspendedSession.sessionId}/scan`)
      .send({ upc: 'suspended-scan', otp: suspendedSession.otp });
    expect(suspendedResponse.status).toBe(403);
  });

  it('deletes populated drafts and returns same-second manual edits through the cursor', async () => {
    const deletable = await createSession();
    db.prepare(
      `INSERT INTO session_items (session_id, upc, quantity, lookup_status, source)
       VALUES (?, ?, 1, 'new_candidate', 'manual')`
    ).run(deletable.sessionId, 'draft-child');
    db.prepare("UPDATE scan_sessions SET status = 'draft' WHERE session_id = ?").run(
      deletable.sessionId
    );
    const deleteResponse = await request
      .delete(`/api/session/${deletable.sessionId}`)
      .set('Cookie', ownerCookie);
    expect(deleteResponse.status).toBe(200);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM session_items WHERE session_id = ?').get(
        deletable.sessionId
      ) as { count: number }).count
    ).toBe(0);

    const editable = await createSession();
    const inserted = db
      .prepare(
        `INSERT INTO session_items
          (session_id, upc, quantity, lookup_status, product_name, source, updated_at)
         VALUES (?, ?, 1, 'new_candidate', ?, 'manual', ?)`
      )
      .run(editable.sessionId, 'cursor-edit', 'Before', '2026-01-02 10:00:00');
    const itemId = Number(inserted.lastInsertRowid);
    const patch = await request
      .patch(`/api/session/${editable.sessionId}/items/${itemId}`)
      .set('Cookie', ownerCookie)
      .send({ product_name: 'After' });
    expect(patch.status).toBe(200);

    const poll = await request
      .get(`/api/session/${editable.sessionId}`)
      .set('Cookie', ownerCookie)
      .query({ since_updated_at: '2026-01-02 10:00:00', since_id: itemId });
    expect(poll.status).toBe(200);
    expect(poll.body.items).toHaveLength(1);
    expect(poll.body.items[0]).toMatchObject({ id: itemId, product_name: 'After' });
  });

  it('retains scan tags when committing items to inventory', async () => {
    const session = await createSession();
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number }).id;
    const itemId = Number(
      db
        .prepare(
          `INSERT INTO session_items
            (session_id, upc, quantity, lookup_status, product_name, source, tag_names)
           VALUES (?, ?, 2, 'new_candidate', ?, 'manual', ?)`
        )
        .run(session.sessionId, 'commit-tags-upc', 'Tagged item', 'cold,featured').lastInsertRowid
    );

    const response = await request
      .post(`/api/session/${session.sessionId}/commit`)
      .set('Cookie', ownerCookie)
      .send({ assignments: [{ id: itemId, category_id: categoryId }] });
    expect(response.status).toBe(200);
    expect(
      db.prepare('SELECT tag_names FROM inventory WHERE upc = ?').get('commit-tags-upc')
    ).toEqual({ tag_names: 'cold,featured' });
  });
});
