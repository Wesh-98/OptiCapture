/**
 * tests/store-inventory-search.test.ts — the store's inventory search matches the Super Admin's
 *
 * GET /api/inventory?q= is what the dashboard's "Search Categories/Items" box now calls. It
 * uses the same helper as the Super Admin search (itemSearchCondition): name, brand, category
 * or tag, ignoring spaces and punctuation, plus a full barcode in its other form. Before, the
 * store list skipped brand and barcode forms, and the dashboard only filtered the page it had.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, login, registerStore, type RegisteredStore } from './helpers.js';

const request = createTestApp();
let store: RegisteredStore;
let other: RegisteredStore;
let drinks: number;
let snacks: number;

function addItem(
  storeId: number,
  item: {
    name: string;
    upc: string;
    category: number | null;
    brand?: string;
    tags?: string;
    status?: string;
  }
) {
  db.prepare(
    `INSERT INTO inventory (item_name, upc, category_id, brand, tag_names, status, quantity, store_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    item.name,
    item.upc,
    item.category,
    item.brand ?? null,
    item.tags ?? null,
    item.status ?? 'Active',
    storeId
  );
}

const search = (q: string, extra: Record<string, string> = {}, cookie = store.cookie) =>
  request
    .get('/api/inventory')
    .query({ q, limit: '100', ...extra })
    .set('Cookie', cookie);

const names = (res: { body: { items: Array<{ item_name: string }> } }) =>
  res.body.items.map(item => item.item_name).sort();

beforeAll(async () => {
  store = await registerStore(request, { storeName: 'Search Mart', username: 'searchowner' });
  other = await registerStore(request, { storeName: 'Search Other', username: 'searchother' });
  const category = (name: string, storeId: number) =>
    Number(
      db
        .prepare("INSERT INTO categories (name, icon, store_id) VALUES (?, 'Package', ?)")
        .run(name, storeId).lastInsertRowid
    );
  drinks = category('Cold Drinks', store.storeId);
  snacks = category('Salty Treats', store.storeId);

  addItem(store.storeId, {
    name: 'Coca-Cola 330ml',
    upc: '049000028911',
    category: drinks,
    brand: 'Coca-Cola Co',
  });
  addItem(store.storeId, {
    name: 'Lime Seltzer',
    upc: '012345678905',
    category: drinks,
    tags: 'sparkling, citrus',
  });
  addItem(store.storeId, {
    name: 'Sea Salt Chips',
    upc: '036000291452',
    category: snacks,
    brand: 'Crunchy',
    status: 'Inactive',
  });
  addItem(store.storeId, { name: 'Pretzels', upc: 'STORE-PRZ-1', category: snacks, tags: 'baked' });
  // Another store's matching item must never show up.
  addItem(other.storeId, { name: 'Coca-Cola Other Store', upc: '049000028911', category: null });
});

describe('GET /api/inventory?q= — the shared item search', () => {
  it('matches names ignoring spaces, case and punctuation', async () => {
    expect(names(await search('coca cola'))).toEqual(['Coca-Cola 330ml']);
    expect(names(await search('COCACOLA'))).toEqual(['Coca-Cola 330ml']);
  });

  it('matches tags', async () => {
    expect(names(await search('sparkling'))).toEqual(['Lime Seltzer']);
    expect(names(await search('baked'))).toEqual(['Pretzels']);
  });

  it('matches brand, which the store search used to skip', async () => {
    expect(names(await search('crunchy'))).toEqual(['Sea Salt Chips']);
  });

  it('matches the category name', async () => {
    expect(names(await search('salty treats'))).toEqual(['Pretzels', 'Sea Salt Chips']);
  });

  it('finds a barcode in its other form, as the Super Admin search does', async () => {
    // Stored as 12-digit UPC-A; searched as the 13-digit EAN form, and as typed.
    expect(names(await search('0049000028911'))).toEqual(['Coca-Cola 330ml']);
    expect(names(await search('049000028911'))).toEqual(['Coca-Cola 330ml']);
    // Part of a barcode still matches, as text.
    expect(names(await search('2891'))).toEqual(['Coca-Cola 330ml']);
  });

  it('keeps to the signed-in store', async () => {
    const res = await search('coca cola');
    expect(res.body.total).toBe(1);
    const theirs = await search('coca cola', {}, other.cookie);
    expect(names(theirs)).toEqual(['Coca-Cola Other Store']);
  });

  it('combines with the category and status filters, and counts the matches', async () => {
    // "salt" matches Sea Salt Chips by name and Pretzels by its category, Salty Treats.
    expect(names(await search('salt'))).toEqual(['Pretzels', 'Sea Salt Chips']);

    const inactive = await search('salt', { status: 'Inactive' });
    expect(names(inactive)).toEqual(['Sea Salt Chips']);
    expect(inactive.body.total).toBe(1);

    const active = await search('salt', { status: 'Active' });
    expect(names(active)).toEqual(['Pretzels']);

    const inDrinks = await search('salt', { category_id: String(drinks) });
    expect(inDrinks.body.total).toBe(0);
    const inSnacks = await search('chips', { category_id: String(snacks) });
    expect(names(inSnacks)).toEqual(['Sea Salt Chips']);
  });

  it('pages through matches with the total of all of them', async () => {
    const page1 = await request
      .get('/api/inventory')
      .query({ q: 'salty treats', limit: '1', page: '1', sort: 'name_asc' })
      .set('Cookie', store.cookie);
    const page2 = await request
      .get('/api/inventory')
      .query({ q: 'salty treats', limit: '1', page: '2', sort: 'name_asc' })
      .set('Cookie', store.cookie);
    expect(page1.body.total).toBe(2);
    expect(names(page1)).toEqual(['Pretzels']);
    expect(names(page2)).toEqual(['Sea Salt Chips']);
  });

  it('treats a blank search as no search', async () => {
    const res = await search('   ');
    expect(res.body.total).toBe(4);
  });

  it('searches with punctuation alone literally', async () => {
    expect(names(await search('-prz-'))).toEqual(['Pretzels']);
  });

  it('is the same search the Super Admin runs for this store', async () => {
    const superCookie = await login(request, 'superadmin', 'superadmin123');
    for (const q of ['coca cola', 'sparkling', 'crunchy', '0049000028911', 'salty treats']) {
      const mine = names(await search(q));
      const admin = await request
        .get('/api/admin/search')
        .query({ q, store: String(store.storeId) })
        .set('Cookie', superCookie);
      expect(admin.status).toBe(200);
      expect(admin.body.items.map((i: { item_name: string }) => i.item_name).sort()).toEqual(mine);
    }
  });
});
