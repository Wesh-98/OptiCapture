/**
 * Regressions for the cleanup findings of the 2026-10-12 health check: uploaded images left
 * on disk after the row that named them went away, scan sessions never swept, dashboard
 * figures that did not add up, and a log date filter that followed UTC days.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDayRangeUtc } from '../src/components/logs/logsApi.js';
import { db, pruneScanSessions } from '../src/server/db.js';
import { UPLOADS_DIR } from '../src/server/helpers.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

const request = createTestApp();
let owner: string;

// A 1x1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  owner = await login(request, 'admin', 'admin123', getStoreCode(1));
});

const onDisk = (stored: string | null | undefined) =>
  Boolean(stored) && fs.existsSync(path.join(UPLOADS_DIR, path.basename(stored!)));
const gone = (stored: string) => vi.waitFor(() => expect(onDisk(stored)).toBe(false));
const imageOf = (id: number) =>
  (db.prepare('SELECT image FROM inventory WHERE id = ?').get(id) as { image: string }).image;

let serial = 0;
async function addItemWithImage(extra: Record<string, unknown> = {}) {
  serial += 1;
  const res = await request
    .post('/api/inventory')
    .set('Cookie', owner)
    .send({ item_name: `Pictured ${serial}`, upc: `pic-${serial}`, image: PNG, ...extra });
  expect(res.status).toBe(200);
  const image = imageOf(res.body.id);
  expect(onDisk(image)).toBe(true);
  return { id: res.body.id as number, image };
}

describe('the test run', () => {
  it('writes uploads to a throwaway folder, not the project’s', () => {
    expect(UPLOADS_DIR.startsWith(os.tmpdir())).toBe(true);
  });
});

describe('an upload is removed with the last row that names it', () => {
  it('when its item is deleted', async () => {
    const item = await addItemWithImage();
    await request.delete(`/api/inventory/${item.id}`).set('Cookie', owner);
    await gone(item.image);
  });

  it('when its item’s image is replaced or cleared', async () => {
    const item = await addItemWithImage();
    await request.put(`/api/inventory/${item.id}`).set('Cookie', owner).send({ image: PNG });
    const replacement = imageOf(item.id);
    expect(replacement).not.toBe(item.image);
    await gone(item.image);
    expect(onDisk(replacement)).toBe(true);

    await request.put(`/api/inventory/${item.id}`).set('Cookie', owner).send({ image: '' });
    await gone(replacement);
  });

  it('but not while another row still points at it', async () => {
    const first = await addItemWithImage();
    const second = await request
      .post('/api/inventory')
      .set('Cookie', owner)
      .send({ item_name: 'Shares a picture', upc: 'pic-shared', image: first.image });
    expect(second.status).toBe(200);

    await request.delete(`/api/inventory/${first.id}`).set('Cookie', owner);
    // Give the background cleanup the chance to (wrongly) remove it.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(onDisk(first.image)).toBe(true);

    await request.delete(`/api/inventory/${second.body.id}`).set('Cookie', owner);
    await gone(first.image);
  });

  it('and not when an edit leaves the image alone', async () => {
    const item = await addItemWithImage();
    await request.put(`/api/inventory/${item.id}`).set('Cookie', owner).send({ sale_price: 2 });
    await request.put(`/api/inventory/${item.id}`).set('Cookie', owner).send({ image: item.image });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(onDisk(item.image)).toBe(true);
  });

  it('when its category, or the category’s items, are deleted', async () => {
    const mk = async (name: string) =>
      (await request.post('/api/categories').set('Cookie', owner).send({ name })).body.id as number;
    const emptied = await mk('Emptied');
    const removed = await mk('Removed');
    const a = await addItemWithImage({ category_id: emptied });
    const b = await addItemWithImage({ category_id: removed });

    await request.delete(`/api/categories/${emptied}/items`).set('Cookie', owner);
    await request.delete(`/api/categories/${removed}`).set('Cookie', owner);
    await gone(a.image);
    await gone(b.image);
  });

  it('when a staged scan’s photo is replaced, the scan is removed, or its session is deleted', async () => {
    const { sessionId, otp } = (await request.post('/api/session/create').set('Cookie', owner)).body;
    const stage = async (upc: string) => {
      const scan = await request
        .post(`/api/session/${sessionId}/scan`)
        .send({ upc, otp, item_name: `Staged ${upc}` });
      const id = scan.body.item.id as number;
      const patched = await request
        .patch(`/api/session/${sessionId}/items/${id}`)
        .set('Cookie', owner)
        .send({ image: PNG });
      expect(onDisk(patched.body.item.image)).toBe(true);
      return { id, image: patched.body.item.image as string };
    };

    const replaced = await stage('stg-1');
    await request
      .patch(`/api/session/${sessionId}/items/${replaced.id}`)
      .set('Cookie', owner)
      .send({ image: PNG });
    await gone(replaced.image);

    const removed = await stage('stg-2');
    await request.delete(`/api/session/${sessionId}/items/${removed.id}`).set('Cookie', owner);
    await gone(removed.image);

    const left = await stage('stg-3');
    await request.delete(`/api/session/${sessionId}`).set('Cookie', owner);
    await gone(left.image);
  });

  it('when a store logo is replaced', async () => {
    const save = (logo: string) =>
      request.put('/api/auth/store/settings').set('Cookie', owner).send({ name: 'OptiMart Downtown', logo });
    const first = (await save(PNG)).body.logo as string;
    expect(onDisk(first)).toBe(true);
    const second = (await save(PNG)).body.logo as string;
    await gone(first);
    expect(onDisk(second)).toBe(true);
  });
});

describe('scan session sweep', () => {
  const insert = (id: string, status: string, expires: string, created = "datetime('now')") =>
    db
      .prepare(
        `INSERT INTO scan_sessions (session_id, otp, user_id, store_id, status, expires_at, created_at)
         VALUES (?, 'OTP12345', 1, 1, ?, datetime('now', ?), ${created})`
      )
      .run(id, status, expires);
  const exists = (id: string) =>
    Boolean(db.prepare('SELECT 1 FROM scan_sessions WHERE session_id = ?').get(id));

  beforeEach(() => {
    db.prepare('DELETE FROM session_items').run();
    db.prepare('DELETE FROM scan_sessions').run();
  });

  it('removes sessions never scanned into and old committed ones, and nothing holding scans', () => {
    insert('empty-old', 'active', '-2 days');
    insert('empty-recent', 'active', '-2 hours');
    insert('empty-live', 'active', '+8 hours');
    insert('draft-with-scans', 'draft', '-30 days');
    insert('committed-old', 'completed', '-100 days', "datetime('now', '-100 days')");
    insert('committed-recent', 'completed', '-10 days', "datetime('now', '-10 days')");
    db.prepare("INSERT INTO session_items (session_id, upc) VALUES ('draft-with-scans', 'kept-1')").run();

    pruneScanSessions();

    expect({
      emptyOld: exists('empty-old'),
      emptyRecent: exists('empty-recent'),
      emptyLive: exists('empty-live'),
      draftWithScans: exists('draft-with-scans'),
      committedOld: exists('committed-old'),
      committedRecent: exists('committed-recent'),
    }).toEqual({
      emptyOld: false,
      emptyRecent: true,
      emptyLive: true,
      draftWithScans: true,
      committedOld: false,
      committedRecent: true,
    });
  });
});

describe('dashboard figures', () => {
  it('add up when an item has no quantity recorded', async () => {
    await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', owner)
      .send({
        sheetsData: [
          { sheetName: 'Sheet1', rows: [{ n: 'No Quantity', u: 'noqty-1' }], mapping: { n: 'item_name', u: 'upc' } },
        ],
      });
    const stats = (await request.get('/api/dashboard/stats').set('Cookie', owner)).body;
    expect(stats.inStock + stats.outOfStock).toBe(stats.totalItems);
  });
});

describe('log date filter', () => {
  const insertLog = (details: string, timestamp: string) =>
    db
      .prepare("INSERT INTO logs (action, details, user_id, store_id, timestamp) VALUES ('READ', ?, 1, 1, ?)")
      .run(details, timestamp);

  it('filters by the instants the page sends, end exclusive', async () => {
    insertLog('tz-before', '2026-03-10 04:59:59');
    insertLog('tz-first', '2026-03-10 05:00:00');
    insertLog('tz-last', '2026-03-11 04:59:59');
    insertLog('tz-after', '2026-03-11 05:00:00');

    // One local day for a viewer five hours behind UTC.
    const res = await request
      .get('/api/logs')
      .set('Cookie', owner)
      .query({ q: 'tz-', from_utc: '2026-03-10T05:00:00.000Z', to_utc: '2026-03-11T05:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((row: { details: string }) => row.details).sort()).toEqual([
      'tz-first',
      'tz-last',
    ]);
  });

  it('rejects a malformed instant and still accepts plain dates', async () => {
    const bad = await request.get('/api/logs').set('Cookie', owner).query({ from_utc: '2026-03-10' });
    expect(bad.status).toBe(400);
    const plain = await request
      .get('/api/logs')
      .set('Cookie', owner)
      .query({ q: 'tz-', from: '2026-03-11', to: '2026-03-11' });
    expect(plain.body.items).toHaveLength(2);
  });

  it('turns picked dates into the viewer’s local day boundaries', () => {
    const range = localDayRangeUtc('2026-03-10', '2026-03-10');
    expect(new Date(range.from_utc!).getTime()).toBe(new Date(2026, 2, 10).getTime());
    expect(new Date(range.to_utc!).getTime()).toBe(new Date(2026, 2, 11).getTime());
    expect(localDayRangeUtc()).toEqual({});
    expect(localDayRangeUtc('not-a-date')).toEqual({ from_utc: undefined });
  });
});
