/**
 * Regression tests for the defects confirmed by the 2026-10-02 backend QA audit.
 * Each block names the behaviour that was broken so a reintroduction fails loudly.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { db } from '../src/server/db.js';
import { isValidGtin } from '../src/server/helpers.js';
import { fetchWithScanRetry } from '../src/hooks/useMobileScan.js';
import { buildScanLimiters, isOtpScanRequest } from '../src/server/middleware.js';
import express from 'express';
import supertest from 'supertest';
import { createApp, parseTrustProxy } from '../src/server/app.js';
import { DUMMY_HASH, BCRYPT_COST } from '../src/server/cache.js';
import { createTestApp, login, registerStore, type RegisteredStore, type TestApp } from './helpers.js';

let request: TestApp;
let store: RegisteredStore;

const snacksId = () =>
  (db.prepare("SELECT id FROM categories WHERE store_id = ? AND name = 'Snacks'").get(store.storeId) as { id: number }).id;

async function openSession() {
  const res = await request.post('/api/session/create').set('Cookie', store.cookie).send({});
  return res.body as { sessionId: string; otp: string };
}

beforeAll(async () => {
  request = createTestApp();
  store = await registerStore(request, { storeName: 'QA Fix Mart', username: 'qafix' });
});

describe('login protection', () => {
  it('counts every failed attempt even when they arrive at the same time', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        request.post('/api/auth/login').send({ username: 'qafix', password: 'WrongPass1', store_code: store.storeCode })
      )
    );
    const row = db
      .prepare("SELECT failed_login_attempts, locked_until FROM users WHERE username = 'qafix'")
      .get() as { failed_login_attempts: number; locked_until: string | null };
    expect(row.failed_login_attempts).toBe(8);
    expect(row.locked_until).not.toBeNull();
    db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username = 'qafix'").run();
  });

  it('uses the same bcrypt cost for the unknown-user dummy hash as for real passwords', () => {
    expect(bcrypt.getRounds(DUMMY_HASH)).toBe(BCRYPT_COST);
    const stored = db.prepare("SELECT password FROM users WHERE username = 'qafix'").get() as { password: string };
    expect(bcrypt.getRounds(stored.password)).toBe(BCRYPT_COST);
  });
});

describe('proxy trust', () => {
  it('honours X-Forwarded-For only from loopback or private-network proxies by default', () => {
    const trust = createApp().get('trust proxy fn') as (addr: string, hop: number) => boolean;
    expect(trust('203.0.113.7', 0)).toBe(false);
    expect(trust('10.0.4.12', 0)).toBe(true);
    expect(trust('127.0.0.1', 0)).toBe(true);
  });

  it('accepts an explicit hop count or list from TRUST_PROXY', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy(undefined)).toBe('loopback, linklocal, uniquelocal');
  });
});

describe('POST /api/inventory', () => {
  it('returns 409 rather than 500 for a duplicate UPC', async () => {
    const first = await request.post('/api/inventory').set('Cookie', store.cookie).send({ item_name: 'Cola', upc: '555000111' });
    const dup = await request.post('/api/inventory').set('Cookie', store.cookie).send({ item_name: 'Other Cola', upc: ' 555000111 ' });
    expect(first.status).toBe(200);
    expect(dup.status).toBe(409);
  });

  it('trims names and treats differently-cased or padded names as duplicates', async () => {
    const created = await request.post('/api/inventory').set('Cookie', store.cookie).send({ item_name: '  Lemonade  ' });
    expect(created.status).toBe(200);
    const stored = db.prepare('SELECT item_name FROM inventory WHERE id = ?').get(created.body.id) as { item_name: string };
    expect(stored.item_name).toBe('Lemonade');
    expect((await request.post('/api/inventory').set('Cookie', store.cookie).send({ item_name: 'lemonade' })).status).toBe(409);
  });
});

describe('catalog import', () => {
  it('never invents quantities or names, parses formatted numbers, and reports invalid values', async () => {
    const res = await request.post('/api/inventory/batch-confirm').set('Cookie', store.cookie).send({
      sheetsData: [{
        sheetName: 'Inventory',
        mapping: { UPC: 'upc', Name: 'item_name', Price: 'sale_price', Qty: 'quantity', Cat: 'category' },
        rows: [
          { UPC: 'imp-1', Name: 'No Qty', Price: '$3.99', Qty: '', Cat: 'snacks' },
          { UPC: 'imp-2', Name: 'Thousands', Price: '1,250.50', Qty: '1,200', Cat: 'SNACKS' },
          { UPC: 'imp-3', Name: 'Fractional', Price: '1', Qty: '2.5', Cat: 'Snacks' },
          { UPC: 'imp-4', Name: 'Bad Price', Price: 'abc', Qty: '1', Cat: 'Snacks' },
          { UPC: 'imp-5', Name: '', Price: '1', Qty: '1', Cat: 'Snacks' },
        ],
      }],
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2);
    expect(res.body.errors).toHaveLength(3);
    expect(res.body.errors.join(' ')).toMatch(/whole number/);
    expect(res.body.errors.join(' ')).toMatch(/not a valid non-negative number/);
    expect(res.body.errors.join(' ')).toMatch(/Item name is required/);

    const rows = db
      .prepare("SELECT upc, quantity, sale_price, category_id FROM inventory WHERE store_id = ? AND upc LIKE 'imp-%' ORDER BY upc")
      .all(store.storeId) as Array<{ upc: string; quantity: number | null; sale_price: number; category_id: number }>;
    expect(rows.map(r => r.upc)).toEqual(['imp-1', 'imp-2']);
    expect(rows[0].quantity).toBeNull();
    expect(rows[0].sale_price).toBe(3.99);
    expect(rows[1].quantity).toBe(1200);
    expect(rows[1].sale_price).toBe(1250.5);
    // "snacks" and "SNACKS" reuse the store's existing "Snacks" category
    expect(rows.every(r => r.category_id === snacksId())).toBe(true);
    const snackCats = db
      .prepare("SELECT COUNT(*) AS n FROM categories WHERE store_id = ? AND LOWER(name) = 'snacks'")
      .get(store.storeId) as { n: number };
    expect(snackCats.n).toBe(1);
  });
});

describe('scan sessions', () => {
  it('returns the merged row when a barcode is rescanned with a leading zero', async () => {
    const { sessionId, otp } = await openSession();
    await request.post(`/api/session/${sessionId}/scan`).send({ upc: '012345678905', otp, item_name: 'Water' });
    const second = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '0012345678905', otp, item_name: 'Water' });
    expect(second.status).toBe(200);
    expect(second.body.item).toMatchObject({ upc: '012345678905', quantity: 2 });
  });

  it('never extends scanning past 24 hours from when the session was started or resumed', async () => {
    const { sessionId, otp } = await openSession();
    db.prepare(
      "UPDATE scan_sessions SET scan_window_started_at = datetime('now', '-23 hours'), expires_at = datetime('now', '+1 hour') WHERE session_id = ?"
    ).run(sessionId);
    await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7001', otp, item_name: 'Late' });
    const capped = db
      .prepare(
        "SELECT expires_at <= datetime(scan_window_started_at, '+24 hours') AS within, expires_at < datetime('now', '+2 hours') AS short FROM scan_sessions WHERE session_id = ?"
      )
      .get(sessionId) as { within: number; short: number };
    expect(capped).toEqual({ within: 1, short: 1 });

    // A window that is already over stops scanning once its last extension lapses
    db.prepare(
      "UPDATE scan_sessions SET scan_window_started_at = datetime('now', '-30 hours'), expires_at = datetime('now', '+1 minute') WHERE session_id = ?"
    ).run(sessionId);
    await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7002', otp, item_name: 'Later' });
    const blocked = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7003', otp, item_name: 'Too late' });
    expect(blocked.status).toBe(410);
  });

  it('starts a fresh scanning window when an authenticated user resumes a draft', async () => {
    const { sessionId, otp } = await openSession();
    await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7101', otp, item_name: 'Draft item' });
    db.prepare("UPDATE scan_sessions SET scan_window_started_at = datetime('now', '-30 hours') WHERE session_id = ?").run(sessionId);
    await request.patch(`/api/session/${sessionId}/status`).set('Cookie', store.cookie).send({ status: 'draft' });
    await request.patch(`/api/session/${sessionId}/status`).set('Cookie', store.cookie).send({ status: 'active' });
    const resumed = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7102', otp, item_name: 'After resume' });
    expect(resumed.status).toBe(200);
  });
});

describe('store logo', () => {
  it('keeps the logo when a settings save omits it, and clears it when sent empty', async () => {
    db.prepare("UPDATE stores SET logo = '/uploads/keep.png' WHERE id = ?").run(store.storeId);
    await request.put('/api/auth/store/settings').set('Cookie', store.cookie).send({ name: 'QA Fix Mart' });
    expect((db.prepare('SELECT logo FROM stores WHERE id = ?').get(store.storeId) as { logo: string | null }).logo).toBe('/uploads/keep.png');
    await request.put('/api/auth/store/settings').set('Cookie', store.cookie).send({ name: 'QA Fix Mart', logo: '' });
    expect((db.prepare('SELECT logo FROM stores WHERE id = ?').get(store.storeId) as { logo: string | null }).logo).toBeNull();
  });

  it('lets a superadmin remove a store logo by sending null', async () => {
    const superCookie = await login(request, 'superadmin', 'superadmin123');
    db.prepare("UPDATE stores SET logo = '/uploads/admin-keep.png' WHERE id = ?").run(store.storeId);
    const res = await request.put(`/api/admin/stores/${store.storeId}`).set('Cookie', superCookie).send({ name: 'QA Fix Mart', logo: null });
    expect(res.status).toBe(200);
    expect((db.prepare('SELECT logo FROM stores WHERE id = ?').get(store.storeId) as { logo: string | null }).logo).toBeNull();
  });
});

describe('superadmin store context', () => {
  it('refuses store-scoped routes with 403 instead of failing inside SQL', async () => {
    const superCookie = await login(request, 'superadmin', 'superadmin123');
    expect((await request.get('/api/inventory').set('Cookie', superCookie)).status).toBe(403);
    expect((await request.post('/api/session/create').set('Cookie', superCookie).send({})).status).toBe(403);
    expect((await request.post('/api/inventory').set('Cookie', superCookie).send({ item_name: 'x' })).status).toBe(403);
    // The routes superadmin screens use still work
    expect((await request.get('/api/admin/stores').set('Cookie', superCookie)).status).toBe(200);
    expect((await request.get('/api/auth/me').set('Cookie', superCookie)).status).toBe(200);
  });
});

describe('async route errors', () => {
  it('answers 500 instead of hanging when an async handler throws', async () => {
    const realPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('FROM stores WHERE store_code')) throw new Error('simulated database failure');
      return realPrepare(sql);
    }) as typeof db.prepare);
    try {
      const res = await request
        .post('/api/auth/login')
        .timeout(5000)
        .send({ username: 'qafix', password: 'Password1', store_code: store.storeCode });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'An internal error occurred' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('brand at commit', () => {
  it('keeps the scanned brand on the new catalog item and exports it', async () => {
    const { sessionId, otp } = await openSession();
    const scan = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '8801', otp, item_name: 'Ginger Ale' });
    await request
      .patch(`/api/session/${sessionId}/items/${scan.body.item.id}`)
      .set('Cookie', store.cookie)
      .send({ brand: 'Fizzco' });
    const commit = await request
      .post(`/api/session/${sessionId}/commit`)
      .set('Cookie', store.cookie)
      .send({ assignments: [{ id: scan.body.item.id, category_id: snacksId() }] });
    expect(commit.body.inserted).toBe(1);
    const row = db.prepare("SELECT brand FROM inventory WHERE upc = '8801' AND store_id = ?").get(store.storeId) as { brand: string };
    expect(row.brand).toBe('Fizzco');

    const csv = await request.get('/api/inventory/export').set('Cookie', store.cookie).query({ format: 'csv' });
    expect(csv.text.split('\n')[0]).toContain('"item_name","brand"');
    expect(csv.text).toContain('"Ginger Ale","Fizzco"');
  });
});

describe('barcode check digits', () => {
  it('validates EAN-8/UPC-E, UPC-A, EAN-13 and GTIN-14, and skips non-GTIN codes', () => {
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('036000291453')).toBe(false);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('04252614')).toBe(true); // UPC-E
    expect(isValidGtin('00036000291452')).toBe(true);
    expect(isValidGtin('ABC-123')).toBeNull();
    expect(isValidGtin('7001')).toBeNull();
  });

  it('flags a misread barcode, keeps it out of a commit, and clears the flag once corrected', async () => {
    const { sessionId, otp } = await openSession();
    const scan = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '036000291453', otp, item_name: 'Misread' });
    expect(scan.body.item.lookup_status).toBe('invalid_barcode');

    // Naming it does not make it committable
    const renamed = await request
      .patch(`/api/session/${sessionId}/items/${scan.body.item.id}`)
      .set('Cookie', store.cookie)
      .send({ product_name: 'Still misread' });
    expect(renamed.body.item.lookup_status).toBe('invalid_barcode');
    const blocked = await request
      .post(`/api/session/${sessionId}/commit`)
      .set('Cookie', store.cookie)
      .send({ assignments: [{ id: scan.body.item.id, category_id: snacksId() }] });
    expect(blocked.body.inserted ?? 0).toBe(0);

    // Correcting the UPC clears the flag and the item commits
    const fixed = await request
      .patch(`/api/session/${sessionId}/items/${scan.body.item.id}`)
      .set('Cookie', store.cookie)
      .send({ upc: '036000291452' });
    expect(fixed.body.item.lookup_status).toBe('new_candidate');
    const commit = await request
      .post(`/api/session/${sessionId}/commit`)
      .set('Cookie', store.cookie)
      .send({ assignments: [{ id: scan.body.item.id, category_id: snacksId() }] });
    expect(commit.body.inserted).toBe(1);
  });
});

describe('scan rate limits', () => {
  it('limits per device and per session, so phones sharing one store IP do not throttle each other', async () => {
    const app = express();
    app.get('/session/:id/items', ...buildScanLimiters({ perDevice: 5, perSession: 12, perIp: 100, windowMs: 60_000 }), (_req, res) => {
      res.json({ ok: true });
    });
    const client = supertest(app);
    const hit = (session: string, device: string) => client.get(`/session/${session}/items`).set('X-Device-Id', device);

    // Two phones on the same IP each use their full per-device allowance
    for (const device of ['phone-a', 'phone-b']) {
      for (let i = 0; i < 5; i++) expect((await hit('s1', device)).status).toBe(200);
    }
    // One phone going past its own allowance is stopped...
    expect((await hit('s1', 'phone-a')).status).toBe(429);
    // ...and the session as a whole is capped across all its phones
    expect((await hit('s1', 'phone-c')).status).toBe(200);
    expect((await hit('s1', 'phone-c')).status).toBe(429);
    // A different session on the same IP is unaffected
    expect((await hit('s2', 'phone-a')).status).toBe(200);
  });

  it('keeps the phone scan and sync endpoints out of the general per-IP API budget', () => {
    const req = (method: string, path: string) => ({ method, path }) as express.Request;
    expect(isOtpScanRequest(req('POST', '/session/abc/scan'))).toBe(true);
    expect(isOtpScanRequest(req('GET', '/session/abc/items'))).toBe(true);
    expect(isOtpScanRequest(req('DELETE', '/session/abc/items'))).toBe(false);
    expect(isOtpScanRequest(req('GET', '/inventory'))).toBe(false);
  });
});

describe('resent scans', () => {
  it('counts a scan once when the phone resends it with the same scan ID', async () => {
    const { sessionId, otp } = await openSession();
    const send = (scanId?: string) =>
      request.post(`/api/session/${sessionId}/scan`).send({ upc: '036000291452', otp, item_name: 'Soda', scan_id: scanId });

    const first = await send('scan-aaaa-0001');
    const resent = await send('scan-aaaa-0001');
    expect(first.body.item.quantity).toBe(1);
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ duplicate: true, item: { id: first.body.item.id, quantity: 1 } });

    // A new physical scan (new ID) and an old client (no ID) both still count
    expect((await send('scan-aaaa-0002')).body.item.quantity).toBe(2);
    expect((await send()).body.item.quantity).toBe(3);
  });

  it('rejects malformed scan IDs', async () => {
    const { sessionId, otp } = await openSession();
    const res = await request.post(`/api/session/${sessionId}/scan`).send({ upc: '7201', otp, scan_id: 'bad id!' });
    expect(res.status).toBe(400);
  });

  it('retries network failures with the identical request, but not server errors', async () => {
    const init = { method: 'POST', body: '{"scan_id":"x"}' };
    const seen: unknown[] = [];
    let calls = 0;
    const flaky = async (_url: string, i: unknown) => {
      seen.push(i);
      if (++calls < 3) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200 });
    };
    const res = await fetchWithScanRetry('/scan', init, [0, 0], flaky);
    expect(res.status).toBe(200);
    expect(seen).toEqual([init, init, init]);

    let serverCalls = 0;
    const serverError = async () => {
      serverCalls++;
      return new Response('{}', { status: 500 });
    };
    expect((await fetchWithScanRetry('/scan', init, [0, 0], serverError)).status).toBe(500);
    expect(serverCalls).toBe(1);

    const down = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(fetchWithScanRetry('/scan', init, [0, 0], down)).rejects.toThrow('Failed to fetch');
  });
});

describe('health check', () => {
  it('answers without authentication when the database is reachable', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
