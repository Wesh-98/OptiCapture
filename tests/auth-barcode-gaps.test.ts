/**
 * tests/auth-barcode-gaps.test.ts — login, registration and barcode branches nothing ran
 *
 * The coverage report showed these paths had never executed:
 *   - logging in with a username that does not exist, or a body that is not an object
 *   - two accounts sharing a username in one store (the password decides which one, and two
 *     matching passwords are refused rather than guessed)
 *   - registration's own input limits
 *   - switching to a suspended store, and store settings with no store selected
 *   - UPC-E barcodes for each compression rule, JPEG/GIF/WEBP photo checks, and the
 *     product-lookup choice between providers
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/server/db.js';
import {
  isTokenRevoked,
  pendingOAuth,
  pendingOAuthSet,
  revokedTokens,
} from '../src/server/cache.js';
import {
  UnsupportedImageTypeError,
  isValidGtin,
  lookupProduct,
  normalizeImageUrl,
  saveBase64Image,
} from '../src/server/helpers.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

const request = createTestApp();

// ── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login — remaining branches', () => {
  it('refuses an unknown username with the same answer as a wrong password', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'nobody-here', password: 'Password1', store_code: getStoreCode(1) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('refuses a body that is not an object, and a store code that is not text', async () => {
    const list = await request.post('/api/auth/login').send([{ username: 'admin' }]);
    expect(list.status).toBe(400);
    // The app-wide body guard answers before the route's own check.
    expect(list.body.error).toBe('JSON request body must be an object');

    const numericCode = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123', store_code: 123456 });
    expect(numericCode.status).toBe(400);
  });

  describe('two accounts with one username in a store', () => {
    let storeCode: string;

    beforeAll(async () => {
      const a = await request
        .post('/api/auth/register')
        .send({ store_name: 'Shared Name A', username: 'twin', password: 'Password1' });
      const b = await request
        .post('/api/auth/register')
        .send({ store_name: 'Shared Name B', username: 'twin', password: 'Password2' });
      const c = await request
        .post('/api/auth/register')
        .send({ store_name: 'Shared Name C', username: 'twin', password: 'Password1' });
      storeCode = a.body.store_code;
      const userOf = (storeId: number) =>
        (
          db
            .prepare("SELECT id FROM users WHERE store_id = ? AND username = 'twin'")
            .get(storeId) as {
            id: number;
          }
        ).id;
      const grant = db.prepare(
        "INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, 'taker')"
      );
      grant.run(userOf(b.body.store_id), a.body.store_id);
      grant.run(userOf(c.body.store_id), a.body.store_id);
    });

    it('signs in the one whose password matches', async () => {
      const res = await request
        .post('/api/auth/login')
        .send({ username: 'twin', password: 'Password2', store_code: storeCode });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('taker');
    });

    it('refuses to guess when two of them share the password too', async () => {
      const res = await request
        .post('/api/auth/login')
        .send({ username: 'twin', password: 'Password1', store_code: storeCode });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Multiple accounts match/);
    });
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('POST /api/auth/register — input limits', () => {
  const register = (body: Record<string, unknown>) =>
    request
      .post('/api/auth/register')
      .send({ store_name: 'Limits Store', username: 'limits', password: 'Password1', ...body });

  it.each([
    [{ store_name: '' }, 'Store name and username are required'],
    [{ username: '   ' }, 'Store name and username are required'],
    [{ store_name: 'S'.repeat(101) }, 'Store name must be 100 characters or fewer'],
    [{ username: 'u'.repeat(51) }, 'Username must be 50 characters or fewer'],
    [{ password: undefined }, 'Password is required'],
    [{ password: 'weakpass' }, /at least 8 characters/],
  ])('refuses %o', async (body, error) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(error);
  });

  it('refuses a body that is not an object, and fields that are not text', async () => {
    const list = await request.post('/api/auth/register').send(['x']);
    expect(list.status).toBe(400);

    const numeric = await register({ city: 12 });
    expect(numeric.status).toBe(400);
  });

  it('refuses an expired Google signup key', async () => {
    pendingOAuthSet('stale-key', {
      googleId: 'g-1',
      email: 'g@shop.com',
      name: 'G',
      expiresAt: Date.now() - 1000,
    });
    const res = await register({
      username: 'googler',
      password: undefined,
      oauth_key: 'stale-key',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Google session expired. Please sign in with Google again.');
    // The stale key is discarded, not left to be tried again.
    expect(pendingOAuth.has('stale-key')).toBe(false);
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'googler'").get()).toBeUndefined();
  });
});

// ── Store switching and settings ─────────────────────────────────────────────

describe('store switching and settings without a usable store', () => {
  it('will not switch into a suspended store, or a store id that is not a number', async () => {
    const reg = await request
      .post('/api/auth/register')
      .send({ store_name: 'Switch Home', username: 'switcher', password: 'Password1' });
    const other = await request
      .post('/api/auth/register')
      .send({ store_name: 'Switch Away', username: 'awayowner', password: 'Password1' });
    const userId = (
      db.prepare("SELECT id FROM users WHERE username = 'switcher'").get() as { id: number }
    ).id;
    db.prepare("INSERT INTO user_stores (user_id, store_id, role) VALUES (?, ?, 'taker')").run(
      userId,
      other.body.store_id
    );
    db.prepare("UPDATE stores SET status = 'suspended' WHERE id = ?").run(other.body.store_id);
    const cookie = await login(request, 'switcher', 'Password1', reg.body.store_code);

    const suspended = await request
      .post('/api/auth/switch-store')
      .set('Cookie', cookie)
      .send({ store_id: other.body.store_id });
    expect(suspended.status).toBe(403);
    expect(suspended.body.error).toBe('Store is suspended');

    const garbage = await request
      .post('/api/auth/switch-store')
      .set('Cookie', cookie)
      .send({ store_id: 'abc' });
    expect(garbage.status).toBe(400);
  });

  it('asks the superadmin to pick a store before showing or saving store settings', async () => {
    const cookie = await login(request, 'superadmin', 'superadmin123');

    const read = await request.get('/api/auth/store/settings').set('Cookie', cookie);
    expect(read.status).toBe(409);
    expect(read.body.needs_store_selection).toBe(true);

    const write = await request
      .put('/api/auth/store/settings')
      .set('Cookie', cookie)
      .send({ name: 'Nope' });
    expect([403, 409]).toContain(write.status);
  });

  it('refuses store settings that are not text', async () => {
    const cookie = await login(request, 'admin', 'admin123', getStoreCode(1));
    const res = await request
      .put('/api/auth/store/settings')
      .set('Cookie', cookie)
      .send({ name: 'Shop', phone: 5551234567 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Store fields must be strings');

    const list = await request.put('/api/auth/store/settings').set('Cookie', cookie).send(['x']);
    expect(list.status).toBe(400);
  });

  it('hides the store code from a taker', async () => {
    const cookie = await login(request, 'taker', 'taker123', getStoreCode(1));
    const res = await request.get('/api/auth/store/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.store_code).toBeNull();
  });
});

// ── Barcodes ─────────────────────────────────────────────────────────────────

describe('isValidGtin — UPC-E', () => {
  // Each 8-digit code below is only valid once expanded to UPC-A under its own rule; its
  // check digit does not work as a plain EAN-8. So a broken expansion rule fails the test.
  it.each([
    ['01234505', 'last digit 0-2: manufacturer digits then 0000'],
    ['01234531', 'last digit 3: 00000 after three digits'],
    ['01234543', 'last digit 4: 00000 after four digits'],
  ])('accepts %s (%s)', code => {
    expect(isValidGtin(code)).toBe(true);
  });

  it('accepts the last rule, and rejects a wrong check digit', () => {
    expect(isValidGtin('01234565')).toBe(true);
    expect(isValidGtin('01234500')).toBe(false);
  });

  it('has no check digit to verify for other codes', () => {
    expect(isValidGtin('ABC-123')).toBeNull();
    expect(isValidGtin('12345')).toBeNull();
    expect(isValidGtin(' 036000291452 ')).toBe(true);
  });
});

describe('saveBase64Image — content must match the declared type', () => {
  const dataUrl = (mime: string, bytes: number[]) =>
    `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const pad = (bytes: number[]) => [...bytes, ...new Array(16).fill(0)];

  it('stores real JPEG, GIF and WEBP photos', () => {
    const jpeg = saveBase64Image(dataUrl('image/jpeg', pad([0xff, 0xd8, 0xff, 0xe0])));
    const gif = saveBase64Image(dataUrl('image/gif', pad([0x47, 0x49, 0x46, 0x38])));
    const webp = saveBase64Image(
      dataUrl('image/webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0])
    );
    expect(jpeg).toMatch(/^\/uploads\/.+\.jpg$/);
    expect(gif).toMatch(/^\/uploads\/.+\.gif$/);
    expect(webp).toMatch(/^\/uploads\/.+\.webp$/);
  });

  it.each([
    ['a PNG labelled JPEG', 'image/jpeg', pad([0x89, 0x50, 0x4e, 0x47])],
    ['a JPEG labelled GIF', 'image/gif', pad([0xff, 0xd8, 0xff, 0xe0])],
    [
      'a RIFF file that is not WEBP',
      'image/webp',
      pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49]),
    ],
    ['a file under four bytes', 'image/png', [0x89, 0x50]],
  ])('refuses %s', (_label, mime, bytes) => {
    expect(() => saveBase64Image(dataUrl(mime, bytes))).toThrow(UnsupportedImageTypeError);
  });
});

describe('normalizeImageUrl — Google Drive links', () => {
  it('turns every Drive link shape into the image proxy path', () => {
    expect(normalizeImageUrl('https://drive.google.com/thumbnail?id=AbC_1-2')).toBe(
      '/api/drive-image/AbC_1-2'
    );
    expect(normalizeImageUrl('https://drive.google.com/uc?export=view&id=XyZ9')).toBe(
      '/api/drive-image/XyZ9'
    );
    expect(normalizeImageUrl('https://drive.google.com/open?id=Q1')).toBe('/api/drive-image/Q1');
  });
});

// ── Product lookup ───────────────────────────────────────────────────────────

describe('lookupProduct — choosing between providers', () => {
  type Answer = { status: number; body?: unknown } | 'throw';
  function providers(answers: { goUpc?: Answer; off?: Answer; upcItemDb?: Answer }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        const answer = url.includes('go-upc.com')
          ? answers.goUpc
          : url.includes('openfoodfacts')
            ? answers.off
            : answers.upcItemDb;
        if (answer === 'throw') throw new TypeError('network down');
        const a = answer ?? { status: 404 };
        return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
      })
    );
  }
  const off = (product: Record<string, unknown>) => ({ status: 200, body: { product } });
  const itemDb = (item: Record<string, unknown>) => ({ status: 200, body: { items: [item] } });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('prefers the paid provider when it is configured and knows the product', async () => {
    vi.stubEnv('GO_UPC_API_KEY', 'key');
    providers({
      goUpc: {
        status: 200,
        body: { product: { name: ' Cola ', brand: ' Fizz ', imageUrl: 'https://i/g.png' } },
      },
      off: off({ product_name: 'Other Cola' }),
    });
    const result = await lookupProduct('036000291452');
    expect(result).toEqual({
      product: { product_name: 'Cola', brand: 'Fizz', image: 'https://i/g.png', source: 'go_upc' },
      conclusive: true,
    });
  });

  it('treats a paid-provider answer with no name as not found', async () => {
    vi.stubEnv('GO_UPC_API_KEY', 'key');
    providers({
      goUpc: { status: 200, body: { product: { name: '  ' } } },
      off: off({ product_name: 'Cola' }),
    });
    const result = await lookupProduct('036000291452');
    expect(result.product?.source).toBe('open_food_facts');
  });

  it('prefers the result with a photo when both free providers answer', async () => {
    providers({
      off: off({ product_name: 'Cola', image_url: 'https://i/off.png' }),
      upcItemDb: itemDb({ title: 'Cola Can' }),
    });
    expect((await lookupProduct('036000291452')).product?.source).toBe('open_food_facts');

    providers({
      off: off({ product_name: 'Cola', image_url: 'https://i/off.png' }),
      upcItemDb: itemDb({ title: 'Cola Can', images: ['https://i/db.png'] }),
    });
    expect((await lookupProduct('036000291452')).product?.source).toBe('upcitemdb');

    providers({ off: off({ product_name: 'Cola' }), upcItemDb: itemDb({ title: 'Cola Can' }) });
    expect((await lookupProduct('036000291452')).product?.product_name).toBe('Cola Can');
  });

  it('falls back to the English name and the first brand from Open Food Facts', async () => {
    providers({
      off: off({ product_name: '', product_name_en: 'Lemonade', brands: 'Sunny, Other' }),
    });
    const result = await lookupProduct('036000291452');
    expect(result.product).toMatchObject({ product_name: 'Lemonade', brand: 'Sunny' });
  });

  it('calls a miss conclusive only when every provider actually answered', async () => {
    providers({ off: { status: 404 }, upcItemDb: { status: 400 } });
    expect(await lookupProduct('036000291452')).toEqual({ product: null, conclusive: true });

    providers({ off: { status: 404 }, upcItemDb: { status: 429 } });
    expect(await lookupProduct('036000291452')).toEqual({ product: null, conclusive: false });

    providers({ off: 'throw', upcItemDb: { status: 404 } });
    expect((await lookupProduct('036000291452')).conclusive).toBe(false);
  });

  it('asks nothing for a blank code', async () => {
    providers({});
    expect(await lookupProduct('   ')).toEqual({ product: null, conclusive: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ── Caches ───────────────────────────────────────────────────────────────────

describe('in-memory caches', () => {
  it('drops the oldest pending Google signup once 500 are waiting', () => {
    pendingOAuth.clear();
    const entry = { googleId: 'g', email: '', name: '', expiresAt: Date.now() + 60_000 };
    for (let i = 0; i < 500; i++) pendingOAuthSet(`k${i}`, entry);
    pendingOAuthSet('newest', entry);
    expect(pendingOAuth.size).toBe(500);
    expect(pendingOAuth.has('k0')).toBe(false);
    expect(pendingOAuth.has('newest')).toBe(true);
    pendingOAuth.clear();
  });

  it('forgets a revoked token once it would have expired anyway', () => {
    revokedTokens.set('old-token', Date.now() - 1);
    expect(isTokenRevoked('old-token')).toBe(false);
    expect(revokedTokens.has('old-token')).toBe(false);
  });
});
