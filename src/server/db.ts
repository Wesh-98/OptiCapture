import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB lives at project root — two levels up from src/server/
const DB_PATH = path.join(__dirname, '..', '..', 'opticapture.db');
export const db = new Database(DB_PATH);
// WAL mode: allows concurrent reads while a write is in progress — critical for
// multiple phones scanning simultaneously into the same session
db.pragma('journal_mode = WAL');
// Wait up to 5 s instead of throwing SQLITE_BUSY immediately under write contention
db.pragma('busy_timeout = 5000');

// Audit log retention — delete entries older than 90 days; run on startup and daily
export function pruneAuditLogs() {
  db.prepare("DELETE FROM logs WHERE timestamp < datetime('now', '-90 days')").run();
}

// Database Initialization
// Migration version tracking
db.prepare(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`).run();

const appliedMigrations = new Set(
  (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version)
);

function runMigration(version: number, fn: () => void) {
  if (appliedMigrations.has(version)) return;
  fn();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  appliedMigrations.add(version);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    store_name TEXT DEFAULT 'Main Store',
    must_reset_password INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    icon TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(name, store_id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT,
    description TEXT,
    quantity INTEGER,
    unit TEXT,
    category_id INTEGER,
    status TEXT DEFAULT 'Active',
    sale_price REAL,
    tax_percent REAL,
    image TEXT,
    upc TEXT,
    number TEXT,
    tag_names TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(upc, store_id),
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scan_sessions (
    session_id TEXT PRIMARY KEY,
    otp TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS session_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    upc TEXT,
    quantity INTEGER DEFAULT 1,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    lookup_status TEXT DEFAULT 'unknown',
    product_name TEXT,
    brand TEXT,
    image TEXT,
    source TEXT DEFAULT 'scan_only',
    exists_in_inventory INTEGER DEFAULT 0,
    FOREIGN KEY(session_id) REFERENCES scan_sessions(session_id)
  );
`);

// Index: allow deduplication by item number per store (for imports without UPC)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_number_store
    ON inventory(number, store_id)
    WHERE number IS NOT NULL AND number != '';
`);

// user_stores junction table — multi-store access
db.exec(`
  CREATE TABLE IF NOT EXISTS user_stores (
    user_id INTEGER NOT NULL,
    store_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    PRIMARY KEY (user_id, store_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );
`);

// Migrate existing users into user_stores (runs once — INSERT OR IGNORE skips duplicates)
db.prepare(`
  INSERT OR IGNORE INTO user_stores (user_id, store_id, role)
  SELECT id, store_id, role FROM users WHERE store_id != 0
`).run();

// Schema migrations for stores table
runMigration(1, () => {
  ['street', 'zipcode', 'state', 'logo'].forEach(col => {
    const exists = db.prepare(`PRAGMA table_info(stores)`).all().some((c: any) => c.name === col);
    if (!exists) db.prepare(`ALTER TABLE stores ADD COLUMN ${col} TEXT`).run();
  });
});

// Schema migrations for session_items table
runMigration(2, () => {
  ['tag_names', 'sale_price', 'unit'].forEach(col => {
    const exists = db.prepare(`PRAGMA table_info(session_items)`).all().some((c: any) => c.name === col);
    if (!exists) db.prepare(`ALTER TABLE session_items ADD COLUMN ${col} TEXT`).run();
  });
});

// Schema migrations for scan_sessions table — add OTP security columns
runMigration(3, () => {
  try { db.prepare("ALTER TABLE scan_sessions ADD COLUMN otp_attempts INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE scan_sessions ADD COLUMN expires_at TEXT").run(); } catch {}
});

// Schema migrations for users table — add account lockout columns
runMigration(4, () => {
  try { db.prepare("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL").run(); } catch {}
});

// Seed sentinel store (id=0) for superadmin — must exist before superadmin user is inserted
const checkHQ = db.prepare('SELECT id FROM stores WHERE id = 0').get();
if (!checkHQ) {
  db.prepare("INSERT INTO stores (id, name) VALUES (0, 'OptiCapture HQ')").run();
}

// Seed store
const checkStore = db.prepare('SELECT id FROM stores WHERE id = 1').get();
if (!checkStore) {
  db.prepare("INSERT INTO stores (id, name) VALUES (1, 'OptiMart Downtown')").run();
}

// Seed demo accounts only in development (C-2: never seed known credentials in production)
if (process.env.NODE_ENV !== 'production') {
  const checkUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!checkUser) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('admin', hashedPassword, 'owner', 1, 'OptiMart Downtown');

    const takerPass = bcrypt.hashSync('taker123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('taker', takerPass, 'taker', 1, 'OptiMart Downtown');
  }

  const checkSuper = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
  if (!checkSuper) {
    const superPass = bcrypt.hashSync('superadmin123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('superadmin', superPass, 'superadmin', 0, 'OptiCapture HQ');
  }
}

// Seed default categories — always upsert icon so image paths stay current
const upsertCat = db.prepare(`
  INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)
  ON CONFLICT(name, store_id) DO UPDATE SET icon = excluded.icon
