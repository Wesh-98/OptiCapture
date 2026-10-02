import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const db = new Database(':memory:');
const current = fileURLToPath(new URL('../docs/database-schema.sql', import.meta.url));
const proposed = fileURLToPath(new URL('../docs/integration-schema-proposal.sql', import.meta.url));
db.exec(readFileSync(current, 'utf8') + '\n' + readFileSync(proposed, 'utf8'));
assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
assert.deepEqual(db.pragma('foreign_key_check'), []);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
assert.equal(tables.length, 25);
const fkCount = tables.reduce((count, { name }) =>
  count + new Set(db.pragma(`foreign_key_list(${name})`).map(key => key.id)).size, 0);
assert.equal(fkCount, 56);

db.exec(`
  INSERT INTO stores (id, name) VALUES
    (10, 'Reference Store'), (11, 'Other Store'), (12, 'Unmapped Store');
  INSERT INTO users (id, username, store_id) VALUES (10, 'reference-admin', 10);
  INSERT INTO user_stores (user_id, store_id, role) VALUES (10, 10, 'owner');
  INSERT INTO integration_sources (id, display_name, issuer, audience)
    VALUES ('platform', 'Existing Platform', 'issuer', 'opticapture');
  INSERT INTO store_external_mappings (source_id, store_id, external_store_id)
    VALUES ('platform', 10, 'external-store-10'), ('platform', 11, 'external-store-11');
  INSERT INTO external_user_identities (source_id, external_user_id, user_id)
    VALUES ('platform', 'external-user-10', 10);
  INSERT INTO sso_store_grants
    (source_id, user_id, store_id, external_role, granted_role, created_membership, expires_at)
    VALUES ('platform', 10, 10, 'admin', 'owner', 0, '2026-10-01 20:00:00');
  INSERT INTO scan_sessions (session_id, user_id, store_id)
    VALUES ('s1', 10, 10), ('s2', 10, 10), ('s3', 10, 10);
  INSERT INTO count_commits (id, session_id, store_id, committed_by)
    VALUES ('c1', 's1', 10, 10), ('c2', 's2', 10, 10);
  INSERT INTO count_commit_lines
    (id, commit_id, line_number, item_name, previous_quantity, counted_quantity,
     external_system, external_item_id, mapping_status)
    VALUES (1, 'c1', 1, 'Item 1', 5, 8, 'platform', 'item-1', 'mapped'),
           (2, 'c2', 1, 'Item 2', 3, 2, 'platform', 'item-2', 'mapped');
  INSERT INTO count_exports
    (id, commit_id, source_id, store_id, generated_by, format, artifact_uri, artifact_sha256, attempt_number)
    VALUES ('e1', 'c1', 'platform', 10, 10, 'xlsx', 'artifact://e1', 'sha256', 1);
  INSERT INTO count_export_lines
    (export_id, commit_id, count_line_id, row_number, external_item_id, previous_quantity, counted_quantity)
    VALUES ('e1', 'c1', 1, 1, 'item-1', 5, 8);
`);

assert.equal(db.prepare('SELECT delta_quantity FROM count_commit_lines WHERE id=1').get().delta_quantity, 3);
assert.equal(db.prepare('SELECT delta_quantity FROM count_export_lines WHERE export_id=?').get('e1').delta_quantity, 3);
assert.throws(() => db.exec(`
  INSERT INTO count_export_lines
    (export_id, commit_id, count_line_id, row_number, external_item_id, previous_quantity, counted_quantity)
    VALUES ('e1', 'c1', 2, 2, 'item-2', 3, 2);
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO store_external_mappings (source_id, store_id, external_store_id)
    VALUES ('platform', 10, 'another-external-store');
`), /UNIQUE/);
assert.throws(() => db.exec(`
  INSERT INTO count_commits (id, session_id, store_id, committed_by)
    VALUES ('c3', 's1', 10, 10);
`), /UNIQUE/);
assert.throws(() => db.exec(`
  INSERT INTO count_commits (id, session_id, store_id, committed_by)
    VALUES ('wrong-store-commit', 's3', 11, 10);
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO count_exports
    (id, commit_id, source_id, store_id, generated_by, format, artifact_uri, artifact_sha256, attempt_number)
    VALUES ('wrong-store-export', 'c1', 'platform', 11, 10, 'xlsx', 'artifact://bad', 'sha256', 2);
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO reconciliation_runs (id, export_id, store_id)
    VALUES ('wrong-store-review', 'e1', 11);
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO catalog_imports (id, source_id, store_id, artifact_uri, artifact_sha256)
    VALUES ('unmapped-import', 'platform', 12, 'artifact://bad', 'sha256');
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO count_commit_lines
    (commit_id, line_number, item_name, previous_quantity, counted_quantity,
     external_system, external_item_id, mapping_status)
    VALUES ('c1', 2, 'Bad source', 0, 1, 'missing-source', 'item-3', 'mapped');
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'bad-time', 10, 10, '2026-10-01 12:00:00', '2026-10-01 11:00:00');
`), /CHECK/);
db.exec(`
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'digest-1', 10, 10, '2026-10-01 12:00:00', '2026-10-01 12:05:00');
`);
assert.throws(() => db.exec(`
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'wrong-membership', 10, 11, '2026-10-01 12:00:00', '2026-10-01 12:05:00');
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'digest-1', 10, 10, '2026-10-01 12:00:00', '2026-10-01 12:05:00');
`), /UNIQUE/);

