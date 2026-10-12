import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, itemNames, setUpTwoStores } from './helpers.js';

const request = createTestApp();

let ownerCookie: string;
let superadminCookie: string;
let northId: number;
let southId: number;

function addItem(storeId: number, name: string, age: string) {
  const category = db
    .prepare('SELECT id FROM categories WHERE store_id = ? ORDER BY id LIMIT 1')
    .get(storeId) as { id: number } | undefined;
  const categoryId = category?.id ?? null;
  db.prepare(
    `INSERT INTO inventory (item_name, quantity, category_id, status, upc, sale_price, store_id, created_at)
     VALUES (?, 1, ?, 'Active', ?, 2.5, ?, datetime('now', ?))`
  ).run(name, categoryId, `upc-${name}`, storeId, age);
}

const names = itemNames;

beforeAll(async () => {
  ({ ownerCookie, superadminCookie, northId, southId } = await setUpTwoStores(request, 'owner'));

  addItem(northId, 'North Hour', '-1 hours');
  addItem(southId, 'South Day3', '-3 days');
  addItem(northId, 'North Day20', '-20 days');
  addItem(southId, 'South Day60', '-60 days');
  addItem(0, 'HQ Fresh', '-1 hours');
});

const get = (query = '') =>
  request.get(`/api/admin/recent-items${query}`).set('Cookie', superadminCookie);

describe('superadmin recently added items', () => {
  it('lists the last 7 days across every store, newest first, without HQ', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['North Hour', 'South Day3']);
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 50, days: 7 });
    expect(res.body.items[0]).toMatchObject({
      store_id: northId,
      store_name: 'North Mart',
      store_status: 'active',
      sale_price: 2.5,
      upc: 'upc-North Hour',
    });
    expect(res.body.items[0].category_name).toEqual(expect.any(String));
  });

  it('widens or narrows the window', async () => {
    expect(names((await get('?days=1')).body)).toEqual(['North Hour']);
    expect(names((await get('?days=30')).body)).toEqual([
      'North Hour',
      'South Day3',
      'North Day20',
    ]);
  });

  it('filters to one store', async () => {
    const res = await get(`?days=30&store=${northId}`);
    expect(names(res.body)).toEqual(['North Hour', 'North Day20']);
    expect(res.body.total).toBe(2);
  });

  it('pages 50 at a time', async () => {
    const insert = db.transaction(() => {
      for (let n = 0; n < 51; n++) addItem(southId, `Bulk ${n}`, '-2 days');
    });
    insert();
    const first = await get(`?store=${southId}`);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.total).toBe(52);
    const second = await get(`?store=${southId}&page=2`);
    // Same-second inserts fall back to id order, so Bulk 0 is the oldest of the batch.
    expect(names(second.body)).toEqual(['Bulk 0', 'South Day3']);
    db.prepare("DELETE FROM inventory WHERE item_name LIKE 'Bulk %'").run();
  });

  it('rejects bad windows, pages and store IDs', async () => {
    for (const query of ['?days=14', '?days=7.0', '?days=abc', '?page=0', '?page=1e0']) {
      expect((await get(query)).status).toBe(400);
    }
    expect((await get('?store=1abc')).status).toBe(400);
    expect((await get('?store=0')).status).toBe(403);
    expect((await get('?store=999999')).status).toBe(404);
  });

  it('says whether each item was added by hand or imported', async () => {
    const categoryId = (
      db.prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1').get() as {
        id: number;
      }
    ).id;
    const manual = await request.post('/api/inventory').set('Cookie', ownerCookie).send({
      item_name: 'Source Manual',
      upc: 'source-manual-1',
      quantity: 1,
      category_id: categoryId,
    });
    expect(manual.status).toBe(200);
    const imported = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Sheet1',
            mapping: { Name: 'item_name', UPC: 'upc' },
            rows: [{ Name: 'Source Import', UPC: 'source-import-1' }],
          },
        ],
      });
    expect(imported.body).toMatchObject({ added: 1 });

    const res = await get('?store=1&days=1');
    const sourceOf = (name: string) =>
      res.body.items.find((item: any) => item.item_name === name)?.source;
    expect(sourceOf('Source Manual')).toBe('manual');
    expect(sourceOf('Source Import')).toBe('import');
    // Items from before the column existed have no recorded source.
    const north = await get(`?store=${northId}`);
    expect(north.body.items.map((item: any) => item.source)).toEqual([null]);
  });

  it('is closed to store owners', async () => {
    const res = await request.get('/api/admin/recent-items').set('Cookie', ownerCookie);
    expect(res.status).toBe(403);
  });
});

describe('manual add', () => {
  it('requires a UPC but not an image', async () => {
    const categoryId = (
      db.prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1').get() as {
        id: number;
      }
    ).id;
    for (const upc of [undefined, '', '   ']) {
      const res = await request
        .post('/api/inventory')
        .set('Cookie', ownerCookie)
        .send({ item_name: 'No UPC Item', upc, quantity: 1, category_id: categoryId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('UPC is required');
    }
    const ok = await request
      .post('/api/inventory')
      .set('Cookie', ownerCookie)
      .send({
        item_name: 'No Image Item',
        upc: 'no-image-1',
        quantity: 1,
        category_id: categoryId,
      });
    expect(ok.status).toBe(200);
  });
});
