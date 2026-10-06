/**
 * tests/audit-fixes-2026-10-05-batch2.test.ts — regressions for the second round of
 * 2026-10-05 audit fixes.
 *
 * Covers:
 *   - import dedupes leading-zero UPC variants, matching the scan commit path
 *   - import enforces a row ceiling and caps its per-row diagnostics
 *   - import never creates a category under a reserved name
 *   - import still writes every row correctly across more than one commit chunk
 *   - an import that stops partway reports and logs only the chunks it saved
 *   - GET /logs answers one shape and filters by date, not by string ordering
 *   - deleting a store removes the images it owned
 *   - a poll that gets an HTTP answer is not reported as an offline server
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';
import { db } from '../src/server/db.js';
import { UPLOADS_DIR, savedUploadPath } from '../src/server/helpers.js';
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
    const { lastId } = db.prepare('SELECT COALESCE(MAX(id), 0) AS lastId FROM logs').get() as {
      lastId: number;
    };
    // Rows with no identifier are skipped, and the skipped-row list is what used to be
    // serialised into the log row.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      upc: '',
      item_name: `Log Dump Item ${i}`,
    }));
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(confirmBody(rows, { upc: 'upc', item_name: 'item_name' }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(50);

    const entries = db
      .prepare("SELECT details FROM logs WHERE action = 'IMPORT' AND store_id = 1 AND id > ?")
      .all(lastId) as Array<{ details: string }>;
    expect(entries).toHaveLength(1);
    const [entry] = entries;

    expect(entry.details).toMatch(/50 skipped/);
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

    const res = await request
      .delete(`/api/admin/stores/${doomed.storeId}`)
      .set('Cookie', superadminCookie);

    // The cleanup ran: a failed delete would leave the file there too and prove nothing.
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT 1 FROM stores WHERE id = ?').get(doomed.storeId)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM stores WHERE id = ?').get(keep.storeId)).toBeDefined();
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

describe('upload ownership', () => {
  function writeUpload(label: string): { name: string; diskPath: string } {
    const name = `audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const diskPath = path.join(UPLOADS_DIR, name);
    fs.writeFileSync(diskPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { name, diskPath };
  }

  it('reports which upload a save created, and which it only passed through', () => {
    // saveBase64Image echoes anything that is not a data URI, so "the result is an
    // /uploads path" is not enough to prove this call wrote it.
    expect(savedUploadPath('data:image/png;base64,AAAA', '/uploads/new.png')).toBe(
      '/uploads/new.png'
    );
    expect(savedUploadPath('/uploads/existing.png', '/uploads/existing.png')).toBeNull();
    expect(savedUploadPath('https://example.com/a.png', 'https://example.com/a.png')).toBeNull();
  });

  it('keeps an image path the store already owns, so re-importing an export works', async () => {
    const upload = writeUpload('roundtrip');
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Round Trip Original', 'roundtrip-upc-1', 1, ?, 1)`
    ).run(`/uploads/${upload.name}`);

    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: 'roundtrip-upc-2', item_name: 'Round Trip Copy', image: `/uploads/${upload.name}` }], {
          upc: 'upc',
          item_name: 'item_name',
          image: 'image',
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.errors_total).toBe(0);
    const row = db
      .prepare("SELECT image FROM inventory WHERE upc = 'roundtrip-upc-2'")
      .get() as { image: string | null };
    expect(row.image).toBe(`/uploads/${upload.name}`);
    expect(fs.existsSync(upload.diskPath)).toBe(true);

    fs.unlinkSync(upload.diskPath);
  });

  it('refuses to attach an upload owned by another store to an imported item', async () => {
    const victimStore = await registerStore(request, {
      storeName: 'Upload Owner Store',
      username: 'uploadownerowner',
    });
    const upload = writeUpload('foreign');
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Foreign Owner Item', 'foreign-owner-upc', 1, ?, ?)`
    ).run(`/uploads/${upload.name}`, victimStore.storeId);

    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: 'foreign-img-upc', item_name: 'Foreign Image Item', image: `/uploads/${upload.name}` }], {
          upc: 'upc',
          item_name: 'item_name',
          image: 'image',
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.errors_total).toBe(1);
    expect(res.body.errors[0]).toMatch(/not an upload of this store/);

    const row = db
      .prepare("SELECT image FROM inventory WHERE upc = 'foreign-img-upc'")
      .get() as { image: string | null };
    expect(row.image).toBeNull();
    expect(fs.existsSync(upload.diskPath)).toBe(true);

    fs.unlinkSync(upload.diskPath);
  });

  it('does not unlink a file another store still references when a store is deleted', async () => {
    const victim = await registerStore(request, {
      storeName: 'Shared Upload Victim',
      username: 'sharedvictimowner',
    });
    const doomed = await registerStore(request, {
      storeName: 'Shared Upload Doomed',
      username: 'shareddoomedowner',
    });

    const upload = writeUpload('shared');
    const stored = `/uploads/${upload.name}`;
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Shared Victim Item', 'shared-victim-upc', 1, ?, ?)`
    ).run(stored, victim.storeId);
    // However it got there, the doomed store's row names a file it does not own.
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Shared Doomed Item', 'shared-doomed-upc', 1, ?, ?)`
    ).run(stored, doomed.storeId);

    const res = await request
      .delete(`/api/admin/stores/${doomed.storeId}`)
      .set('Cookie', superadminCookie);

    expect(res.status).toBe(200);
    // The surviving store still points at it, so the file must still be there.
    expect(fs.existsSync(upload.diskPath)).toBe(true);
    const survivor = db
      .prepare("SELECT image FROM inventory WHERE upc = 'shared-victim-upc'")
      .get() as { image: string };
    expect(survivor.image).toBe(stored);

    fs.unlinkSync(upload.diskPath);
  });
});

describe('PR #2 review round 3', () => {
  /**
   * A PNG data URI whose bytes carry a unique marker after the signature, so a file this
   * test caused can be told apart from uploads other test files write concurrently.
   */
  function markedPngDataUri(): { dataUri: string; marker: string } {
    const marker = `marker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(marker),
    ]);
    return { dataUri: `data:image/png;base64,${bytes.toString('base64')}`, marker };
  }

  function uploadsContaining(marker: string): string[] {
    return fs
      .readdirSync(UPLOADS_DIR)
      .filter(name => fs.readFileSync(path.join(UPLOADS_DIR, name)).includes(marker));
  }

  function writeSharedUpload(label: string): { name: string; diskPath: string } {
    const name = `audit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const diskPath = path.join(UPLOADS_DIR, name);
    fs.writeFileSync(diskPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { name, diskPath };
  }

  it('writes no image file for a new row rejected for having no name', async () => {
    const { dataUri, marker } = markedPngDataUri();
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: 'nameless-image-upc', image: dataUri }], {
          upc: 'upc',
          image: 'image',
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.errors_total).toBe(1);
    expect(res.body.errors[0]).toMatch(/Item name is required/);
    expect(
      db.prepare("SELECT 1 FROM inventory WHERE upc = 'nameless-image-upc'").get()
    ).toBeUndefined();
    expect(uploadsContaining(marker)).toEqual([]);
  });

  it('removes the image a row saved when writing that row then fails', async () => {
    db.exec(`
      CREATE TRIGGER audit_fail_import_insert BEFORE INSERT ON inventory
      WHEN NEW.upc = 'insert-fails-upc'
      BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END
    `);
    try {
      const { dataUri, marker } = markedPngDataUri();
      const res = await request
        .post('/api/inventory/batch-confirm')
        .set('Cookie', ownerCookie)
        .send(
          confirmBody(
            [
              { upc: 'insert-fails-upc', item_name: 'Doomed Row', image: dataUri },
              { upc: 'insert-survives-upc', item_name: 'Surviving Row' },
            ],
            { upc: 'upc', item_name: 'item_name', image: 'image' }
          )
        );

      // The failure stays on its own row; the rest of the chunk commits.
      expect(res.status).toBe(200);
      expect(res.body.errors_total).toBe(1);
      expect(res.body.errors[0]).toMatch(/forced insert failure/);
      expect(
        db.prepare("SELECT 1 FROM inventory WHERE upc = 'insert-survives-upc'").get()
      ).toBeDefined();
      expect(uploadsContaining(marker)).toEqual([]);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS audit_fail_import_insert');
    }
  });

  it('keeps the image of a row that was written', async () => {
    const { dataUri, marker } = markedPngDataUri();
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', ownerCookie)
      .send(
        confirmBody([{ upc: 'image-kept-upc', item_name: 'Image Kept', image: dataUri }], {
          upc: 'upc',
          item_name: 'item_name',
          image: 'image',
        })
      );

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT image FROM inventory WHERE upc = 'image-kept-upc'").get() as {
      image: string;
    };
    const files = uploadsContaining(marker);
    expect(files).toEqual([path.basename(row.image)]);
    fs.unlinkSync(path.join(UPLOADS_DIR, files[0]));
  });

  // The cleanup unlinks by file name, so each of these doomed-store values names the
  // victim's file even though the strings differ. The sub-path case is the reported bug;
  // the query case guards uploadFileName, which strips '?v=2' and so now resolves it to the
  // victim's file too.
  const doomedSpellings: Array<[string, (name: string) => string]> = [
    ['subpath', name => `/uploads/nested/${name}`],
    ['query', name => `/uploads/${name}?v=2`],
  ];
  for (const [label, spelling] of doomedSpellings) {
    it(`does not unlink a file another store references, given a ${label} spelling`, async () => {
      const victim = await registerStore(request, {
        storeName: `Spelling Victim ${label}`,
        username: `spellvictim${label}`,
      });
      const doomed = await registerStore(request, {
        storeName: `Spelling Doomed ${label}`,
        username: `spelldoomed${label}`,
      });
      const upload = writeSharedUpload(`spelling-${label}`);

      db.prepare(
        `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
         VALUES ('Spelling Victim', ?, 1, ?, ?)`
      ).run(`spell-victim-${label}`, `/uploads/${upload.name}`, victim.storeId);
      db.prepare(
        `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
         VALUES ('Spelling Doomed', ?, 1, ?, ?)`
      ).run(`spell-doomed-${label}`, spelling(upload.name), doomed.storeId);

      const res = await request
        .delete(`/api/admin/stores/${doomed.storeId}`)
        .set('Cookie', superadminCookie);

      expect(res.status).toBe(200);
      expect(fs.existsSync(upload.diskPath)).toBe(true);
      fs.unlinkSync(upload.diskPath);
    });
  }

  it('treats an absolute URL to an upload as a reference to that file', async () => {
    const victim = await registerStore(request, {
      storeName: 'Absolute URL Victim',
      username: 'absurlvictimowner',
    });
    const doomed = await registerStore(request, {
      storeName: 'Absolute URL Doomed',
      username: 'absurldoomedowner',
    });
    const upload = writeSharedUpload('absolute');

    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Absolute Victim', 'abs-victim-upc', 1, ?, ?)`
    ).run(`https://opticapture.example/uploads/${upload.name}`, victim.storeId);
    db.prepare(
      `INSERT INTO inventory (item_name, upc, quantity, image, store_id)
       VALUES ('Absolute Doomed', 'abs-doomed-upc', 1, ?, ?)`
    ).run(`/uploads/${upload.name}`, doomed.storeId);

    const res = await request
      .delete(`/api/admin/stores/${doomed.storeId}`)
      .set('Cookie', superadminCookie);

    expect(res.status).toBe(200);
    expect(fs.existsSync(upload.diskPath)).toBe(true);
    fs.unlinkSync(upload.diskPath);
  });

  it('rejects an oversized JSON file at preview, before any mapping', async () => {
    const items = Array.from({ length: 50_001 }, (_, i) => ({ upc: `jsoncap-${i}` }));
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', ownerCookie)
      .attach('file', Buffer.from(JSON.stringify({ items })), {
        filename: 'inventory.json',
        contentType: 'application/json',
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/limited to/i);
  });

  it('rejects an oversized CSV file at preview, before any mapping', async () => {
    const csv = ['upc', ...Array.from({ length: 50_001 }, (_, i) => `csvcap-${i}`)].join('\n');
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', ownerCookie)
      .attach('file', Buffer.from(csv), { filename: 'inventory.csv', contentType: 'text/csv' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/limited to/i);
  });
});

