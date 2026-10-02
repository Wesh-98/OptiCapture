// Online backup of the OptiCapture SQLite database.
//
// Uses SQLite's backup API, so it is safe while the server is running and the copy includes
// changes still in the -wal file. Each copy is integrity-checked before older ones are pruned.
//
//   npm run db:backup
//
// Environment:
//   DATABASE_PATH  database to back up (default: opticapture.db in the project root)
//   BACKUP_DIR     where copies go (default: backups/ in the project root)
//   BACKUP_KEEP    how many backups to keep, newest first (default: 14; 0 keeps all)
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, process.env.DATABASE_PATH || 'opticapture.db');
const backupDir = path.resolve(root, process.env.BACKUP_DIR || 'backups');
const keep = Number.parseInt(process.env.BACKUP_KEEP ?? '14', 10);
const PREFIX = 'opticapture-';

if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });

// UTC timestamp, e.g. opticapture-20261002-174658.db; names sort oldest to newest.
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const target = path.join(backupDir, `${PREFIX}${stamp}.db`);

const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();

// The copy inherits WAL mode; switch it to a rollback journal so each backup is one
// self-contained file with no -wal/-shm siblings.
const copy = new Database(target);
copy.pragma('journal_mode = DELETE');
const integrity = copy.pragma('integrity_check', { simple: true });
const migration = copy.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
copy.close();
if (integrity !== 'ok') {
  console.error(`Backup failed its integrity check (${integrity}); kept for inspection: ${target}`);
  process.exit(1);
}
console.log(`Backed up ${source}\n      to ${target} (integrity ok, schema version ${migration})`);

// Prune only files this script created, newest first, never the one just written.
if (keep > 0) {
  const ours = readdirSync(backupDir)
    .filter(name => name.startsWith(PREFIX) && /^opticapture-\d{8}-\d{6}\.db$/.test(name))
    .sort()
    .reverse();
  for (const name of ours.slice(keep)) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(path.join(backupDir, name + suffix), { force: true });
    }
    console.log(`Removed old backup ${name}`);
  }
}
