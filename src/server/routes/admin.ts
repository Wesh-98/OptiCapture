import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authenticateToken, asyncRoute } from '../middleware.js';
import { BCRYPT_COST } from '../cache.js';
import {
  generateTempPassword,
  normalizeUsername,
  removeUploadedFiles,
  saveBase64Image,
  UnsupportedImageTypeError,
  uploadFileName,
} from '../helpers.js';
import type { AuthRequest } from '../types.js';
import { logError } from '../logger.js';
import {
  listStoreInventory,
  readItemSnapshot,
  updateInventoryItem,
  type InventoryRowSnapshot,
} from './inventory.js';
import {
  listStoreCategories,
  RESERVED_CATEGORY_NAMES,
  visibleCategoryCondition,
} from './categories.js';

export const adminRouter = express.Router();
const HQ_STORE_ID = 0;

/**
 * A route ID as plain decimal digits, or null. Number() alone accepts "1e0" and "0x1",
 * and parseInt accepts "5abc", so either could reach a store the caller never named.
 */
function parseIdParam(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
type StoreRole = 'owner' | 'taker';

function requireSuperadmin(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (req.user.role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

function isStoreRole(value: unknown): value is StoreRole {
  return value === 'owner' || value === 'taker';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * The upload files some surviving row still points at. A '/uploads/...' value in a deleted
 * store's row is not proof that the store owned the file — inventory POST/PUT and imports
 * can write an arbitrary path into inventory.image — so deleting a store must never unlink
 * a file something else still points at.
 *
 * Compared by uploadFileName, the key the unlink uses, not by the stored string:
 * '/uploads/sub/x.png' and an absolute 'https://…/uploads/x.png' both name x.png. One scan
 * builds the set rather than one query per file being deleted.
 */
function referencedUploadFileNames(): Set<string> {
  const rows = db
    .prepare(
      `SELECT image AS path FROM inventory WHERE image LIKE '%/uploads/%'
       UNION SELECT logo AS path FROM stores WHERE logo LIKE '%/uploads/%'
       UNION SELECT image AS path FROM session_items WHERE image LIKE '%/uploads/%'`
    )
    .all() as Array<{ path: string }>;
  return new Set(rows.map(row => uploadFileName(row.path)));
}

function writeAdminLog(details: string, userId: number, storeId: number) {
  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
    'ADMIN',
    details,
    userId,
    storeId
  );
}

// Per-store inventory figures shown on the superadmin pages. Bind RESERVED_CATEGORY_NAMES
// first, before the query's own parameters.
const STORE_INVENTORY_STATS = `
  (SELECT COUNT(*) FROM inventory i WHERE i.store_id = s.id) AS item_count,
  (SELECT COUNT(*) FROM categories c WHERE c.store_id = s.id AND ${visibleCategoryCondition}) AS category_count,
  (SELECT COUNT(*) FROM inventory i
    WHERE i.store_id = s.id AND i.created_at >= datetime('now', '-7 days')) AS items_added_week,
  (SELECT MAX(i.created_at) FROM inventory i WHERE i.store_id = s.id) AS last_item_added_at,
  (SELECT COUNT(*) FROM inventory i
    WHERE i.store_id = s.id AND (i.upc IS NULL OR TRIM(i.upc) = '')) AS missing_upc_count`;

// Super admin — list all stores
// The dashboard's Recent changes card: store lifecycle events and new captures only.
// Catalog edits (manual adds, edits, deletes, imports) belong to the store's own portal.
export type ActivityKind =
  | 'registered'
  | 'suspended'
  | 'reactivated'
  | 'updated'
  | 'deleted'
  | 'capture';

const ACTIVITY_FILTER = `
  (l.action = 'BATCH' AND l.store_id != ?)
  OR (l.action = 'CREATE' AND l.details LIKE 'Registered store %')
  OR (l.action = 'ADMIN' AND (l.details LIKE 'Set store % status to %'
                              OR l.details LIKE 'Updated store %'
                              OR l.details LIKE 'Deleted store %'))`;

/** Turns one matching log row into a kind and a short line. Raw log text never reaches the UI. */
export function describeActivity(
  action: string,
  details: string | null
): { kind: ActivityKind; summary: string; deletedName?: string } {
  const text = details?.trim() ?? '';
  if (action === 'BATCH') {
    const inserted = Number(/inserted=(\d+)/.exec(text)?.[1] ?? Number.NaN);
    const verified = Number(/verified=(\d+)/.exec(text)?.[1] ?? Number.NaN);
    if (Number.isNaN(inserted)) return { kind: 'capture', summary: 'Committed a scan session' };
    const added = `Captured ${inserted} new ${inserted === 1 ? 'item' : 'items'}`;
    return {
      kind: 'capture',
      summary: verified > 0 ? `${added}, confirmed ${verified} existing` : added,
    };
  }
  if (action === 'CREATE') return { kind: 'registered', summary: 'Store registered' };
  if (text.startsWith('Set store ')) {
    return text.endsWith(' active')
      ? { kind: 'reactivated', summary: 'Store reactivated' }
      : { kind: 'suspended', summary: 'Store suspended' };
  }
  if (text.startsWith('Deleted store ')) {
    // The store's own rows are gone by now, so its name only survives in the log line.
    const deletedName = /^Deleted store "(.*)" \(\d+\)$/.exec(text)?.[1];
    return { kind: 'deleted', summary: 'Store deleted', deletedName };
  }
  return { kind: 'updated', summary: 'Store details updated' };
}

adminRouter.get('/activity', authenticateToken, requireSuperadmin, (req: AuthRequest, res) => {
  const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 5;
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM logs l WHERE ${ACTIVITY_FILTER}`)
    .get(HQ_STORE_ID) as { total: number };
  const rows = db
    .prepare(
      `SELECT l.id, l.action, l.details, l.timestamp, s.id AS store_id, s.name AS store_name,
              u.username
         FROM logs l
         LEFT JOIN stores s ON s.id = l.store_id AND s.id != ?
         LEFT JOIN users u ON u.id = l.user_id
        WHERE ${ACTIVITY_FILTER}
        ORDER BY l.timestamp DESC, l.id DESC
        LIMIT ?`
    )
    .all(HQ_STORE_ID, HQ_STORE_ID, limit) as Array<{
    id: number;
    action: string;
    details: string | null;
    timestamp: string;
    store_id: number | null;
    store_name: string | null;
    username: string | null;
  }>;
  const items = rows.map(({ action, details, store_name, ...row }) => {
    const { deletedName, ...described } = describeActivity(action, details);
    return { ...row, ...described, store_name: store_name ?? deletedName ?? 'Unknown store' };
  });
  res.json({ items, total });
});

adminRouter.get('/stores', authenticateToken, requireSuperadmin, (_req: AuthRequest, res) => {
  const stores = db
    .prepare(
      `
    SELECT s.*,
      (SELECT COUNT(*) FROM user_stores us WHERE us.store_id = s.id) AS user_count,
      ${STORE_INVENTORY_STATS}
    FROM stores s
    WHERE s.id != ?
    ORDER BY s.created_at DESC
  `
    )
    .all(...RESERVED_CATEGORY_NAMES, HQ_STORE_ID);
  res.json(stores);
});

interface ViewedStoreSummary {
  id: number;
  name: string;
  status: string;
  logo: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  item_count: number;
  category_count: number;
  items_added_week: number;
  last_item_added_at: string | null;
  missing_upc_count: number;
}

/**
 * The store a superadmin inventory route reads, taken only from the URL. Sends the error
 * response itself and returns null for a malformed ID, the HQ store, or a store that does
 * not exist — it never falls back to the caller's own store.
 */
function resolveViewedStore(req: AuthRequest, res: express.Response) {
  const storeId = parseIdParam(req.params.id);
  if (storeId === null) {
    res.status(400).json({ error: 'Invalid store ID' });
    return null;
  }
  if (storeId === HQ_STORE_ID) {
    res.status(403).json({ error: 'The HQ store is managed internally' });
    return null;
  }
  const store = db
    .prepare(
      `SELECT s.id, s.name, s.status, s.logo, s.street, s.city, s.state, s.zipcode,
        ${STORE_INVENTORY_STATS}
       FROM stores s WHERE s.id = ?`
    )
    .get(...RESERVED_CATEGORY_NAMES, storeId) as ViewedStoreSummary | undefined;
  if (!store) {
    res.status(404).json({ error: 'Store not found' });
    return null;
  }
  return store;
}

// Super admin — one store's summary, for the header of its inventory view
adminRouter.get('/stores/:id', authenticateToken, requireSuperadmin, (req: AuthRequest, res) => {
  const store = resolveViewedStore(req, res);
  if (store) res.json(store);
});

// Super admin — read-only, paged item list for one store (same filters as GET /inventory)
adminRouter.get(
  '/stores/:id/inventory',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const store = resolveViewedStore(req, res);
    if (!store) return;
    const result = listStoreInventory(store.id, req.query);
    if ('error' in result) return res.status(400).json(result);
    res.json(result);
  }
);

// Super admin — read-only category list with item counts for one store
adminRouter.get(
  '/stores/:id/categories',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const store = resolveViewedStore(req, res);
    if (store) res.json(listStoreCategories(store.id));
  }
);

// Super admin — one item from one store, plus the other stores that carry the same UPC
adminRouter.get(
  '/stores/:id/items/:itemId',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const store = resolveViewedStore(req, res);
    if (!store) return;
    const itemId = parseIdParam(req.params.itemId);
    if (itemId === null) return res.status(400).json({ error: 'Invalid item ID' });
    const item = db
      .prepare(
        `SELECT i.*, c.name AS category_name
         FROM inventory i LEFT JOIN categories c ON c.id = i.category_id
         WHERE i.id = ? AND i.store_id = ?`
      )
      .get(itemId, store.id) as { upc: string | null } | undefined;
    if (!item) return res.status(404).json({ error: 'Item not found in this store' });

    const upc = item.upc?.trim();
    const otherStores = upc
      ? db
          .prepare(
            `SELECT i.id AS item_id, i.store_id, s.name AS store_name, s.status AS store_status,
               i.sale_price, i.status
             FROM inventory i JOIN stores s ON s.id = i.store_id
             WHERE TRIM(i.upc) = ? AND i.store_id NOT IN (?, ?)
             ORDER BY s.name COLLATE NOCASE`
          )
          .all(upc, store.id, HQ_STORE_ID)
      : [];
    res.json({ item, other_stores: otherStores });
  }
);

// What the superadmin may change on a store's item. Quantity and tags stay with the store.
// A new image arrives as a data URL and is saved like the store's own uploads.
const EDITABLE_ITEM_FIELDS = [
  'item_name',
  'upc',
  'category_id',
  'sale_price',
  'tax_percent',
  'unit',
  'status',
  'description',
  'image',
] as const;
const MAX_EDIT_REASON = 500;

const formatMoney = (value: number | null) => (value == null ? '—' : `$${value.toFixed(2)}`);
const formatText = (value: string | null) => (value?.trim() ? value.trim() : '—');

/**
 * The store-log line for a superadmin edit: every visible before → after, plus the reason.
 * Null when nothing the store would see actually changed.
 */
export function describeItemEdit(
  before: InventoryRowSnapshot,
  after: InventoryRowSnapshot,
  reason: string
): string | null {
  const parts: string[] = [];
  const diff = (label: string, from: string, to: string) => {
    if (from !== to) parts.push(`${label} ${from} → ${to}`);
  };
  diff('Name', formatText(before.item_name), formatText(after.item_name));
  diff('UPC', formatText(before.upc), formatText(after.upc));
  diff('Category', before.category_name ?? 'Uncategorized', after.category_name ?? 'Uncategorized');
  diff('Price', formatMoney(before.sale_price), formatMoney(after.sale_price));
  diff(
    'Tax',
    before.tax_percent == null ? '—' : `${before.tax_percent}%`,
    after.tax_percent == null ? '—' : `${after.tax_percent}%`
  );
  diff('Unit', formatText(before.unit), formatText(after.unit));
  diff('Status', before.status, after.status);
  // Descriptions can run to 2,000 characters, so the log only notes that it changed.
  if ((before.description ?? '') !== (after.description ?? '')) parts.push('Description updated');
  if ((before.image ?? '') !== (after.image ?? '')) {
    parts.push(!after.image ? 'Image removed' : before.image ? 'Image replaced' : 'Image added');
  }
  if (parts.length === 0) return null;
  const line = `Super Admin edited "${after.item_name}": ${parts.join('; ')}`;
  return reason ? `${line}. Reason: ${reason}` : line;
}

// Superadmin edit of one item in one store. It runs through the same update as the store's
// own edit, refuses if the item changed since the form was opened, and logs the change to
// that store under the superadmin's name.
adminRouter.put(
  '/stores/:id/items/:itemId',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const store = resolveViewedStore(req, res);
    if (!store) return;
    if (store.status !== 'active') {
      return res.status(403).json({ error: 'Suspended stores are read-only' });
    }
    const itemId = parseIdParam(req.params.itemId);
    if (itemId === null) return res.status(400).json({ error: 'Invalid item ID' });

    const { changes, expected_updated_at, reason } = req.body ?? {};
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes must be an object' });
    }
    const fields = Object.keys(changes);
    const notEditable = fields.filter(
      field => !(EDITABLE_ITEM_FIELDS as readonly string[]).includes(field)
    );
    if (notEditable.length > 0) {
      return res.status(400).json({ error: `Cannot edit: ${notEditable.join(', ')}` });
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to change' });
    if (typeof expected_updated_at !== 'string' || !expected_updated_at) {
      return res.status(400).json({ error: 'expected_updated_at is required' });
    }
    if (reason != null && typeof reason !== 'string') {
      return res.status(400).json({ error: 'reason must be a string' });
    }
    const note = (reason ?? '').trim();
    if (note.length > MAX_EDIT_REASON) {
      return res
        .status(400)
        .json({ error: `Reason must be ${MAX_EDIT_REASON} characters or fewer` });
    }

    const result = updateInventoryItem(store.id, req.user.id, itemId, changes, {
      expectedUpdatedAt: expected_updated_at,
      describe: (before, after) => describeItemEdit(before, after, note),
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json({ item: readItemSnapshot(itemId, store.id) });
  }
);

// Super admin — activate or suspend a store
adminRouter.put(
  '/stores/:id/status',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const storeId = parseIdParam(req.params.id);
    if (storeId === null) return res.status(400).json({ error: 'Invalid store ID' });
    if (storeId === HQ_STORE_ID) {
      return res.status(403).json({ error: 'The HQ store is managed internally' });
    }
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    const result = db.prepare('UPDATE stores SET status = ? WHERE id = ?').run(status, storeId);
    if (!result.changes) return res.status(404).json({ error: 'Store not found' });
    writeAdminLog(`Set store ${storeId} status to ${status}`, req.user.id, storeId);
    res.json({ ok: true });
  }
);

// Super admin — list users with access to a store
adminRouter.get(
  '/stores/:id/users',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const storeId = parseIdParam(req.params.id);
    if (storeId === null) return res.status(400).json({ error: 'Invalid store ID' });
    if (storeId === HQ_STORE_ID) {
      return res.status(403).json({ error: 'The HQ store is managed internally' });
    }
    const users = db
      .prepare(
        `
    SELECT u.id, u.username, u.email, us.role
    FROM user_stores us
    JOIN users u ON u.id = us.user_id
    WHERE us.store_id = ?
    ORDER BY us.role, u.username
  `
      )
      .all(storeId);
    res.json(users);
  }
);

// Super admin — grant an existing user access or create a brand-new store user
adminRouter.post(
  '/stores/:id/users',
  authenticateToken,
  requireSuperadmin,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    const { username, role, mode, email } = req.body ?? {};
    const storeId = parseIdParam(req.params.id);
    if (storeId === null) return res.status(400).json({ error: 'Invalid store ID' });
    if (storeId === HQ_STORE_ID) {
      return res.status(403).json({ error: 'The HQ store is managed internally' });
    }

    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedMode = mode === 'create' ? 'create' : 'existing';
    if (!normalizedUsername || !isStoreRole(role)) {
      return res.status(400).json({ error: 'Valid username and role required' });
    }
    if (normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
    }
    if (normalizedEmail.length > 200) {
      return res.status(400).json({ error: 'Email must be 200 characters or fewer' });
    }
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const store = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId) as any;
    if (!store) return res.status(404).json({ error: 'Store not found' });

    if (normalizedMode === 'create') {
      // Keep usernames unique within the target store context so store-code login never
      // has to guess between two different accounts with the same username.
      const conflictingUsername = db
        .prepare(
          `
        SELECT u.id
        FROM users u
        LEFT JOIN user_stores us ON us.user_id = u.id
        WHERE u.username = ?
          AND (u.store_id = ? OR us.store_id = ?)
        LIMIT 1
      `
        )
        .get(normalizedUsername, storeId, storeId) as any;
      if (conflictingUsername) {
        return res.status(409).json({ error: 'Username already exists for this store' });
      }

      // Newly created store users start with a one-time password and must replace it
      // themselves after the first sign-in.
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);

      try {
        const createdAccess = db.transaction(() => {
          const createdUser = db
            .prepare(
              `
            INSERT INTO users (
              username, password, role, store_id, store_name, email, must_reset_password
            ) VALUES (?, ?, ?, ?, ?, ?, 1)
          `
            )
            .run(
              normalizedUsername,
              passwordHash,
              role,
              store.id,
              store.name,
              normalizedEmail || null
            );
          const userId = createdUser.lastInsertRowid as number;
          db.prepare('INSERT INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
            userId,
            store.id,
            role
          );
          writeAdminLog(
            `Created user "${normalizedUsername}" with ${role} access`,
            req.user.id,
            store.id
          );
          return db
            .prepare(
              `
            SELECT u.id, u.username, u.email, us.role
            FROM user_stores us
            JOIN users u ON u.id = us.user_id
            WHERE us.user_id = ? AND us.store_id = ?
          `
            )
            .get(userId, store.id) as any;
        })();

        return res.status(201).json({
          ...(createdAccess ?? {
            id: null,
            username: normalizedUsername,
            email: normalizedEmail || null,
            role,
          }),
          created: true,
          // The UI surfaces this exactly once, so admins can hand it to the new user.
          tempPassword,
        });
      } catch (error) {
        logError('admin:create-store-user', error, 'Failed to create store user', {
          storeId: req.params.id,
        });
        return res.status(500).json({ error: 'An internal error occurred' });
      }
    }

    const userMatches = db
      .prepare('SELECT id, username, email, store_id FROM users WHERE username = ?')
      .all(normalizedUsername) as any[];
    if (userMatches.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userMatches.length > 1) {
      return res.status(409).json({
        error: 'Multiple users share that username. Use a unique username before granting access.',
      });
    }
    const user = userMatches[0];
    const existing = db
      .prepare('SELECT 1 FROM user_stores WHERE user_id = ? AND store_id = ?')
      .get(user.id, storeId);
    if (existing) return res.status(409).json({ error: 'User already has access to this store' });
    db.prepare('INSERT INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      user.id,
      storeId,
      role
    );
    writeAdminLog(`Granted ${role} access to "${normalizedUsername}"`, req.user.id, storeId);
    const createdAccess = db
      .prepare(
        `
      SELECT u.id, u.username, u.email, us.role
      FROM user_stores us
      JOIN users u ON u.id = us.user_id
      WHERE us.user_id = ? AND us.store_id = ?
    `
      )
      .get(user.id, storeId) as any;
    res
      .status(201)
      .json(
        createdAccess ?? { id: user.id, username: user.username, email: user.email ?? null, role }
      );
  })
);

// Super admin — revoke a user's access to a store
adminRouter.delete(
  '/stores/:id/users/:userId',
  authenticateToken,
  requireSuperadmin,
  (req: AuthRequest, res) => {
    const storeId = parseIdParam(req.params.id);
    const userId = parseIdParam(req.params.userId);
    if (storeId === null || userId === null) {
      return res.status(400).json({ error: 'Invalid store or user ID' });
    }
    if (storeId === HQ_STORE_ID) {
      return res.status(403).json({ error: 'The HQ store is managed internally' });
    }
    const target = db
      .prepare(
        `
      SELECT us.role, u.store_id AS primary_store_id
      FROM user_stores us
      JOIN users u ON u.id = us.user_id
      WHERE us.user_id = ? AND us.store_id = ?
    `
      )
      .get(userId, storeId) as any;
    if (!target) return res.status(404).json({ error: 'User does not have access to this store' });
    if (target.primary_store_id === storeId) {
      return res.status(400).json({ error: 'Cannot revoke a user from their primary store' });
    }
    // Prevent removing the last owner
    const ownerCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM user_stores WHERE store_id = ? AND role = 'owner'")
        .get(storeId) as any
    ).c;
    if (target?.role === 'owner' && ownerCount <= 1)
      return res.status(400).json({ error: 'Cannot remove the last owner of a store' });
    db.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_id = ?').run(userId, storeId);
    writeAdminLog(`Revoked store access for user ${userId}`, req.user.id, storeId);
    res.json({ ok: true });
  }
);

// Super admin — delete store + all associated data
adminRouter.delete(
  '/stores/:id',
  authenticateToken,
  requireSuperadmin,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    const storeId = parseIdParam(req.params.id);
    if (storeId === null) return res.status(400).json({ error: 'Invalid store ID' });
    if (storeId === HQ_STORE_ID) {
      return res.status(403).json({ error: 'The HQ store is managed internally' });
    }
    const store = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId) as any;
    if (!store) return res.status(404).json({ error: 'Store not found' });

    // Collect the store's own uploaded images before the rows naming them are deleted.
    // Without this every deleted store left its product images on disk forever.
    const uploadedImages = (
      db
        .prepare(
          `SELECT image AS path FROM inventory WHERE store_id = ? AND image LIKE '/uploads/%'
         UNION
         SELECT logo AS path FROM stores WHERE id = ? AND logo LIKE '/uploads/%'`
        )
        .all(storeId, storeId) as Array<{ path: string }>
    ).map(row => row.path);

    db.transaction(() => {
      // Delete in dependency order
      db.prepare(
        `DELETE FROM session_items WHERE session_id IN (SELECT session_id FROM scan_sessions WHERE store_id = ?)`
      ).run(storeId);
      db.prepare(`DELETE FROM scan_sessions WHERE store_id = ?`).run(storeId);
      db.prepare(`DELETE FROM inventory WHERE store_id = ?`).run(storeId);
      db.prepare(`DELETE FROM categories WHERE store_id = ?`).run(storeId);
      db.prepare(`DELETE FROM logs WHERE store_id = ?`).run(storeId);
      // M-22: Re-home multi-store users so users.store_id no longer points at the
      // store we're about to delete (satisfies the users.store_id FK).
      db.prepare(
        `
      UPDATE users
      SET
        store_id = (
          SELECT us.store_id FROM user_stores us
          JOIN stores s ON s.id = us.store_id
          WHERE us.user_id = users.id AND us.store_id != ?
          LIMIT 1
        ),
        store_name = (
          SELECT s.name FROM user_stores us
          JOIN stores s ON s.id = us.store_id
          WHERE us.user_id = users.id AND us.store_id != ?
          LIMIT 1
        )
      WHERE store_id = ? AND id IN (
        SELECT user_id FROM user_stores WHERE store_id != ?
      )
    `
      ).run(storeId, storeId, storeId, storeId);
      // Remove user_stores rows for this store BEFORE deleting users, so the
      // user_stores.user_id FK does not block the user DELETE below.
      db.prepare(`DELETE FROM user_stores WHERE store_id = ?`).run(storeId);
      // Delete sole-store users (re-homed multi-store users now have store_id ≠ storeId).
      db.prepare(`DELETE FROM users WHERE store_id = ?`).run(storeId);
      db.prepare(`DELETE FROM stores WHERE id = ?`).run(storeId);
    })();

    // Only after the transaction commits — a rollback must not take the files with it — and
    // only for files nothing else still references.
    const stillReferenced = referencedUploadFileNames();
    await removeUploadedFiles(
      uploadedImages.filter(image => !stillReferenced.has(uploadFileName(image)))
    );

    writeAdminLog(`Deleted store "${store.name}" (${storeId})`, req.user.id, HQ_STORE_ID);

    res.json({ ok: true, deleted: store.name });
  })
);

// Super admin — edit store details
adminRouter.put('/stores/:id', authenticateToken, requireSuperadmin, (req: AuthRequest, res) => {
  const storeId = parseIdParam(req.params.id);
  if (storeId === null) return res.status(400).json({ error: 'Invalid store ID' });
  if (storeId === HQ_STORE_ID) {
    return res.status(403).json({ error: 'The HQ store is managed internally' });
  }
  const { name, street, city, zipcode, state, phone, email, logo } = req.body;
  const stringFields = { name, street, city, zipcode, state, phone, email };
  if (
    Object.values(stringFields).some(value => value !== undefined && typeof value !== 'string') ||
    (logo !== undefined && logo !== null && typeof logo !== 'string')
  ) {
    return res.status(400).json({ error: 'Store fields must be strings' });
  }
  if (typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'Store name is required' });
  if (name.length > 100)
    return res.status(400).json({ error: 'Store name must be 100 characters or fewer' });
  if (street && street.length > 200) {
    return res.status(400).json({ error: 'Street address must be 200 characters or fewer' });
  }
  if (city && city.length > 100) {
    return res.status(400).json({ error: 'City/Town must be 100 characters or fewer' });
  }
  if (email && email.length > 200) {
    return res.status(400).json({ error: 'Email must be 200 characters or fewer' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (phone && !/^\d{10}$/.test(String(phone).replaceAll(/\D/g, ''))) {
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  }
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode)) {
    return res.status(400).json({ error: 'Zipcode format: 12345 or 12345-6789' });
  }
  try {
    // An omitted logo keeps the current one; null or an empty string clears it.
    const savedLogo = logo === undefined ? undefined : logo ? saveBase64Image(logo) : null;
    db.prepare(
      `UPDATE stores SET name = ?, street = ?, city = ?, zipcode = ?, state = ?, phone = ?, email = ?${
        savedLogo === undefined ? '' : ', logo = ?'
      } WHERE id = ?`
    ).run(
      name.trim(),
      street || null,
      city || null,
      zipcode || null,
      state || null,
      phone || null,
      email || null,
      ...(savedLogo === undefined ? [] : [savedLogo]),
      storeId
    );
    db.prepare('UPDATE users SET store_name = ? WHERE store_id = ?').run(name.trim(), storeId);
    writeAdminLog(`Updated store "${name.trim()}" (${storeId})`, req.user.id, storeId);

    const updatedStore = db
      .prepare(
        'SELECT id, name, street, city, zipcode, state, phone, email, logo, status FROM stores WHERE id = ?'
      )
      .get(storeId);

    res.json(updatedStore);
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: error.message });
    }

    logError('admin:edit-store', error, 'Failed to edit store', {
      storeId: req.params.id,
    });
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

adminRouter.post(
  '/users/:userId/reset-password',
  authenticateToken,
  requireSuperadmin,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    const userId = parseIdParam(req.params.userId);
    if (userId === null) return res.status(400).json({ error: 'Invalid user ID' });

    const user = db
      .prepare('SELECT id, username, store_id FROM users WHERE id = ?')
      .get(userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, BCRYPT_COST);
    db.prepare(
      `
    UPDATE users
    SET password = ?,
        failed_login_attempts = 0,
        locked_until = NULL,
        must_reset_password = 1,
        token_version = COALESCE(token_version, 1) + 1
    WHERE id = ?
  `
    ).run(hash, userId);
    writeAdminLog(
      `Reset password for "${user.username}" (${userId})`,
      req.user.id,
      user.store_id ?? HQ_STORE_ID
    );

    // Resets also hand back a one-time password and route the user through the same
    // forced password-change flow as a newly created account.
    res.json({ tempPassword, username: user.username });
  })
);
