import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { revokeToken, upcCache, upcCacheSet } from '../src/server/cache.js';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let adminCookie: string;
let otherStoreCookie: string;
let otherStoreId: number;
let otherStoreUserId: number;

async function createSession() {
  const res = await request.post('/api/session/create').set('Cookie', adminCookie);
  expect(res.status).toBe(200);
  return res.body as { sessionId: string; otp: string };
}

function insertSessionItem(
  sessionId: string,
  data: {
    upc: string;
    quantity?: number;
    lookup_status?: string;
    product_name?: string | null;
    brand?: string | null;
    image?: string | null;
    source?: string;
    exists_in_inventory?: number;
    device_id?: string | null;
    unit?: string | null;
    sale_price?: number | null;
    tag_names?: string | null;
    scanned_at?: string;
    updated_at?: string;
  }
): number {
  const result = db
    .prepare(
      `
    INSERT INTO session_items (
      session_id, upc, quantity, scanned_at, updated_at, lookup_status,
      product_name, brand, image, source, exists_in_inventory, device_id,
      unit, sale_price, tag_names
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      sessionId,
      data.upc,
      data.quantity ?? 1,
      data.scanned_at ?? '2026-01-02T10:00:00',
      data.updated_at ?? '2026-01-02T10:00:00',
      data.lookup_status ?? 'new_candidate',
      data.product_name ?? null,
      data.brand ?? null,
      data.image ?? null,
      data.source ?? 'manual',
      data.exists_in_inventory ?? 0,
      data.device_id ?? null,
      data.unit ?? null,
      data.sale_price ?? null,
      data.tag_names ?? null
    );

  return Number(result.lastInsertRowid);
}

beforeAll(async () => {
  const adminStoreCode = getStoreCode(1);
  adminCookie = await login(request, 'admin', 'admin123', adminStoreCode);

  const otherStore = await registerStore(request, {
    storeName: 'Session Isolation Store',
    username: 'sessionowner',
  });
  otherStoreId = otherStore.storeId;
  otherStoreCookie = otherStore.cookie;
  otherStoreUserId = (db
    .prepare("SELECT id FROM users WHERE store_id = ? AND role = 'owner'")
    .get(otherStore.storeId) as { id: number } | undefined)!.id;
});

beforeEach(() => {
  db.prepare('DELETE FROM session_items').run();
  db.prepare('DELETE FROM scan_sessions').run();
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
  db.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_id != ?').run(
    otherStoreUserId,
    otherStoreId
  );
  upcCache.clear();
});

describe('session creation and metadata', () => {
  it('reuses an empty active session and upgrades legacy OTPs', async () => {
    const first = await createSession();

    db.prepare('UPDATE scan_sessions SET otp = ?, otp_attempts = 5 WHERE session_id = ?').run(
      'ABC123',
      first.sessionId
    );

    const second = await createSession();

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.otp).toHaveLength(8);
    expect(second.otp).not.toBe('ABC123');
    expect(
      (
        db
          .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
          .get(first.sessionId) as any
      ).otp_attempts
    ).toBe(0);
  });

  it('lists active sessions with items and supports draft/resume metadata updates', async () => {
    const session = await createSession();
    insertSessionItem(session.sessionId, {
      upc: 'session-active-1',
      product_name: 'Scanned Item',
    });

    const activeRes = await request.get('/api/sessions/active').set('Cookie', adminCookie);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body).toHaveLength(1);
    expect(activeRes.body[0]).toMatchObject({
      session_id: session.sessionId,
      status: 'active',
      item_count: 1,
      created_by: 'admin',
    });

    const badStatusRes = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'completed' });
    expect(badStatusRes.status).toBe(400);

    const draftRes = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'draft', label: 'Night Shift Draft' });
    expect(draftRes.status).toBe(200);

    const metaAfterDraft = await request
      .get(`/api/session/${session.sessionId}/meta`)
      .set('Cookie', adminCookie);
    expect(metaAfterDraft.status).toBe(200);
    expect(metaAfterDraft.body).toMatchObject({
      session_id: session.sessionId,
      status: 'draft',
      label: 'Night Shift Draft',
      otp: session.otp,
    });

    const resumeRes = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' });
    expect(resumeRes.status).toBe(200);
  });
});

describe('session item retrieval', () => {
  it('requires a valid OTP, filters by device, and enforces account store access for browser sessions', async () => {
    const session = await createSession();
    insertSessionItem(session.sessionId, { upc: 'shared-item', device_id: null });
    insertSessionItem(session.sessionId, { upc: 'device-a-item', device_id: 'device-a' });
    insertSessionItem(session.sessionId, { upc: 'device-b-item', device_id: 'device-b' });

    const missingOtpRes = await request.get(`/api/session/${session.sessionId}/items`);
    expect(missingOtpRes.status).toBe(400);

    const invalidOtpRes = await request
      .get(`/api/session/${session.sessionId}/items`)
      .query({ otp: 'WRONGOTP' });
    expect(invalidOtpRes.status).toBe(403);

    const filteredRes = await request
      .get(`/api/session/${session.sessionId}/items`)
      .query({ otp: session.otp, device_id: 'device-a' });
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.items.map((item: any) => item.upc).sort()).toEqual([
      'device-a-item',
      'shared-item',
    ]);

    const foreignStoreRes = await request
      .get(`/api/session/${session.sessionId}/items`)
      .set('Cookie', otherStoreCookie)
      .query({ otp: session.otp });
    expect(foreignStoreRes.status).toBe(403);

    // The auth cookie is now account-scoped, so once this user is granted
    // membership to store 1 the OTP route should allow access even though the
    // browser session originated from a different store login.
    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      otherStoreUserId,
      1,
      'taker'
    );

    const delegatedAccessRes = await request
      .get(`/api/session/${session.sessionId}/items`)
      .set('Cookie', otherStoreCookie)
      .query({ otp: session.otp });
    expect(delegatedAccessRes.status).toBe(200);

    const mismatchedHeaderRes = await request
      .get(`/api/session/${session.sessionId}/items`)
      .set('Cookie', otherStoreCookie)
      .set('X-Store-Id', String(otherStoreId))
      .query({ otp: session.otp });
    expect(mismatchedHeaderRes.status).toBe(403);
  });

  it('rejects revoked browser cookies on OTP item retrieval', async () => {
    const session = await createSession();
    insertSessionItem(session.sessionId, { upc: 'revoked-cookie-item' });

    const delegatedStore = await registerStore(request, {
      storeName: 'Revoked OTP Browser Store',
      username: 'revokedotpowner',
    });
    const delegatedUserId = (db
      .prepare('SELECT id FROM users WHERE store_id = ?')
      .get(delegatedStore.storeId) as { id: number }).id;
    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      delegatedUserId,
      1,
      'taker'
    );

    const token = /token=([^;]+)/.exec(delegatedStore.cookie)?.[1];
    expect(token).toBeTruthy();
    revokeToken(token!);

    const res = await request
      .get(`/api/session/${session.sessionId}/items`)
      .set('Cookie', delegatedStore.cookie)
      .query({ otp: session.otp });
    expect(res.status).toBe(401);
  });

  it('returns 410 for expired sessions and supports incremental authenticated polling', async () => {
    const expiredSession = await createSession();
    db.prepare('UPDATE scan_sessions SET expires_at = ? WHERE session_id = ?').run(
      '2000-01-01T00:00:00.000Z',
      expiredSession.sessionId
    );

    const expiredRes = await request
      .get(`/api/session/${expiredSession.sessionId}/items`)
      .query({ otp: expiredSession.otp });
    expect(expiredRes.status).toBe(410);

    const activeSession = await createSession();
    const firstId = insertSessionItem(activeSession.sessionId, {
      upc: 'poll-1',
      updated_at: '2026-01-02T10:00:00',
    });
    insertSessionItem(activeSession.sessionId, {
      upc: 'poll-2',
      updated_at: '2026-01-02T10:00:00',
    });
    insertSessionItem(activeSession.sessionId, {
      upc: 'poll-3',
      updated_at: '2026-01-02T11:00:00',
    });

    const res = await request
      .get(`/api/session/${activeSession.sessionId}`)
      .set('Cookie', adminCookie)
      .query({ since_updated_at: '2026-01-02T10:00:00', since_id: String(firstId) });

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: any) => item.upc)).toEqual(['poll-3', 'poll-2']);
  });
});

describe('session scanning', () => {
  it('allows browser scans through delegated access and rejects a mismatched active-store header', async () => {
    const session = await createSession();

    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      otherStoreUserId,
      1,
      'taker'
    );

    const delegatedScanRes = await request
      .post(`/api/session/${session.sessionId}/scan`)
      .set('Cookie', otherStoreCookie)
      .send({ upc: 'delegated-browser-scan', otp: session.otp });
    expect(delegatedScanRes.status).toBe(200);

    const mismatchedHeaderRes = await request
      .post(`/api/session/${session.sessionId}/scan`)
      .set('Cookie', otherStoreCookie)
      .set('X-Store-Id', String(otherStoreId))
      .send({ upc: 'delegated-browser-scan-2', otp: session.otp });
    expect(mismatchedHeaderRes.status).toBe(403);
  });

  it('increments OTP failures and enforces draft or locked session guards', async () => {
    const invalidOtpSession = await createSession();

    const invalidOtpRes = await request
      .post(`/api/session/${invalidOtpSession.sessionId}/scan`)
      .send({
        upc: 'scan-invalid',
        otp: 'WRONGOTP',
      });
    expect(invalidOtpRes.status).toBe(401);
    expect(
      (
        db
          .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
          .get(invalidOtpSession.sessionId) as any
      ).otp_attempts
    ).toBe(1);

    db.prepare('UPDATE scan_sessions SET otp_attempts = 5 WHERE session_id = ?').run(
      invalidOtpSession.sessionId
    );
    const lockedRes = await request.post(`/api/session/${invalidOtpSession.sessionId}/scan`).send({
      upc: 'scan-locked',
      otp: invalidOtpSession.otp,
    });
    expect(lockedRes.status).toBe(429);

    const draftSession = await createSession();
    db.prepare("UPDATE scan_sessions SET status = 'draft' WHERE session_id = ?").run(
      draftSession.sessionId
    );
    const draftRes = await request.post(`/api/session/${draftSession.sessionId}/scan`).send({
      upc: 'scan-draft',
      otp: draftSession.otp,
    });
    expect(draftRes.status).toBe(403);
  });

  it('uses inventory matches immediately and merges conflicting device ids safely', async () => {
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, image, unit, store_id)
      VALUES (?, ?, ?, 'Active', ?, ?, ?, 1)
    `
    ).run('Inventory Match', 4, categoryId, 'scan-existing-1', '/uploads/match.png', 'ea');

    const session = await createSession();

    const firstScan = await request
      .post(`/api/session/${session.sessionId}/scan`)
      .set('x-device-id', 'device-a')
      .send({ upc: 'scan-existing-1', otp: session.otp });
    expect(firstScan.status).toBe(200);
    expect(firstScan.body.item).toMatchObject({
      lookup_status: 'existing',
      product_name: 'Inventory Match',
      source: 'inventory',
      exists_in_inventory: 1,
      unit: 'ea',
    });

    const secondScan = await request
      .post(`/api/session/${session.sessionId}/scan`)
      .set('x-device-id', 'device-b')
      .send({ upc: 'scan-existing-1', otp: session.otp });
    expect(secondScan.status).toBe(200);

    const row = db
      .prepare(
        'SELECT quantity, device_id, source, exists_in_inventory FROM session_items WHERE session_id = ? AND upc = ?'
      )
      .get(session.sessionId, 'scan-existing-1') as any;
    expect(row).toMatchObject({
      quantity: 2,
      device_id: null,
      source: 'inventory',
      exists_in_inventory: 1,
    });
  });

  it('supports manual item names and cached UPC lookups without external requests', async () => {
    const session = await createSession();

    const manualRes = await request.post(`/api/session/${session.sessionId}/scan`).send({
      upc: 'scan-manual-1',
      otp: session.otp,
      item_name: 'Manual Product',
    });
    expect(manualRes.status).toBe(200);
    expect(manualRes.body.item).toMatchObject({
      lookup_status: 'new_candidate',
      product_name: 'Manual Product',
      source: 'manual',
    });

    upcCacheSet('scan-cache-1', {
      product_name: 'Cached Product',
      brand: 'Cached Brand',
      image: 'https://example.com/cached.png',
      source: 'upcitemdb',
      ts: Date.now(),
    });

    const cachedRes = await request.post(`/api/session/${session.sessionId}/scan`).send({
      upc: 'scan-cache-1',
      otp: session.otp,
    });
    expect(cachedRes.status).toBe(200);
    expect(cachedRes.body.item).toMatchObject({
      lookup_status: 'new_candidate',
      product_name: 'Cached Product',
      brand: 'Cached Brand',
      source: 'upcitemdb',
    });
  });
});

