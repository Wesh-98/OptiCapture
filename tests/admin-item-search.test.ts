import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let ownerCookie: string;
let superadminCookie: string;
let northId: number;
let southId: number;

function addItem(
  storeId: number,
  name: string,
  upc: string,
  extra: { brand?: string; category?: string } = {}
) {
  let categoryId: number | null = null;
  if (extra.category) {
    categoryId = Number(
      db
        .prepare('INSERT INTO categories (name, store_id) VALUES (?, ?)')
        .run(extra.category, storeId).lastInsertRowid
    );
  }
  db.prepare(
    `INSERT INTO inventory (item_name, quantity, category_id, status, upc, brand, sale_price, store_id)
     VALUES (?, 1, ?, 'Active', ?, ?, 2.5, ?)`
  ).run(name, categoryId, upc, extra.brand ?? null, storeId);
}

const names = (body: { items: Array<{ item_name: string }> }) =>
  body.items.map(item => item.item_name);

beforeAll(async () => {
  ownerCookie = await login(request, 'admin', 'admin123', getStoreCode(1));
  superadminCookie = await login(request, 'superadmin', 'superadmin123');
  northId = (await registerStore(request, { storeName: 'North Mart', username: 'northsearch' }))
    .storeId;
  southId = (await registerStore(request, { storeName: 'South Mart', username: 'southsearch' }))
    .storeId;

  addItem(northId, 'Zesty Cola', '012345678905');
  addItem(southId, 'zesty cola', '0012345678905');
  addItem(northId, 'Plain Water', '111111111117', { brand: 'Zesty Springs' });
  addItem(southId, 'Rye Bread', '222222222224', { category: 'Zesty Bakes' });
  addItem(southId, '100% Juice', '333333333331');
  addItem(0, 'Zesty HQ Sample', '444444444448');
});

const get = (query: string) =>
  request.get(`/api/admin/search${query}`).set('Cookie', superadminCookie);

describe('superadmin item search', () => {
  it('matches name, brand and category across stores, by name then store, without HQ', async () => {
    const res = await get('?q=ZESTY');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['Plain Water', 'Rye Bread', 'Zesty Cola', 'zesty cola']);
    expect(res.body).toMatchObject({ total: 4, page: 1, limit: 50, q: 'ZESTY' });
    expect(res.body.items[2]).toMatchObject({
      store_id: northId,
      store_name: 'North Mart',
      store_status: 'active',
      upc: '012345678905',
    });
    expect(res.body.items[1].category_name).toBe('Zesty Bakes');
  });

  it('finds a barcode in either its 12- or 13-digit form, and by part of it', async () => {
    expect((await get('?q=012345678905')).body.total).toBe(2);
    expect((await get('?q=0012345678905')).body.total).toBe(2);
    expect(names((await get('?q=22222')).body)).toEqual(['Rye Bread']);
  });

  it('ignores spaces, punctuation and accents on either side', async () => {
    addItem(northId, 'Coca-Cola Classic', '555555555551');
    addItem(southId, 'Coca Cola Zero', '555555555552');
    addItem(southId, "Café D'Or", '555555555553');
    const both = ['Coca Cola Zero', 'Coca-Cola Classic'];
    for (const q of ['coca cola', 'coca-cola', 'cocacola', 'COCA  COLA']) {
      expect(names((await get(`?q=${encodeURIComponent(q)}`)).body)).toEqual(both);
    }
    expect(names((await get('?q=cafe%20dor')).body)).toEqual(["Café D'Or"]);
    // The store's own search follows the same rule.
    const own = await request
      .get(`/api/admin/stores/${northId}/inventory?q=coca%20cola`)
      .set('Cookie', superadminCookie);
    expect(names(own.body)).toEqual(['Coca-Cola Classic']);
    db.prepare("DELETE FROM inventory WHERE upc LIKE '55555555555_'").run();
  });

  it('finds items by any of their tags', async () => {
    addItem(northId, 'Lemon Burst', '666666666661');
    addItem(southId, 'Orange Pop', '666666666662');
    db.prepare(
      "UPDATE inventory SET tag_names = 'Fizzy Drinks, soda' WHERE upc = '666666666661'"
    ).run();
    db.prepare("UPDATE inventory SET tag_names = 'soda' WHERE upc = '666666666662'").run();
    expect(names((await get('?q=fizzy%20drinks')).body)).toEqual(['Lemon Burst']);
    expect(names((await get('?q=soda')).body)).toEqual(['Lemon Burst', 'Orange Pop']);
    const own = await request
      .get(`/api/admin/stores/${southId}/inventory?q=soda`)
      .set('Cookie', superadminCookie);
    expect(names(own.body)).toEqual(['Orange Pop']);
    db.prepare("DELETE FROM inventory WHERE upc LIKE '66666666666_'").run();
  });

  it('filters to one store', async () => {
    const res = await get(`?q=zesty&store=${southId}`);
    expect(names(res.body)).toEqual(['Rye Bread', 'zesty cola']);
    expect(res.body.total).toBe(2);
  });

  it('treats % and _ as plain text', async () => {
    expect(names((await get('?q=100%25')).body)).toEqual(['100% Juice']);
    expect((await get('?q=%25%25')).body.total).toBe(0);
    expect((await get('?q=__')).body.total).toBe(0);
  });

  it('pages 50 at a time', async () => {
    const insert = db.transaction(() => {
      for (let n = 0; n < 51; n++)
        addItem(northId, `Bulkfind ${String(n).padStart(2, '0')}`, `b${n}`);
    });
    insert();
    const first = await get('?q=bulkfind');
    expect(first.body.items).toHaveLength(50);
    expect(first.body.total).toBe(51);
    expect(names((await get('?q=bulkfind&page=2')).body)).toEqual(['Bulkfind 50']);
    db.prepare("DELETE FROM inventory WHERE item_name LIKE 'Bulkfind %'").run();
  });

  it('rejects short or oversized searches, bad pages and bad store IDs', async () => {
    for (const query of ['', '?q=', '?q=a', '?q=%20a%20', `?q=${'a'.repeat(101)}`]) {
      expect((await get(query)).status).toBe(400);
    }
    for (const query of ['?q=zesty&page=0', '?q=zesty&page=1e0', '?q=zesty&store=1abc']) {
      expect((await get(query)).status).toBe(400);
    }
    expect((await get('?q=zesty&store=0')).status).toBe(403);
    expect((await get('?q=zesty&store=999999')).status).toBe(404);
  });

  it('is closed to store owners', async () => {
    const res = await request.get('/api/admin/search?q=zesty').set('Cookie', ownerCookie);
    expect(res.status).toBe(403);
  });
});
