# New-item handoff to the existing platform

**Status:** design proposal, not implemented. **Date:** 2026-10-01.
**Audience:** OptiCapture engineers, and the existing platform's integration team.

## Purpose

OptiCapture's scanning exists mainly to find products that are on the shelf but not yet in the catalog. Stock counting is deferred until this works. In the integrated setup, the existing platform owns the official catalog. A new item found by OptiCapture therefore has to be sent to the platform, created there, and linked back so both systems refer to it by the platform's item ID.

This document defines that handoff: one shared outbox inside OptiCapture, plus three delivery channels that read from it. Channels can be added one at a time without rework.

```text
Scan session ──commit──► OptiCapture catalog ──► handoff outbox
                                                    │
                     ┌──────────────────────────────┼──────────────────────────────┐
                     ▼                              ▼                              ▼
             A. File export                 B. Pull API                    C. Push API
          (admin uploads file)       (platform fetches + acks)      (OptiCapture calls platform)
                     │                              │                              │
                     └──────────────► existing platform creates item ◄─────────────┘
                                                    │
                                 platform item ID returned or imported back
                                                    ▼
                                OptiCapture links item (external_item_id)
```

## What exists today

- Session commit adds a new item to `inventory` once it has a confirmed name and an assigned category. Existing items are only confirmed and never changed. See [Current relationships and rules](DATABASE_RELATIONSHIPS_CURRENT.md), rule 6.
- `inventory` already has `external_system`, `external_item_id`, `external_store_id`, `external_category_id`, and `external_sku`.
- Catalog import matches rows by `(external_system, external_item_id)`, then UPC, number, and SKU. On a UPC match it fills in the external IDs. That is what makes the file round trip (channel A) able to link items.
- The current `/api/inventory/export` sends the **whole catalog**. There is no "new items only" export, and nothing records which items came from scanning.

## Handoff lifecycle

Each new item gets one handoff record per integration source.

| Status | Meaning | Moves to |
| --- | --- | --- |
| `pending` | Created by session commit; not yet delivered | `sent`, `cancelled` |
| `sent` | Delivered at least once (file generated, fetched by API, or pushed) and awaiting an outcome | `linked`, `rejected`, `cancelled`, or `sent` again on redelivery |
| `linked` | The platform has the item. `external_item_id` is stored on the handoff and copied to `inventory` | final |
| `rejected` | The platform refused it, with a reason. An admin fixes the item and re-queues it, which creates a new `pending` attempt | `pending` (re-queue) |
| `cancelled` | No longer to be sent (item deleted or excluded by an admin) | final |

Rules:

1. A handoff is created **in the same transaction** as the session commit that adds the item, only for stores mapped to an integration source. Standalone stores create none.
2. The handoff ID is a UUID and never changes. It is the idempotency key for every channel: the platform must treat a repeated handoff ID as the same item.
3. The data sent is read from the **current** inventory row at delivery time, so corrections made before sending are included. Each delivery stores a hash of what was sent.
4. `linked` copies `external_system` and `external_item_id` onto the inventory item in one transaction. From then on it is an ordinary mapped item, and later catalog imports match it by ID instead of by UPC.
5. If the platform already had an item with the same UPC, it answers `linked_existing` with that item's ID, rather than creating a duplicate or rejecting.
6. Deleting an inventory item cancels its open handoff. The handoff keeps a snapshot of the UPC and name, so history remains readable.

## Proposed schema

Adds to the [integration proposal](integration-schema-proposal.sql) and follows its conventions: UTC `YYYY-MM-DD HH:MM:SS` timestamps enforced by `CHECK`, and statuses limited by `CHECK`. The SQL below was validated in SQLite against the current schema plus that proposal.

