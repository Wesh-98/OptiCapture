/**
 * tests/audit-fixes-2026-10-05.test.ts — regressions for the 2026-10-05 audit fixes
 *
 * Covers, in order:
 *   - repeated query parameters no longer reach better-sqlite3's binder as arrays
 *   - unknown /api paths answer JSON 404 instead of falling through to the SPA shell
 *   - /api/server-info survives that 404 handler (it is registered ahead of it)
 *   - POST /inventory treats category_id '' as "no category" rather than a FK violation
 *   - POST /session/:id/commit rejects malformed payload shapes with 400, not 500
 *   - a scan merged into a leading-zero variant row still receives its background lookup
 *   - the category confirmation copy states what the bulk action is about to change
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestApp, getStoreCode, login } from './helpers.js';
import { db } from '../src/server/db.js';
import { upcCache } from '../src/server/cache.js';
import { describeCategoryAction } from '../src/components/dashboard/categoryActions.js';

const request = createTestApp();

async function ownerCookie(): Promise<string> {
  return login(request, 'admin', 'admin123', getStoreCode(1));
}

describe('repeated query parameters', () => {
  it('answers GET /inventory instead of 500 when category_id is repeated', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .get('/api/inventory?category_id=1&category_id=2')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('answers GET /inventory instead of 500 when q, page and limit are repeated', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .get('/api/inventory?q=a&q=b&page=1&page=9&limit=5&limit=7')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
  });

  it('rejects a repeated OTP on the unauthenticated phone route without a 500', async () => {
    const res = await request.get('/api/session/does-not-exist/items?otp=a&otp=b');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Invalid session or OTP');
  });

  it('answers GET /logs instead of 500 when filters are repeated', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .get('/api/logs?q=a&q=b&action=LOGIN&action=CREATE&page=1&page=2')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});

describe('unmatched API routes', () => {
  it('answers JSON 404 for an unknown /api path', async () => {
    const res = await request.get('/api/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown API endpoint');
  });

  it('answers JSON 404 for an unknown method on a known prefix', async () => {
    const res = await request.delete('/api/dashboard/stats');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown API endpoint');
  });

  it('still serves /api/server-info, which is registered ahead of the 404 handler', async () => {
    const res = await request.get('/api/server-info');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mobileUrl');
    expect(res.body).toHaveProperty('protocol');
  });
});

describe('POST /inventory category_id normalisation', () => {
  it('stores an empty category_id as NULL instead of failing the foreign key', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Audit Fix No Category', category_id: '' });

    expect(res.status).toBe(200);

    const row = db
      .prepare('SELECT category_id FROM inventory WHERE id = ?')
      .get(res.body.id) as { category_id: number | null };
    expect(row.category_id).toBeNull();
  });

  it('still honours a real category_id', async () => {
    const cookie = await ownerCookie();
    const categories = await request.get('/api/categories').set('Cookie', cookie);
    const categoryId = (categories.body as Array<{ id: number }>)[0].id;

    const res = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Audit Fix With Category', category_id: categoryId });

    expect(res.status).toBe(200);
    const row = db
      .prepare('SELECT category_id FROM inventory WHERE id = ?')
      .get(res.body.id) as { category_id: number | null };
    expect(row.category_id).toBe(categoryId);
  });
});

describe('POST /session/:id/commit payload validation', () => {
  it('rejects a non-array assignments with 400', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .post('/api/session/any-session/commit')
      .set('Cookie', cookie)
      .send({ assignments: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must be arrays');
  });

  it('rejects a non-array verifyIds with 400', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .post('/api/session/any-session/commit')
      .set('Cookie', cookie)
      .send({ verifyIds: 'nope' });

    expect(res.status).toBe(400);
  });

  it('rejects assignment entries that are not objects with 400', async () => {
    const cookie = await ownerCookie();
    const res = await request
      .post('/api/session/any-session/commit')
      .set('Cookie', cookie)
      .send({ assignments: [1, 2] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must be an object');
  });
});

describe('background lookup on a merged leading-zero variant row', () => {
  // '012345678905' (UPC-A) and '0012345678905' (the same code as EAN-13) are the same
  // product, and the scan route merges them into one staged row keyed by whichever
  // variant arrived first.
  const EAN13 = '0012345678905';
  const UPCA = '012345678905';

  let lookupPayload: unknown = null;

  beforeEach(() => {
    upcCache.clear();
    lookupPayload = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (lookupPayload && url.includes('openfoodfacts')) {
          return new Response(JSON.stringify(lookupPayload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    upcCache.clear();
  });

  it('fills in the product name for the second variant scanned', async () => {
    const cookie = await ownerCookie();
    const created = await request.post('/api/session/create').set('Cookie', cookie);
    expect(created.status).toBe(200);
    const { sessionId, otp } = created.body as { sessionId: string; otp: string };

    // First scan resolves to nothing, so the row is staged without a name.
    const first = await request
      .post(`/api/session/${sessionId}/scan`)
      .send({ upc: EAN13, otp });
    expect(first.status).toBe(200);
    const stagedId = first.body.item.id as number;
    expect(first.body.item.upc).toBe(EAN13);

    // A server restart would clear the UPC cache, so the next scan looks up again.
    upcCache.clear();
    lookupPayload = { product: { product_name: 'Merged Variant Cola', brands: 'Probe Co' } };

    // The other variant merges into the row above, which still holds the EAN-13 UPC.
    const second = await request
      .post(`/api/session/${sessionId}/scan`)
      .send({ upc: UPCA, otp });
    expect(second.status).toBe(200);
    expect(second.body.item.id).toBe(stagedId);
    expect(second.body.item.quantity).toBe(2);

    // The background lookup must target the staged row by id; keyed on the scanned UPC
    // it matched nothing and the name never arrived.
    await vi.waitFor(
      () => {
        const row = db
          .prepare('SELECT product_name, lookup_status FROM session_items WHERE id = ?')
          .get(stagedId) as { product_name: string | null; lookup_status: string };
        expect(row.product_name).toBe('Merged Variant Cola');
        expect(row.lookup_status).toBe('new_candidate');
      },
      { timeout: 5000, interval: 50 }
    );
  });
});

describe('category action confirmation copy', () => {
  const cat = { name: 'Snacks', item_count: 42 };

  it('says how many items a bulk status change overwrites', () => {
    const copy = describeCategoryAction('deactivate', cat);

    expect(copy.detail).toContain('42 items');
    expect(copy.detail).toContain('Snacks');
    expect(copy.detail).toContain("overwrites each item's own status");
  });

  it('says that deleting a category deletes its items too', () => {
    const copy = describeCategoryAction('deleteCategory', cat);

    expect(copy.detail).toContain('42 items');
    expect(copy.detail).toContain('permanently deleted');
  });

  it('says that deleting all items keeps the category', () => {
    const copy = describeCategoryAction('deleteItems', cat);

    expect(copy.detail).toContain('The category itself stays');
  });

  it('uses the singular for a category holding one item', () => {
    expect(describeCategoryAction('activate', { name: 'Water', item_count: 1 }).detail).toContain(
      '1 item in'
    );
  });
});