describe('import that stops partway', () => {
  // RAISE(ROLLBACK) ends the whole transaction mid-chunk, which is how SQLite answers a full
  // disk or an I/O error — the failures that stop a chunk rather than a single row.
  function failImportAt(upc: string) {
    db.exec(`
      CREATE TRIGGER audit_rollback_import BEFORE INSERT ON inventory
      WHEN NEW.upc = '${upc}'
      BEGIN SELECT RAISE(ROLLBACK, 'forced chunk failure'); END
    `);
  }

  function importLogsSince(lastId: number): Array<{ details: string }> {
    return db
      .prepare("SELECT details FROM logs WHERE action = 'IMPORT' AND store_id = 1 AND id > ?")
      .all(lastId) as Array<{ details: string }>;
  }

  function lastLogId(): number {
    return (db.prepare('SELECT COALESCE(MAX(id), 0) AS lastId FROM logs').get() as { lastId: number })
      .lastId;
  }

  it('reports and logs the chunks it saved, and nothing from the chunk that failed', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) => ({
      upc: `partial-${i}`,
      item_name: `Partial Item ${i}`,
    }));
    const logId = lastLogId();
    // Row 1,005 sits in the second chunk; the rows after it in that chunk must not be written.
    failImportAt('partial-1005');
    try {
      const res = await request
        .post('/api/inventory/batch-confirm')
        .set('Cookie', ownerCookie)
        .send(confirmBody(rows, { upc: 'upc', item_name: 'item_name' }));

      expect(res.status).toBe(500);
      expect(res.body.partial).toBe(true);
      expect(res.body.rows_saved).toBe(1_000);
      expect(res.body.rows_total).toBe(1_200);
      expect(res.body.added).toBe(1_000);
      expect(res.body.updated).toBe(0);
      expect(res.body.error).toMatch(/1,000 of 1,200/);

      const saved = db
        .prepare("SELECT COUNT(*) AS n FROM inventory WHERE upc LIKE 'partial-%' AND store_id = 1")
        .get() as { n: number };
      expect(saved.n).toBe(1_000);

      const entries = importLogsSince(logId);
      expect(entries).toHaveLength(1);
      expect(entries[0].details).toMatch(/stopped after 1000 of 1200 rows/i);
      expect(entries[0].details).toMatch(/\+1000 new/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS audit_rollback_import');
    }
  });

  it('reports a plain failure when the first chunk fails, since nothing was saved', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      upc: `firstchunk-${i}`,
      item_name: `First Chunk Item ${i}`,
    }));
    const logId = lastLogId();
    failImportAt('firstchunk-5');
    try {
      const res = await request
        .post('/api/inventory/batch-confirm')
        .set('Cookie', ownerCookie)
        .send(confirmBody(rows, { upc: 'upc', item_name: 'item_name' }));

      expect(res.status).toBe(500);
      expect(res.body.partial).toBeUndefined();
      const saved = db
        .prepare("SELECT COUNT(*) AS n FROM inventory WHERE upc LIKE 'firstchunk-%' AND store_id = 1")
        .get() as { n: number };
      expect(saved.n).toBe(0);
      expect(importLogsSince(logId)).toEqual([]);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS audit_rollback_import');
    }
  });
});
