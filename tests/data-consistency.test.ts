/**
 * Regressions for the data-consistency findings of the 2026-10-12 health check: one barcode
 * held twice, categories differing only by case, imports past the form's limits, the wrong
 * status for a caller's mistake, and the audit log open to takers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();
let owner: string;
let superadmin: string;

beforeAll(async () => {
  owner = await login(request, 'admin', 'admin123', getStoreCode(1));
  superadmin = await login(request, 'superadmin', 'superadmin123');
});

const addItem = (body: Record<string, unknown>, cookie = owner) =>
  request.post('/api/inventory').set('Cookie', cookie).send(body);

const importRows = (rows: Record<string, unknown>[], mapping: Record<string, string>, extra = {}) =>
  request
    .post('/api/inventory/batch-confirm')
    .set('Cookie', owner)
    .send({ sheetsData: [{ sheetName: 'Sheet1', rows, mapping, ...extra }] });

describe('a barcode belongs to one item per store', () => {
  // The same code as UPC-A and as EAN-13 with its leading zero.
  const UPCA = '036000291452';
  const EAN13 = '0036000291452';

  it('refuses a manual add of a barcode the store holds in its other form', async () => {
    expect((await addItem({ item_name: 'Tissues', upc: UPCA })).status).toBe(200);
    const dup = await addItem({ item_name: 'Tissues EAN', upc: EAN13 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('An item with that UPC already exists');
  });

  it('refuses an edit that moves an item onto another item’s barcode, in either form', async () => {
    const other = await addItem({ item_name: 'Napkins', upc: '4006381333931' });
    const exact = await request
      .put(`/api/inventory/${other.body.id}`)
      .set('Cookie', owner)
      .send({ upc: UPCA });
    const variant = await request
      .put(`/api/inventory/${other.body.id}`)
      .set('Cookie', owner)
      .send({ upc: EAN13 });
    expect([exact.status, variant.status]).toEqual([409, 409]);
  });

  it('lets an item be saved with its own barcode, including its other form', async () => {
    const { id } = db.prepare('SELECT id FROM inventory WHERE upc = ?').get(UPCA) as { id: number };
    const same = await request.put(`/api/inventory/${id}`).set('Cookie', owner).send({ upc: UPCA });
    const otherForm = await request
      .put(`/api/inventory/${id}`)
      .set('Cookie', owner)
      .send({ upc: EAN13 });
    expect([same.status, otherForm.status]).toEqual([200, 200]);
  });

  it('applies the same rule to a superadmin edit', async () => {
    const napkins = db.prepare("SELECT id FROM inventory WHERE item_name = 'Napkins'").get() as {
      id: number;
    };
    const detail = await request
      .get(`/api/admin/stores/1/items/${napkins.id}`)
      .set('Cookie', superadmin);
    const res = await request
      .put(`/api/admin/stores/1/items/${napkins.id}`)
      .set('Cookie', superadmin)
      .send({ changes: { upc: UPCA }, expected_revision: detail.body.item.revision });
    expect(res.status).toBe(409);
  });

  it('still lets another store hold the same barcode', async () => {
    const other = await registerStore(request, { storeName: 'Barcode Twin Store', username: 'twinowner' });
    expect((await addItem({ item_name: 'Tissues', upc: UPCA }, other.cookie)).status).toBe(200);
  });

  it('lets two items share a name, on add and on rename', async () => {
    const small = await addItem({ item_name: 'Cola', upc: 'cola-355ml' });
    const large = await addItem({ item_name: 'cola', upc: 'cola-2l' });
    const third = await addItem({ item_name: 'Diet', upc: 'cola-diet' });
    const rename = await request
      .put(`/api/inventory/${third.body.id}`)
      .set('Cookie', owner)
      .send({ item_name: 'Cola' });
    expect([small.status, large.status, rename.status]).toEqual([200, 200, 200]);
  });
});

describe('category names', () => {
  it('refuses a name that differs from an existing one only by case or spacing', async () => {
    const first = await request.post('/api/categories').set('Cookie', owner).send({ name: 'Hardware' });
    const lower = await request.post('/api/categories').set('Cookie', owner).send({ name: 'hardware' });
    const padded = await request
      .post('/api/categories')
      .set('Cookie', owner)
      .send({ name: '  HARDWARE ' });
    expect([first.status, lower.status, padded.status]).toEqual([201, 409, 409]);
  });

  it('refuses a rename onto another category but allows re-casing its own name', async () => {
    const tools = await request.post('/api/categories').set('Cookie', owner).send({ name: 'Tools' });
    const clash = await request
      .put(`/api/categories/${tools.body.id}`)
      .set('Cookie', owner)
      .send({ name: 'hardware' });
    const recase = await request
      .put(`/api/categories/${tools.body.id}`)
      .set('Cookie', owner)
      .send({ name: 'TOOLS' });
    expect([clash.status, recase.status]).toEqual([409, 200]);
  });

  it('caps the icon length', async () => {
    const res = await request
      .post('/api/categories')
      .set('Cookie', owner)
      .send({ name: 'Icon Heavy', icon: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });
});

describe('import holds rows to the item form’s limits', () => {
  const mapping = { n: 'item_name', u: 'upc', d: 'description', c: 'category' };

  it('reports over-length fields as row errors and saves the rest', async () => {
    const res = await importRows(
      [
        { n: 'N'.repeat(501), u: 'len-1' },
        { n: 'Long Upc', u: 'U'.repeat(129) },
        { n: 'Long Desc', u: 'len-3', d: 'D'.repeat(2001) },
        { n: 'Long Cat', u: 'len-4', c: 'C'.repeat(101) },
        { n: 'Fits', u: 'len-5', d: 'D'.repeat(2000), c: 'C'.repeat(100) },
      ],
      mapping
    );
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.errors_total).toBe(4);
    expect(res.body.errors).toEqual([
      expect.stringContaining('Item name must be 500 characters or fewer'),
      expect.stringContaining('UPC must be 128 characters or fewer'),
      expect.stringContaining('Description must be 2000 characters or fewer'),
      expect.stringContaining('Category must be 100 characters or fewer'),
    ]);
    // The error names the row without echoing a 501-character name back.
    expect(res.body.errors[0].length).toBeLessThan(200);
    const longest = db
      .prepare('SELECT MAX(LENGTH(item_name)) n, MAX(LENGTH(upc)) u FROM inventory')
      .get() as { n: number; u: number };
    expect(longest.n).toBeLessThanOrEqual(500);
    expect(longest.u).toBeLessThanOrEqual(128);
  });

  it('refuses a sheet whose own name would become an over-length category', async () => {
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', owner)
      .send({
        sheetsData: [
          { sheetName: 'S'.repeat(101), rows: [{ n: 'A', u: 'len-6' }], mapping: { n: 'item_name', u: 'upc' } },
        ],
      });
    expect(res.status).toBe(400);
    expect(
      (db.prepare('SELECT MAX(LENGTH(name)) m FROM categories').get() as { m: number }).m
    ).toBeLessThanOrEqual(100);
  });
});

describe('a caller’s mistake is a 4xx', () => {
  it('answers 413 for an upload over the size limit', async () => {
    const res = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', owner)
      .attach('file', Buffer.alloc(21 * 1024 * 1024), { filename: 'big.csv', contentType: 'text/csv' });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('answers 400 for a session label that is not text, or too long', async () => {
    const { sessionId } = (await request.post('/api/session/create').set('Cookie', owner)).body;
    const patch = (label: unknown) =>
      request
        .patch(`/api/session/${sessionId}/status`)
        .set('Cookie', owner)
        .send({ status: 'draft', label });
    expect((await patch({ a: 1 })).status).toBe(400);
    expect((await patch('L'.repeat(101))).status).toBe(400);
    expect((await patch('Aisle 3')).status).toBe(200);
  });

  it('answers 400 for an edit that changes nothing, and writes no audit row', async () => {
    const created = await addItem({ item_name: 'Untouched', upc: 'untouched-1' });
    const before = (db.prepare('SELECT COUNT(*) c FROM logs').get() as { c: number }).c;
    const res = await request.put(`/api/inventory/${created.body.id}`).set('Cookie', owner).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nothing to change');
    expect((db.prepare('SELECT COUNT(*) c FROM logs').get() as { c: number }).c).toBe(before);
  });

  it('tells the owner of a suspended store that it is suspended', async () => {
    const store = await registerStore(request, { storeName: 'Soon Suspended', username: 'suspowner' });
    db.prepare("UPDATE stores SET status = 'suspended' WHERE id = ?").run(store.storeId);
    const res = await request.get('/api/inventory').set('Cookie', store.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Store account suspended');
  });
});
