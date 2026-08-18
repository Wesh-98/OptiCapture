/**
 * tests/helpers.ts — Shared test utilities
 *
 * Centralises the repetitive scaffolding that every test file needs:
 *   - Building the Express app (createTestApp)
 *   - Looking up the random store code that db.ts generates for seeded stores
 *   - Performing a login and returning the session cookie string
 *   - Registering a brand-new store and immediately logging in as its owner
 *
 * Import order matters: this module imports db.ts and app.ts. Because
 * vitest.config.ts uses pool:'forks', each test file runs in its own process,
 * and setup.ts sets DATABASE_PATH=':memory:' before any module is imported, so
 * these imports always see a fresh in-memory database.
 */
import supertest from 'supertest';
import { createApp } from '../src/server/app.js';
import { db } from '../src/server/db.js';

// supertest(app) returns SuperAgentTest in v7 — use ReturnType so the type
// stays in sync with whatever supertest version is installed.
export type TestApp = ReturnType<typeof supertest>;

// ── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates and returns a supertest wrapper around a fresh Express app instance.
 * Call once per test file (top-level) — not inside individual tests — so all
 * tests in a file share the same in-memory database state.
 */
export function createTestApp(): TestApp {
  return supertest(createApp());
}

// ── Database helpers ─────────────────────────────────────────────────────────

/**
 * Returns the store_code for the given store id.
 * db.ts migration 9 generates a random 6-char code for every store, so tests
 * cannot hard-code it — they must query it at runtime.
 */
export function getStoreCode(storeId: number): string {
  const row = db.prepare('SELECT store_code FROM stores WHERE id = ?').get(storeId) as
    | { store_code: string }
    | undefined;
  if (!row) throw new Error(`No store found with id=${storeId}`);
  return row.store_code;
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Performs a POST /api/auth/login and returns the raw Set-Cookie header value.
 * Pass this to `.set('Cookie', cookie)` on subsequent requests.
 *
 * Throws if the login response is not 200, so test failures are surfaced early
 * with a clear message rather than a confusing 401 on the next request.
 */
export async function login(
  request: TestApp,
  username: string,
  password: string,
  storeCode?: string
): Promise<string> {
  const body: Record<string, string> = { username, password };
  if (storeCode) body.store_code = storeCode;

  const res = await request.post('/api/auth/login').send(body);
  if (res.status !== 200) {
    throw new Error(
      `login() failed — expected 200, got ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  // supertest exposes Set-Cookie as string | string[] | undefined depending on
  // how many cookies are set. Normalise to string[] — login sets exactly one.
  const raw = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!cookies.length) throw new Error('login() succeeded but no Set-Cookie header returned');
  return cookies[0];
}

// ── Store registration helper ─────────────────────────────────────────────────

export interface RegisteredStore {
  storeId: number;
  storeCode: string;
  cookie: string; // session cookie of the owner
}

/**
 * Registers a new store + owner via POST /api/auth/register and immediately
 * logs in, returning the store id, store code, and session cookie.
 *
 * Use this in multi-tenant isolation tests where you need two independent
 * stores with no shared data.
 */
export async function registerStore(
  request: TestApp,
  opts: {
    storeName: string;
    username: string;
    password?: string;
  }
): Promise<RegisteredStore> {
  const password = opts.password ?? 'Password1';

  const regRes = await request.post('/api/auth/register').send({
    store_name: opts.storeName,
    username: opts.username,
    password,
  });

  if (regRes.status !== 201) {
    throw new Error(
      `registerStore() failed — expected 201, got ${regRes.status}: ${JSON.stringify(regRes.body)}`
    );
  }

  const { store_id: storeId, store_code: storeCode } = regRes.body;
  const cookie = await login(request, opts.username, password, storeCode);

  return { storeId, storeCode, cookie };
}
