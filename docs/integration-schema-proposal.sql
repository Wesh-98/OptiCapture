-- DESIGN PROPOSAL ONLY. Do not apply to a live OptiCapture database.
-- Additive SQLite schema for the initial integration plan, after the current schema.
-- The existing platform remains authoritative for users, stores, and live inventory.
-- Existing table columns are unchanged; one composite index is added to scan_sessions.
-- Two triggers make scan_events append-only.
-- Timestamps are UTC 'YYYY-MM-DD HH:MM:SS' (the datetime('now') form); CHECKs reject other formats.
-- Implementation needs numbered migrations and backfills.

-- Redundant with the session PK for lookup, but required as a composite FK target
-- so a count commit cannot claim a different store from its scan session.
CREATE UNIQUE INDEX idx_scan_sessions_id_store ON scan_sessions(session_id, store_id);

CREATE TABLE integration_sources (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (created_at IS datetime(created_at)),
  UNIQUE (issuer, audience)
);

CREATE TABLE store_external_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  external_store_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (created_at IS datetime(created_at)),
  UNIQUE (source_id, external_store_id),
  UNIQUE (source_id, store_id),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE external_user_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  display_name TEXT,
  last_seen_at TEXT CHECK (last_seen_at IS datetime(last_seen_at)),
  UNIQUE (source_id, external_user_id),
  UNIQUE (source_id, user_id),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Every SSO-launched store access, including external superadmins, is an explicit
-- per-store grant. The launch service creates or refreshes the matching user_stores
-- row; role alone never grants store access. 'auditor' is the read-only role for
-- external superadmins and must never be stored as 'superadmin', which requireOwner
-- treats as full owner access.
CREATE TABLE sso_store_grants (
  source_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  external_role TEXT NOT NULL CHECK (external_role != ''),
  granted_role TEXT NOT NULL CHECK (granted_role IN ('owner', 'taker', 'auditor')),
  created_membership INTEGER NOT NULL CHECK (created_membership IN (0, 1)),
  first_granted_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (first_granted_at IS datetime(first_granted_at)),
  last_granted_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (last_granted_at IS datetime(last_granted_at)),
  expires_at TEXT NOT NULL CHECK (expires_at IS datetime(expires_at)),
  revoked_at TEXT CHECK (revoked_at IS datetime(revoked_at)),
  PRIMARY KEY (source_id, user_id, store_id),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (source_id, store_id) REFERENCES store_external_mappings(source_id, store_id),
  FOREIGN KEY (source_id, user_id) REFERENCES external_user_identities(source_id, user_id)
);

CREATE TABLE sso_launch_receipts (
  source_id TEXT NOT NULL,
  token_id_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL CHECK (issued_at IS datetime(issued_at)),
  expires_at TEXT NOT NULL CHECK (expires_at IS datetime(expires_at)),
  consumed_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (consumed_at IS datetime(consumed_at)),
  PRIMARY KEY (source_id, token_id_hash),
  CHECK (expires_at > issued_at),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (source_id, user_id, store_id) REFERENCES sso_store_grants(source_id, user_id, store_id),
  FOREIGN KEY (user_id, store_id) REFERENCES user_stores(user_id, store_id)
);

CREATE TABLE catalog_imports (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  imported_by INTEGER,
  artifact_uri TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  source_exported_at TEXT CHECK (source_exported_at IS datetime(source_exported_at)),
  started_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (started_at IS datetime(started_at)),
  completed_at TEXT CHECK (completed_at IS datetime(completed_at)),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'completed', 'partial', 'failed')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  idempotency_key TEXT,
  UNIQUE (source_id, store_id, idempotency_key),
  UNIQUE (id, store_id),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (imported_by) REFERENCES users(id),
  FOREIGN KEY (source_id, store_id) REFERENCES store_external_mappings(source_id, store_id)
);

CREATE TABLE catalog_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  external_item_id TEXT,
  inventory_id INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('inserted', 'updated', 'rejected')),
  message TEXT,
  UNIQUE (import_id, row_number),
  FOREIGN KEY (import_id) REFERENCES catalog_imports(id),
  FOREIGN KEY (inventory_id) REFERENCES inventory(id)
);

