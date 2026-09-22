import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPC_CACHE_MAX,
  isTokenRevoked,
  pendingOAuth,
  pendingOAuthSet,
  revokeToken,
  revokedTokens,
  upcCache,
  upcCacheSet,
} from '../src/server/cache.js';
import {
  UPLOADS_DIR,
  UnsupportedImageTypeError,
  fetchGoUpc,
  fetchOpenFoodFacts,
  fetchUpcItemDb,
  generateOTP,
  generateStoreCode,
  lookupProductByUpc,
  saveBase64Image,
  upcVariants,
} from '../src/server/helpers.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP+bkJszwAAAABJRU5ErkJggg==';

let createdUploadPath: string | null = null;

beforeEach(() => {
  upcCache.clear();
  pendingOAuth.clear();
  revokedTokens.clear();
  createdUploadPath = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();

  if (createdUploadPath && fs.existsSync(createdUploadPath)) {
    fs.unlinkSync(createdUploadPath);
  }
});

describe('helper utilities', () => {
  it('generates safe OTP and store codes using the expected alphabet', () => {
    const otp = generateOTP();
    const storeCode = generateStoreCode();

    expect(otp).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(storeCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('returns the expected UPC/EAN variants', () => {
    expect(upcVariants('0123456789012')).toEqual(['0123456789012', '123456789012']);
    expect(upcVariants('123456789012')).toEqual(['123456789012', '0123456789012']);
    expect(upcVariants('ABC-123')).toEqual(['ABC-123']);
  });

  it('saves supported base64 images, passes through URLs, and rejects unsafe formats', () => {
    const savedPath = saveBase64Image(TINY_PNG);
    createdUploadPath = path.join(UPLOADS_DIR, path.basename(savedPath));

    expect(savedPath).toMatch(/^\/uploads\/.+\.png$/);
    expect(fs.existsSync(createdUploadPath)).toBe(true);
    expect(saveBase64Image('https://example.com/image.png')).toBe('https://example.com/image.png');
    expect(() => saveBase64Image('data:image/tiff;base64,AAAA')).toThrow(UnsupportedImageTypeError);
  });

  it('parses OpenFoodFacts responses into the shared lookup shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          product: {
            product_name: 'Sparkling Water',
            brands: 'Fresh Co, Other',
            image_front_url: 'https://example.com/off.png',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOpenFoodFacts('0123456789012', new AbortController().signal);

    expect(result).toEqual({
      product_name: 'Sparkling Water',
      brand: 'Fresh Co',
      image: 'https://example.com/off.png',
      source: 'open_food_facts',
    });
  });

  it('parses UPCitemdb responses into the shared lookup shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: 'Iced Tea',
              brand: 'Brewed',
              images: ['https://example.com/upc.png'],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchUpcItemDb('123456789012', new AbortController().signal);

    expect(result).toEqual({
      product_name: 'Iced Tea',
      brand: 'Brewed',
      image: 'https://example.com/upc.png',
      source: 'upcitemdb',
    });
  });

  it('calls Go-UPC with its documented endpoint and bearer response shape', async () => {
    vi.stubEnv('GO_UPC_API_KEY', 'go-upc-secret');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          product: {
            name: 'Go UPC Product',
            brand: 'Lookup Brand',
            imageUrl: 'https://example.com/go-upc.png',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoUpc('123456789012', new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://go-upc.com/api/v1/code/123456789012',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer go-upc-secret' }),
      })
    );
    expect(result).toEqual({
      product_name: 'Go UPC Product',
      brand: 'Lookup Brand',
      image: 'https://example.com/go-upc.png',
      source: 'go_upc',
    });
  });

  it('prefers the richer UPCitemdb result when both lookup providers succeed', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input: string | URL) => {
      const url = String(input);

      if (url.includes('openfoodfacts')) {
        return new Response(
          JSON.stringify({
            product: {
              product_name: 'OFF Cola',
              brands: 'OFF Brand',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('upcitemdb')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                title: 'UPC Cola',
                brand: 'UPC Brand',
                images: ['https://example.com/cola.png'],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await lookupProductByUpc('123456789012');

    expect(result).toEqual({
      product_name: 'UPC Cola',
      brand: 'UPC Brand',
      image: 'https://example.com/cola.png',
      source: 'upcitemdb',
    });
  });
});

describe('cache helpers', () => {
  it('evicts the oldest UPC cache entry when the cache is full', () => {
    for (let i = 0; i < UPC_CACHE_MAX + 1; i++) {
      upcCacheSet(String(i), {
        product_name: `Item ${i}`,
        brand: null,
        image: null,
        source: 'manual',
        ts: i,
      });
    }

    expect(upcCache.size).toBe(UPC_CACHE_MAX);
    expect(upcCache.has('0')).toBe(false);
    expect(upcCache.has(String(UPC_CACHE_MAX))).toBe(true);
  });

  it('stores pending OAuth registrations by key', () => {
    pendingOAuthSet('oauth-key', {
      googleId: 'google-123',
      email: 'owner@example.com',
      name: 'Owner Name',
      expiresAt: Date.now() + 60_000,
    });

    expect(pendingOAuth.get('oauth-key')).toMatchObject({
      googleId: 'google-123',
      email: 'owner@example.com',
      name: 'Owner Name',
    });
  });

  it('marks live revoked tokens as invalid and lazily prunes expired ones', () => {
    const liveToken = jwt.sign({ sub: 'live-user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    revokeToken(liveToken);

    expect(isTokenRevoked(liveToken)).toBe(true);

    const expiredToken = jwt.sign({ sub: 'expired-user' }, process.env.JWT_SECRET!, {
      expiresIn: -1,
    });
    revokeToken(expiredToken);

    expect(isTokenRevoked(expiredToken)).toBe(false);
    expect(revokedTokens.has(expiredToken)).toBe(false);
  });
});