// Timestamps must use the canonical UTC 'YYYY-MM-DD HH:MM:SS' form.
for (const badTime of ['2026-10-01T12:00:00Z', '2026-10-01 12:00:00.000', 'not-a-time']) {
  assert.throws(() => db.prepare(`
    INSERT INTO sso_launch_receipts
      (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
      VALUES ('platform', ?, 10, 10, ?, '2026-10-01 13:00:00')
  `).run(`bad-format-${badTime}`, badTime), /CHECK/);
}
assert.equal(
  db.prepare('SELECT consumed_at = datetime(consumed_at) ok FROM sso_launch_receipts LIMIT 1').get().ok,
  1
);

// External superadmin: per-store explicit grant with the read-only 'auditor' role.
db.exec(`
  INSERT INTO users (id, username, store_id, role) VALUES (20, 'external-superadmin', 11, 'owner');
  INSERT INTO external_user_identities (source_id, external_user_id, user_id)
    VALUES ('platform', 'external-superadmin-20', 20);
  INSERT INTO user_stores (user_id, store_id, role) VALUES (20, 11, 'auditor');
  INSERT INTO sso_store_grants
    (source_id, user_id, store_id, external_role, granted_role, created_membership, expires_at)
    VALUES ('platform', 20, 11, 'superadmin', 'auditor', 1, '2026-10-01 20:00:00');
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'superadmin-digest', 20, 11, '2026-10-01 12:00:00', '2026-10-01 12:05:00');
`);
assert.throws(() => db.exec(`
  INSERT INTO sso_store_grants
    (source_id, user_id, store_id, external_role, granted_role, created_membership, expires_at)
    VALUES ('platform', 20, 10, 'superadmin', 'superadmin', 1, '2026-10-01 20:00:00');
`), /CHECK/);
// Membership alone is not enough: a launch into a store needs a grant for that store.
db.exec(`INSERT INTO user_stores (user_id, store_id, role) VALUES (20, 10, 'auditor');`);
assert.throws(() => db.exec(`
  INSERT INTO sso_launch_receipts
    (source_id, token_id_hash, user_id, store_id, issued_at, expires_at)
    VALUES ('platform', 'ungranted-store', 20, 10, '2026-10-01 12:00:00', '2026-10-01 12:05:00');
`), /FOREIGN KEY/);

// Scanner identity and append-only scan attribution.
db.exec(`
  INSERT INTO session_devices (session_id, device_id, store_id, user_id, binding, bound_at)
    VALUES ('s3', 'phone-a', 10, 10, 'authenticated', '2026-10-01 12:00:00');
  INSERT INTO session_devices (session_id, device_id, store_id) VALUES ('s3', 'phone-b', 10);
  INSERT INTO scan_events (session_id, store_id, event_type, upc, quantity_delta, device_id, actor_user_id)
    VALUES ('s3', 10, 'scan', '0001', 1, 'phone-a', 10),
           ('s3', 10, 'scan', '0001', 1, 'phone-b', NULL),
           ('s3', 10, 'adjust', '0001', -1, NULL, 10);
`);
assert.equal(db.prepare("SELECT SUM(quantity_delta) n FROM scan_events WHERE session_id='s3' AND upc='0001'").get().n, 1);
assert.throws(() => db.exec(`UPDATE scan_events SET actor_user_id = 10 WHERE device_id = 'phone-b'`), /append-only/);
assert.throws(() => db.exec(`DELETE FROM scan_events WHERE session_id = 's3'`), /append-only/);
assert.throws(() => db.exec(`
  INSERT INTO scan_events (session_id, store_id, event_type, upc, quantity_delta, device_id)
    VALUES ('s3', 10, 'scan', '0001', 1, 'unregistered-phone');
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO scan_events (session_id, store_id, event_type, upc, quantity_delta, device_id)
    VALUES ('s3', 10, 'adjust', '0001', 2, 'phone-b');
`), /CHECK/);
assert.throws(() => db.exec(`
  INSERT INTO session_devices (session_id, device_id, store_id) VALUES ('s3', 'phone-c', 11);
`), /FOREIGN KEY/);
assert.throws(() => db.exec(`
  INSERT INTO session_devices (session_id, device_id, store_id, user_id, binding, bound_at)
    VALUES ('s3', 'phone-d', 10, 10, 'admin_assigned', '2026-10-01 12:00:00');
`), /CHECK/);
assert.throws(() => db.exec(`
  INSERT INTO session_devices (session_id, device_id, store_id, user_id) VALUES ('s3', 'phone-e', 10, 10);
`), /CHECK/);

db.exec(`
  INSERT INTO count_line_contributors
    (count_line_id, actor_user_id, device_id, attribution, net_quantity, event_count, first_event_at, last_event_at)
    VALUES (1, 10, 'phone-a', 'event', 2, 2, '2026-10-01 12:00:00', '2026-10-01 12:01:00'),
           (1, NULL, 'phone-b', 'unattributed', 1, 1, '2026-10-01 12:02:00', '2026-10-01 12:02:00');
`);
assert.throws(() => db.exec(`
  INSERT INTO count_line_contributors
    (count_line_id, actor_user_id, device_id, attribution, net_quantity, event_count, first_event_at, last_event_at)
    VALUES (1, NULL, 'phone-b', 'unattributed', 1, 1, '2026-10-01 12:03:00', '2026-10-01 12:03:00');
`), /UNIQUE/);
assert.throws(() => db.exec(`
  INSERT INTO count_line_contributors
    (count_line_id, actor_user_id, device_id, attribution, net_quantity, event_count, first_event_at, last_event_at)
    VALUES (1, NULL, NULL, 'unattributed', 1, 1, '2026-10-01 12:03:00', '2026-10-01 12:03:00');
`), /CHECK/);

assert.deepEqual(db.pragma('foreign_key_check'), []);
db.close();
console.log('Integration proposal verified: 25 tables, 56 FKs, idempotency, lineage, grant, and attribution constraints');
