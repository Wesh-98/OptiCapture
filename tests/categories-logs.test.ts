import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let adminCookie: string;
let takerCookie: string;
let otherStoreId: number;
let otherOwnerId: number;
let uniqueId = 0;

function nextName(prefix: string): string {
  uniqueId += 1;
  return `${prefix} ${uniqueId}`;
}

beforeAll(async () => {
  const adminStoreCode = getStoreCode(1);
  adminCookie = await login(request, 'admin', 'admin123', adminStoreCode);
  takerCookie = await login(request, 'taker', 'taker123', adminStoreCode);

  const otherStore = await registerStore(request, {
    storeName: 'Logs Isolation Store',
    username: 'logsowner',
  });
  otherStoreId = otherStore.storeId;
  otherOwnerId = (db
    .prepare('SELECT id FROM users WHERE username = ? AND store_id = ?')
    .get('logsowner', otherStoreId) as { id: number } | undefined)!.id;
});

beforeEach(() => {
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
  db.prepare("DELETE FROM categories WHERE store_id = 1 AND name LIKE 'Test Category %'").run();
});

describe('categories routes', () => {
  it('reports category stock counts and dashboard totals for the current store', async () => {
    db.prepare(
      "INSERT OR IGNORE INTO categories (name, icon, store_id) VALUES ('Inventory', 'Package', 1)"
    ).run();
    const baselineCategoryCount = (db
      .prepare(
        "SELECT COUNT(*) AS count FROM categories WHERE store_id = 1 AND LOWER(TRIM(name)) != 'inventory'"
      )
      .get() as { count: number } | undefined)!.count;
    const seededCategory = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Stocked Item', 5, seededCategory, 'cat-stock-1');
    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Out Item', 0, seededCategory, 'cat-stock-2');

    const categoriesRes = await request.get('/api/categories').set('Cookie', adminCookie);
    const statsRes = await request.get('/api/dashboard/stats').set('Cookie', adminCookie);

    expect(categoriesRes.status).toBe(200);
    expect(categoriesRes.body.some((entry: any) => entry.name === 'Inventory')).toBe(false);
    const category = categoriesRes.body.find((entry: any) => entry.id === seededCategory);
    expect(category).toMatchObject({ item_count: 2, total_stock: 5 });

    expect(statsRes.status).toBe(200);
    expect(statsRes.body).toEqual({
      totalCategories: baselineCategoryCount,
      totalItems: 2,
      inStock: 1,
      outOfStock: 1,
    });
  });

  it('requires owner access to create categories and rejects duplicates', async () => {
    const categoryName = nextName('Test Category');

    const forbiddenRes = await request
      .post('/api/categories')
      .set('Cookie', takerCookie)
      .send({ name: categoryName });
    expect(forbiddenRes.status).toBe(403);

    const blankRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: '   ' });
    expect(blankRes.status).toBe(400);

    const createRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    expect(createRes.status).toBe(201);

    const duplicateRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    expect(duplicateRes.status).toBe(409);

    const auditLog = db
      .prepare("SELECT action, details FROM logs WHERE action = 'CREATE' ORDER BY id DESC LIMIT 1")
      .get() as { action: string; details: string };
    expect(auditLog).toMatchObject({ action: 'CREATE' });
    expect(auditLog.details).toContain(categoryName);
  });

  it('rejects Inventory as a category name', async () => {
    const createRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: ' Inventory ', icon: 'Package' });
    expect(createRes.status).toBe(400);
    expect(createRes.body.error).toMatch(/not a category/i);

    const categoryName = nextName('Test Category');
    const validRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    const categoryId = validRes.body.id as number;

    const updateRes = await request
      .put(`/api/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Inventory', icon: 'Package' });
    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error).toMatch(/not a category/i);
  });

  it('rejects invalid status values on PUT /categories/:id/status', async () => {
    const categoryName = nextName('Test Category');
    const createRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    const categoryId = createRes.body.id as number;

    const invalidRes = await request
      .put(`/api/categories/${categoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'deleted' });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error).toMatch(/Active or Inactive/i);

    const objRes = await request
      .put(`/api/categories/${categoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: { value: 'Inactive' } });
    expect(objRes.status).toBe(400);

    const validRes = await request
      .put(`/api/categories/${categoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'Active' });
    expect(validRes.status).toBe(200);
  });

  it('cascades inventory status when a category is marked inactive', async () => {
    const categoryName = nextName('Test Category');
    const createRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    const categoryId = createRes.body.id as number;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Cascade Item', 2, categoryId, 'cat-cascade-1');

    const statusRes = await request
      .put(`/api/categories/${categoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'Inactive' });

    expect(statusRes.status).toBe(200);

    const row = db.prepare('SELECT status FROM inventory WHERE category_id = ?').get(categoryId) as
      | { status: string }
      | undefined;
    expect(row?.status).toBe('Inactive');
  });

  it('deletes category items only when using the dedicated endpoint', async () => {
    const categoryName = nextName('Test Category');
    const createRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: categoryName, icon: 'Package' });
    const categoryId = createRes.body.id as number;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Delete Me', 4, categoryId, 'cat-delete-items');

    const deleteRes = await request
      .delete(`/api/categories/${categoryId}/items`)
      .set('Cookie', adminCookie);

    expect(deleteRes.status).toBe(200);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM inventory WHERE category_id = ?')
          .get(categoryId) as any
      ).count
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM categories WHERE id = ?').get(categoryId) as any)
        .count
    ).toBe(1);
  });

  it('updates and deletes categories in the current store only', async () => {
    const firstName = nextName('Test Category');
    const secondName = nextName('Test Category');

    await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: firstName, icon: 'Package' });
    const secondRes = await request
      .post('/api/categories')
      .set('Cookie', adminCookie)
      .send({ name: secondName, icon: 'Package' });

    const duplicateRename = await request
      .put(`/api/categories/${secondRes.body.id}`)
      .set('Cookie', adminCookie)
      .send({ name: firstName, icon: 'Package' });
    expect(duplicateRename.status).toBe(409);

    const renameRes = await request
      .put(`/api/categories/${secondRes.body.id}`)
      .set('Cookie', adminCookie)
      .send({ name: `${secondName} Renamed`, icon: 'Box' });
    expect(renameRes.status).toBe(200);

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Delete Category Item', 1, secondRes.body.id, 'cat-delete-category');

    const deleteRes = await request
      .delete(`/api/categories/${secondRes.body.id}`)
      .set('Cookie', adminCookie);
    expect(deleteRes.status).toBe(200);

    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM categories WHERE id = ?')
          .get(secondRes.body.id) as any
      ).count
    ).toBe(0);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM inventory WHERE category_id = ?')
          .get(secondRes.body.id) as any
      ).count
    ).toBe(0);
  });
});

describe('logs route', () => {
  it('allows takers to view their store audit trail and clamps invalid limits', async () => {
    db.prepare(
      'INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)'
    ).run('READ', 'Taker-visible log', 1, 1);

    const res = await request
      .get('/api/logs')
      .set('Cookie', takerCookie)
      .query({ limit: '-20' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].details).toBe('Taker-visible log');
  });
  it('rejects malformed date parameters', async () => {
    const badFromRes = await request
      .get('/api/logs')
      .set('Cookie', adminCookie)
      .query({ from: 'not-a-date' });
    expect(badFromRes.status).toBe(400);
    expect(badFromRes.body.error).toMatch(/YYYY-MM-DD/i);

    const badToRes = await request
      .get('/api/logs')
      .set('Cookie', adminCookie)
      .query({ to: '01/02/2026' });
    expect(badToRes.status).toBe(400);
  });

  it('returns only the current store logs and honors date/limit filters', async () => {
    db.prepare(
      `
      INSERT INTO logs (action, details, user_id, store_id, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('CREATE', 'Older admin log', 1, 1, '2026-01-01T09:00:00');
    db.prepare(
      `
      INSERT INTO logs (action, details, user_id, store_id, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('UPDATE', 'Filtered admin log A', 1, 1, '2026-01-02T10:00:00');
    db.prepare(
      `
      INSERT INTO logs (action, details, user_id, store_id, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('DELETE', 'Filtered admin log B', 1, 1, '2026-01-02T11:00:00');
    db.prepare(
      `
      INSERT INTO logs (action, details, user_id, store_id, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('CREATE', 'Other store log', otherOwnerId, otherStoreId, '2026-01-02T12:00:00');

    const res = await request
      .get('/api/logs')
      .set('Cookie', adminCookie)
      .query({ from: '2026-01-02', to: '2026-01-02', limit: '2' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((entry: any) => entry.details)).toEqual([
      'Filtered admin log B',
      'Filtered admin log A',
    ]);
    expect(res.body.every((entry: any) => entry.store_id === 1)).toBe(true);
    expect(res.body.every((entry: any) => entry.username === 'admin')).toBe(true);
  });

  it('filters and paginates logs in SQL before returning a page', async () => {
    const insert = db.prepare(
      `INSERT INTO logs (action, details, user_id, store_id, timestamp)
       VALUES (?, ?, 1, 1, ?)`
    );
    insert.run('CREATE', 'Needle older result', '2026-01-01T10:00:00');
    insert.run('CREATE', 'Needle newest result', '2026-01-02T10:00:00');
    insert.run('DELETE', 'Unrelated result', '2026-01-03T10:00:00');

    const firstPage = await request
      .get('/api/logs')
      .set('Cookie', adminCookie)
      .query({ page: '1', limit: '1', action: 'CREATE', q: 'needle' });
    const secondPage = await request
      .get('/api/logs')
      .set('Cookie', adminCookie)
      .query({ page: '2', limit: '1', action: 'CREATE', q: 'needle' });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toMatchObject({ total: 2, store_total: 3, page: 1, limit: 1 });
    expect(firstPage.body.items[0].details).toBe('Needle newest result');
    expect(secondPage.body.items[0].details).toBe('Needle older result');
  });
});
