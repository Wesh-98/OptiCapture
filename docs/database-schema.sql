-- OptiCapture SQLite schema generated from src/server/db.ts.
-- Reference snapshot for a fresh database; startup migrations remain authoritative.
-- Regenerate with: node --import tsx scripts/export-db-schema.mjs
PRAGMA foreign_keys = ON;

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    icon TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(name, store_id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

CREATE TABLE inventory (
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, external_system TEXT, external_store_id TEXT, external_category_id TEXT, external_item_id TEXT, external_sku TEXT, last_imported_at TEXT, last_exported_at TEXT, sync_status TEXT, last_verified_at TEXT, last_verified_by INTEGER, last_verified_session_id TEXT, brand TEXT,
    UNIQUE(upc, store_id),
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE scan_sessions (
    session_id TEXT PRIMARY KEY,
    otp TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'
  , otp_attempts INTEGER DEFAULT 0, expires_at TEXT, label TEXT DEFAULT NULL, scan_window_started_at TEXT);

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );

CREATE TABLE session_items (
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
    exists_in_inventory INTEGER DEFAULT 0, tag_names TEXT, sale_price TEXT, unit TEXT, device_id TEXT DEFAULT NULL, updated_at TEXT DEFAULT NULL, recent_scan_ids TEXT,
    FOREIGN KEY(session_id) REFERENCES scan_sessions(session_id)
  );

CREATE TABLE stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , street TEXT, zipcode TEXT, state TEXT, logo TEXT, address TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', status TEXT DEFAULT 'active', store_code TEXT DEFAULT NULL, city TEXT DEFAULT '');

CREATE TABLE user_stores (
    user_id INTEGER NOT NULL,
    store_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    PRIMARY KEY (user_id, store_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

CREATE TABLE "users" (
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
            token_version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(username, store_id),
            FOREIGN KEY(store_id) REFERENCES stores(id)
          );

CREATE INDEX idx_categories_store ON categories(store_id);

CREATE INDEX idx_inventory_category_store ON inventory(category_id, store_id);

CREATE UNIQUE INDEX idx_inventory_external_item_store
  ON inventory(external_system, external_item_id, store_id)
  WHERE external_item_id IS NOT NULL AND external_item_id != '';

CREATE INDEX idx_inventory_name_store ON inventory(item_name, store_id);

CREATE UNIQUE INDEX idx_inventory_number_store
    ON inventory(number, store_id)
    WHERE number IS NOT NULL AND number != '';

CREATE INDEX idx_inventory_store_updated ON inventory(store_id, updated_at DESC);

CREATE INDEX idx_logs_store_ts ON logs(store_id, timestamp DESC);

CREATE INDEX idx_scan_sessions_store_status ON scan_sessions(store_id, status, expires_at);

CREATE INDEX idx_scan_sessions_user_store ON scan_sessions(user_id, store_id, status);

CREATE INDEX idx_session_items_session_at  ON session_items(session_id, scanned_at DESC);

CREATE INDEX idx_session_items_session_upc ON session_items(session_id, upc);

CREATE INDEX idx_session_items_session_updated ON session_items(session_id, updated_at DESC, id DESC);

CREATE UNIQUE INDEX idx_stores_code ON stores(store_code);

CREATE UNIQUE INDEX idx_users_oauth
  ON users(oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL;

CREATE INDEX idx_users_store_id ON users(store_id);
