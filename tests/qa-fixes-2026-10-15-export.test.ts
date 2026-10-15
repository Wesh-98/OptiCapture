/**
 * Regression tests for the export and image findings of the 2026-10-15 QA run: files Excel
 * mis-reads or refuses, an export the server ran for a format nobody asked for, and item
 * images that pointed the browser at the app's own API.
 */
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { autoDetect } from '../src/components/import/importApi.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();
let cookie: string;
let storeId: number;

beforeAll(async () => {
  const store = await registerStore(request, { storeName: 'QA Export Mart', username: 'qaexport' });
  cookie = store.cookie;
  storeId = store.storeId;
});

const binary = (res: any, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

function exportFile(format: string, as = cookie) {
  return request
    .get('/api/inventory/export')
    .query({ format })
    .set('Cookie', as)
    .buffer(true)
    .parse(binary);
}

const item = (upc: string) =>
  db.prepare('SELECT * FROM inventory WHERE store_id = ? AND upc = ?').get(storeId, upc) as
    | Record<string, any>
    | undefined;

const exportLogs = () =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM logs WHERE store_id = ? AND action = 'EXPORT'")
      .get(storeId) as { n: number }
  ).n;

describe('M5: CSV export encoding', () => {
  it('starts with a UTF-8 byte-order mark so Excel reads accents correctly', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, store_id) VALUES ('Crème brûlée', '300000000001', 1, ?)"
    ).run(storeId);
    const res = await exportFile('csv');
    const body = res.body as Buffer;
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.toString('utf8')).toContain('Crème brûlée');
  });

  it('re-imports cleanly: no byte-order mark in the headers, no guard apostrophes', async () => {
    db.prepare(
      "INSERT INTO inventory (item_name, upc, quantity, tag_names, store_id) VALUES ('+1 Energy', '300000000002', 3, '@promo', ?)"
    ).run(storeId);
    const csv = (await exportFile('csv')).body as Buffer;

    const up = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', cookie)
      .attach('file', csv, { filename: 'export.csv', contentType: 'text/csv' });
    const headers: string[] = up.body.sheets[0].headers;
    expect(headers[0]).toBe('external_system');

    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', cookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Sheet1',
            categoryName: null,
            rows: up.body.sheets[0].rows,
            rowNumbers: up.body.sheets[0].rowNumbers,
            mapping: autoDetect(headers),
          },
        ],
      });
    expect(res.body).toMatchObject({ errors: [], conflicts_total: 0 });
    expect(item('300000000002')).toMatchObject({ item_name: '+1 Energy', tag_names: '@promo' });
    expect(item('300000000001')?.item_name).toBe('Crème brûlée');
  });
});

describe('M6: XLSX export of a store with no items', () => {
  it('has a worksheet with the column headings', async () => {
    const empty = await registerStore(request, { storeName: 'Empty Mart', username: 'qaempty' });
    const res = await exportFile('xlsx', empty.cookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Buffer);
    expect(workbook.worksheets.map(ws => ws.name)).toEqual(['Inventory']);
    expect(workbook.worksheets[0].getRow(1).getCell(6).value).toBe('item_name');
  });
});

describe('L9: unknown export formats', () => {
  it('are refused and change nothing', async () => {
    const before = exportLogs();
    db.prepare('UPDATE inventory SET sync_status = NULL WHERE store_id = ?').run(storeId);
    const res = await request
      .get('/api/inventory/export')
      .query({ format: 'docx' })
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(exportLogs()).toBe(before);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE store_id = ? AND sync_status = 'exported'"
        )
        .get(storeId)
    ).toEqual({ n: 0 });
  });
});

describe('M11: item image values', () => {
  const refused = [
    '/api/inventory/export?format=csv',
    '//evil.example/x.png',
    'javascript:alert(1)',
    '/uploads/../opticapture.db',
    'ftp://example.com/a.png',
  ];
  const accepted = [
    'https://images.example.com/a.jpg',
    '/uploads/2f0c8a1e-photo.png',
    'https://drive.google.com/file/d/AbC_123/view?usp=sharing',
  ];

  it('refuses anything but a web link, Drive image or uploaded photo when adding', async () => {
    // An existing upload is only accepted when the store already uses it.
    db.prepare(
      "INSERT INTO inventory (item_name, upc, image, store_id) VALUES ('Has photo', '329999999999', '/uploads/2f0c8a1e-photo.png', ?)"
    ).run(storeId);
    for (const [index, image] of refused.entries()) {
      const res = await request
        .post('/api/inventory')
        .set('Cookie', cookie)
        .send({ item_name: 'Bad image', upc: `31000000000${index}`, image });
      expect(res.status, image).toBe(400);
      expect(res.body.error).toMatch(/Image must be/);
    }
    for (const [index, image] of accepted.entries()) {
      const res = await request
        .post('/api/inventory')
        .set('Cookie', cookie)
        .send({ item_name: 'Good image', upc: `32000000000${index}`, image });
      expect(res.status, image).toBe(200);
    }
    expect(item('320000000002')?.image).toBe('/api/drive-image/AbC_123');
  });

  it('refuses a takers’ edit that points the image at the API', async () => {
    const taker = await login(request, 'taker', 'taker123', getStoreCode(1));
    const created = await request
      .post('/api/inventory')
      .set('Cookie', taker)
      .send({ item_name: 'Taker item', upc: '330000000001' });
    const res = await request
      .put(`/api/inventory/${created.body.id}`)
      .set('Cookie', taker)
      .send({ image: '/api/inventory/export?format=csv' });
    expect(res.status).toBe(400);
  });

  it('refuses it on a staged scan item', async () => {
    const session = (await request.post('/api/session/create').set('Cookie', cookie)).body;
    db.prepare(
      "INSERT INTO session_items (session_id, upc, product_name, lookup_status, source) VALUES (?, '012000001291', 'Staged', 'new_candidate', 'manual')"
    ).run(session.sessionId);
    const row = db
      .prepare('SELECT id FROM session_items WHERE session_id = ?')
      .get(session.sessionId) as { id: number };
    const res = await request
      .patch(`/api/session/${session.sessionId}/items/${row.id}`)
      .set('Cookie', cookie)
      .send({ image: '/api/logs' });
    expect(res.status).toBe(400);
  });
});

