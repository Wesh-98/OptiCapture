import express from 'express';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import type { AuthRequest } from '../types.js';
import { logError } from '../logger.js';
import { discardUploads } from '../uploads.js';

export const categoriesRouter = express.Router();

export const RESERVED_CATEGORY_NAMES = ['inventory'];
const reservedCategoryPlaceholders = RESERVED_CATEGORY_NAMES.map(() => '?').join(', ');
/** SQL condition on alias `c` that hides reserved categories; bind RESERVED_CATEGORY_NAMES. */
export const visibleCategoryCondition = `LOWER(TRIM(c.name)) NOT IN (${reservedCategoryPlaceholders})`;

export function isReservedCategoryName(name: string): boolean {
  return RESERVED_CATEGORY_NAMES.includes(name.trim().toLowerCase());
}

const MAX_CATEGORY_ICON_LENGTH = 200;

/**
 * Another category in the store with this name, ignoring case and outer spaces. The table's
 * UNIQUE(name, store_id) is case-sensitive, so "Snacks" and "snacks" could both be created
 * here while the import treated them as one category.
 */
function categoryNameTaken(name: string, storeId: number | undefined, exceptId?: unknown) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM categories
          WHERE LOWER(TRIM(name)) = LOWER(?) AND store_id = ? AND id IS NOT ?`
      )
      .get(name.trim(), storeId, exceptId === undefined ? null : Number(exceptId))
  );
}

/** The uploaded images of a category's items, read before those items are deleted. */
function categoryItemUploads(categoryId: unknown, storeId: number | undefined): string[] {
  return (
    db
      .prepare(
        "SELECT image FROM inventory WHERE category_id = ? AND store_id = ? AND image LIKE '/uploads/%'"
      )
      .all(categoryId, storeId) as Array<{ image: string }>
  ).map(row => row.image);
}

function writeCategoryLog(
  action: string,
  details: string,
  userId: number,
  storeId: number | undefined
) {
  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
    action,
    details,
    userId,
    storeId
  );
}

// Dashboard Stats
categoriesRouter.get('/dashboard/stats', authenticateToken, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const categoryIdParam = req.query.category_id;
  let categoryId: number | null = null;

  if (categoryIdParam !== undefined) {
    categoryId = Number(categoryIdParam);
    if (!Number.isInteger(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }
    const categoryExists = db
      .prepare('SELECT 1 FROM categories WHERE id = ? AND store_id = ?')
      .get(categoryId, storeId);
    if (!categoryExists) return res.status(404).json({ error: 'Category not found' });
  }

  const totalCategories = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM categories c
       WHERE c.store_id = ? AND ${visibleCategoryCondition}`
    )
    .get(storeId, ...RESERVED_CATEGORY_NAMES) as any;
  const categoryCondition = categoryId === null ? '' : ' AND category_id = ?';
  const inventoryParams = categoryId === null ? [storeId] : [storeId, categoryId];
  const totalItems = db
    .prepare(`SELECT COUNT(*) as count FROM inventory WHERE store_id = ?${categoryCondition}`)
    .get(...inventoryParams) as any;
  const inStock = db
    .prepare(
      `SELECT COUNT(*) as count FROM inventory WHERE quantity > 0 AND store_id = ?${categoryCondition}`
    )
    .get(...inventoryParams) as any;
  const outOfStock = db
    .prepare(
      `SELECT COUNT(*) as count FROM inventory WHERE COALESCE(quantity, 0) <= 0 AND store_id = ?${categoryCondition}`
    )
    .get(...inventoryParams) as any;

  res.json({
    totalCategories: totalCategories.count,
    totalItems: totalItems.count,
    inStock: inStock.count,
    outOfStock: outOfStock.count,
  });
});

/** A store's visible categories with item counts. Shared with the superadmin per-store view. */
export function listStoreCategories(storeId: number | undefined) {
  return db
    .prepare(
      `
    SELECT c.*,
    (SELECT COUNT(*) FROM inventory i WHERE i.category_id = c.id AND i.store_id = ?) as item_count,
    (SELECT SUM(quantity) FROM inventory i WHERE i.category_id = c.id AND i.store_id = ?) as total_stock
    FROM categories c
    WHERE c.store_id = ? AND ${visibleCategoryCondition}
    ORDER BY c.name ASC
  `
    )
    .all(storeId, storeId, storeId, ...RESERVED_CATEGORY_NAMES);
}

categoriesRouter.get('/categories', authenticateToken, (req: AuthRequest, res) => {
  res.json(listStoreCategories(req.user.store_id));
});

