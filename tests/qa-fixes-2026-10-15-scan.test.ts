/**
 * Regression tests for the scan-workspace findings of the 2026-10-15 QA run: staged edits
 * that silently lost items at commit, limits the item form enforces but staging did not,
 * rows that could never be committed, and barcodes stored in forms nothing else matches.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { upcCacheSet } from '../src/server/cache.js';
import { createTestApp, registerStore } from './helpers.js';

const request = createTestApp();
let cookie: string;
let storeId: number;
let categoryId: number;

beforeAll(async () => {
  const store = await registerStore(request, { storeName: 'QA Scan Mart', username: 'qascan' });
  cookie = store.cookie;
  storeId = store.storeId;
  categoryId = Number(
    db
      .prepare("INSERT INTO categories (name, icon, store_id) VALUES ('Scanned', 'Package', ?)")
      .run(storeId).lastInsertRowid
  );
});

async function newSession() {
  const res = await request.post('/api/session/create').set('Cookie', cookie);
  return res.body as { sessionId: string; otp: string };
}

// A fresh cache entry keeps the background product lookup off the network.
function scan(session: { sessionId: string; otp: string }, upc: unknown, name = 'Cached Product') {
  if (typeof upc === 'string') {
    upcCacheSet(upc.replaceAll(/[\s-]/g, ''), {
      product_name: name,
      brand: null,
      image: null,
      source: 'test',
      ts: Date.now(),
    });
  }
  return request.post(`/api/session/${session.sessionId}/scan`).send({ upc, otp: session.otp });
}

function patchItem(sessionId: string, itemId: number, body: Record<string, unknown>) {
  return request
    .patch(`/api/session/${sessionId}/items/${itemId}`)
    .set('Cookie', cookie)
    .send(body);
}

function commit(sessionId: string, ids: number[]) {
  return request
    .post(`/api/session/${sessionId}/commit`)
    .set('Cookie', cookie)
    .send({ assignments: ids.map(id => ({ id, category_id: categoryId })) });
}

const inventoryRows = (upc: string) =>
  db
    .prepare('SELECT item_name, quantity, sale_price FROM inventory WHERE store_id = ? AND upc = ?')
    .all(storeId, upc);

describe('H5: a staged UPC edit onto another staged row', () => {
  it('is refused, so commit cannot drop one of the two items', async () => {
    const session = await newSession();
    const first = await scan(session, '036000291452', 'Product One');
    const second = await scan(session, '012345678905', 'Product Two');

    const res = await patchItem(session.sessionId, second.body.item.id, {
      product_name: 'Product Two',
      upc: '036000291452',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already staged in this session as "Product One"');

    const done = await commit(session.sessionId, [first.body.item.id, second.body.item.id]);
    expect(done.body).toMatchObject({ inserted: 2, verified: 0 });
    expect(inventoryRows('036000291452')).toEqual([
      { item_name: 'Product One', quantity: 1, sale_price: null },
    ]);
    expect(inventoryRows('012345678905')).toEqual([
      { item_name: 'Product Two', quantity: 1, sale_price: null },
    ]);
  });

  it('also refuses the other form of a staged barcode', async () => {
    const session = await newSession();
    await scan(session, '070847811169', 'Has Zero');
    const other = await scan(session, '041000005264', 'Other');
    const res = await patchItem(session.sessionId, other.body.item.id, { upc: '70847811169' });
    expect(res.status).toBe(409);
  });

  it('lets a row keep its own barcode, as the edit dialog always sends it', async () => {
    const session = await newSession();
    const row = await scan(session, '049000028911', 'Keeps UPC');
    const res = await patchItem(session.sessionId, row.body.item.id, {
      product_name: 'Renamed',
      upc: '049000028911',
    });
    expect(res.status).toBe(200);
  });
});

describe('M1: a staged UPC edit onto a catalog item', () => {
  it('is refused and names the catalog item', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Catalog Item', '042100005264', 7, ?)"
    ).run(storeId);
    const session = await newSession();
    const row = await scan(session, '073141000013', 'New Thing');
    const res = await patchItem(session.sessionId, row.body.item.id, {
      product_name: 'My new thing',
      upc: '042100005264',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already in your inventory as "Catalog Item"');
    expect(inventoryRows('042100005264')).toEqual([
      { item_name: 'Catalog Item', quantity: 7, sale_price: null },
    ]);
  });
});

describe('M1: the catalog gains a staged barcode after the scan', () => {
  it('refuses an edit the commit would discard', async () => {
    const session = await newSession();
    const row = await scan(session, '012000001284', 'Staged First');
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Added Meanwhile', '012000001284', 1, ?)"
    ).run(storeId);
    const res = await patchItem(session.sessionId, row.body.item.id, {
      product_name: 'Renamed',
      upc: '012000001284',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('"Added Meanwhile"');

    // An edit that sends no UPC is checked against the stored one.
    const partial = await patchItem(session.sessionId, row.body.item.id, { sale_price: 2 });
    expect(partial.status).toBe(409);
  });
});

describe('M12 and L10: staged quantities and prices', () => {
  it('refuses a price above the item form’s ceiling, or below zero', async () => {
    const session = await newSession();
    const row = await scan(session, '096385074', 'Price Probe');
    for (const price of [5e12, -4, 'abc']) {
      const res = await patchItem(session.sessionId, row.body.item.id, { sale_price: price });
      expect(res.status).toBe(400);
    }
  });

  it('clears a price of only spaces instead of saving it as 0', async () => {
    const session = await newSession();
    const row = await scan(session, '041000005264', 'Blank Price');
    await patchItem(session.sessionId, row.body.item.id, { sale_price: 3 });
    const res = await patchItem(session.sessionId, row.body.item.id, { sale_price: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.item.sale_price).toBeNull();
  });

  it('returns staged prices as numbers', async () => {
    const session = await newSession();
    const row = await scan(session, '012000001291', 'Numeric Price');
    const patched = await patchItem(session.sessionId, row.body.item.id, { sale_price: '4' });
    expect(patched.body.item.sale_price).toBe(4);

    const feed = await request.get(`/api/session/${session.sessionId}`).set('Cookie', cookie);
    expect(feed.body.items[0].sale_price).toBe(4);

    const phone = await request
      .get(`/api/session/${session.sessionId}/items`)
      .set('X-Scan-Otp', session.otp);
    expect(phone.body.items[0].sale_price).toBe(4);
  });

  it('caps the price at commit for a row staged before the ceiling existed', async () => {
    const session = await newSession();
    const row = await scan(session, '085239016039', 'Legacy Price');
    db.prepare("UPDATE session_items SET sale_price = '5000000000000' WHERE id = ?").run(
      row.body.item.id
    );
    await commit(session.sessionId, [row.body.item.id]);
    expect(inventoryRows('085239016039')).toEqual([
      { item_name: 'Legacy Price', quantity: 1, sale_price: 1_000_000 },
    ]);
  });
});

describe('L11: a staged catalog item that was deleted from the catalog', () => {
  it('becomes a new item again that can be named and committed', async () => {
    const id = db
      .prepare(
        "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Soon Gone', '070847012474', 1, ?)"
      )
      .run(storeId).lastInsertRowid;
    const session = await newSession();
    const row = await scan(session, '070847012474');
    expect(row.body.item.lookup_status).toBe('existing');

    await request.delete(`/api/inventory/${id}`).set('Cookie', cookie);
    const patched = await patchItem(session.sessionId, row.body.item.id, {
      product_name: 'Back Again',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.item).toMatchObject({
      exists_in_inventory: 0,
      lookup_status: 'new_candidate',
    });

    const done = await commit(session.sessionId, [row.body.item.id]);
    expect(done.body).toMatchObject({ inserted: 1, status: 'completed' });
  });

  it('is still refused while the catalog item exists', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Still Here', '070847012481', 1, ?)"
    ).run(storeId);
    const session = await newSession();
    const row = await scan(session, '070847012481');
    const res = await patchItem(session.sessionId, row.body.item.id, { product_name: 'x' });
    expect(res.status).toBe(409);
  });
});

describe('M2: scanned barcodes', () => {
  it('stores a numeric barcode without spaces or dashes', async () => {
    const session = await newSession();
    const res = await scan(session, '0 12345-67890 5');
    expect(res.status).toBe(200);
    expect(res.body.item.upc).toBe('012345678905');
  });

  it('refuses control characters and number-formatted values, and says why', async () => {
    const session = await newSession();
    const cases: Array<[unknown, RegExp]> = [
      ['12 3', /cannot be part of a barcode/],
      ['1.23457E+11', /Excel reformatted/],
      ['12345678905.0', /Excel reformatted/],
      [{ code: 1 }, /must be text/],
    ];
    for (const [upc, message] of cases) {
      const res = await scan(session, upc);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    }
  });

  it('keeps letter codes as scanned', async () => {
    const session = await newSession();
    const res = await scan(session, 'ABC-123');
    expect(res.body.item.upc).toBe('ABC-123');
  });
});
