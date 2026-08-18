import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/server/db.js';
import { normalizeImageUrl, UPLOADS_DIR } from '../src/server/helpers.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

const request = createTestApp();
const createdUploadFiles: string[] = [];

let adminCookie: string;

beforeAll(async () => {
  const adminStoreCode = getStoreCode(1);
  adminCookie = await login(request, 'admin', 'admin123', adminStoreCode);
});

beforeEach(() => {
  db.prepare('DELETE FROM inventory').run();
  db.prepare('DELETE FROM logs').run();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const filePath of createdUploadFiles.splice(0)) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }
});

describe('normalizeImageUrl', () => {
  it('converts shared Drive file links to the local proxy path', () => {
    expect(normalizeImageUrl('https://drive.google.com/file/d/abc123_DEF/view?usp=sharing')).toBe(
      '/api/drive-image/abc123_DEF'
    );
  });

  it('converts Drive and Docs query-string URLs to the local proxy path', () => {
    expect(normalizeImageUrl('https://drive.google.com/thumbnail?id=thumb123&sz=w800')).toBe(
      '/api/drive-image/thumb123'
    );
    expect(normalizeImageUrl('https://docs.google.com/uc?export=view&id=docs456')).toBe(
      '/api/drive-image/docs456'
    );
    expect(normalizeImageUrl('https://drive.google.com/open?id=open789')).toBe(
      '/api/drive-image/open789'
    );
  });

  it('leaves non-Google URLs untouched', () => {
    const url = 'https://example.com/images/product.png';
    expect(normalizeImageUrl(url)).toBe(url);
  });
});

describe('inventory image persistence', () => {
  it('normalizes Drive image URLs when creating inventory items', async () => {
    const res = await request.post('/api/inventory').set('Cookie', adminCookie).send({
      item_name: 'Drive Create Test',
      quantity: 3,
      status: 'Active',
      image: 'https://drive.google.com/file/d/create123/view?usp=sharing',
    });

    expect(res.status).toBe(200);

    const row = db.prepare('SELECT image FROM inventory WHERE id = ?').get(res.body.id) as
      | { image: string }
      | undefined;

    expect(row?.image).toBe('/api/drive-image/create123');
  });

  it('normalizes Docs image URLs when updating inventory items', async () => {
    const createRes = await request.post('/api/inventory').set('Cookie', adminCookie).send({
      item_name: 'Drive Update Test',
      quantity: 1,
      status: 'Active',
      image: 'https://example.com/original.png',
    });

    expect(createRes.status).toBe(200);

    const updateRes = await request
      .put(`/api/inventory/${createRes.body.id}`)
      .set('Cookie', adminCookie)
      .send({
        item_name: 'Drive Update Test',
        quantity: 1,
        status: 'Active',
        image: 'https://docs.google.com/uc?export=view&id=update456',
      });

    expect(updateRes.status).toBe(200);

    const row = db.prepare('SELECT image FROM inventory WHERE id = ?').get(createRes.body.id) as
      | { image: string }
      | undefined;

    expect(row?.image).toBe('/api/drive-image/update456');
  });
});

describe('GET /api/drive-image/:fileId', () => {
  it('rejects invalid file ids before calling fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request.get('/api/drive-image/bad$id');

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the first valid image response and avoids the fallback request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request.get('/api/drive-image/file_123');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://drive.google.com/thumbnail?id=file_123&sz=w800',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'image/*',
          'User-Agent': 'OptiCapture/1.0',
        }),
      })
    );
  });

  it('falls back to the uc endpoint when the thumbnail response is not an image', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response('<html>not an image</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([4, 5, 6]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request.get('/api/drive-image/fallback456');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://drive.google.com/uc?export=view&id=fallback456',
      expect.any(Object)
    );
  });

  it('returns 404 when no candidate URL produces an image', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('missing', { status: 404 })).mockResolvedValueOnce(
      new Response('<html>still not an image</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request.get('/api/drive-image/missing789');

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request.get('/api/drive-image/error123');

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('GET /uploads/:filename', () => {
  it('serves uploaded files with attachment disposition', async () => {
    const filename = `${randomUUID()}.png`;
    const filePath = path.join(UPLOADS_DIR, filename);
    createdUploadFiles.push(filePath);
    fs.writeFileSync(filePath, Uint8Array.from([137, 80, 78, 71]));

    const res = await request.get(`/uploads/${filename}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
  });
});
