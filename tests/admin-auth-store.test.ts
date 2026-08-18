import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login, registerStore } from './helpers.js';

const request = createTestApp();

let ownerCookie: string;
let superadminCookie: string;
let uniqueId = 0;

function nextName(prefix: string): string {
  uniqueId += 1;
  return `${prefix} ${uniqueId}`;
}

function extractCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  if (!cookies.length) throw new Error('Expected Set-Cookie header to be present');
  return cookies[0];
}

beforeAll(async () => {
  const adminStoreCode = getStoreCode(1);
  ownerCookie = await login(request, 'admin', 'admin123', adminStoreCode);
  superadminCookie = await login(request, 'superadmin', 'superadmin123');
});

describe('admin store management', () => {
  it('lists stores for superadmins and blocks owners', async () => {
    const registered = await registerStore(request, {
      storeName: nextName('Admin Store'),
      username: nextName('adminstoreowner').replaceAll(' ', '').toLowerCase(),
    });
    const storeOwnerId = (db
      .prepare("SELECT id FROM users WHERE store_id = ? AND role = 'owner'")
      .get(registered.storeId) as { id: number } | undefined)!.id;
    const categoryId = (db
      .prepare('SELECT id FROM categories WHERE store_id = ? ORDER BY id LIMIT 1')
      .get(registered.storeId) as { id: number } | undefined)!.id;

    db.prepare(
      `
      INSERT INTO inventory (item_name, quantity, category_id, status, upc, store_id)
      VALUES (?, ?, ?, 'Active', ?, ?)
    `
    ).run(
      'Store Listing Item',
      1,
      categoryId,
      `admin-store-item-${registered.storeId}`,
      registered.storeId
    );

    const forbiddenRes = await request.get('/api/admin/stores').set('Cookie', ownerCookie);
    expect(forbiddenRes.status).toBe(403);

    const res = await request.get('/api/admin/stores').set('Cookie', superadminCookie);
    expect(res.status).toBe(200);

    const store = res.body.find((entry: any) => entry.id === registered.storeId);
    expect(store).toMatchObject({
      id: registered.storeId,
      user_count: 1,
      item_count: 1,
    });

    const usersRes = await request
      .get(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie);
    expect(usersRes.status).toBe(200);
    expect(usersRes.body.some((entry: any) => entry.id === storeOwnerId)).toBe(true);
  });

  it('validates and updates store suspension status', async () => {
    const storeName = nextName('Suspend Store');
    const username = nextName('suspendowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });

    const invalidIdRes = await request
      .put('/api/admin/stores/not-a-number/status')
      .set('Cookie', superadminCookie)
      .send({ status: 'active' });
    expect(invalidIdRes.status).toBe(400);

    const hqRes = await request
      .put('/api/admin/stores/0/status')
      .set('Cookie', superadminCookie)
      .send({ status: 'suspended' });
    expect(hqRes.status).toBe(403);

    const invalidStatusRes = await request
      .put(`/api/admin/stores/${registered.storeId}/status`)
      .set('Cookie', superadminCookie)
      .send({ status: 'paused' });
    expect(invalidStatusRes.status).toBe(400);

    const suspendRes = await request
      .put(`/api/admin/stores/${registered.storeId}/status`)
      .set('Cookie', superadminCookie)
      .send({ status: 'suspended' });
    expect(suspendRes.status).toBe(200);
    expect(
      (db.prepare('SELECT status FROM stores WHERE id = ?').get(registered.storeId) as any).status
    ).toBe('suspended');

    const loginRes = await request.post('/api/auth/login').send({
      username,
      password: 'Password1',
      store_code: registered.storeCode,
    });
    expect(loginRes.status).toBe(403);
  });

  it('validates store-user creation and existing-access grant edge cases', async () => {
    const storeName = nextName('User Grant Store');
    const username = nextName('grantowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });

    const invalidStoreIdRes = await request
      .post('/api/admin/stores/not-a-number/users')
      .set('Cookie', superadminCookie)
      .send({ username: 'someone', role: 'owner', mode: 'existing' });
    expect(invalidStoreIdRes.status).toBe(400);

    const hqRes = await request
      .post('/api/admin/stores/0/users')
      .set('Cookie', superadminCookie)
      .send({ username: 'someone', role: 'owner', mode: 'existing' });
    expect(hqRes.status).toBe(403);

    const missingFieldsRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username: '', role: 'viewer', mode: 'existing' });
    expect(missingFieldsRes.status).toBe(400);

    const invalidEmailRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username: 'newperson', role: 'owner', mode: 'create', email: 'bad-email' });
    expect(invalidEmailRes.status).toBe(400);

    const storeNotFoundRes = await request
      .post('/api/admin/stores/999999/users')
      .set('Cookie', superadminCookie)
      .send({ username: 'newperson', role: 'owner', mode: 'create' });
    expect(storeNotFoundRes.status).toBe(404);

    const conflictCreateRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username, role: 'taker', mode: 'create' });
    expect(conflictCreateRes.status).toBe(409);

    const notFoundExistingRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username: 'missing-user', role: 'owner', mode: 'existing' });
    expect(notFoundExistingRes.status).toBe(404);

    const existingAccessRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username, role: 'owner', mode: 'existing' });
    expect(existingAccessRes.status).toBe(409);
  });

  it('rejects ambiguous existing-user grants when multiple users share a username', async () => {
    const firstStore = await registerStore(request, {
      storeName: nextName('Ambiguous Admin Store A'),
      username: 'ambiguousadmin',
    });
    const secondStore = await registerStore(request, {
      storeName: nextName('Ambiguous Admin Store B'),
      username: 'ambiguousadmin',
    });
    const targetStore = await registerStore(request, {
      storeName: nextName('Grant Target Store'),
      username: nextName('granttarget').replaceAll(' ', '').toLowerCase(),
    });

    const res = await request
      .post(`/api/admin/stores/${targetStore.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({ username: 'ambiguousadmin', role: 'taker', mode: 'existing' });

    expect(firstStore.storeId).not.toBe(secondStore.storeId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Multiple users share that username/i);
  });

  it('creates store users with temporary passwords and enforces the reset flow', async () => {
    const storeName = nextName('Temp Password Store');
    const username = nextName('tempowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });
    const tempUsername = nextName('tempuser').replaceAll(' ', '').toLowerCase();

    const createUserRes = await request
      .post(`/api/admin/stores/${registered.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({
        username: tempUsername,
        role: 'taker',
        mode: 'create',
        email: 'temp.user@example.com',
      });

    expect(createUserRes.status).toBe(201);
    expect(createUserRes.body.created).toBe(true);
    expect(createUserRes.body.tempPassword).toMatch(/^[A-Za-z0-9_-]{10}$/);

    const tempLogin = await request.post('/api/auth/login').send({
      username: tempUsername,
      password: createUserRes.body.tempPassword,
      store_code: registered.storeCode,
    });
    expect(tempLogin.status).toBe(200);
    expect(tempLogin.body.must_reset_password).toBe(true);

    const tempCookie = extractCookie(tempLogin);

    const blockedRes = await request.get('/api/categories').set('Cookie', tempCookie);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toMatch(/password reset required/i);

    const meRes = await request.get('/api/auth/me').set('Cookie', tempCookie);
    expect(meRes.status).toBe(200);

    const resetRes = await request.put('/api/auth/store/password').set('Cookie', tempCookie).send({
      current_password: createUserRes.body.tempPassword,
      new_password: 'NewPassword2',
    });
    expect(resetRes.status).toBe(200);

    const resetCookie = extractCookie(resetRes);
    const categoriesRes = await request.get('/api/categories').set('Cookie', resetCookie);
    expect(categoriesRes.status).toBe(200);
  }, 15000);

  it('edits stores, rejects unsafe logos, and deletes stores cleanly', async () => {
    const storeName = nextName('Editable Store');
    const username = nextName('editableowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });

    const badLogoRes = await request
      .put(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie)
      .send({
        name: `${storeName} Updated`,
        logo: 'data:image/tiff;base64,AAAA',
      });
    expect(badLogoRes.status).toBe(400);

    const updateRes = await request
      .put(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie)
      .send({
        name: `${storeName} Updated`,
        street: '123 Market St',
        city: 'Albany',
        zipcode: '10001',
        state: 'NY',
        phone: '5555555555',
        email: 'updated@example.com',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body).toMatchObject({
      id: registered.storeId,
      name: `${storeName} Updated`,
      street: '123 Market St',
      city: 'Albany',
      phone: '5555555555',
      email: 'updated@example.com',
    });

    const deleteRes = await request
      .delete(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie);
    expect(deleteRes.status).toBe(200);
    expect(
      (db.prepare('SELECT id FROM stores WHERE id = ?').get(registered.storeId) as any) ?? null
    ).toBeNull();
  });

  it('validates revoke access rules and store edit input guards', async () => {
    const storeName = nextName('Revoke Guard Store');
    const ownerUsername = nextName('revokeowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username: ownerUsername });
    const ownerUserId = (db
      .prepare('SELECT id FROM users WHERE username = ? AND store_id = ?')
      .get(ownerUsername, registered.storeId) as { id: number } | undefined)!.id;

    const invalidRevokeRes = await request
      .delete('/api/admin/stores/not-a-number/users/not-a-user')
      .set('Cookie', superadminCookie);
    expect(invalidRevokeRes.status).toBe(400);

    const revokeHqRes = await request
      .delete(`/api/admin/stores/0/users/${ownerUserId}`)
      .set('Cookie', superadminCookie);
    expect(revokeHqRes.status).toBe(403);

    const revokeMissingRes = await request
      .delete(`/api/admin/stores/${registered.storeId}/users/999999`)
      .set('Cookie', superadminCookie);
    expect(revokeMissingRes.status).toBe(404);

    const revokePrimaryRes = await request
      .delete(`/api/admin/stores/${registered.storeId}/users/${ownerUserId}`)
      .set('Cookie', superadminCookie);
    expect(revokePrimaryRes.status).toBe(400);
    expect(revokePrimaryRes.body.error).toMatch(/primary store/i);

    const badStoreIdRes = await request
      .put('/api/admin/stores/not-a-number')
      .set('Cookie', superadminCookie)
      .send({ name: 'Nope' });
    expect(badStoreIdRes.status).toBe(400);

    const hqEditRes = await request
      .put('/api/admin/stores/0')
      .set('Cookie', superadminCookie)
      .send({ name: 'Nope' });
    expect(hqEditRes.status).toBe(403);

    const missingNameRes = await request
      .put(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie)
      .send({ name: '   ' });
    expect(missingNameRes.status).toBe(400);

    const invalidPhoneRes = await request
      .put(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie)
      .send({ name: 'Valid Name', phone: '1234' });
    expect(invalidPhoneRes.status).toBe(400);

    const invalidZipRes = await request
      .put(`/api/admin/stores/${registered.storeId}`)
      .set('Cookie', superadminCookie)
      .send({ name: 'Valid Name', zipcode: 'ABCDE' });
    expect(invalidZipRes.status).toBe(400);
  });
});

describe('auth store access flows', () => {
  it('lists accessible stores, switches stores, and revokes delegated access', async () => {
    const alphaUsername = nextName('alphowner').replaceAll(' ', '').toLowerCase();
    const betaUsername = nextName('betaowner').replaceAll(' ', '').toLowerCase();
    const alphaStore = await registerStore(request, {
      storeName: nextName('Alpha Store'),
      username: alphaUsername,
    });
    const betaStore = await registerStore(request, {
      storeName: nextName('Beta Store'),
      username: betaUsername,
    });

    const alphaUserId = (db
      .prepare('SELECT id FROM users WHERE username = ? AND store_id = ?')
      .get(alphaUsername, alphaStore.storeId) as { id: number } | undefined)!.id;

    const noAccessRes = await request
      .post('/api/auth/switch-store')
      .set('Cookie', alphaStore.cookie)
      .send({ store_id: betaStore.storeId });
    expect(noAccessRes.status).toBe(403);

    const invalidStoreIdRes = await request
      .post('/api/auth/switch-store')
      .set('Cookie', alphaStore.cookie)
      .send({ store_id: 'abc' });
    expect(invalidStoreIdRes.status).toBe(400);

    const grantRes = await request
      .post(`/api/admin/stores/${betaStore.storeId}/users`)
      .set('Cookie', superadminCookie)
      .send({
        username: alphaUsername,
        role: 'taker',
        mode: 'existing',
      });
    expect(grantRes.status).toBe(201);

    const myStoresRes = await request.get('/api/auth/my-stores').set('Cookie', alphaStore.cookie);
    expect(myStoresRes.status).toBe(200);
    expect(
      myStoresRes.body.map((entry: any) => entry.id).sort((a: number, b: number) => a - b)
    ).toEqual([alphaStore.storeId, betaStore.storeId]);

    const unresolvedMeRes = await request.get('/api/auth/me').set('Cookie', alphaStore.cookie);
    expect(unresolvedMeRes.status).toBe(200);
    expect(unresolvedMeRes.body).toMatchObject({
      username: alphaUsername,
      role: null,
      store_id: null,
      store_name: null,
      needs_store_selection: true,
    });

    const unresolvedSettingsRes = await request
      .get('/api/auth/store/settings')
      .set('Cookie', alphaStore.cookie);
    expect(unresolvedSettingsRes.status).toBe(409);
    expect(unresolvedSettingsRes.body.needs_store_selection).toBe(true);

    const switchRes = await request
      .post('/api/auth/switch-store')
      .set('Cookie', alphaStore.cookie)
      .send({ store_id: betaStore.storeId });
    expect(switchRes.status).toBe(200);
    expect(switchRes.body).toMatchObject({
      success: true,
      store_id: betaStore.storeId,
      role: 'taker',
    });
    expect(switchRes.body.store_name).toBe(
      (db.prepare('SELECT name FROM stores WHERE id = ?').get(betaStore.storeId) as any).name
    );

    const resolvedMeRes = await request
      .get('/api/auth/me')
      .set('Cookie', alphaStore.cookie)
      .set('X-Store-Id', String(betaStore.storeId));
    expect(resolvedMeRes.status).toBe(200);
    expect(resolvedMeRes.body).toMatchObject({
      username: alphaUsername,
      role: 'taker',
      store_id: betaStore.storeId,
      needs_store_selection: false,
    });

    const settingsRes = await request
      .get('/api/auth/store/settings')
      .set('Cookie', alphaStore.cookie)
      .set('X-Store-Id', String(betaStore.storeId));
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.id).toBe(betaStore.storeId);

    const revokeRes = await request
      .delete(`/api/admin/stores/${betaStore.storeId}/users/${alphaUserId}`)
      .set('Cookie', superadminCookie);
    expect(revokeRes.status).toBe(200);

    const afterRevokeRes = await request
      .post('/api/auth/switch-store')
      .set('Cookie', alphaStore.cookie)
      .send({ store_id: betaStore.storeId });
    expect(afterRevokeRes.status).toBe(403);
  });

  it('validates and updates owner store settings', async () => {
    const storeName = nextName('Settings Store');
    const username = nextName('settingsowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });

    const invalidEmailRes = await request
      .put('/api/auth/store/settings')
      .set('Cookie', registered.cookie)
      .send({
        name: storeName,
        email: 'not-an-email',
      });
    expect(invalidEmailRes.status).toBe(400);

    const validUpdateRes = await request
      .put('/api/auth/store/settings')
      .set('Cookie', registered.cookie)
      .send({
        name: `${storeName} Updated`,
        street: '99 Example Ave',
        city: 'Trenton',
        zipcode: '12345',
        state: 'NJ',
        phone: '(555) 555-5555',
        email: 'settings@example.com',
      });
    expect(validUpdateRes.status).toBe(200);
    expect(validUpdateRes.body).toMatchObject({
      name: `${storeName} Updated`,
      street: '99 Example Ave',
      city: 'Trenton',
      zipcode: '12345',
      state: 'NJ',
      phone: '(555) 555-5555',
      email: 'settings@example.com',
    });
  });

  it('resets passwords through the admin route and forces the user back through setup', async () => {
    const storeName = nextName('Reset Store');
    const username = nextName('resetowner').replaceAll(' ', '').toLowerCase();
    const registered = await registerStore(request, { storeName, username });
    const userId = (db
      .prepare('SELECT id FROM users WHERE username = ? AND store_id = ?')
      .get(username, registered.storeId) as { id: number } | undefined)!.id;

    const resetRes = await request
      .post(`/api/admin/users/${userId}/reset-password`)
      .set('Cookie', superadminCookie);
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.username).toBe(username);
    expect(resetRes.body.tempPassword).toMatch(/^[A-Za-z0-9_-]{10}$/);

    const loginRes = await request.post('/api/auth/login').send({
      username,
      password: resetRes.body.tempPassword,
      store_code: registered.storeCode,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.must_reset_password).toBe(true);
  });

  it('validates reset-password target ids and missing users', async () => {
    const invalidIdRes = await request
      .post('/api/admin/users/not-a-number/reset-password')
      .set('Cookie', superadminCookie);
    expect(invalidIdRes.status).toBe(400);

    const missingUserRes = await request
      .post('/api/admin/users/999999/reset-password')
      .set('Cookie', superadminCookie);
    expect(missingUserRes.status).toBe(404);
  });
});