```sql
CREATE TABLE new_item_handoffs (
  id TEXT PRIMARY KEY NOT NULL,                 -- UUID; idempotency key for the platform
  source_id TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  inventory_id INTEGER,                         -- NULL once the item is deleted
  upc TEXT NOT NULL,                            -- snapshot for history
  item_name TEXT NOT NULL,                      -- snapshot for history
  session_id TEXT NOT NULL,                     -- scan session that found the item
  created_by INTEGER NOT NULL,                  -- user who committed it
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'linked', 'rejected', 'cancelled')),
  last_channel TEXT CHECK (last_channel IN ('file', 'pull_api', 'push_api')),
  delivery_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_count >= 0),
  last_payload_sha256 TEXT,
  external_item_id TEXT,
  outcome_detail TEXT,                          -- rejection reason or platform note
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (created_at IS datetime(created_at)),
  last_sent_at TEXT CHECK (last_sent_at IS datetime(last_sent_at)),
  resolved_at TEXT CHECK (resolved_at IS datetime(resolved_at)),
  CHECK (status != 'linked' OR (external_item_id IS NOT NULL AND external_item_id != '')),
  CHECK (status != 'rejected' OR (outcome_detail IS NOT NULL AND outcome_detail != '')),
  CHECK (status = 'pending' OR delivery_count > 0 OR status = 'cancelled'),
  FOREIGN KEY (source_id, store_id) REFERENCES store_external_mappings(source_id, store_id),
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- One open handoff per item and source; closed ones remain as history.
CREATE UNIQUE INDEX idx_new_item_handoffs_open
  ON new_item_handoffs(inventory_id, source_id)
  WHERE status IN ('pending', 'sent');
CREATE INDEX idx_new_item_handoffs_queue
  ON new_item_handoffs(source_id, store_id, status, created_at, id);
```

`ON DELETE SET NULL` is the one exception to the proposal's `NO ACTION` default. Owners and takers can delete catalog items today, and handoff history must not block that. The item delete route cancels any open handoff in the same transaction; the key then clears `inventory_id`, and the UPC and name snapshots keep the history readable. The key is deliberately on `inventory(id)` alone. A composite `(inventory_id, store_id)` key would also null the required `store_id` on delete and make the delete fail. The service checks that the item and the handoff belong to the same store when it creates the handoff.

## Channel A: file handoff (phase 1)

Works with nothing built on the platform side.

1. An owner opens **Export new items** and chooses a store and source. OptiCapture builds an XLSX/CSV of `pending` handoffs (optionally including `sent` ones for a resend) and marks them `sent` once the file is built.
2. The owner uploads the file through the platform's normal import.
3. The platform's next catalog export is imported into OptiCapture with External System and External Item ID mapped. Any `sent` handoff whose item matches by UPC and now has an external ID for that source becomes `linked`.
4. Items still `sent` after a configurable period are listed as **awaiting platform** for follow-up.

Default columns, until the platform's import format is known (they will be remapped to match it):

| Column | Source |
| --- | --- |
| `handoff_id` | Handoff UUID; the platform should keep it for duplicate checks if it can |
| `external_store_id` | `store_external_mappings.external_store_id` |
| `upc` | `inventory.upc` |
| `item_name` | `inventory.item_name` |
| `brand` | Scan lookup brand. **Gap:** not stored on `inventory` today |
| `category` | Local category name |
| `external_category_id` | Platform category ID, once category mapping exists |
| `unit`, `sale_price`, `tax_percent` | `inventory` |
| `quantity` | Scanned starting quantity (informational; the platform owns stock) |
| `image_url` | Absolute, time-limited image URL |
| `found_at` | Session commit time, ISO 8601 UTC with `Z` |
| `session_id` | Scan session that found it |

Limitation: linking depends on the round trip and on UPC. That is acceptable for scanned items, which are identified by barcode in the first place.

## Channel B: pull API provided by OptiCapture (recommended long-term)

OptiCapture defines the contract, so it does not depend on whether the platform has an API of its own. The platform runs a scheduled job.

### Authentication
- One service credential per integration source, sent as `Authorization: Bearer <token>` over HTTPS. Phase 1 uses an opaque API key stored hashed, with at most two active keys for rotation. OAuth 2.0 client credentials can replace it later without changing the endpoints.
- A credential only sees stores mapped to its source in `store_external_mappings`.
- These endpoints are separate from user sessions: no cookies, no `X-Store-Id`.

### `GET /api/integration/v1/new-items`
Query parameters:
- `external_store_id` (required)
- `limit` (1–200, default 100)
- `cursor` (opaque, from the previous page)

Returns `pending` items and `sent` items without an outcome, oldest first. Fetching marks returned items `sent`, increments `delivery_count`, and records the payload hash, so an item is redelivered until it is acknowledged.

```json
{
  "items": [
    {
      "handoff_id": "8f0c2a4e-6b1d-4c39-9e57-0f2b7d1a9c44",
      "external_store_id": "store-42",
      "upc": "036000291452",
      "item_name": "Sparkling Water 500ml",
      "brand": "Example Brand",
      "category": { "name": "Beverages", "external_category_id": null },
      "unit": "ea",
      "sale_price": 1.99,
      "tax_percent": 8.25,
      "quantity": 12,
      "image_url": "https://app.opticapture.com/api/integration/v1/images/<signed-token>",
      "found_at": "2026-10-01T14:03:22Z",
      "session_id": "a1b2c3"
    }
  ],
  "next_cursor": "eyJpZCI6...",
  "has_more": false
}
```

