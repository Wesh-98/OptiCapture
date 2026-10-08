import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { db } from '../src/server/db.js';
import { UPLOADS_DIR } from '../src/server/helpers.js';
import { itemRevision, readItemSnapshot } from '../src/server/routes/inventory.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let superadminCookie: string;
let ownerCookie: string;
let storeId: number;
let otherStoreId: number;
let categoryId: number;
let otherCategoryId: number;
let itemId: number;

function firstCategoryId(id: number): number {
  return (
    db.prepare('SELECT id FROM categories WHERE store_id = ? ORDER BY id LIMIT 1').get(id) as {
      id: number;
    }
  ).id;
}

function categoryName(): string {
  return (
    db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string }
  ).name;
}

function revision(): string {
  return itemRevision(readItemSnapshot(itemId, storeId)!);
}

function readItem() {
  return db.prepare('SELECT * FROM inventory WHERE id = ?').get(itemId) as Record<string, any>;
}

function lastLog() {
  return db
    .prepare('SELECT * FROM logs WHERE store_id = ? ORDER BY id DESC LIMIT 1')
    .get(storeId) as Record<string, any>;
}

function edit(body: Record<string, unknown>, cookie = superadminCookie, store = storeId) {
  return request.put(`/api/admin/stores/${store}/items/${itemId}`).set('Cookie', cookie).send(body);
}

beforeAll(async () => {
  superadminCookie = await login(request, 'superadmin', 'superadmin123');
  ownerCookie = await login(request, 'admin', 'admin123', getStoreCode(1));
  storeId = (await registerStore(request, { storeName: 'Edit Store', username: 'editowner' }))
    .storeId;
  otherStoreId = (await registerStore(request, { storeName: 'Edit Other', username: 'editother' }))
    .storeId;
  categoryId = firstCategoryId(storeId);
  otherCategoryId = firstCategoryId(otherStoreId);
});

