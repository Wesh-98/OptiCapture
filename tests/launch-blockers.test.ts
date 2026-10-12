/**
 * Regressions for the launch blockers found by the 2026-10-12 health check:
 * import files turned away by their reported type, a lookup outage remembered for a week,
 * scan sessions vanishing at expiry, and a wrong-OTP lock that never cleared.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { upcCache, upcCacheFresh, UPC_CACHE_FAILED_TTL } from '../src/server/cache.js';
import { db } from '../src/server/db.js';
import { lookupProduct } from '../src/server/helpers.js';
import { importFileFormat } from '../src/server/routes/inventory.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

const request = createTestApp();
let owner: string;

beforeAll(async () => {
  owner = await login(request, 'admin', 'admin123', getStoreCode(1));
});

async function createSession() {
  const res = await request.post('/api/session/create').set('Cookie', owner);
  expect(res.status).toBe(200);
  return res.body as { sessionId: string; otp: string };
}

/** Stage one named item so the session is no longer empty (empty ones are reused). */
async function scanInto(session: { sessionId: string; otp: string }, upc: string) {
  const res = await request
    .post(`/api/session/${session.sessionId}/scan`)
    .send({ upc, otp: session.otp, item_name: `Item ${upc}` });
  expect(res.status).toBe(200);
}

const expire = (sessionId: string) =>
  db
    .prepare("UPDATE scan_sessions SET expires_at = datetime('now', '-1 minute') WHERE session_id = ?")
    .run(sessionId);

describe('import file type', () => {
  const CSV = 'item_name,upc\nWindows Csv Item,win-csv-1\n';

  it.each([
    ['application/vnd.ms-excel', 'what Windows with Excel reports for a .csv'],
    ['application/octet-stream', 'an unknown type'],
    ['text/plain', 'a plain-text type'],
  ])('accepts a .csv sent as %s (%s)', async contentType => {
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', owner)
      .attach('file', Buffer.from(CSV), { filename: 'pos-export.CSV', contentType });
    expect(res.status).toBe(200);
    expect(res.body.sheets[0].rows).toEqual([{ item_name: 'Windows Csv Item', upc: 'win-csv-1' }]);
  });

  it('goes by the file name first and the reported type only without one', () => {
    expect(importFileFormat('stock.xlsx', 'application/octet-stream')).toBe('xlsx');
    expect(importFileFormat('stock.json', '')).toBe('json');
    expect(importFileFormat('upload', 'text/csv')).toBe('csv');
    expect(importFileFormat(undefined, 'application/json')).toBe('json');
    // An extension we do not read is refused even when the type claims otherwise.
    expect(importFileFormat('stock.xls', 'application/vnd.ms-excel')).toBeNull();
    expect(importFileFormat('notes.txt', 'text/csv')).toBeNull();
    expect(importFileFormat('upload', 'application/pdf')).toBeNull();
  });

  it('still refuses a file that is neither named nor typed as an import', async () => {
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', owner)
      .attach('file', Buffer.from('MZ'), { filename: 'tool.exe', contentType: 'text/csv' });
    expect(res.status).toBe(400);
  });
});

