/**
 * tests/hardening.test.ts — Regression tests for the health-check fixes.
 *
 * Each test here pins a specific defect that was found and fixed. They are
 * grouped by the concern they protect rather than by route, so the intent stays
 * obvious if one of them starts failing later.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let ownerCookie: string;
let takerCookie: string;
let storeOneCategoryId: number;

beforeAll(async () => {
  const storeCode = getStoreCode(1);
  ownerCookie = await login(request, 'admin', 'admin123', storeCode);
  takerCookie = await login(request, 'taker', 'taker123', storeCode);
  storeOneCategoryId = (
    db.prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1').get() as {
      id: number;
    }
  ).id;
});

beforeEach(() => {
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
});

describe('cross-tenant category assignment', () => {
  it('rejects an inventory create pointing at another store’s category', async () => {
    const other = await registerStore(request, {
      storeName: 'Foreign Store A',
      username: 'foreign-owner-a',
    });
    const foreignCategoryId = (
      db.prepare('SELECT id FROM categories WHERE store_id = ? LIMIT 1').get(other.storeId) as {
        id: number;
      }
    ).id;

    const res = await request
      .post('/api/inventory')
      .set('Cookie', ownerCookie)
      .send({ item_name: 'Smuggled Item', quantity: 1, category_id: foreignCategoryId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid category');
    expect(db.prepare('SELECT COUNT(*) AS n FROM inventory').get()).toEqual({ n: 0 });
  });

  it('rejects an inventory update pointing at another store’s category', async () => {
    const other = await registerStore(request, {
      storeName: 'Foreign Store B',
      username: 'foreign-owner-b',
    });
    const foreignCategoryId = (
      db.prepare('SELECT id FROM categories WHERE store_id = ? LIMIT 1').get(other.storeId) as {
        id: number;
      }
    ).id;

    const created = db
      .prepare(
        `INSERT INTO inventory (item_name, quantity, category_id, status, store_id)
         VALUES ('Local Item', 1, ?, 'Active', 1)`
      )
      .run(storeOneCategoryId);

    const res = await request
      .put(`/api/inventory/${created.lastInsertRowid}`)
      .set('Cookie', ownerCookie)
      .send({ item_name: 'Local Item', quantity: 1, category_id: foreignCategoryId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid category');
    const row = db
      .prepare('SELECT category_id FROM inventory WHERE id = ?')
      .get(created.lastInsertRowid) as { category_id: number };
    expect(row.category_id).toBe(storeOneCategoryId);
  });

  it('still accepts a category owned by the caller’s own store', async () => {
    const res = await request
      .post('/api/inventory')
      .set('Cookie', ownerCookie)
      .send({ item_name: 'Legitimate Item', quantity: 1, category_id: storeOneCategoryId });

    expect(res.status).toBe(200);
  });
});

describe('CSV export formula injection', () => {
  it('neutralises leading formula characters in exported cells', async () => {
    db.prepare(
      `INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
       VALUES (?, 1, ?, 'Active', ?, 1)`
    ).run("=cmd|'/c calc'!A0", storeOneCategoryId, 'csv-injection-1');

    const res = await request
      .get('/api/inventory/export')
      .set('Cookie', ownerCookie)
      .query({ format: 'csv' });

    expect(res.status).toBe(200);
    // The dangerous cell is present but prefixed so Excel treats it as text.
    expect(res.text).toContain("\"'=cmd|'/c calc'!A0\"");
    expect(res.text).not.toContain('"=cmd');
  });
});

describe('store code exposure', () => {
  it('returns the store code to an owner', async () => {
    const res = await request.get('/api/auth/store/settings').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.store_code).toBe(getStoreCode(1));
  });

  it('withholds the store code from a taker', async () => {
    const res = await request.get('/api/auth/store/settings').set('Cookie', takerCookie);
    // The taker still needs this screen (name, logo, password change) — only the
    // credential-bearing field is stripped.
    expect(res.status).toBe(200);
    expect(res.body.name).toBeTruthy();
    expect(res.body.store_code).toBeNull();
  });
});

describe('session item partial updates', () => {
  it('leaves fields absent from the PATCH body untouched', async () => {
    const createRes = await request.post('/api/session/create').set('Cookie', ownerCookie);
    const sessionId = createRes.body.sessionId as string;

    const inserted = db
      .prepare(
        `INSERT INTO session_items
           (session_id, upc, quantity, lookup_status, product_name, brand, unit, sale_price)
         VALUES (?, ?, 2, 'new_candidate', 'Original Name', 'Original Brand', 'can', 4.5)`
      )
      .run(sessionId, 'partial-patch-1');

    const res = await request
      .patch(`/api/session/${sessionId}/items/${inserted.lastInsertRowid}`)
      .set('Cookie', ownerCookie)
      .send({ quantity: 7 });

    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({
      quantity: 7,
      product_name: 'Original Name',
      brand: 'Original Brand',
      unit: 'can',
    });
    // session_items.sale_price was added as TEXT (migration 2), so the untouched
    // value round-trips as a string — the point here is that it survived at all.
    expect(Number(res.body.item.sale_price)).toBe(4.5);
  });

  it('still clears a field when the client explicitly sends an empty value', async () => {
    const createRes = await request.post('/api/session/create').set('Cookie', ownerCookie);
    const sessionId = createRes.body.sessionId as string;

    const inserted = db
      .prepare(
        `INSERT INTO session_items
           (session_id, upc, quantity, lookup_status, product_name, brand)
         VALUES (?, ?, 1, 'new_candidate', 'Original Name', 'Original Brand')`
      )
      .run(sessionId, 'partial-patch-2');

    const res = await request
      .patch(`/api/session/${sessionId}/items/${inserted.lastInsertRowid}`)
      .set('Cookie', ownerCookie)
      .send({ brand: '' });

    expect(res.status).toBe(200);
    expect(res.body.item.brand).toBeNull();
    expect(res.body.item.product_name).toBe('Original Name');
  });
});

describe('OTP attempt accounting on the read path', () => {
  it('burns an attempt when GET /session/:id/items is given a wrong OTP', async () => {
    const createRes = await request.post('/api/session/create').set('Cookie', ownerCookie);
    const sessionId = createRes.body.sessionId as string;

    const before = db
      .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
      .get(sessionId) as { otp_attempts: number };

    const res = await request.get(`/api/session/${sessionId}/items`).query({ otp: 'WRONGOTP' });

    expect(res.status).toBe(403);
    const after = db
      .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
      .get(sessionId) as { otp_attempts: number };
    expect(after.otp_attempts).toBe(before.otp_attempts + 1);
  });

  it('locks the read path out after repeated wrong OTPs', async () => {
    const createRes = await request.post('/api/session/create').set('Cookie', ownerCookie);
    const sessionId = createRes.body.sessionId as string;
    const correctOtp = createRes.body.otp as string;

    for (let i = 0; i < 5; i++) {
      await request.get(`/api/session/${sessionId}/items`).query({ otp: 'WRONGOTP' });
    }

    // Even the correct OTP is refused once the attempt budget is spent.
    const res = await request.get(`/api/session/${sessionId}/items`).query({ otp: correctOtp });
    expect(res.status).toBe(429);
  });
});

describe('session commit input validation', () => {
  it('returns 400 rather than 500 for a non-numeric category id', async () => {
    const createRes = await request.post('/api/session/create').set('Cookie', ownerCookie);
    const sessionId = createRes.body.sessionId as string;

    const inserted = db
      .prepare(
        `INSERT INTO session_items (session_id, upc, quantity, lookup_status, product_name)
         VALUES (?, ?, 1, 'new_candidate', 'Commit Me')`
      )
      .run(sessionId, 'commit-nan-1');

    const res = await request
      .post(`/api/session/${sessionId}/commit`)
      .set('Cookie', ownerCookie)
      .send({
        assignments: [{ id: Number(inserted.lastInsertRowid), category_id: 'not-a-number' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('One or more categories are invalid');
  });
});
