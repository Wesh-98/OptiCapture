import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/server/db.js';
import { pendingOAuth } from '../src/server/cache.js';
import { googleClient } from '../src/server/middleware.js';
import { createTestApp } from './helpers.js';

const request = createTestApp();

let uniqueId = 0;

function nextName(prefix: string): string {
  uniqueId += 1;
  return `${prefix} ${uniqueId}`;
}

beforeEach(() => {
  pendingOAuth.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  pendingOAuth.clear();
});

describe('Google OAuth start + pending profile', () => {
  it('sets a CSRF cookie and redirects to Google auth', async () => {
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc123';
    const generateSpy = vi.spyOn(googleClient, 'generateAuthUrl').mockReturnValue(authUrl);

    const res = await request.get('/api/auth/google').query({ intent: 'signup' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(authUrl);
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: 'offline',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
      })
    );

    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some(cookie => cookie.startsWith('oauth_state='))).toBe(true);
    expect(cookies.some(cookie => cookie.toLowerCase().includes('httponly'))).toBe(true);
    expect(cookies.some(cookie => cookie.toLowerCase().includes('secure'))).toBe(true);
  });

  it('returns pending OAuth profiles and expires old ones', async () => {
    pendingOAuth.set('live-key', {
      googleId: 'google-live',
      email: 'live@example.com',
      name: 'Live User',
      expiresAt: Date.now() + 60_000,
    });
    pendingOAuth.set('expired-key', {
      googleId: 'google-expired',
      email: 'expired@example.com',
      name: 'Expired User',
      expiresAt: Date.now() - 1,
    });

    const liveRes = await request.get('/api/auth/google/pending').query({ key: 'live-key' });
    expect(liveRes.status).toBe(200);
    expect(liveRes.body).toEqual({
      email: 'live@example.com',
      name: 'Live User',
    });

    const expiredRes = await request.get('/api/auth/google/pending').query({ key: 'expired-key' });
    expect(expiredRes.status).toBe(404);
    expect(expiredRes.body.error).toMatch(/expired/i);
    expect(pendingOAuth.has('expired-key')).toBe(false);
  });
});

describe('Google OAuth callback', () => {
  it('rejects callbacks with an invalid or missing state nonce', async () => {
    const res = await request.get('/api/auth/google/callback').query({
      code: 'oauth-code',
      state: 'nonce-1',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=oauth_failed');
  });

  it('stores new Google users as pending signups and redirects to signup', async () => {
    vi.spyOn(googleClient, 'getToken').mockResolvedValue({
      tokens: { id_token: 'id-token' },
    } as any);
    vi.spyOn(googleClient, 'setCredentials').mockImplementation(() => {});
    vi.spyOn(googleClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-new-user',
        email: 'new.user@example.com',
        name: 'New Google User',
        email_verified: true,
      }),
    } as any);

    const res = await request
      .get('/api/auth/google/callback')
      .set('Cookie', 'oauth_state=nonce-2:signup')
      .query({ code: 'oauth-code', state: 'nonce-2' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/signup\?pending=/);

    const key = res.headers.location.split('pending=')[1];
    expect(key).toBeTruthy();
    expect(pendingOAuth.get(key)).toMatchObject({
      googleId: 'google-new-user',
      email: 'new.user@example.com',
      name: 'New Google User',
    });
  });

  it('logs in existing linked Google users and redirects them into the app', async () => {
    const storeName = nextName('OAuth Linked Store');
    const username = nextName('oauthlinked').replaceAll(' ', '').toLowerCase();

    const registerRes = await request.post('/api/auth/register').send({
      store_name: storeName,
      username,
      password: 'Password1',
    });
    expect(registerRes.status).toBe(201);

    const user = db
      .prepare('SELECT id FROM users WHERE store_id = ?')
      .get(registerRes.body.store_id) as { id: number } | undefined;
    expect(user).toBeDefined();

    db.prepare(
      "UPDATE users SET oauth_provider = 'google', oauth_id = ?, password = NULL WHERE id = ?"
    ).run('google-linked-user', user!.id);

    vi.spyOn(googleClient, 'getToken').mockResolvedValue({
      tokens: { id_token: 'id-token' },
    } as any);
    vi.spyOn(googleClient, 'setCredentials').mockImplementation(() => {});
    vi.spyOn(googleClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-linked-user',
        email: 'linked@example.com',
        name: 'Linked User',
        email_verified: true,
      }),
    } as any);

    const res = await request
      .get('/api/auth/google/callback')
      .set('Cookie', 'oauth_state=nonce-3:login')
      .query({ code: 'oauth-code', state: 'nonce-3' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some(cookie => cookie.startsWith('token='))).toBe(true);
  });

  it('redirects suspended Google-linked store users back to login', async () => {
    const storeName = nextName('OAuth Suspended Store');
    const username = nextName('oauthsuspended').replaceAll(' ', '').toLowerCase();

    const registerRes = await request.post('/api/auth/register').send({
      store_name: storeName,
      username,
      password: 'Password1',
    });
    expect(registerRes.status).toBe(201);

    const user = db
      .prepare('SELECT id FROM users WHERE store_id = ?')
      .get(registerRes.body.store_id) as { id: number } | undefined;
    expect(user).toBeDefined();

    db.prepare(
      "UPDATE users SET oauth_provider = 'google', oauth_id = ?, password = NULL WHERE id = ?"
    ).run('google-suspended-user', user!.id);
    db.prepare("UPDATE stores SET status = 'suspended' WHERE id = ?").run(
      registerRes.body.store_id
    );

    vi.spyOn(googleClient, 'getToken').mockResolvedValue({
      tokens: { id_token: 'id-token' },
    } as any);
    vi.spyOn(googleClient, 'setCredentials').mockImplementation(() => {});
    vi.spyOn(googleClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-suspended-user',
        email: 'suspended@example.com',
        name: 'Suspended User',
        email_verified: true,
      }),
    } as any);

    const res = await request
      .get('/api/auth/google/callback')
      .set('Cookie', 'oauth_state=nonce-4:login')
      .query({ code: 'oauth-code', state: 'nonce-4' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=suspended');
  });
});