### `POST /api/integration/v1/new-items/ack`
```json
{
  "results": [
    { "handoff_id": "8f0c…", "outcome": "created", "external_item_id": "ITEM-90311" },
    { "handoff_id": "1d7e…", "outcome": "linked_existing", "external_item_id": "ITEM-11872" },
    { "handoff_id": "5a90…", "outcome": "rejected", "reason": "Missing department" }
  ]
}
```
- `created` and `linked_existing` set the handoff to `linked` and copy the ID to inventory. `rejected` requires `reason`.
- **Idempotent:** repeating the same outcome returns `200` and changes nothing. A different outcome for an already `linked` handoff returns `409`.
- The response reports each result separately (`applied`, `duplicate`, `conflict`, or `not_found`), so one bad entry never fails the batch.
- An `external_item_id` already linked to a different item for the same source and store returns `conflict`. This mirrors the existing unique index on `inventory(external_system, external_item_id, store_id)`.

### Images
`image_url` is a signed, expiring link served by OptiCapture, because images are stored as private `/uploads/...` paths today. The platform must download the image if it wants to keep it.

### Limits
The endpoints are rate-limited per credential. Every call writes an operational log entry (source, store, counts).

## Channel C: push to the platform's API (only if one exists)

If the platform has a documented item-create API, OptiCapture can call it after each commit, or after an admin approves sending.

- One adapter per platform, behind a common interface: `createItem(payload, idempotencyKey) → created | linked_existing | rejected`.
- The handoff ID is sent as the idempotency key, if the platform supports one. Otherwise OptiCapture checks for an existing item by UPC before creating.
- Retries use exponential backoff, and a failed call leaves the handoff `pending`. Outcomes are recorded exactly as in channel B.
- This needs platform credentials stored securely per source. They are **not** part of the current schema proposal.

## Channel D: notification (optional add-on to B)

OptiCapture POSTs `{ "external_store_id": "...", "pending": 3 }` to a URL configured per source when items are waiting, signed with an HMAC of the body. The platform then pulls through channel B. This gives near real-time delivery without constant polling.

## Gaps to close before building

1. **Category mapping.** New items need the platform's category, but local categories have no external ID. Proposed: a `category_external_mappings(source_id, category_id, external_category_id)` table, set by admins. Until then, only the category name is sent.
2. **Brand.** Scan lookup captures `brand` on staged items, but commit does not store it on `inventory`. Add a column, or drop brand from the handoff.
3. **Service credentials.** Channels B and C need per-source credential storage and rotation, which are not in the current proposal.
4. **Store mapping.** A handoff can only be created for a store mapped to a source (`store_external_mappings`).
5. **Admin view.** Owners need to see pending, sent, rejected, and awaiting-platform items, and re-queue or cancel them.

## Questions for the existing platform team

These decide which channels are possible:

1. Is there an API to create items? If yes: authentication method, whether it returns the new item ID, and whether it accepts an idempotency key.
2. Can the platform run a scheduled job that calls an external HTTPS API (channel B)?
3. What is the exact import file format for new items (channel A)? Which columns are required? How are categories/departments identified?
4. Are new items reviewed or approved inside the platform before going live? If so, how and when is the outcome visible?
5. What happens on a UPC that already exists there: reject, merge, or create a duplicate?
6. Can the platform store OptiCapture's `handoff_id` on the item, to help detect duplicates?
7. How should images be delivered: URL to fetch, file attachment, or not at all?

## Rollout

| Step | Delivers | Depends on |
| --- | --- | --- |
| 1 | Outbox table and handoff creation in session commit; admin view of handoffs | Store-to-source mapping |
| 2 | Channel A: "export new items" file and linking on catalog re-import | Platform's import format (question 3) |
| 3 | Channel B: pull API, credentials, signed image URLs | Platform can run a job (question 2) |
| 4 | Channel C adapter, or channel D notifications | Platform API (question 1) or a notification URL |

Steps 1 and 2 complete the Milestone 1 round trip in the [integration plan](Initial%20Integration%20Plan.md) without waiting on the platform team. Step 3 can be built in parallel once its contract is agreed.
