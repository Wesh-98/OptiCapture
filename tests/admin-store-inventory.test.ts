import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let ownerCookie: string;
let superadminCookie: string;
let viewedStoreId: number;
let otherStoreId: number;
let viewedCategoryId: number;

function addItem(storeId: number, categoryId: number, name: string, status = 'Active') {
  db.prepare(
    `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
     VALUES (?, 1, ?, ?, ?, ?)`
  ).run(name, categoryId, status, `upc-${storeId}-${name}`, storeId);
}

function firstCategoryId(storeId: number): number {
  return (
    db.prepare('SELECT id FROM categories WHERE store_id = ? ORDER BY id LIMIT 1').get(storeId) as {
      id: number;
    }
  ).id;
}

beforeAll(async () => {
  ownerCookie = await login(request, 'admin', 'admin123', getStoreCode(1));
  superadminCookie = await login(request, 'superadmin', 'superadmin123');

  viewedStoreId = (
    await registerStore(request, { storeName: 'Viewed Store', username: 'viewedowner' })
  ).storeId;
  otherStoreId = (
    await registerStore(request, { storeName: 'Other Store', username: 'otherowner' })
  ).storeId;

  viewedCategoryId = firstCategoryId(viewedStoreId);
  addItem(viewedStoreId, viewedCategoryId, 'Viewed Cola');
  addItem(viewedStoreId, viewedCategoryId, 'Viewed Chips', 'Inactive');
  addItem(otherStoreId, firstCategoryId(otherStoreId), 'Other Store Cola');
});