describe('M11: images that are another store’s uploads', () => {
  it('are refused on add, edit and scan edits, while a store keeps its own', async () => {
    const other = await registerStore(request, { storeName: 'Other Mart', username: 'qaother' });
    const theirs = '/uploads/0000aaaa-other-store.png';
    db.prepare(
      "INSERT INTO inventory (item_name, upc, image, store_id) VALUES ('Theirs', '350000000001', ?, ?)"
    ).run(theirs, other.storeId);
    const mine = '/uploads/0000bbbb-this-store.png';
    const own = db
      .prepare(
        "INSERT INTO inventory (item_name, upc, image, store_id) VALUES ('Mine', '350000000002', ?, ?)"
      )
      .run(mine, storeId).lastInsertRowid;

    const add = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Borrowed', upc: '350000000003', image: theirs });
    expect(add.status).toBe(400);
    expect(add.body.error).toMatch(/not one of this store/);

    const edit = await request
      .put(`/api/inventory/${own}`)
      .set('Cookie', cookie)
      .send({ image: theirs });
    expect(edit.status).toBe(400);

    // Re-saving an item with its own photo, as the edit form does, is fine.
    const keep = await request
      .put(`/api/inventory/${own}`)
      .set('Cookie', cookie)
      .send({ item_name: 'Mine renamed', image: mine });
    expect(keep.status).toBe(200);

    const session = (await request.post('/api/session/create').set('Cookie', cookie)).body;
    const staged = db
      .prepare(
        "INSERT INTO session_items (session_id, upc, product_name, lookup_status, source) VALUES (?, '012000001291', 'Staged', 'new_candidate', 'manual')"
      )
      .run(session.sessionId).lastInsertRowid;
    const scanEdit = await request
      .patch(`/api/session/${session.sessionId}/items/${staged}`)
      .set('Cookie', cookie)
      .send({ image: theirs });
    expect(scanEdit.status).toBe(400);
  });
});

describe('M11: a web link does not make an upload the store’s own', () => {
  it('refuses /uploads/<file> after saving https://…/uploads/<file>', async () => {
    const other = await registerStore(request, { storeName: 'Owner Mart', username: 'qaowner2' });
    const theirs = '/uploads/0000cccc-launder.png';
    db.prepare(
      "INSERT INTO inventory (item_name, upc, image, store_id) VALUES ('Theirs', '360000000001', ?, ?)"
    ).run(theirs, other.storeId);

    const link = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Link', upc: '360000000002', image: `https://x.example${theirs}` });
    expect(link.status).toBe(200);

    const claim = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Claim', upc: '360000000003', image: theirs });
    expect(claim.status).toBe(400);
  });

  it('refuses another store’s upload that this store has set as its logo', async () => {
    const other = await registerStore(request, { storeName: 'Logo Mart', username: 'qalogo' });
    const theirs = '/uploads/0000dddd-their-photo.png';
    db.prepare(
      "INSERT INTO inventory (item_name, upc, image, store_id) VALUES ('Theirs', '370000000001', ?, ?)"
    ).run(theirs, other.storeId);
    // Store settings accept any /uploads/ path as the logo.
    db.prepare('UPDATE stores SET logo = ? WHERE id = ?').run(theirs, storeId);
    const res = await request
      .post('/api/inventory')
      .set('Cookie', cookie)
      .send({ item_name: 'Via logo', upc: '370000000002', image: theirs });
    expect(res.status).toBe(400);
    db.prepare('UPDATE stores SET logo = NULL WHERE id = ?').run(storeId);
  });
});

describe('L12: a bad image in an import row', () => {
  it('leaves the picture off but still imports the item', async () => {
    const csv = [
      'UPC,Item Name,Image',
      '340000000001,Api image,/api/inventory/export?format=json',
      // Quoted: the comma after "base64" would otherwise split the value into two columns.
      '340000000002,Svg data,"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="',
      '340000000003,Good image,https://images.example.com/ok.png',
    ].join('\n');
    const up = await request
      .post('/api/inventory/batch-upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(csv), { filename: 'img.csv', contentType: 'text/csv' });
    expect(up.body.sheets[0].rows[1].Image).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    const res = await request
      .post('/api/inventory/batch-confirm')
      .set('Cookie', cookie)
      .send({
        sheetsData: [
          {
            sheetName: 'Sheet1',
            rows: up.body.sheets[0].rows,
            mapping: { UPC: 'upc', 'Item Name': 'item_name', Image: 'image' },
          },
        ],
      });
    expect(res.body.added).toBe(3);
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0]).toContain('left off the item');
    expect(item('340000000001')?.image).toBeNull();
    expect(item('340000000002')?.image).toBeNull();
    expect(item('340000000003')?.image).toBe('https://images.example.com/ok.png');
  });
});