describe('session input validation', () => {
  it('blocks status changes on a committed session', async () => {
    const session = await createSession();
    db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(
      session.sessionId
    );

    const toDraftRes = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'draft' });
    expect(toDraftRes.status).toBe(403);

    const toActiveRes = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' });
    expect(toActiveRes.status).toBe(403);
  });

  it('rejects oversized item_name in manual scan and handles invalid poll cursors gracefully', async () => {
    const session = await createSession();

    // item_name longer than 500 chars should be truncated, not stored raw
    const longName = 'A'.repeat(600);
    const scanRes = await request.post(`/api/session/${session.sessionId}/scan`).send({
      upc: 'validation-1',
      otp: session.otp,
      item_name: longName,
    });
    expect(scanRes.status).toBe(200);
    const row = db
      .prepare('SELECT product_name FROM session_items WHERE session_id = ? AND upc = ?')
      .get(session.sessionId, 'validation-1') as any;
    expect(row.product_name.length).toBe(500);

    // Non-numeric sinceId should fall back to returning all items (no frozen feed)
    const pollRes = await request
      .get(`/api/session/${session.sessionId}`)
      .set('Cookie', adminCookie)
      .query({ since_updated_at: '2026-01-01T00:00:00', since_id: 'abc' });
    expect(pollRes.status).toBe(200);

    // Malformed since_updated_at should also fall back to returning the full feed.
    const badTimestampRes = await request
      .get(`/api/session/${session.sessionId}`)
      .set('Cookie', adminCookie)
      .query({ since_updated_at: 'not-a-real-timestamp', since_id: '1' });
    expect(badTimestampRes.status).toBe(200);
    expect(badTimestampRes.body.items.map((item: any) => item.upc)).toContain('validation-1');
  });

  it('resets OTP attempt counter after a successful scan', async () => {
    const session = await createSession();

    // 3 wrong attempts
    for (let i = 0; i < 3; i++) {
      await request
        .post(`/api/session/${session.sessionId}/scan`)
        .send({ upc: 'x', otp: 'WRONGOTP' });
    }
    expect(
      (
        db
          .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
          .get(session.sessionId) as any
      ).otp_attempts
    ).toBe(3);

    // Correct OTP — should reset counter
    const goodRes = await request.post(`/api/session/${session.sessionId}/scan`).send({
      upc: 'otp-reset-1',
      otp: session.otp,
    });
    expect(goodRes.status).toBe(200);
    expect(
      (
        db
          .prepare('SELECT otp_attempts FROM scan_sessions WHERE session_id = ?')
          .get(session.sessionId) as any
      ).otp_attempts
    ).toBe(0);
  });

  it('sanitizes all string fields and sale_price in PATCH items', async () => {
    const session = await createSession();
    const itemId = insertSessionItem(session.sessionId, { upc: 'sanitize-1' });

    // sale_price as non-numeric string → stored as null
    await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({
        product_name: 'P'.repeat(600),
        brand: 'B'.repeat(300),
        sale_price: 'notanumber',
        unit: 'U'.repeat(100),
      });

    const row = db
      .prepare('SELECT product_name, brand, sale_price, unit FROM session_items WHERE id = ?')
      .get(itemId) as any;
    expect(row.product_name.length).toBe(500);
    expect(row.brand.length).toBe(200);
    expect(row.sale_price).toBeNull();
    expect(row.unit.length).toBe(50);
  });

  it('rejects oversized UPC edits and stores uploaded session-item images as files', async () => {
    const session = await createSession();
    const itemId = insertSessionItem(session.sessionId, { upc: 'sanitize-image-1' });

    const badUpcRes = await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({ product_name: 'Bad UPC', upc: 'U'.repeat(129) });
    expect(badUpcRes.status).toBe(400);

    const imageRes = await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({
        product_name: 'Image Item',
        image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X6l9VQAAAABJRU5ErkJggg==',
      });
    expect(imageRes.status).toBe(200);
    expect(imageRes.body.item.image).toMatch(/^\/uploads\//);
  });

  it('clamps quantity to [1, 1_000_000] and rejects non-numeric values', async () => {
    const session = await createSession();
    const itemId = insertSessionItem(session.sessionId, { upc: 'qty-test-1', quantity: 3 });

    // Negative value → clamped to 1
    await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({ product_name: 'Test', quantity: -999 });
    expect(
      (db.prepare('SELECT quantity FROM session_items WHERE id = ?').get(itemId) as any).quantity
    ).toBe(1);

    // String value → parsed, falls back to 1
    await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({ product_name: 'Test', quantity: 'bad' });
    expect(
      (db.prepare('SELECT quantity FROM session_items WHERE id = ?').get(itemId) as any).quantity
    ).toBe(1);

    // Oversized value → clamped to 1_000_000
    await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({ product_name: 'Test', quantity: 9_999_999 });
    expect(
      (db.prepare('SELECT quantity FROM session_items WHERE id = ?').get(itemId) as any).quantity
    ).toBe(1_000_000);
  });
});

