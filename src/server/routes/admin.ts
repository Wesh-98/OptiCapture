import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { generateTempPassword, saveBase64Image, UnsupportedImageTypeError } from '../helpers.js';

export const adminRouter = express.Router();

// Super admin — list all stores
adminRouter.get('/stores', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const stores = db
    .prepare(
      `
    SELECT s.*,
      COUNT(DISTINCT u.id) AS user_count,
      COUNT(DISTINCT i.id) AS item_count
    FROM stores s
    LEFT JOIN users u ON u.store_id = s.id
    LEFT JOIN inventory i ON i.store_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `
    )
    .all();
  res.json(stores);
});

// Super admin — activate or suspend a store
adminRouter.put('/stores/:id/status', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE stores SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// Super admin — list users with access to a store
adminRouter.get('/stores/:id/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
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
    .all(req.params.id);
  res.json(users);
});

// Super admin — grant a user access to a store
adminRouter.post('/stores/:id/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { username, role } = req.body;
  if (!username || !['owner', 'taker'].includes(role))
    return res.status(400).json({ error: 'Valid username and role required' });
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  const existing = db
    .prepare('SELECT 1 FROM user_stores WHERE user_id = ? AND store_id = ?')
    .get(user.id, req.params.id);
  if (existing) return res.status(409).json({ error: 'User already has access to this store' });
  db.prepare('INSERT INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
    user.id,
    req.params.id,
    role
  );
  res.json({ ok: true });
});

// Super admin — revoke a user's access to a store
adminRouter.delete('/stores/:id/users/:userId', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  // Prevent removing the last owner
  const ownerCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM user_stores WHERE store_id = ? AND role = 'owner'")
      .get(req.params.id) as any
  ).c;
  const target = db
    .prepare('SELECT role FROM user_stores WHERE user_id = ? AND store_id = ?')
    .get(req.params.userId, req.params.id) as any;
  if (target?.role === 'owner' && ownerCount <= 1)
    return res.status(400).json({ error: 'Cannot remove the last owner of a store' });
  db.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_id = ?').run(
    req.params.userId,
    req.params.id
  );
  res.json({ ok: true });
});

// Super admin — delete store + all associated data
adminRouter.delete('/stores/:id', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const storeId = Number(req.params.id);
  const store = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(storeId) as any;
  if (!store) return res.status(404).json({ error: 'Store not found' });

  db.transaction(() => {
    // Delete in dependency order
    db.prepare(
      `DELETE FROM session_items WHERE session_id IN (SELECT session_id FROM scan_sessions WHERE store_id = ?)`
    ).run(storeId);
    db.prepare(`DELETE FROM scan_sessions WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM inventory WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM categories WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM logs WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM user_stores WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM users WHERE store_id = ?`).run(storeId);
    db.prepare(`DELETE FROM stores WHERE id = ?`).run(storeId);
  })();

  res.json({ ok: true, deleted: store.name });
});

// Super admin — edit store details
adminRouter.put('/stores/:id', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { name, street, zipcode, state, phone, email, logo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Store name is required' });
  try {
    const savedLogo = logo ? saveBase64Image(logo) : null;
    db.prepare(
      'UPDATE stores SET name = ?, street = ?, zipcode = ?, state = ?, phone = ?, email = ?, logo = ? WHERE id = ?'
    ).run(
      name.trim(),
      street || null,
      zipcode || null,
      state || null,
      phone || null,
      email || null,
      savedLogo,
      req.params.id
    );

    const updatedStore = db
      .prepare(
        'SELECT id, name, street, zipcode, state, phone, email, logo, status FROM stores WHERE id = ?'
      )
      .get(req.params.id);

    res.json(updatedStore);
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: error.message });
    }

    console.error('[admin:edit-store]', error);
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

adminRouter.post('/users/:userId/reset-password', authenticateToken, async (req: any, res: any) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userId);

  res.json({ tempPassword, username: user.username });
});