beforeEach(() => {
  db.prepare("UPDATE stores SET status = 'active' WHERE id = ?").run(storeId);
  db.prepare('DELETE FROM inventory WHERE store_id = ?').run(storeId);
  itemId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, quantity, category_id, status, upc, sale_price, store_id)
         VALUES ('Edit Cola', 4, ?, 'Active', '0001', 1.99, ?)`
      )
      .run(categoryId, storeId).lastInsertRowid
  );
});

describe('superadmin item edits', () => {
  it('applies the change and logs every before → after to the store', async () => {
    const res = await edit({
      changes: { sale_price: 2.49, status: 'Inactive' },
      expected_revision: revision(),
      reason: 'Price list from head office',
    });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ sale_price: 2.49, status: 'Inactive' });
    expect(readItem()).toMatchObject({ sale_price: 2.49, status: 'Inactive', quantity: 4 });

    const log = lastLog();
    expect(log.action).toBe('UPDATE');
    expect(log.details).toBe(
      'Super Admin edited "Edit Cola": Price $1.99 → $2.49; Status Active → Inactive. Reason: Price list from head office'
    );
    const superadminId = (
      db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get() as { id: number }
    ).id;
    expect(log.user_id).toBe(superadminId);
  });

  it('refuses a save when the item changed since the form opened', async () => {
    const res = await edit({
      changes: { sale_price: 9 },
      expected_revision: 'stale',
    });
    expect(res.status).toBe(409);
    expect(readItem().sale_price).toBe(1.99);
  });

  it('refuses a stale save even when the other edit leaves updated_at unchanged', async () => {
    // updated_at is whole seconds, so a store edit in the same second as the form opened
    // leaves it as it was. That edit must still make the superadmin's save stale.
    const opened = revision();
    const stamp = readItem().updated_at;
    db.prepare('UPDATE inventory SET sale_price = 7 WHERE id = ?').run(itemId);
    expect(readItem().updated_at).toBe(stamp);

    const res = await edit({ changes: { status: 'Inactive' }, expected_revision: opened });
    expect(res.status).toBe(409);
    expect(readItem()).toMatchObject({ sale_price: 7, status: 'Active' });
  });

  it('returns the item with a fresh revision for the next edit', async () => {
    const res = await edit({ changes: { sale_price: 2.25 }, expected_revision: revision() });
    expect(res.status).toBe(200);
    expect(res.body.item.revision).toBe(revision());
    const detail = await request
      .get(`/api/admin/stores/${storeId}/items/${itemId}`)
      .set('Cookie', superadminCookie);
    expect(detail.body.item.revision).toBe(revision());
  });

  it('returns the other stores carrying the saved UPC, not the old one', async () => {
    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
       VALUES ('Match Cola', 1, ?, 'Active', 'MATCH-9', ?)`
    ).run(otherCategoryId, otherStoreId);
    const res = await edit({ changes: { upc: 'MATCH-9' }, expected_revision: revision() });
    expect(res.status).toBe(200);
    expect(res.body.other_stores.map((row: any) => row.store_id)).toEqual([otherStoreId]);
  });

  it('only lets the superadmin change catalog fields', async () => {
    const res = await edit({
      changes: { quantity: 99, tag_names: 'x' },
      expected_revision: revision(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot edit: quantity, tag_names');
    expect(readItem().quantity).toBe(4);
  });

  it('keeps a suspended store read-only', async () => {
    db.prepare("UPDATE stores SET status = 'suspended' WHERE id = ?").run(storeId);
    const res = await edit({
      changes: { sale_price: 3 },
      expected_revision: revision(),
    });
    expect(res.status).toBe(403);
    expect(readItem().sale_price).toBe(1.99);
  });

  it("rejects another store's category", async () => {
    const res = await edit({
      changes: { category_id: otherCategoryId },
      expected_revision: revision(),
    });
    expect(res.status).toBe(400);
    expect(readItem().category_id).toBe(categoryId);
  });

  it('rolls back a save that changes nothing visible', async () => {
    const before = readItem();
    const logsBefore = db.prepare('SELECT COUNT(*) AS n FROM logs').get() as { n: number };
    const res = await edit({
      changes: { sale_price: 1.99 },
      expected_revision: revision(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nothing to change');
    expect(db.prepare('SELECT COUNT(*) AS n FROM logs').get()).toEqual(logsBefore);
    // Rolled back whole: updated_at did not move either.
    expect(readItem()).toEqual(before);
  });

  it('does not reach an item through another store', async () => {
    const res = await edit(
      { changes: { sale_price: 3 }, expected_revision: revision() },
      superadminCookie,
      otherStoreId
    );
    expect(res.status).toBe(404);
    expect(readItem().sale_price).toBe(1.99);
  });

  it('can clear the price, UPC and category', async () => {
    const res = await edit({
      changes: { sale_price: null, upc: null, category_id: null },
      expected_revision: revision(),
    });
    expect(res.status).toBe(200);
    expect(readItem()).toMatchObject({ sale_price: null, upc: null, category_id: null });
    expect(lastLog().details).toBe(
      `Super Admin edited "Edit Cola": UPC 0001 → —; Category ${categoryName()} → Uncategorized; Price $1.99 → —`
    );
  });

  it('refuses a UPC another item in the store already has', async () => {
    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
       VALUES ('Edit Chips', 1, ?, 'Active', '0002', ?)`
    ).run(categoryId, storeId);
    const res = await edit({
      changes: { upc: '0002' },
      expected_revision: revision(),
    });
    expect(res.status).toBe(409);
    expect(readItem().upc).toBe('0001');
  });

  it('replaces and removes the image, saving an upload like the store does', async () => {
    // A 1×1 transparent PNG.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const added = await edit({
      changes: { image: png },
      expected_revision: revision(),
    });
    expect(added.status).toBe(200);
    expect(readItem().image).toMatch(/^\/uploads\/.+\.png$/);
    expect(lastLog().details).toBe('Super Admin edited "Edit Cola": Image added');

    const removed = await edit({
      changes: { image: null },
      expected_revision: revision(),
    });
    expect(removed.status).toBe(200);
    expect(readItem().image).toBeNull();
    expect(lastLog().details).toBe('Super Admin edited "Edit Cola": Image removed');
  });

  it('refuses an image type the store could not upload either', async () => {
    const res = await edit({
      changes: { image: 'data:image/svg+xml;base64,PHN2Zy8+' },
      expected_revision: revision(),
    });
    expect(res.status).toBe(400);
    expect(readItem().image).toBeNull();
  });

  describe('a refused save leaves no uploaded file behind', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const uploadCount = () => (fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).length : 0);
    // The cleanup runs just after the response, so give it a moment.
    const settle = () => new Promise(resolve => setTimeout(resolve, 50));

    it('when the superadmin form is stale', async () => {
      const before = uploadCount();
      const res = await edit({
        changes: { image: png },
        expected_revision: 'stale',
      });
      expect(res.status).toBe(409);
      await settle();
      expect(uploadCount()).toBe(before);
    });

    it("when a store's own edit hits a duplicate UPC", async () => {
      db.prepare(
        `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
         VALUES ('Orphan Chips', 1, ?, 'Active', '0003', ?)`
      ).run(categoryId, storeId);
      const owner = await login(request, 'editowner', 'Password1', getStoreCode(storeId));
      const before = uploadCount();
      const res = await request
        .put(`/api/inventory/${itemId}`)
        .set('Cookie', owner)
        .send({ upc: '0003', image: png });
      expect(res.status).toBe(409);
      await settle();
      expect(uploadCount()).toBe(before);
      expect(readItem().image).toBeNull();
    });
  });

  it('is closed to store owners', async () => {
    const res = await edit(
      { changes: { sale_price: 3 }, expected_revision: revision() },
      ownerCookie
    );
    expect(res.status).toBe(403);
  });

  it("leaves the store's own edits and log line as they were", async () => {
    const owner = await login(request, 'editowner', 'Password1', getStoreCode(storeId));
    const res = await request
      .put(`/api/inventory/${itemId}`)
      .set('Cookie', owner)
      .send({ sale_price: 5 });
    expect(res.status).toBe(200);
    expect(lastLog().details).toBe('Updated item "Edit Cola"');
  });
});
