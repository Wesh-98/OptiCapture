import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Build the same schema as a fresh app database without touching local data.
process.env.DATABASE_PATH = ':memory:';
process.env.ALLOW_DEMO_SEED = 'false';
process.env.NODE_ENV = 'production';

const { db } = await import('../src/server/db.ts');
const objects = db
  .prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'view', 'trigger')
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY CASE type
      WHEN 'table' THEN 0
      WHEN 'index' THEN 1
      WHEN 'view' THEN 2
      ELSE 3
    END, name
  `)
  .all();

const schema = [
  '-- OptiCapture SQLite schema generated from src/server/db.ts.',
  '-- Reference snapshot for a fresh database; startup migrations remain authoritative.',
  '-- Regenerate with: node --import tsx scripts/export-db-schema.mjs',
  'PRAGMA foreign_keys = ON;',
  '',
  ...objects.flatMap(({ sql }) => [`${sql.trim().replace(/;$/, '')};`, '']),
].join('\n');

db.close();

// The exported SQL must be usable on its own as an empty database schema.
const checkDb = new Database(':memory:');
checkDb.exec(schema);
const integrity = checkDb.pragma('integrity_check', { simple: true });
const violations = checkDb.pragma('foreign_key_check');
checkDb.close();
if (integrity !== 'ok' || violations.length > 0) {
  throw new Error('Generated schema failed SQLite validation');
}

const outputPath = fileURLToPath(new URL('../docs/database-schema.sql', import.meta.url));
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== schema) {
    throw new Error('docs/database-schema.sql is out of date; regenerate it');
  }
} else {
  writeFileSync(outputPath, schema);
}

console.log(`${objects.length} schema objects verified`);