-- A scanning device seen in a session, and the user it is bound to. Binding happens
-- through the phone's authenticated app/SSO cookie or by an admin assigning the
-- device. The service must verify store membership at bind time; these history rows
-- reference users, not user_stores, so revoking a membership is never blocked.
CREATE TABLE session_devices (
  session_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK (device_id != ''),
  store_id INTEGER NOT NULL,
  user_id INTEGER,
  binding TEXT NOT NULL DEFAULT 'unbound'
    CHECK (binding IN ('unbound', 'authenticated', 'admin_assigned')),
  bound_by INTEGER,
  bound_at TEXT CHECK (bound_at IS datetime(bound_at)),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (first_seen_at IS datetime(first_seen_at)),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (last_seen_at IS datetime(last_seen_at)),
  PRIMARY KEY (session_id, device_id),
  CHECK ((binding = 'unbound') = (user_id IS NULL)),
  CHECK ((binding = 'unbound') = (bound_at IS NULL)),
  CHECK ((binding = 'admin_assigned') = (bound_by IS NOT NULL)),
  FOREIGN KEY (session_id, store_id) REFERENCES scan_sessions(session_id, store_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bound_by) REFERENCES users(id)
);

-- Append-only record of every change to staged quantities. session_items stays the
-- mutable running total; for each (session_id, upc) the sum of quantity_delta must
-- equal the staged quantity. actor_user_id is the device's bound user (scan) or the
-- editing user (adjust/remove) at the time of the event and is never rewritten.
CREATE TABLE scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('scan', 'adjust', 'remove')),
  upc TEXT NOT NULL CHECK (upc != ''),
  session_item_id INTEGER,
  quantity_delta INTEGER NOT NULL,
  device_id TEXT,
  actor_user_id INTEGER,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (occurred_at IS datetime(occurred_at)),
  CHECK (event_type != 'scan' OR
    (quantity_delta > 0 AND (device_id IS NOT NULL OR actor_user_id IS NOT NULL))),
  CHECK (event_type != 'adjust' OR (quantity_delta != 0 AND actor_user_id IS NOT NULL)),
  CHECK (event_type != 'remove' OR (quantity_delta <= 0 AND actor_user_id IS NOT NULL)),
  FOREIGN KEY (session_id, store_id) REFERENCES scan_sessions(session_id, store_id),
  FOREIGN KEY (session_id, device_id) REFERENCES session_devices(session_id, device_id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TRIGGER scan_events_no_update BEFORE UPDATE ON scan_events
BEGIN
  SELECT RAISE(ABORT, 'scan_events is append-only');
END;

CREATE TRIGGER scan_events_no_delete BEFORE DELETE ON scan_events
BEGIN
  SELECT RAISE(ABORT, 'scan_events is append-only');
END;

CREATE TABLE count_commits (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL,
  committed_by INTEGER NOT NULL,
  catalog_import_id TEXT,
  -- Highest scan_events.id frozen into this snapshot; later events are excluded.
  last_scan_event_id INTEGER,
  committed_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (committed_at IS datetime(committed_at)),
  UNIQUE (id, store_id),
  FOREIGN KEY (session_id, store_id) REFERENCES scan_sessions(session_id, store_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (committed_by) REFERENCES users(id),
  FOREIGN KEY (catalog_import_id, store_id) REFERENCES catalog_imports(id, store_id)
);

CREATE TABLE count_commit_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  source_session_item_id INTEGER,
  inventory_id INTEGER,
  external_system TEXT,
  external_item_id TEXT,
  external_sku TEXT,
  upc TEXT,
  item_name TEXT NOT NULL,
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  delta_quantity INTEGER GENERATED ALWAYS AS (counted_quantity - previous_quantity) STORED,
  counted_by_user_id INTEGER,
  device_id TEXT,
  first_scanned_at TEXT CHECK (first_scanned_at IS datetime(first_scanned_at)),
  last_scanned_at TEXT CHECK (last_scanned_at IS datetime(last_scanned_at)),
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('mapped', 'unmapped')),
  CHECK (mapping_status != 'mapped' OR
    (external_system IS NOT NULL AND external_system != '' AND
     external_item_id IS NOT NULL AND external_item_id != '')),
  UNIQUE (commit_id, line_number),
  UNIQUE (commit_id, source_session_item_id),
  UNIQUE (id, commit_id),
  FOREIGN KEY (commit_id) REFERENCES count_commits(id),
  FOREIGN KEY (inventory_id) REFERENCES inventory(id),
  FOREIGN KEY (counted_by_user_id) REFERENCES users(id),
  FOREIGN KEY (external_system) REFERENCES integration_sources(id)
);