`);
const seedCats: [string, string][] = [
  ['Soft Drinks',              '/icons/soft-drinks.png'],
  ['Snacks',                 '/icons/snack.png'],
  ['Candy',                  '/icons/candy.png'],
  ['Tobacco',                'Cigarette'],
  ['Household Items',        '/icons/household-items.png'],
  ['Automotive',             '/icons/automotive.png'],
  ['Cold Coffee',            '/icons/cold-coffee.png'],
  ['Dairy',                  '/icons/dairy.png'],
  ['Electronics',            '/icons/electronics.png'],
  ['Wine & Beer',            '/icons/beer-wine.png'],
  ['Pets',                   '/icons/pet-food.png'],
  ['Pastries',               '/icons/pastry.png'],
  ['Newspapers',             '/icons/newspaper.png'],
  ['Energy Drinks',          '/icons/energy-drink.png'],
  ['Frozen Food',           '/icons/frozen-food.png'],
  ['Grocery',                '/icons/grocery.png'],
  ['Gum & Mints',            '/icons/gum-mint.png'],
  ['Juices, Teas, Lemonades',  '/icons/juice-tea-lemonade.png'],
  ['Non-Tobacco',            '/icons/non-tobacco.png'],
  ['Nutrition Snacks',     '/icons/nutrition-snacks.png'],
  ['Personal Care',          '/icons/personal-care.png'],
  ['Sports Drinks',          '/icons/sports-drink.png'],
  ['Water',                  '/icons/water.png'],
  ['Scratch Tickets',        '/icons/scratch-tickets.png'],
  ['Phone Cards',            '/icons/phone-cards.png'],
];
for (const [name, icon] of seedCats) upsertCat.run(name, icon, 1);

// Migrate stores table — add columns if missing
runMigration(5, () => {
  const storesCols = new Set((db.prepare('PRAGMA table_info(stores)').all() as any[]).map((c: any) => c.name));
  if (!storesCols.has('address')) db.prepare("ALTER TABLE stores ADD COLUMN address TEXT DEFAULT ''").run();
  if (!storesCols.has('phone'))   db.prepare("ALTER TABLE stores ADD COLUMN phone TEXT DEFAULT ''").run();
  if (!storesCols.has('email'))   db.prepare("ALTER TABLE stores ADD COLUMN email TEXT DEFAULT ''").run();
  if (!storesCols.has('status'))  db.prepare("ALTER TABLE stores ADD COLUMN status TEXT DEFAULT 'active'").run();
});

// Migrate users table — add OAuth columns if missing
runMigration(6, () => {
  const usersCols = new Set((db.prepare('PRAGMA table_info(users)').all() as any[]).map((c: any) => c.name));
  if (!usersCols.has('oauth_provider')) db.prepare("ALTER TABLE users ADD COLUMN oauth_provider TEXT DEFAULT NULL").run();
  if (!usersCols.has('oauth_id'))       db.prepare("ALTER TABLE users ADD COLUMN oauth_id TEXT DEFAULT NULL").run();
  if (!usersCols.has('email'))          db.prepare("ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL").run();
});

// Migrate scan_sessions table — add label column for named drafts
runMigration(7, () => {
  const cols = (db.prepare('PRAGMA table_info(scan_sessions)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('label')) db.prepare("ALTER TABLE scan_sessions ADD COLUMN label TEXT DEFAULT NULL").run();
});

// Migration 8: expire legacy sessions that have no expires_at (created before migration 3)
// Sets them to expired so they no longer appear in the active sessions list
runMigration(8, () => {
  db.prepare(`
    UPDATE scan_sessions
    SET expires_at = datetime('now', '-1 second')
    WHERE expires_at IS NULL AND status IN ('active', 'draft')
  `).run();
});

// Migration 9: add store_code to stores — unique 6-char code used at login
runMigration(9, () => {
  const cols = (db.prepare('PRAGMA table_info(stores)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('store_code')) {
    db.prepare('ALTER TABLE stores ADD COLUMN store_code TEXT DEFAULT NULL').run();
    // Backfill existing stores with unique codes
    const stores = db.prepare('SELECT id FROM stores').all() as any[];
    const usedCodes = new Set<string>();
    const genUnique = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code: string;
      do {
        const bytes = randomBytes(6);
        code = '';
        for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
      } while (usedCodes.has(code));
      usedCodes.add(code);
      return code;
    };
    const upd = db.prepare('UPDATE stores SET store_code = ? WHERE id = ?');
    for (const s of stores) upd.run(genUnique(), s.id);
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_code ON stores(store_code)').run();
  }
});

// Migration 10: recreate users table with UNIQUE(username, store_id) instead of UNIQUE(username)
// This enables store-scoped usernames — two different stores can now have a user called "admin"
runMigration(10, () => {
  // Disable FK enforcement so DROP TABLE users isn't blocked by user_stores referencing it
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password TEXT,
        role TEXT NOT NULL DEFAULT 'owner',
        store_id INTEGER,
        store_name TEXT,
        must_reset_password INTEGER NOT NULL DEFAULT 0,
        email TEXT,
        oauth_provider TEXT,
        oauth_id TEXT,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        UNIQUE(username, store_id)
      );
      INSERT OR IGNORE INTO users_new
        SELECT id, username, password, role, store_id, store_name,
               COALESCE(must_reset_password, 0), email,
               oauth_provider, oauth_id, failed_login_attempts, locked_until
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

runMigration(11, () => {
  const cols = (db.prepare('PRAGMA table_info(session_items)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('device_id')) {
    db.prepare("ALTER TABLE session_items ADD COLUMN device_id TEXT DEFAULT NULL").run();
  }
});

runMigration(12, () => {
  const cols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('token_version')) {
    db.prepare("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1").run();
  }
});

runMigration(13, () => {
  const cols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('must_reset_password')) {
    db.prepare("ALTER TABLE users ADD COLUMN must_reset_password INTEGER NOT NULL DEFAULT 0").run();
  }
});

db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users(oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL
`).run();