describe('superadmin per-store inventory view', () => {
  it('returns only the store named in the URL', async () => {
    const res = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory`)
      .set('Cookie', superadminCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const names = res.body.items.map((item: any) => item.item_name).sort();
    expect(names).toEqual(['Viewed Chips', 'Viewed Cola']);
  });

  it('applies the same search, status, and paging filters as GET /inventory', async () => {
    const searchRes = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory?q=cola`)
      .set('Cookie', superadminCookie);
    expect(searchRes.body.items.map((item: any) => item.item_name)).toEqual(['Viewed Cola']);

    const statusRes = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory?status=Inactive`)
      .set('Cookie', superadminCookie);
    expect(statusRes.body.items.map((item: any) => item.item_name)).toEqual(['Viewed Chips']);

    const pageRes = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory?limit=1&page=2`)
      .set('Cookie', superadminCookie);
    expect(pageRes.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(pageRes.body.items).toHaveLength(1);

    const badStatus = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory?status=Gone`)
      .set('Cookie', superadminCookie);
    expect(badStatus.status).toBe(400);
  });

  it('sorts items by recently added or by name, and rejects unknown sorts', async () => {
    const names = async (sort: string) =>
      (
        await request
          .get(`/api/admin/stores/${viewedStoreId}/inventory?sort=${sort}`)
          .set('Cookie', superadminCookie)
      ).body.items.map((item: any) => item.item_name);

    // Same-second inserts fall back to id order, so the later insert counts as newer.
    expect(await names('recent')).toEqual(['Viewed Chips', 'Viewed Cola']);
    expect(await names('name_asc')).toEqual(['Viewed Chips', 'Viewed Cola']);
    expect(await names('name_desc')).toEqual(['Viewed Cola', 'Viewed Chips']);

    const bad = await request
      .get(`/api/admin/stores/${viewedStoreId}/inventory?sort=price`)
      .set('Cookie', superadminCookie);
    expect(bad.status).toBe(400);
  });

  it('lists the store categories with item counts', async () => {
    const res = await request
      .get(`/api/admin/stores/${viewedStoreId}/categories`)
      .set('Cookie', superadminCookie);
    expect(res.status).toBe(200);
    const category = res.body.find((entry: any) => entry.id === viewedCategoryId);
    expect(category).toMatchObject({ store_id: viewedStoreId, item_count: 2 });
    expect(res.body.every((entry: any) => entry.store_id === viewedStoreId)).toBe(true);
  });

  it('returns the store summary for the page header', async () => {
    const res = await request
      .get(`/api/admin/stores/${viewedStoreId}`)
      .set('Cookie', superadminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: viewedStoreId, name: 'Viewed Store', item_count: 2 });
  });

  it('reports the per-store inventory figures in the store list and summary', async () => {
    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id, created_at)
       VALUES ('Viewed Old Gum', 1, ?, 'Active', NULL, ?, datetime('now', '-30 days'))`
    ).run(viewedCategoryId, viewedStoreId);

    const summary = await request
      .get(`/api/admin/stores/${viewedStoreId}`)
      .set('Cookie', superadminCookie);
    expect(summary.body).toMatchObject({
      item_count: 3,
      items_added_week: 2,
      missing_upc_count: 1,
    });
    expect(summary.body.category_count).toBeGreaterThan(0);
    expect(summary.body.last_item_added_at).toEqual(expect.any(String));

    const list = await request.get('/api/admin/stores').set('Cookie', superadminCookie);
    const row = list.body.find((store: any) => store.id === viewedStoreId);
    expect(row).toMatchObject({ item_count: 3, items_added_week: 2, missing_upc_count: 1 });

    db.prepare("DELETE FROM inventory WHERE item_name = 'Viewed Old Gum'").run();
  });

  it('returns one item with the other stores that carry its UPC', async () => {
    const sharedUpc = '012345678905';
    const insert = db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, sale_price, store_id)
       VALUES (?, 1, ?, 'Active', ?, ?, ?)`
    );
    const viewedItemId = Number(
      insert.run('Shared Water', viewedCategoryId, sharedUpc, 1.5, viewedStoreId).lastInsertRowid
    );
    const otherItemId = Number(
      insert.run('Shared Water', firstCategoryId(otherStoreId), sharedUpc, 1.75, otherStoreId)
        .lastInsertRowid
    );

    const res = await request
      .get(`/api/admin/stores/${viewedStoreId}/items/${viewedItemId}`)
      .set('Cookie', superadminCookie);
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ id: viewedItemId, store_id: viewedStoreId });
    expect(res.body.other_stores).toEqual([
      expect.objectContaining({
        item_id: otherItemId,
        store_id: otherStoreId,
        store_name: 'Other Store',
        sale_price: 1.75,
      }),
    ]);

    // An item ID from another store is not readable through this store's URL.
    const crossStore = await request
      .get(`/api/admin/stores/${viewedStoreId}/items/${otherItemId}`)
      .set('Cookie', superadminCookie);
    expect(crossStore.status).toBe(404);

    const badId = await request
      .get(`/api/admin/stores/${viewedStoreId}/items/abc`)
      .set('Cookie', superadminCookie);
    expect(badId.status).toBe(400);

    const owner = await request
      .get(`/api/admin/stores/${viewedStoreId}/items/${viewedItemId}`)
      .set('Cookie', ownerCookie);
    expect(owner.status).toBe(403);

    db.prepare('DELETE FROM inventory WHERE id IN (?, ?)').run(viewedItemId, otherItemId);
  });

  it('rejects malformed, HQ, and unknown store IDs instead of falling back', async () => {
    for (const path of ['', '/inventory', '/categories']) {
      const malformed = await request
        .get(`/api/admin/stores/12abc${path}`)
        .set('Cookie', superadminCookie);
      expect(malformed.status).toBe(400);

      const hq = await request.get(`/api/admin/stores/0${path}`).set('Cookie', superadminCookie);
      expect(hq.status).toBe(403);

      const missing = await request
        .get(`/api/admin/stores/999999${path}`)
        .set('Cookie', superadminCookie);
      expect(missing.status).toBe(404);
    }
  });

  it('is closed to store owners', async () => {
    for (const path of ['', '/inventory', '/categories']) {
      const res = await request
        .get(`/api/admin/stores/${viewedStoreId}${path}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(403);
    }
  });
});

describe('superadmin recent changes feed', () => {
  function log(action: string, details: string, storeId: number) {
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, NULL, ?)').run(
      action,
      details,
      storeId
    );
  }

  it('lists inventory changes newest first, with scan commits reworded', async () => {
    log('CREATE', 'Added item "Feed Soda"', viewedStoreId);
    log('LOGIN', 'viewedowner signed in', viewedStoreId);
    log('BATCH', 'Committed session abc | inserted=3 verified=2 | Drinks: 5', otherStoreId);
    log('CREATE', 'Added item "HQ Only"', 0);

    const res = await request.get('/api/admin/activity?limit=50').set('Cookie', superadminCookie);
    expect(res.status).toBe(200);
    const ours = res.body.filter((row: any) =>
      [viewedStoreId, otherStoreId, 0].includes(row.store_id)
    );
    expect(ours.map((row: any) => [row.store_name, row.summary])).toEqual([
      ['Other Store', 'Captured 3 new items from a scan, confirmed 2 existing'],
      ['Viewed Store', 'Added item "Feed Soda"'],
      // Registering a store is logged as a change too, and it is worth seeing.
      ['Other Store', 'Registered store "Other Store"'],
      ['Viewed Store', 'Registered store "Viewed Store"'],
    ]);
  });

  it('is closed to store owners', async () => {
    const res = await request.get('/api/admin/activity').set('Cookie', ownerCookie);
    expect(res.status).toBe(403);
  });
});