-- Per-line breakdown of who counted what, aggregated from scan_events at commit time.
-- 'device_binding' attributes an unbound device's events to the user that device was
-- bound to by commit time. The service must make net_quantity sum to the line's
-- counted_quantity, and sets count_commit_lines.counted_by_user_id only when the line
-- has exactly one attributed contributor.
CREATE TABLE count_line_contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_line_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  device_id TEXT,
  attribution TEXT NOT NULL CHECK (attribution IN ('event', 'device_binding', 'unattributed')),
  net_quantity INTEGER NOT NULL,
  event_count INTEGER NOT NULL CHECK (event_count > 0),
  first_event_at TEXT NOT NULL CHECK (first_event_at IS datetime(first_event_at)),
  last_event_at TEXT NOT NULL CHECK (last_event_at IS datetime(last_event_at)),
  CHECK ((attribution = 'unattributed') = (actor_user_id IS NULL)),
  CHECK (attribution != 'unattributed' OR device_id IS NOT NULL),
  FOREIGN KEY (count_line_id) REFERENCES count_commit_lines(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE count_exports (
  id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  generated_by INTEGER NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (generated_at IS datetime(generated_at)),
  format TEXT NOT NULL CHECK (format IN ('xlsx', 'csv', 'json')),
  artifact_uri TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'delivered', 'delivery_failed')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  UNIQUE (commit_id, source_id, attempt_number),
  UNIQUE (id, commit_id),
  UNIQUE (id, store_id),
  FOREIGN KEY (commit_id, store_id) REFERENCES count_commits(id, store_id),
  FOREIGN KEY (source_id) REFERENCES integration_sources(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (generated_by) REFERENCES users(id),
  FOREIGN KEY (source_id, store_id) REFERENCES store_external_mappings(source_id, store_id)
);

CREATE TABLE count_export_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  count_line_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  external_item_id TEXT NOT NULL CHECK (external_item_id != ''),
  external_sku TEXT,
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  delta_quantity INTEGER GENERATED ALWAYS AS (counted_quantity - previous_quantity) STORED,
  UNIQUE (export_id, row_number),
  UNIQUE (export_id, count_line_id),
  FOREIGN KEY (export_id, commit_id) REFERENCES count_exports(id, commit_id),
  FOREIGN KEY (count_line_id, commit_id) REFERENCES count_commit_lines(id, commit_id)
);

CREATE TABLE reconciliation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  export_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  reviewed_by INTEGER,
  external_batch_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (received_at IS datetime(received_at)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'partial', 'failed', 'needs_review')),
  FOREIGN KEY (export_id, store_id) REFERENCES count_exports(id, store_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE reconciliation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  count_line_id INTEGER NOT NULL,
  export_line_id INTEGER,
  result TEXT NOT NULL
    CHECK (result IN ('matched', 'mismatch', 'rejected', 'unmapped', 'missing')),
  applied_quantity INTEGER CHECK (applied_quantity IS NULL OR applied_quantity >= 0),
  details TEXT,
  UNIQUE (run_id, count_line_id),
  FOREIGN KEY (run_id) REFERENCES reconciliation_runs(id),
  FOREIGN KEY (count_line_id) REFERENCES count_commit_lines(id),
  FOREIGN KEY (export_line_id) REFERENCES count_export_lines(id)
);

CREATE INDEX idx_store_external_mappings_store ON store_external_mappings(store_id);
CREATE INDEX idx_external_user_identities_user ON external_user_identities(user_id);
CREATE INDEX idx_sso_store_grants_store ON sso_store_grants(store_id);
CREATE INDEX idx_sso_store_grants_user_store ON sso_store_grants(user_id, store_id);
CREATE INDEX idx_sso_launch_receipts_expires ON sso_launch_receipts(expires_at);
CREATE INDEX idx_session_devices_user ON session_devices(user_id);
CREATE INDEX idx_scan_events_session_upc ON scan_events(session_id, upc, id);
CREATE INDEX idx_scan_events_session_device ON scan_events(session_id, device_id, id);
CREATE INDEX idx_scan_events_actor ON scan_events(actor_user_id);
CREATE UNIQUE INDEX idx_count_line_contributors_key
  ON count_line_contributors(count_line_id, COALESCE(actor_user_id, -1), COALESCE(device_id, ''));
CREATE INDEX idx_count_line_contributors_actor ON count_line_contributors(actor_user_id);
CREATE INDEX idx_catalog_imports_store_started ON catalog_imports(store_id, started_at DESC);
CREATE INDEX idx_catalog_import_rows_inventory ON catalog_import_rows(inventory_id);
CREATE INDEX idx_count_commits_store_at ON count_commits(store_id, committed_at DESC);
CREATE INDEX idx_count_commit_lines_inventory ON count_commit_lines(inventory_id);
CREATE INDEX idx_count_exports_store_at ON count_exports(store_id, generated_at DESC);
CREATE INDEX idx_count_export_lines_count_line ON count_export_lines(count_line_id);
CREATE INDEX idx_reconciliation_runs_export_at ON reconciliation_runs(export_id, received_at DESC);
CREATE INDEX idx_reconciliation_lines_export_line ON reconciliation_lines(export_line_id);