describe('product lookup during a provider outage', () => {
  const UPC = '5000112637922';
  let mode: 'down' | 'rate-limited' | 'not-found' | 'product';

  beforeEach(() => {
    upcCache.clear();
    mode = 'down';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (mode === 'down') throw new Error('network down');
        if (mode === 'rate-limited') return new Response('{}', { status: 429 });
        if (mode === 'product' && url.includes('openfoodfacts')) {
          return Response.json({ product: { product_name: 'Recovered Cola', brands: 'Probe' } });
        }
        return new Response('{}', { status: 404 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    upcCache.clear();
  });

  it('tells "could not answer" apart from "no such product"', async () => {
    expect(await lookupProduct(UPC)).toEqual({ product: null, conclusive: false });
    mode = 'rate-limited';
    expect(await lookupProduct(UPC)).toEqual({ product: null, conclusive: false });
    mode = 'not-found';
    expect(await lookupProduct(UPC)).toEqual({ product: null, conclusive: true });
    mode = 'product';
    const found = await lookupProduct(UPC);
    expect(found.conclusive).toBe(true);
    expect(found.product?.product_name).toBe('Recovered Cola');
  });

  it('keeps an outage result only briefly, then resolves the barcode on a later scan', async () => {
    const first = await createSession();
    const scan = await request
      .post(`/api/session/${first.sessionId}/scan`)
      .send({ upc: UPC, otp: first.otp });
    expect(scan.status).toBe(200);

    await vi.waitFor(() => expect(upcCache.get(UPC)).toBeDefined());
    const cached = upcCache.get(UPC)!;
    expect(cached.product_name).toBeNull();
    expect(cached.ttl).toBe(UPC_CACHE_FAILED_TTL);
    // Good for the hold-off, not for the seven days a real answer is kept.
    expect(upcCacheFresh(cached, cached.ts + UPC_CACHE_FAILED_TTL - 1)).toBe(true);
    expect(upcCacheFresh(cached, cached.ts + UPC_CACHE_FAILED_TTL + 1)).toBe(false);

    // The provider is back and the hold-off has passed.
    mode = 'product';
    upcCache.set(UPC, { ...cached, ts: cached.ts - UPC_CACHE_FAILED_TTL - 1 });
    await scanInto(first, '90000001'); // so the next create is a new session
    const second = await createSession();
    const rescan = await request
      .post(`/api/session/${second.sessionId}/scan`)
      .send({ upc: UPC, otp: second.otp });
    expect(rescan.status).toBe(200);

    await vi.waitFor(() => {
      const row = db
        .prepare('SELECT product_name, lookup_status FROM session_items WHERE session_id = ? AND upc = ?')
        .get(second.sessionId, UPC);
      expect(row).toEqual({ product_name: 'Recovered Cola', lookup_status: 'new_candidate' });
    });
    expect(upcCache.get(UPC)?.ttl).toBeUndefined();
  });

  it('remembers a real "not found" for the full period', async () => {
    mode = 'not-found';
    const session = await createSession();
    await request.post(`/api/session/${session.sessionId}/scan`).send({ upc: UPC, otp: session.otp });
    await vi.waitFor(() => expect(upcCache.get(UPC)).toBeDefined());
    expect(upcCache.get(UPC)?.ttl).toBeUndefined();
  });
});

describe('sessions past their expiry', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM session_items').run();
    db.prepare('DELETE FROM scan_sessions').run();
  });

  const listed = async () =>
    (await request.get('/api/sessions/active').set('Cookie', owner)).body as Array<{
      session_id: string;
      status: string;
      label: string | null;
    }>;

  it('keeps a saved draft on the dashboard after its expiry', async () => {
    const session = await createSession();
    await scanInto(session, '90000010');
    await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', owner)
      .send({ status: 'draft', label: 'Friday count' });
    expire(session.sessionId);

    expect(await listed()).toEqual([
      expect.objectContaining({ session_id: session.sessionId, status: 'draft', label: 'Friday count' }),
    ]);
  });

  it('turns an expired scanning session with scans in it into a draft that can be resumed', async () => {
    const session = await createSession();
    await scanInto(session, '90000011');
    expire(session.sessionId);

    expect(await listed()).toEqual([
      expect.objectContaining({ session_id: session.sessionId, status: 'draft' }),
    ]);
    // The old OTP stays retired until someone signed in resumes the session.
    const stale = await request
      .post(`/api/session/${session.sessionId}/scan`)
      .send({ upc: '90000012', otp: session.otp, item_name: 'Late' });
    expect(stale.status).toBe(403);

    const resume = await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', owner)
      .send({ status: 'active' });
    expect(resume.status).toBe(200);
    await scanInto(session, '90000012');
  });

  it('shows the same draft state when the session is opened directly', async () => {
    const session = await createSession();
    await scanInto(session, '90000013');
    expire(session.sessionId);

    const opened = await request.get(`/api/session/${session.sessionId}`).set('Cookie', owner);
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('draft');
    expect(opened.body.items).toHaveLength(1);
  });

  it('leaves an expired session with nothing in it off the list', async () => {
    const session = await createSession();
    expire(session.sessionId);
    expect(await listed()).toEqual([]);
  });

  it('lists every open session, not just the newest ten', async () => {
    for (let i = 0; i < 12; i++) {
      const session = await createSession();
      await scanInto(session, `9000002${String(i).padStart(2, '0')}`);
    }
    expect(await listed()).toHaveLength(12);
  });

  it('only parks sessions of the store asking', async () => {
    const session = await createSession();
    await scanInto(session, '90000014');
    expire(session.sessionId);
    db.prepare('UPDATE scan_sessions SET store_id = 0 WHERE session_id = ?').run(session.sessionId);

    await listed();
    const row = db
      .prepare('SELECT status FROM scan_sessions WHERE session_id = ?')
      .get(session.sessionId) as { status: string };
    expect(row.status).toBe('active');
  });
});

describe('wrong-OTP lock', () => {
  it('clears when a signed-in user resumes the session', async () => {
    const session = await createSession();
    await scanInto(session, '90000030');
    for (let i = 0; i < 5; i++) {
      await request.get(`/api/session/${session.sessionId}/items`).query({ otp: 'WRONGOTP' });
    }
    const locked = await request
      .get(`/api/session/${session.sessionId}/items`)
      .query({ otp: session.otp });
    expect(locked.status).toBe(429);

    await request
      .patch(`/api/session/${session.sessionId}/status`)
      .set('Cookie', owner)
      .send({ status: 'active' });

    const unlocked = await request
      .get(`/api/session/${session.sessionId}/items`)
      .query({ otp: session.otp });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.items).toHaveLength(1);
  });
});
