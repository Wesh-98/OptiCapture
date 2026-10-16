/**
 * tests/key-flow-gaps.test.ts — guard rails on key flows that had no test
 *
 * The coverage report showed these branches never ran. Each guards something a store relies
 * on day to day:
 *   - changing your own password: the validation and the wrong-current-password refusal
 *   - renaming a category: input validation, the reserved name, and a missing category
 *   - the staged-scan clean-up routes (clear all, remove one, delete a draft): another
 *     store's session and an already-committed session must both be untouchable
 *   - a spreadsheet import that cannot be read must fail cleanly, not with a 500
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { upcCacheSet } from '../src/server/cache.js';
import {
  createTestApp,
  getStoreCode,
  login,
  registerStore,
  type RegisteredStore,
} from './helpers.js';

const request = createTestApp();

let store: RegisteredStore;
let otherStore: RegisteredStore;
let takerCookie: string;
let categoryId: number;

beforeAll(async () => {
  store = await registerStore(request, { storeName: 'Key Flow Store', username: 'keyflowowner' });
  otherStore = await registerStore(request, {
    storeName: 'Key Flow Other',
    username: 'keyflowother',
  });
  takerCookie = await login(request, 'taker', 'taker123', getStoreCode(1));
  categoryId = Number(
    db
      .prepare(
        "INSERT INTO categories (name, icon, store_id) VALUES ('Key Flow Cat', 'Package', ?)"
      )
      .run(store.storeId).lastInsertRowid
  );
});

// ── Password change ──────────────────────────────────────────────────────────

describe('PUT /api/auth/store/password — validation', () => {
  let owner: RegisteredStore;

  beforeAll(async () => {
    owner = await registerStore(request, {
      storeName: 'Password Rules Store',
      username: 'pwrulesowner',
      password: 'Original1',
    });
  });

  const change = (body: unknown, cookie = owner.cookie) =>
    request
      .put('/api/auth/store/password')
      .set('Cookie', cookie)
      .send(body as object);

  it('requires both passwords, as strings', async () => {
    for (const body of [
      {},
      { current_password: 'Original1' },
      { new_password: 'Changed22' },
      { current_password: 'Original1', new_password: 12345678 },
    ]) {
      const res = await change(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Both fields are required');
    }
  });

  it('rejects a new password that is too weak', async () => {
    for (const weak of ['Short1', 'alllowercase1', 'NoDigitsHere']) {
      const res = await change({ current_password: 'Original1', new_password: weak });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least 8 characters/);
    }
  });

  it('refuses a wrong current password and leaves the password unchanged', async () => {
    const res = await change({ current_password: 'NotMine99', new_password: 'Changed22' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect');

    // The original still works and the session is still valid.
    await expect(
      login(request, 'pwrulesowner', 'Original1', owner.storeCode)
    ).resolves.toBeTruthy();
    const me = await request.get('/api/auth/me').set('Cookie', owner.cookie);
    expect(me.status).toBe(200);
  });

  it('requires a signed-in user', async () => {
    const res = await request
      .put('/api/auth/store/password')
      .send({ current_password: 'Original1', new_password: 'Changed22' });
    expect(res.status).toBe(401);
  });

  it('switches the login to the new password and keeps the caller signed in', async () => {
    const res = await change({ current_password: 'Original1', new_password: 'Changed22' });
    expect(res.status).toBe(200);

    // The re-issued cookie in the response keeps this browser signed in.
    const fresh = [res.headers['set-cookie'] ?? []].flat()[0];
    expect(fresh).toBeTruthy();
    const me = await request.get('/api/auth/me').set('Cookie', fresh);
    expect(me.status).toBe(200);

    const oldLogin = await request
      .post('/api/auth/login')
      .send({ username: 'pwrulesowner', password: 'Original1', store_code: owner.storeCode });
    expect(oldLogin.status).toBe(401);
    await expect(
      login(request, 'pwrulesowner', 'Changed22', owner.storeCode)
    ).resolves.toBeTruthy();
  });
});

// ── Category rename ──────────────────────────────────────────────────────────

describe('PUT /api/categories/:id — validation', () => {
  const rename = (id: number | string, body: unknown, cookie = store.cookie) =>
    request
      .put(`/api/categories/${id}`)
      .set('Cookie', cookie)
      .send(body as object);

  it('requires a non-blank name of at most 100 characters', async () => {
    for (const body of [{}, { name: '   ' }, { name: 42 }]) {
      const res = await rename(categoryId, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Category name is required');
    }
    const long = await rename(categoryId, { name: 'x'.repeat(101) });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('Category name is too long');
  });

  it('validates the icon', async () => {
    const wrongType = await rename(categoryId, { name: 'Drinks', icon: 5 });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toBe('Category icon must be a string');

    const tooLong = await rename(categoryId, { name: 'Drinks', icon: 'I'.repeat(500) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('Category icon is too long');
  });

  it('will not rename a category to "Inventory"', async () => {
    const res = await rename(categoryId, { name: ' inventory ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Inventory is not a category name');
  });

  it('answers 404 for a category that does not exist, or belongs to another store', async () => {
    const missing = await rename(999_999, { name: 'Ghost' });
    expect(missing.status).toBe(404);

    const theirs = await rename(categoryId, { name: 'Hijacked' }, otherStore.cookie);
    expect(theirs.status).toBe(404);
    const row = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as {
      name: string;
    };
    expect(row.name).toBe('Key Flow Cat');
  });

  it('is for owners only', async () => {
    const res = await rename(categoryId, { name: 'Taker Rename' }, takerCookie);
    expect(res.status).toBe(403);
  });

  it('trims the name, defaults the icon, and logs the change', async () => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO categories (name, icon, store_id) VALUES ('Key Flow Crisps', 'Cookie', ?)"
        )
        .run(store.storeId).lastInsertRowid
    );
    const res = await rename(id, { name: '  Salty Snacks  ' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT name, icon FROM categories WHERE id = ?').get(id);
    expect(row).toEqual({ name: 'Salty Snacks', icon: 'Package' });
    const log = db
      .prepare("SELECT details FROM logs WHERE store_id = ? AND action = 'UPDATE' ORDER BY id DESC")
      .get(store.storeId) as { details: string } | undefined;
    expect(log?.details).toBe('Updated category "Salty Snacks"');
  });
});

// ── Staged-scan clean-up ─────────────────────────────────────────────────────

describe('clearing and deleting staged scans', () => {
  let upcSeq = 0;

  async function sessionWithItem(cookie = store.cookie) {
    const created = await request.post('/api/session/create').set('Cookie', cookie);
    expect(created.status).toBe(200);
    const { sessionId, otp } = created.body as { sessionId: string; otp: string };

    upcSeq += 1;
    const upc = `7700000000${String(upcSeq).padStart(2, '0')}`;
    // A fresh cache entry keeps the background product lookup off the network.
    upcCacheSet(upc, {
      product_name: 'Staged',
      brand: null,
      image: null,
      source: 'test',
      ts: Date.now(),
    });
    const scanned = await request.post(`/api/session/${sessionId}/scan`).send({ upc, otp });
    expect(scanned.status).toBeLessThan(300);
    const itemId = (
      db.prepare('SELECT id FROM session_items WHERE session_id = ?').get(sessionId) as {
        id: number;
      }
    ).id;
    return { sessionId, itemId };
  }

  const stagedCount = (sessionId: string) =>
    (
      db.prepare('SELECT COUNT(*) AS n FROM session_items WHERE session_id = ?').get(sessionId) as {
        n: number;
      }
    ).n;

  it("cannot touch another store's session in any way", async () => {
    const { sessionId, itemId } = await sessionWithItem();

    const clear = await request
      .delete(`/api/session/${sessionId}/items`)
      .set('Cookie', otherStore.cookie);
    expect(clear.status).toBe(403);
    const one = await request
      .delete(`/api/session/${sessionId}/items/${itemId}`)
      .set('Cookie', otherStore.cookie);
    expect(one.status).toBe(403);
    const whole = await request
      .delete(`/api/session/${sessionId}`)
      .set('Cookie', otherStore.cookie);
    expect(whole.status).toBe(404);

    expect(stagedCount(sessionId)).toBe(1);
    expect(
      db.prepare('SELECT 1 FROM scan_sessions WHERE session_id = ?').get(sessionId)
    ).toBeTruthy();
  });

  it('leaves a committed session exactly as it was', async () => {
    const { sessionId, itemId } = await sessionWithItem();
    // Committing the only staged row completes the session.
    const committed = await request
      .post(`/api/session/${sessionId}/commit`)
      .set('Cookie', store.cookie)
      .send({ assignments: [{ id: itemId, category_id: categoryId }] });
    expect(committed.status).toBe(200);
    expect(committed.body.status).toBe('completed');
    const before = stagedCount(sessionId);

    const clear = await request
      .delete(`/api/session/${sessionId}/items`)
      .set('Cookie', store.cookie);
    expect(clear.status).toBe(403);
    expect(clear.body.error).toBe('Cannot clear a committed session');

    const one = await request
      .delete(`/api/session/${sessionId}/items/${itemId}`)
      .set('Cookie', store.cookie);
    expect(one.status).toBe(403);
    expect(one.body.error).toBe('Cannot delete items from a committed session');

    const whole = await request.delete(`/api/session/${sessionId}`).set('Cookie', store.cookie);
    expect(whole.status).toBe(403);

    expect(stagedCount(sessionId)).toBe(before);
    expect(
      db.prepare('SELECT status FROM scan_sessions WHERE session_id = ?').get(sessionId)
    ).toEqual({
      status: 'completed',
    });
  });

  it('removes one staged row, clears the rest, and deletes a draft with its rows', async () => {
    const { sessionId, itemId } = await sessionWithItem();

    const one = await request
      .delete(`/api/session/${sessionId}/items/${itemId}`)
      .set('Cookie', store.cookie);
    expect(one.status).toBe(200);
    expect(stagedCount(sessionId)).toBe(0);

    const second = await sessionWithItem();
    const clear = await request
      .delete(`/api/session/${second.sessionId}/items`)
      .set('Cookie', store.cookie);
    expect(clear.status).toBe(200);
    expect(stagedCount(second.sessionId)).toBe(0);

    const third = await sessionWithItem();
    const draft = await request
      .patch(`/api/session/${third.sessionId}/status`)
      .set('Cookie', store.cookie)
      .send({ status: 'draft', label: 'To delete' });
    expect(draft.status).toBe(200);
    const removed = await request
      .delete(`/api/session/${third.sessionId}`)
      .set('Cookie', store.cookie);
    expect(removed.status).toBe(200);
    expect(stagedCount(third.sessionId)).toBe(0);
    expect(
      db.prepare('SELECT 1 FROM scan_sessions WHERE session_id = ?').get(third.sessionId)
    ).toBeUndefined();
  });
});

// ── Import upload ────────────────────────────────────────────────────────────

describe('POST /api/inventory/batch-upload — unreadable files', () => {
  const upload = (buffer: Buffer, filename: string, cookie = store.cookie) =>
    request
      .post('/api/inventory/batch-upload')
      .set('Cookie', cookie)
      .attach('file', buffer, filename);

  it('answers a corrupt workbook with a clear 400', async () => {
    const res = await upload(Buffer.from('this is not a zip archive at all'), 'stock.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.');
  });

  it('answers malformed JSON with a 400, not a 500', async () => {
    const res = await upload(Buffer.from('{"items": [1, 2,'), 'stock.json');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejects other file types and a missing file', async () => {
    const pdf = await upload(Buffer.from('%PDF-1.7'), 'stock.pdf');
    expect(pdf.status).toBe(400);
    expect(pdf.body.error).toMatch(/Invalid file type/);

    const none = await request.post('/api/inventory/batch-upload').set('Cookie', store.cookie);
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('No file uploaded');
  });

  it('is for owners only', async () => {
    const res = await upload(Buffer.from('upc,name\n1,A\n'), 'stock.csv', takerCookie);
    expect(res.status).toBe(403);
  });
});
