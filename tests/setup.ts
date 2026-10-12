/**
 * tests/setup.ts — Global test environment bootstrap
 *
 * Vitest runs this file inside each forked worker process, before any test
 * module is imported. Setting env vars here guarantees that db.ts sees them
 * on its very first import (module-level side effects run once per process).
 *
 * Two invariants this file enforces:
 *   - DATABASE_PATH=':memory:'  → better-sqlite3 opens an in-memory database.
 *     Every worker gets a blank slate; no test can pollute another test file's
 *     database.
 *   - JWT_SECRET is a fixed test string so tokens signed in one part of a
 *     test are verifiable in another without spinning up a real secret manager.
 */
import path from 'node:path';
import { TEST_UPLOADS_ROOT } from './global-setup.js';

// Uploads go to a throwaway folder per worker; tests/global-setup.ts removes them all when
// the run ends. They used to land in the project's real uploads/ folder and stay there.
process.env.UPLOADS_DIR = path.join(TEST_UPLOADS_ROOT, String(process.pid));

// In-memory SQLite — isolated per worker process (see vitest.config.ts pool: 'forks')
process.env.DATABASE_PATH = ':memory:';

// Fixed secret for JWT signing during tests — never use in production
process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters-long!!';

// Disable demo seed guard so the seeded admin/taker/superadmin accounts are
// created in the in-memory db (db.ts only seeds when NODE_ENV !== 'production')
process.env.NODE_ENV = 'test';
