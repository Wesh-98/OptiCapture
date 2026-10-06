# Current database: relationships and rules

**Status:** implemented SQLite schema, as created by `src/server/db.ts` through migration 19. This document describes the database *as it runs today*. The [full SQL](database-schema.sql), [one-page ERD](opticapture-erd-quick.svg), and [detailed ERD](opticapture-erd.svg) are the corresponding downloadable references.

## Ownership and table roles

| Table | Primary key | Role |
| --- | --- | --- |
| `stores` | `id` | Owning store/tenant; `id = 0` is the seeded HQ context for superadmin |
| `users` | `id` | Account, credentials/OAuth identity, and default store |
| `user_stores` | (`user_id`, `store_id`) | Per-store membership and `role` |
| `categories` | `id` | Store-scoped category |
| `inventory` | `id` | Local catalog, quantity, and external mapping fields |
| `scan_sessions` | `session_id` | Scan session status, OTP, expiry, and label |
| `session_items` | `id` | Mutable staged scan items under a session |
| `logs` | `id` | Store-scoped audit events |
| `schema_migrations` | `version` | Applied migration history |

## Enforced foreign keys

Every relationship below is one parent to zero or more children. The child FK can refer to at most one parent. `Required` means the child FK is declared `NOT NULL`; `Optional` means it can be `NULL`. All seven FKs use SQLite's default `NO ACTION` on delete and update; there are no cascades.

| Child column | Parent column | Child-to-parent | Meaning |
| --- | --- | --- | --- |
| `users.store_id` | `stores.id` | Optional | Default account store |
| `user_stores.user_id` | `users.id` | Required | Membership account |
| `user_stores.store_id` | `stores.id` | Required | Membership store |
| `categories.store_id` | `stores.id` | Required | Category owner |
| `inventory.store_id` | `stores.id` | Required | Item owner |
| `inventory.category_id` | `categories.id` | Optional | Item category |
| `session_items.session_id` | `scan_sessions.session_id` | Optional | Staged item session |

SQLite does **not** require `inventory.category_id` and `inventory.store_id` to resolve to the same store. Routes must validate that pairing. It also does not require `users.store_id` to have a matching `user_stores` membership. Startup backfills memberships, and request authorization validates the active store.

## Application associations without foreign keys

| Child column | Intended parent | Current rule |
| --- | --- | --- |
| `scan_sessions.user_id` | `users.id` | Route associates the creator, but SQLite permits a missing user |
| `scan_sessions.store_id` | `stores.id` | Routes scope sessions by store, but SQLite permits a missing store |
| `logs.user_id` | `users.id` | Audit actor is retained as a number even if the user disappears |
| `logs.store_id` | `stores.id` | Routes scope logs by store, but SQLite permits a missing store |

`session_items` has no `store_id`; its store is inferred through `scan_sessions`. Because its `session_id` is nullable, the database can also hold an item with no session. The application should not create such rows. `session_items` has indexes for `(session_id, upc)` and timestamps, but no uniqueness constraint on `(session_id, upc)`; duplicate merging is application behavior.

## Uniqueness and identifier rules

| Scope | Enforced key | Notes |
| --- | --- | --- |
| Store login code | `stores.store_code` | Unique index; multiple `NULL`s are allowed |
| Username | (`users.username`, `users.store_id`) | Store-scoped; `store_id` may be `NULL` |
| OAuth identity | (`users.oauth_provider`, `users.oauth_id`) | Partial unique index when provider is not `NULL`; null OAuth IDs are still allowed |
| Membership | (`user_stores.user_id`, `user_stores.store_id`) | Composite primary key |
| Category | (`categories.name`, `categories.store_id`) | Exact SQLite text comparison unless a collation is specified |
| UPC | (`inventory.upc`, `inventory.store_id`) | `NULL` UPCs do not collide |
| Item number | (`inventory.number`, `inventory.store_id`) | Partial unique index only for nonempty numbers |
| External item | (`inventory.external_system`, `inventory.external_item_id`, `inventory.store_id`) | Partial unique index only for nonempty external item ID; a `NULL` external system weakens deduplication |

UPC is a scan identifier, not a guaranteed external item identity. The external platform's stable item ID should be the merge key for integration. Existing `inventory.external_store_id` and `external_category_id` are text values on items, not FK-backed store/category mapping tables.

## Current workflow and data rules

1. **Access and tenancy.** Requests use an account cookie and an active store selection. The middleware validates `X-Store-Id` against the user's active `user_stores` memberships, and routes filter every query by `store_id`. The schema itself provides no row-level tenant isolation. A local `superadmin` bypasses memberships and has no store context. The startup membership backfill skips users whose default store is `0` (the HQ context).
2. **Who can change what.**
   - Owners and superadmins manage categories, imports, exports, and session commits (`requireOwner`).
   - Owners **and takers** can create, edit (including `quantity`), and delete catalog items (`requireOwnerOrTaker`).
   - Any member of the store can create, save, clear, or delete uncommitted sessions and edit new staged items.
