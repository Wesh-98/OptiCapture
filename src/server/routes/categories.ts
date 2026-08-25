import express from 'express';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import type { AuthRequest } from '../types.js';

export const categoriesRouter = express.Router();

const RESERVED_CATEGORY_NAMES = ['inventory'];
const reservedCategoryPlaceholders = RESERVED_CATEGORY_NAMES.map(() => '?').join(', ');
const visibleCategoryCondition = `LOWER(TRIM(c.name)) NOT IN (${reservedCategoryPlaceholders})`;

function isReservedCategoryName(name: string): boolean {
  return RESERVED_CATEGORY_NAMES.includes(name.trim().toLowerCase());
}

// Dashboard Stats
categoriesRouter.get('/dashboard/stats', authenticateToken, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const totalCategories = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM categories c
       WHERE c.store_id = ? AND ${visibleCategoryCondition}`
    )
    .get(storeId, ...RESERVED_CATEGORY_NAMES) as any;
  const totalItems = db
    .prepare('SELECT COUNT(*) as count FROM inventory WHERE store_id = ?')
    .get(storeId) as any;
  const inStock = db
    .prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity > 0 AND store_id = ?')
    .get(storeId) as any;
  const outOfStock = db
    .prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity = 0 AND store_id = ?')
    .get(storeId) as any;

  res.json({
    totalCategories: totalCategories.count,
    totalItems: totalItems.count,
    inStock: inStock.count,
    outOfStock: outOfStock.count,
  });
});

categoriesRouter.get('/categories', authenticateToken, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const categories = db
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
  res.json(categories);
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

    db.transaction(() => {
      db.prepare('UPDATE categories SET status = ? WHERE id = ? AND store_id = ?').run(
        status,
        id,
        storeId
      );
      if (status === 'Inactive') {
        db.prepare('UPDATE inventory SET status = ? WHERE category_id = ? AND store_id = ?').run(
          'Inactive',
          id,
          storeId
        );
      }
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
    db.prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?').run(id, storeId);
    res.json({ success: true });
  }
);

categoriesRouter.post('/categories', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  const { name, icon } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  if (isReservedCategoryName(name)) {
    return res.status(400).json({ error: 'Inventory is not a category name' });
  }
  const storeId = req.user.store_id;
  try {
    const info = db
      .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)')
      .run(name.trim(), icon || 'Package', storeId);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Category name already exists' });
    console.error('[categories:create]', err);
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
    if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
    if (isReservedCategoryName(name)) {
      return res.status(400).json({ error: 'Inventory is not a category name' });
    }
    try {
      db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ? AND store_id = ?').run(
        name.trim(),
        icon || 'Package',
        id,
        storeId
      );
      res.json({ success: true });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE'))
        return res.status(409).json({ error: 'Category name already exists' });
      console.error('[categories:update]', err);
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
    db.transaction(() => {
      db.prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?').run(id, storeId);
      db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').run(id, storeId);
    })();
    res.json({ success: true });
  }
);