describe('session item editing and commit flow', () => {
  it('updates, deletes, and clears session items for the owning store', async () => {
    const session = await createSession();
    const itemId = insertSessionItem(session.sessionId, {
      upc: 'edit-item-1',
      product_name: 'Original Name',
    });

    const patchRes = await request
      .patch(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie)
      .send({
        product_name: 'Edited Name',
        brand: 'Edited Brand',
        quantity: 5,
        upc: 'edit-item-1-updated',
        image: '/uploads/edited.png',
        tag_names: 'fresh,cold',
        sale_price: 2.99,
        unit: 'pack',
      });
    expect(patchRes.status).toBe(200);

    const editedRow = db
      .prepare(
        `
      SELECT product_name, brand, quantity, upc, image, tag_names, sale_price, unit, lookup_status
      FROM session_items
      WHERE id = ?
    `
      )
      .get(itemId) as any;
    expect(editedRow).toMatchObject({
      product_name: 'Edited Name',
      brand: 'Edited Brand',
      quantity: 5,
      upc: 'edit-item-1-updated',
      image: '/uploads/edited.png',
      tag_names: 'fresh,cold',
      sale_price: '2.99',
      unit: 'pack',
      lookup_status: 'new_candidate',
    });

    const deleteItemRes = await request
      .delete(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie);
    expect(deleteItemRes.status).toBe(200);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM session_items WHERE id = ?').get(itemId) as any)
        .count
    ).toBe(0);

    insertSessionItem(session.sessionId, { upc: 'clear-1' });
    insertSessionItem(session.sessionId, { upc: 'clear-2' });

    const clearRes = await request
      .delete(`/api/session/${session.sessionId}/items`)
      .set('Cookie', adminCookie);
    expect(clearRes.status).toBe(200);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM session_items WHERE session_id = ?')
          .get(session.sessionId) as any
      ).count
    ).toBe(0);

    insertSessionItem(session.sessionId, { upc: 'completed-1' });
    db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(
      session.sessionId
    );

    const completedClearRes = await request
      .delete(`/api/session/${session.sessionId}/items`)
      .set('Cookie', adminCookie);
    expect(completedClearRes.status).toBe(403);

    const completedDeleteItemRes = await request
      .delete(`/api/session/${session.sessionId}/items/${itemId}`)
      .set('Cookie', adminCookie);
    expect(completedDeleteItemRes.status).toBe(403);
  });

  it('validates commit assignments and tracks inserted versus skipped items', async () => {
    const session = await createSession();
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;

    const freshItemId = insertSessionItem(session.sessionId, {
      upc: 'commit-new-1',
      product_name: 'Fresh Commit Item',
      quantity: 2,
      sale_price: 1.99,
      unit: 'ea',
      lookup_status: 'new_candidate',
    });
    const existingItemId = insertSessionItem(session.sessionId, {
      upc: 'commit-existing-1',
      product_name: 'Existing Commit Item',
      lookup_status: 'new_candidate',
    });
    const unknownItemId = insertSessionItem(session.sessionId, {
      upc: 'commit-unknown-1',
      product_name: null,
      lookup_status: 'unknown',
    });

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, 1)
    `
    ).run('Already In Inventory', 9, categoryId, 'commit-existing-1');

    const missingAssignmentsRes = await request
      .post(`/api/session/${session.sessionId}/commit`)
      .set('Cookie', adminCookie)
      .send({});
    expect(missingAssignmentsRes.status).toBe(400);

    const invalidCategoryRes = await request
      .post(`/api/session/${session.sessionId}/commit`)
      .set('Cookie', adminCookie)
      .send({ assignments: [{ id: freshItemId, category_id: 999999 }] });
    expect(invalidCategoryRes.status).toBe(400);

    const commitRes = await request
      .post(`/api/session/${session.sessionId}/commit`)
      .set('Cookie', adminCookie)
      .send({
        assignments: [
          { id: freshItemId, category_id: categoryId },
          { id: existingItemId, category_id: categoryId },
          { id: unknownItemId, category_id: categoryId },
        ],
      });

    expect(commitRes.status).toBe(200);
    expect(commitRes.body).toMatchObject({
      total: 3,
      inserted: 1,
      skippedExisting: 1,
      skippedUnknown: 1,
      status: 'active',
    });
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM inventory WHERE upc = ?')
          .get('commit-new-1') as any
      ).count
    ).toBe(1);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM session_items WHERE session_id = ?')
          .get(session.sessionId) as any
      ).count
    ).toBe(2);
  });

  it('completes and deletes sessions only when the remaining state allows it', async () => {
    const completeSession = await createSession();
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = 1 ORDER BY id LIMIT 1')
      .get() as { id: number } | undefined)!.id;
    const commitItemId = insertSessionItem(completeSession.sessionId, {
      upc: 'commit-complete-1',
      product_name: 'Complete Me',
      lookup_status: 'new_candidate',
    });

    const commitRes = await request
      .post(`/api/session/${completeSession.sessionId}/commit`)
      .set('Cookie', adminCookie)
      .send({
        selectedIds: [commitItemId],
        category_id: categoryId,
      });
    expect(commitRes.status).toBe(200);
    expect(commitRes.body.status).toBe('completed');
    expect(
      (
        db
          .prepare('SELECT status FROM scan_sessions WHERE session_id = ?')
          .get(completeSession.sessionId) as any
      ).status
    ).toBe('completed');

    const completedDeleteRes = await request
      .delete(`/api/session/${completeSession.sessionId}`)
      .set('Cookie', adminCookie);
    expect(completedDeleteRes.status).toBe(403);

    const activeSession = await createSession();
    const deleteRes = await request
      .delete(`/api/session/${activeSession.sessionId}`)
      .set('Cookie', adminCookie);
    expect(deleteRes.status).toBe(200);

    const missingRes = await request
      .delete('/api/session/not-a-real-session')
      .set('Cookie', adminCookie);
    expect(missingRes.status).toBe(404);
  });
});
