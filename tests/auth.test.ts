/**
 * tests/auth.test.ts — Authentication route integration tests
 *
 * Covers the critical paths that hardening cares about most:
 *   - Input validation (missing fields, bad formats)
 *   - Login success / failure with the seeded demo accounts
 *   - Superadmin login (no store_code path)
 *   - Account lockout after 5 consecutive failed attempts
 *   - Logout + token revocation (revoked token is rejected on next request)
 *   - token_version bump on password change (old token invalidated immediately)
 *
 * Each assertion is commented with the audit finding or security property
 * it is verifying so reviewers can map tests back to requirements.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/server/db.js';
import { createTestApp, getStoreCode, login } from './helpers.js';

// One app + one in-memory database for all tests in this file.
// pool:'forks' in vitest.config.ts guarantees this process is isolated.
const request = createTestApp();

// The seeded demo store is id=1. Its store_code is generated randomly on each
// new :memory: database, so we query it once before any tests run.
let adminStoreCode: string;

beforeAll(() => {
  adminStoreCode = getStoreCode(1);
});

// ── POST /api/auth/login — input validation ──────────────────────────────────

describe('POST /api/auth/login — input validation', () => {
  it('400 when body is empty', async () => {
    // All three fields (username, password, store_code) are absent
    const res = await request.post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('400 when password is missing', async () => {
    const res = await request.post('/api/auth/login').send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  it('400 when username is missing', async () => {
    const res = await request.post('/api/auth/login').send({ password: 'admin123' });
    expect(res.status).toBe(400);
  });

  it('400 with a store code prompt when a non-superadmin login omits store_code', async () => {
    const res = await request.post('/api/auth/login').send({
      username: 'admin',
      password: 'admin123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Store Code Required');
  });

  it('401 when store_code does not match any store', async () => {
    // Invalid store code — should not leak whether the username exists
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123', store_code: 'XXXXXX' });
    expect(res.status).toBe(401);
  });

  it('401 when password is wrong', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrongpassword', store_code: adminStoreCode });
    expect(res.status).toBe(401);
    // Must not reveal whether the username was correct (M-1: generic error)
    expect(res.body.error).toBe('Invalid credentials');
  });
});

// ── POST /api/auth/login — success paths ────────────────────────────────────

describe('POST /api/auth/login — success', () => {
  it('200 + httpOnly cookie for seeded admin', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123', store_code: adminStoreCode });

    expect(res.status).toBe(200);

    // Verify the returned user payload
    expect(res.body.username).toBe('admin');
    expect(res.body.role).toBe('owner');
    expect(res.body.store_id).toBe(1);

    // JWT must be in an httpOnly cookie, never in the response body (H-3)
    expect(res.body).not.toHaveProperty('token');
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some(c => c.startsWith('token='))).toBe(true);
    // httpOnly must be set — prevents XSS token theft
    expect(cookies.some(c => c.toLowerCase().includes('httponly'))).toBe(true);
  });

  it('200 for seeded taker account', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'taker', password: 'taker123', store_code: adminStoreCode });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('taker');
  });

  it('200 for superadmin (no store_code required)', async () => {
    // Superadmin uses a separate login path that bypasses store_code lookup
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'superadmin', password: 'superadmin123' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('superadmin');
  });

  it('normalizes usernames on registration and login', async () => {
    const regRes = await request.post('/api/auth/register').send({
      store_name: 'Case Normalization Store',
      username: '  MixedCaseOwner  ',
      password: 'Password1',
    });
    expect(regRes.status).toBe(201);

    const stored = db
      .prepare('SELECT username FROM users WHERE store_id = ?')
      .get(regRes.body.store_id) as { username: string };
    expect(stored.username).toBe('mixedcaseowner');

    const loginRes = await request.post('/api/auth/login').send({
      username: 'MIXEDCASEOWNER',
      password: 'Password1',
      store_code: regRes.body.store_code,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.username).toBe('mixedcaseowner');
  });

  it('resets failed_login_attempts to 0 on success after previous failures', async () => {
    // One failed attempt
    await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'bad', store_code: adminStoreCode });

    // Successful login — should clear the counter
    await request
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123', store_code: adminStoreCode });

    const user = db
      .prepare("SELECT failed_login_attempts FROM users WHERE username = 'admin'")
      .get() as any;
    expect(user.failed_login_attempts).toBe(0);
  });

  it('does not increment failed attempts for every account when duplicate usernames are accessible in one store', async () => {
    const primaryReg = await request.post('/api/auth/register').send({
      store_name: 'Ambiguous Login Store A',
      username: 'sharedlogin',
      password: 'Password1',
    });
    expect(primaryReg.status).toBe(201);

    const secondaryReg = await request.post('/api/auth/register').send({
      store_name: 'Ambiguous Login Store B',
      username: 'sharedlogin',
      password: 'Password2',
    });
    expect(secondaryReg.status).toBe(201);

    const primaryUser = db
      .prepare('SELECT id FROM users WHERE store_id = ? AND username = ?')
      .get(primaryReg.body.store_id, 'sharedlogin') as { id: number };
    const secondaryUser = db
      .prepare('SELECT id FROM users WHERE store_id = ? AND username = ?')
      .get(secondaryReg.body.store_id, 'sharedlogin') as { id: number };

    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      secondaryUser.id,
      primaryReg.body.store_id,
      'taker'
    );

    const res = await request.post('/api/auth/login').send({
      username: 'sharedlogin',
      password: 'WrongPassword9',
      store_code: primaryReg.body.store_code,
    });
    expect(res.status).toBe(401);

    const rows = db
      .prepare('SELECT failed_login_attempts FROM users WHERE id IN (?, ?) ORDER BY id')
      .all(primaryUser.id, secondaryUser.id) as Array<{ failed_login_attempts: number }>;
    expect(rows.map(row => row.failed_login_attempts)).toEqual([0, 0]);
  });
});

// ── POST /api/auth/login — account lockout ───────────────────────────────────

describe('POST /api/auth/login — account lockout', () => {
  it('429 after 5 consecutive failed attempts (M-4: brute-force protection)', async () => {
    // Use the taker account so we don't interfere with the admin account used
    // in other describe blocks (test files share a single in-memory db)
    for (let i = 0; i < 5; i++) {
      await request
        .post('/api/auth/login')
        .send({ username: 'taker', password: `wrong${i}`, store_code: adminStoreCode });
    }

    const res = await request
      .post('/api/auth/login')
      .send({ username: 'taker', password: 'taker123', store_code: adminStoreCode });

    // 6th attempt (even with correct password) must be rejected
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/locked/i);
  }, 15000);

  it('locked_until is set in the database after lockout', async () => {
    const user = db.prepare("SELECT locked_until FROM users WHERE username = 'taker'").get() as any;
    expect(user.locked_until).not.toBeNull();
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('200 and clears the token cookie', async () => {
    const cookie = await login(request, 'admin', 'admin123', adminStoreCode);

    const res = await request.post('/api/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(200);
    // The Set-Cookie header must zero out the token value
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some(c => c.startsWith('token=;') || c.includes('token=; '))).toBe(true);
  });

  it('revoked token is rejected on subsequent /api/auth/me (M-27: JWT revocation)', async () => {
    const cookie = await login(request, 'admin', 'admin123', adminStoreCode);

    // Logout — token added to in-memory revocation set (cache.ts)
    await request.post('/api/auth/logout').set('Cookie', cookie);

    // Old cookie must no longer be accepted
    const res = await request.get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('401 without a token', async () => {
    const res = await request.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('200 + user payload when authenticated', async () => {
    // Use a dedicated store/user rather than the shared `admin` account.
    //
    // Reason: jwt.sign() uses second-level precision for `iat`. When tests run
    // fast enough that multiple logins for the same user happen within the same
    // second, they produce identical JWT strings. The logout tests above also
    // log in as `admin` and revoke those tokens, so a "fresh" admin login
    // within the same second yields a token that is already in the revocation
    // cache — causing a spurious 401. A dedicated user avoids this entirely.
    const regRes = await request.post('/api/auth/register').send({
      store_name: 'Me Test Store',
      username: 'meowner',
      password: 'Password1',
    });
    expect(regRes.status).toBe(201);

    const cookie = await login(request, 'meowner', 'Password1', regRes.body.store_code);
    const res = await request.get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('meowner');
    // store_logo may be null but must always be present in the payload
    expect(res.body).toHaveProperty('store_logo');
  });
});

// ── PUT /api/auth/store/password — token_version invalidation ────────────────

describe('PUT /api/auth/store/password — token_version', () => {
  it('old session cookie is invalid after password change (M-28: token_version bump)', async () => {
    // Register a dedicated store so this test does not corrupt the seeded admin
    const regRes = await request.post('/api/auth/register').send({
      store_name: 'Token Version Test Store',
      username: 'tvowner',
      password: 'Password1',
    });
    expect(regRes.status).toBe(201);

    const { store_code: sc } = regRes.body;
    const oldCookie = await login(request, 'tvowner', 'Password1', sc);

    // Change password — server increments token_version and re-issues JWT
    const changeRes = await request
      .put('/api/auth/store/password')
      .set('Cookie', oldCookie)
      .send({ current_password: 'Password1', new_password: 'NewPassword2' });
    expect(changeRes.status).toBe(200);

    // Old cookie carries the old token_version — middleware must reject it
    const meRes = await request.get('/api/auth/me').set('Cookie', oldCookie);
    expect(meRes.status).toBe(401);
  });
});
