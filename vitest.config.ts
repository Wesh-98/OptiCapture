/**
 * vitest.config.ts
 *
 * Kept intentionally separate from vite.config.ts because the two configs
 * serve different runtimes (browser build vs Node test runner) and mixing them
 * causes Vite to apply browser-oriented transforms to server-side test files.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test FILE runs in its own forked Node.js process.
    //
    // 'forks' is the right choice here for two reasons:
    //   1. better-sqlite3 is a native addon; native addons can be unreliable
    //      inside worker_threads. Plain child processes have no such issue.
    //   2. Each fork loads its own fresh module cache, so the DATABASE_PATH
    //      env var set in setupFiles takes effect before db.ts is ever imported,
    //      giving each test file a truly isolated in-memory SQLite database.
    pool: 'forks',

    // Each fork loads better-sqlite3 plus the whole Express app, so the default
    // (one fork per CPU) can exhaust memory on an 8-core dev box. When a fork is
    // OOM-killed vitest still reports the surviving files as passing, so the run
    // exits non-zero with an entire test file silently missing from coverage.
    // Capping concurrency keeps peak memory bounded and the run deterministic.
    maxWorkers: 2,

    // Runs before every test file, inside the forked process.
    // Sets DATABASE_PATH and JWT_SECRET before any modules are loaded.
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Run in Node — no jsdom/browser globals needed for API integration tests.
    environment: 'node',

    // Coverage using V8's built-in instrumentation (zero-config, no Babel).
    // Include backend code plus scan-related frontend helpers that are safe to
    // exercise in the current Node-based test harness. Full interactive hook
    // and component tests would still need a browser-like environment.
    coverage: {
      provider: 'v8',
      include: [
        'src/server/**',
        'src/hooks/useScanSession.ts',
        'src/hooks/useMobileScan.ts',
        'src/hooks/useHardwareScanner.ts',
        'src/lib/mobileScanScanner.ts',
      ],
      exclude: ['src/server/db.ts'], // migration code; hard to meaningfully unit test
    },
  },
});