describe('OAuth-backed registration', () => {
  it('registers a new store from a pending Google signup and clears the pending key', async () => {
    pendingOAuth.set('oauth-signup-key', {
      googleId: 'google-register-user',
      email: 'oauth.register@example.com',
      name: 'OAuth Register User',
      expiresAt: Date.now() + 60_000,
    });

    const res = await request.post('/api/auth/register').send({
      store_name: nextName('OAuth Register Store'),
      username: nextName('oauthregister').replaceAll(' ', '').toLowerCase(),
      city: 'Boston',
      oauth_key: 'oauth-signup-key',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      message: 'Store registered',
      redirect: '/',
    });
    expect(pendingOAuth.has('oauth-signup-key')).toBe(false);

    const createdUser = db
      .prepare('SELECT oauth_provider, oauth_id, email FROM users WHERE store_id = ?')
      .get(res.body.store_id) as any;
    expect(createdUser).toMatchObject({
      oauth_provider: 'google',
      oauth_id: 'google-register-user',
      email: 'oauth.register@example.com',
    });

    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some(cookie => cookie.startsWith('token='))).toBe(true);
  });

  it('rejects expired OAuth signup keys and invalid city values', async () => {
    pendingOAuth.set('expired-oauth-key', {
      googleId: 'google-expired-signup',
      email: 'expired.signup@example.com',
      name: 'Expired Signup User',
      expiresAt: Date.now() - 1,
    });

    const expiredRes = await request.post('/api/auth/register').send({
      store_name: nextName('Expired OAuth Store'),
      username: nextName('expiredoauth').replaceAll(' ', '').toLowerCase(),
      oauth_key: 'expired-oauth-key',
    });
    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.error).toMatch(/Google session expired/i);

    const invalidCityRes = await request.post('/api/auth/register').send({
      store_name: nextName('Invalid City Store'),
      username: nextName('invalidcity').replaceAll(' ', '').toLowerCase(),
      password: 'Password1',
      city: 'x'.repeat(101),
    });
    expect(invalidCityRes.status).toBe(400);
    expect(invalidCityRes.body.error).toMatch(/City\/Town/i);
  });
});
