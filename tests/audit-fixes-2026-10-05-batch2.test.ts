/**
 * tests/audit-fixes-2026-10-05-batch2.test.ts — regressions for the second round of
 * 2026-10-05 audit fixes.
 *
 * Covers:
 *   - import dedupes leading-zero UPC variants, matching the scan commit path
 *   - import enforces a row ceiling and caps its per-row diagnostics
 *   - import never creates a category under a reserved name
 *   - import still writes every row correctly across more than one commit chunk
 *   - GET /logs answers one shape and filters by date, not by string ordering
 *   - deleting a store removes the images it owned
 *   - a poll that gets an HTTP answer is not reported as an offline server
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';
import { db } from '../src/server/db.js';
import { UPLOADS_DIR } from '../src/server/helpers.js';
import { getPollResponseOutcome } from '../src/hooks/useScanSession.js';

const request = createTestApp();

let ownerCookie: string;
let superadminCookie: string;
let categoryId: number;

beforeAll(async () => {
  ownerCookie = await login(request, 'admin', 'admin123', getStoreCode(1));
  superadminCookie = await login(request, 'superadmin', 'superadmin123');
  const categories = await request.get('/api/categories').set('Cookie', ownerCookie);
  categoryId = (categories.body as Array<{ id: number }>)[0].id;
});

function confirmBody(rows: Array<Record<string, unknown>>, mapping: Record<string, string>) {
  return { sheetsData: [{ sheetName: 'Sheet1', categoryName: null, rows, mapping }] };
}

describe('import UPC variant dedupe', () => {
  it('updates the existing item instead of creating a leading-zero duplicate', async () => {
    // Stands in for an item a scan already added under its EAN-13 spelling.
    const inserted = db
      .prepare(
        `INSERT INTO inventory (item_name, upc, quantity, category_id, store_id)
         VALUES ('Variant Dedupe Cola', '0012345678905', 4, ?, 1)`
      )
      .run(categoryId);
    const existingId = Number(inserted.lastInsertRowid);

    // The POS export spells the same barcode as UPC-A.
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: '012345678905', item_name: 'Variant Dedupe Cola', quantity: '9' }], {
          upc: 'upc',
          item_name: 'item_name',
          quantity: 'quantity',
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.added).toBe(0);

    const rows = db
      .prepare("SELECT id, quantity FROM inventory WHERE item_name = 'Variant Dedupe Cola'")
      .all() as Array<{ id: number; quantity: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existingId);
    expect(rows[0].quantity).toBe(9);
  });
});

describe('import ceilings', () => {
  it('rejects an import above the row ceiling with 413', async () => {
    const rows = Array.from({ length: 50_001 }, (_, i) => ({ upc: `cap-${i}` }));
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(confirmBody(rows, { upc: 'upc' }));

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/limited to/i);
  });

  it('caps the reported failures while keeping an exact total', async () => {
    // Each row carries an unparseable quantity, which fails that row and nothing else.
    const rows = Array.from({ length: 150 }, (_, i) => ({
      upc: `badqty-${i}`,
      item_name: `Bad Row ${i}`,
      quantity: 'not-a-number',
    }));
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody(rows, { upc: 'upc', item_name: 'item_name', quantity: 'quantity' })
      );

    expect(res.status).toBe(200);
    expect(res.body.errors_total).toBe(150);
    expect(res.body.errors).toHaveLength(100);
  });

  it('caps the reported skipped rows while keeping an exact skipped count', async () => {
    // No identifier column at all, so every row is skipped.
    const rows = Array.from({ length: 130 }, (_, i) => ({
      upc: '',
      item_name: `Skipped Row ${i}`,
    }));
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(confirmBody(rows, { upc: 'upc', item_name: 'item_name' }));

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(130);
    expect(res.body.skipped_rows).toHaveLength(100);
  });

  it('writes the whole import when it spans more than one commit chunk', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) => ({
      upc: `chunked-${i}`,
      item_name: `Chunked Item ${i}`,
      quantity: '2',
    }));
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody(rows, { upc: 'upc', item_name: 'item_name', quantity: 'quantity' })
      );

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1_200);
    expect(res.body.errors_total).toBe(0);

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE upc LIKE 'chunked-%' AND store_id = 1")
      .get() as { n: number };
    expect(count.n).toBe(1_200);
  });

  it('keeps the audit log entry to counts, not a serialised row dump', async () => {
    const entry = db
      .prepare(
        "SELECT details FROM logs WHERE action = 'IMPORT' AND store_id = 1 ORDER BY id DESC LIMIT 1"
      )
      .get() as { details: string };

    expect(entry.details).toMatch(/skipped/);
    expect(entry.details).not.toContain('row_num');
    expect(entry.details.length).toBeLessThan(300);
  });
});

describe('import reserved category names', () => {
  it('leaves the item uncategorised rather than creating a hidden category', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: 'reserved-cat-1', item_name: 'Reserved Cat Item', category: 'Inventory' }], {
          upc: 'upc',
          item_name: 'item_name',
          category: 'category',
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);

    const created = db
      .prepare("SELECT category_id FROM inventory WHERE upc = 'reserved-cat-1'")
      .get() as { category_id: number | null };
    expect(created.category_id).toBeNull();

    const reserved = db
      .prepare("SELECT COUNT(*) AS n FROM categories WHERE LOWER(TRIM(name)) = 'inventory'")
      .get() as { n: number };
    expect(reserved.n).toBe(0);
  });
});

describe('GET /logs', () => {
  it('answers the same envelope with and without ?page', async () => {
    const withoutPage = await request.get('/api/logs').set('Cookie', ownerCookie);
    const withPage = await request.get('/api/logs?page=1').set('Cookie', ownerCookie);

    for (const res of [withoutPage, withPage]) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.store_total).toBe('number');
    }
  });

  it('filters by date for both stored timestamp spellings', async () => {
    const insert = db.prepare(
      `INSERT INTO logs (action, details, user_id, store_id, timestamp) VALUES (?, ?, 1, 1, ?)`
    );
    // Space-separated is what the database writes today; the ISO 'T' form is what legacy
    // rows carried, and the old text comparison silently excluded them.
    insert.run('CREATE', 'Date filter space form', '2026-03-04 10:00:00');
    insert.run('CREATE', 'Date filter T form', '2026-03-04T11:00:00');
    insert.run('CREATE', 'Date filter next day', '2026-03-05 09:00:00');

    const res = await request
      .get('/api/logs')
      .set('Cookie', ownerCookie)
      .query({ from: '2026-03-04', to: '2026-03-04', q: 'Date filter' });

    expect(res.status).toBe(200);
    const details = (res.body.items as Array<{ details: string }>).map(entry => entry.details);
    expect(details).toContain('Date filter space form');
    expect(details).toContain('Date filter T form');
    expect(details).not.toContain('Date filter next day');
  });
});

describe('store deletion cleans up uploads', () => {
  it('removes images the deleted store owned', async () => {
    const store = await registerStore(request, {
      storeName: 'Upload Cleanup Store',
      username: 'uploadcleanupowner',
    });

    const filename = `audit-cleanup-${Date.now()}.png`;
    const diskPath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(diskPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(fs.existsSync(diskPath)).toBe(true);

    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Cleanup Item', 'cleanup-upc-1', 1, ?, ?)`
    ).run(`/uploads/${filename}`, store.storeId);

    const res = await request
      .delete(`/api/admin/stores/${store.storeId}`)
      .set('Cookie', superadminCookie);

    expect(res.status).toBe(200);
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it('leaves images belonging to other stores alone', async () => {
    const keep = await registerStore(request, {
      storeName: 'Upload Keeper Store',
      username: 'uploadkeeperowner',
    });
    const doomed = await registerStore(request, {
      storeName: 'Upload Doomed Store',
      username: 'uploaddoomedowner',
    });

    const keptName = `audit-keep-${Date.now()}.png`;
    const keptPath = path.join(UPLOADS_DIR, keptName);
    fs.writeFileSync(keptPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Kept Item', 'keep-upc-1', 1, ?, ?)`
    ).run(`/uploads/${keptName}`, keep.storeId);

    await request.delete(`/api/admin/stores/${doomed.storeId}`).set('Cookie', superadminCookie);

    expect(fs.existsSync(keptPath)).toBe(true);
    fs.unlinkSync(keptPath);
  });
});

describe('poll failure classification', () => {
  it('reports an expired session as expired, not as an offline server', () => {
    const outcome = getPollResponseOutcome(410);

    expect(outcome?.statusMessage).toMatch(/expired/i);
    expect(outcome?.pollError).not.toMatch(/offline/i);
    expect(outcome?.shouldStopPolling).toBe(true);
  });

  it('stops polling for a session that is gone or not ours', () => {
    for (const status of [403, 404]) {
      expect(getPollResponseOutcome(status)?.shouldStopPolling).toBe(true);
      expect(getPollResponseOutcome(status)?.pollError).not.toMatch(/offline/i);
    }
  });

  it('asks a signed-out user to log in again', () => {
    expect(getPollResponseOutcome(401)?.statusMessage).toMatch(/log in again/i);
  });

  it('keeps polling through a rate limit', () => {
    expect(getPollResponseOutcome(429)?.shouldStopPolling).toBe(false);
  });

  it('leaves an unrecognised status to the connectivity path', () => {
    expect(getPollResponseOutcome(500)).toBeNull();
  });
});