// Performance indexes
db.prepare('CREATE INDEX IF NOT EXISTS idx_session_items_session_upc ON session_items(session_id, upc)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_session_items_session_at  ON session_items(session_id, scanned_at DESC)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_inventory_upc_store        ON inventory(upc, store_id)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_scan_sessions_store_status ON scan_sessions(store_id, status, expires_at)').run();

// One-time migration: convert uc?export=view Drive URLs → server proxy path
db.prepare(`
  UPDATE inventory
  SET image = '/api/drive-image/' || SUBSTR(image, INSTR(image, 'id=') + 3)
  WHERE image LIKE '%drive.google.com/uc?export=view%'
    AND image NOT LIKE '%/api/drive-image/%'
`).run();

// One-time migration: convert /file/d/FILE_ID/view sharing links → server proxy path
db.prepare(`
  UPDATE inventory
  SET image = '/api/drive-image/' ||
              SUBSTR(image, INSTR(image, '/file/d/') + 8,
                INSTR(SUBSTR(image, INSTR(image, '/file/d/') + 8), '/') - 1)
  WHERE image LIKE '%drive.google.com/file/d/%'
    AND image NOT LIKE '%/api/drive-image/%'
`).run();

// One-time migration: convert existing thumbnail?id= URLs → server proxy path
db.prepare(`
  UPDATE inventory
  SET image = '/api/drive-image/' || SUBSTR(image, INSTR(image, 'thumbnail?id=') + 13,
                CASE WHEN INSTR(SUBSTR(image, INSTR(image, 'thumbnail?id=') + 13), '&') > 0
                     THEN INSTR(SUBSTR(image, INSTR(image, 'thumbnail?id=') + 13), '&') - 1
                     ELSE LENGTH(image) END)
  WHERE image LIKE '%drive.google.com/thumbnail?id=%'
    AND image NOT LIKE '%/api/drive-image/%'
`).run();

// Run after all table creation / migrations so the logs table is guaranteed to exist
pruneAuditLogs();
setInterval(pruneAuditLogs, 24 * 60 * 60 * 1000);