3. **Catalog import.** Import (`/inventory/batch-confirm`) inserts or updates `inventory`, including `quantity` when a quantity column is mapped. Rows are matched in this order:
   1. `(external_system, external_item_id)`, using an exact system match
   2. UPC
   3. item number
   4. external SKU

   A sheet that maps External Item ID must also map External System, or the request is rejected. A row with an external item ID but a blank system is rejected with an error. Matched rows get `last_imported_at` and `sync_status = 'imported'`. The import runs in one transaction, but invalid rows are reported and skipped while valid rows are applied. Rejected rows are recorded only in the response and an `IMPORT` log summary; there is no import batch or rejected-row history table.
4. **Catalog export.** `/inventory/export` exports the **catalog**. XLSX, CSV, and JSON files mark every store item `sync_status = 'exported'` with `last_exported_at`, after the file has been built. PDF is a report and changes nothing. Files carry ISO 8601 UTC timestamps with `Z`. Each export writes an `EXPORT` log entry. It is not a count-result export.
5. **Scan sessions.**
   - **Lifetime:** a session expires 8 hours after creation, resume, or its latest scan. Saving it as a draft extends this to 24 hours. A committed (`completed`) session can't be resumed or deleted.
   - **Phone access:** phones authenticate with the session ID and OTP only; the OTP locks after 5 failed attempts.
   - **Staging:** each scan inserts or increments one mutable `session_items` row per product. EAN-13 and UPC-A leading-zero variants merge into the same row.
   - **Device attribution:** `device_id` holds the scanning device. It becomes `NULL` once a second device scans the same product, meaning "shared". Each phone's item list shows its own rows plus shared ones. There is no per-scan event history or per-user attribution.
6. **Session commit (capture, not counting).** Scanning's primary purpose is adding new items to the catalog. Counting stock is deferred until this baseline works. Existing items are only confirmed and cleared from the session. Their `last_verified_*` values are recorded as a future counting baseline but are not shown in the app, because incidental scans don't make "not seen" meaningful. Commit decides whether each item exists at commit time, by UPC including the leading-zero variant:
   - **Existing catalog item:** recorded as seen. `inventory.last_verified_at`, `last_verified_by`, and `last_verified_session_id` are set. Its details and quantity are never changed, and the staged row is removed. The scan workspace treats these items as read-only, and the item edit endpoint returns `409` for them.
   - **New item** (`new_candidate` with an assigned category): inserted with its scanned quantity, stamped as verified, and the staged row is removed.
   - **Anything else** (unknown, unnamed, or no category): stays staged until confirmed or removed. An unknown item becomes a confirmed new item only when edited to have a name; editing other fields leaves it `unknown`. The server enforces this, and no placeholder name is ever written to the catalog.

   The session is marked `completed` once no staged rows remain. `last_verified_by` and `last_verified_session_id` are plain associations without FKs.
7. **Where quantity changes.** `inventory.quantity` changes only through:
   - direct item create/edit by owners or takers
   - catalog import with a mapped quantity column
   - the starting quantity of new items added by a session commit

   Scanning an existing item never changes it. The former `POST /api/inventory/batch` quantity-increment route was removed.
8. **Logs and deletion.** `logs` entries older than 90 days are deleted at startup and daily. Deleting a store also deletes its logs, sessions, staged items, inventory, categories, memberships, and the users who belong only to that store. Logs are therefore unsuitable as long-term evidence.
9. **Values and types.** Status values are plain text without database `CHECK` constraints, and casing differs by table:
   - `inventory`/`categories`: `Active`/`Inactive`, validated by routes
   - `stores`: lowercase
   - `scan_sessions`: `active`, `draft`, `completed`

   `session_items.sale_price` is declared `TEXT` (the item edit route stores a non-negative number), while `inventory.sale_price` is `REAL`. Quantities and prices are clamped to non-negative values by routes, not by the schema.

## SQLite behavior and limits

- Foreign keys are enabled per app connection; WAL mode and a 5-second busy timeout are configured in `db.ts`.
- Timestamps are UTC text in the `CURRENT_TIMESTAMP` form (`YYYY-MM-DD HH:MM:SS`; `session_items` adds milliseconds), so they compare correctly with `datetime('now')` and sort as text. Values have no zone suffix and must be parsed as UTC. The format is an application rule: current columns have no `CHECK`. Migration 18 converted earlier ISO 8601 values in `inventory.last_imported_at`/`last_exported_at` and any other timestamp column.
- `INTEGER PRIMARY KEY` aliases the row ID and cannot be null. A non-integer `TEXT PRIMARY KEY` in a normal SQLite rowid table can accept `NULL` unless separately declared `NOT NULL`; `scan_sessions.session_id` is such a declaration. The app supplies non-null IDs.
- `UNIQUE` constraints permit multiple rows with `NULL` in a key component. Partial unique indexes have the exact predicates shown in [database-schema.sql](database-schema.sql).
- There are no database-enforced nonnegative quantity/price checks, cross-store category checks, count snapshot tables, export idempotency records, or reconciliation records today.