categoriesRouter.put(
  '/categories/:id/status',
  authenticateToken,
  requireOwner,
  (req: AuthRequest, res) => {
    const { status } = req.body;
    const { id } = req.params;
    const storeId = req.user.store_id;

    // Allowlist to prevent arbitrary strings (including objects coerced to '[object Object]') from being written
    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Active or Inactive' });
    }

    const category = db
      .prepare('SELECT name FROM categories WHERE id = ? AND store_id = ?')
      .get(id, storeId) as { name: string } | undefined;
    if (!category) return res.status(404).json({ error: 'Category not found' });

    db.transaction(() => {
      db.prepare('UPDATE categories SET status = ? WHERE id = ? AND store_id = ?').run(
        status,
        id,
        storeId
      );
      db.prepare('UPDATE inventory SET status = ? WHERE category_id = ? AND store_id = ?').run(
        status,
        id,
        storeId
      );
      writeCategoryLog(
        'UPDATE',
        `Set category "${category.name}" to ${status}`,
        req.user.id,
        storeId
      );
    })();

    res.json({ success: true });
  }
);

categoriesRouter.delete(
  '/categories/:id/items',
  authenticateToken,
  requireOwner,
  (req: AuthRequest, res) => {
    const { id } = req.params;
    const storeId = req.user.store_id;
    const category = db
      .prepare('SELECT name FROM categories WHERE id = ? AND store_id = ?')
      .get(id, storeId) as { name: string } | undefined;
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const images = categoryItemUploads(id, storeId);
    db.transaction(() => {
      const result = db
        .prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?')
        .run(id, storeId);
      writeCategoryLog(
        'DELETE',
        `Deleted ${result.changes} item(s) from category "${category.name}"`,
        req.user.id,
        storeId
      );
    })();
    discardUploads(images);
    res.json({ success: true });
  }
);

categoriesRouter.post('/categories', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  const { name, icon } = req.body;
  if (typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'Category name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Category name is too long' });
  if (icon !== undefined && typeof icon !== 'string')
    return res.status(400).json({ error: 'Category icon must be a string' });
  if (icon && icon.length > MAX_CATEGORY_ICON_LENGTH)
    return res.status(400).json({ error: 'Category icon is too long' });
  if (isReservedCategoryName(name)) {
    return res.status(400).json({ error: 'Inventory is not a category name' });
  }
  const storeId = req.user.store_id;
  if (categoryNameTaken(name, storeId))
    return res.status(409).json({ error: 'Category name already exists' });
  try {
    const info = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)')
        .run(name.trim(), icon || 'Package', storeId);
      writeCategoryLog('CREATE', `Created category "${name.trim()}"`, req.user.id, storeId);
      return result;
    })();
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Category name already exists' });
    logError('categories:create', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

categoriesRouter.put(
  '/categories/:id',
  authenticateToken,
  requireOwner,
  (req: AuthRequest, res) => {
    const { name, icon } = req.body;
    const { id } = req.params;
    const storeId = req.user.store_id;
    if (typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Category name is required' });
    if (name.length > 100) return res.status(400).json({ error: 'Category name is too long' });
    if (icon !== undefined && typeof icon !== 'string')
      return res.status(400).json({ error: 'Category icon must be a string' });
    if (icon && icon.length > MAX_CATEGORY_ICON_LENGTH)
      return res.status(400).json({ error: 'Category icon is too long' });
    if (isReservedCategoryName(name)) {
      return res.status(400).json({ error: 'Inventory is not a category name' });
    }
    if (categoryNameTaken(name, storeId, id))
      return res.status(409).json({ error: 'Category name already exists' });
    try {
      const updated = db.transaction(() => {
        const result = db
          .prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ? AND store_id = ?')
          .run(name.trim(), icon || 'Package', id, storeId);
        if (result.changes) {
          writeCategoryLog('UPDATE', `Updated category "${name.trim()}"`, req.user.id, storeId);
        }
        return result.changes;
      })();
      if (!updated) return res.status(404).json({ error: 'Category not found' });
      res.json({ success: true });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE'))
        return res.status(409).json({ error: 'Category name already exists' });
      logError('categories:update', err, 'Failed to update category', {
        categoryId: req.params.id,
      });
      res.status(500).json({ error: 'An internal error occurred' });
    }
  }
);

categoriesRouter.delete(
  '/categories/:id',
  authenticateToken,
  requireOwner,
  (req: AuthRequest, res) => {
    const { id } = req.params;
    const storeId = req.user.store_id;
    const category = db
      .prepare('SELECT name FROM categories WHERE id = ? AND store_id = ?')
      .get(id, storeId) as { name: string } | undefined;
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const images = categoryItemUploads(id, storeId);
    db.transaction(() => {
      db.prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?').run(id, storeId);
      db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').run(id, storeId);
      writeCategoryLog('DELETE', `Deleted category "${category.name}"`, req.user.id, storeId);
    })();
    discardUploads(images);
    res.json({ success: true });
  }
);
