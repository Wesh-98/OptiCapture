import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authenticateToken } from '../middleware.js';
import { generateTempPassword, saveBase64Image, UnsupportedImageTypeError } from '../helpers.js';

export const adminRouter = express.Router();
const HQ_STORE_ID = 0;
type StoreRole = 'owner' | 'taker';

function isStoreRole(value: unknown): value is StoreRole {
  return value === 'owner' || value === 'taker';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Super admin — list all stores
adminRouter.get('/stores', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const stores = db
    .prepare(
      `
    SELECT s.*,
      COUNT(DISTINCT us.user_id) AS user_count,
      COUNT(DISTINCT i.id) AS item_count
    FROM stores s
    LEFT JOIN user_stores us ON us.store_id = s.id
    LEFT JOIN inventory i ON i.store_id = s.id
    WHERE s.id != ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `
    )
    .all(HQ_STORE_ID);
  res.json(stores);
});

// Super admin — activate or suspend a store
adminRouter.put('/stores/:id/status', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const storeId = Number.parseInt(req.params.id);
  if (Number.isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });
  if (storeId === HQ_STORE_ID) {
    return res.status(403).json({ error: 'The HQ store is managed internally' });
  }
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE stores SET status = ? WHERE id = ?').run(status, storeId);
  res.json({ ok: true });
});

// Super admin — list users with access to a store
adminRouter.get('/stores/:id/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const storeId = Number.parseInt(req.params.id);
  if (Number.isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });
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
});

// Super admin — grant an existing user access or create a brand-new store user
adminRouter.post('/stores/:id/users', authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { username, role, mode, email } = req.body ?? {};
  const storeId = Number.parseInt(req.params.id);
  if (Number.isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });
  if (storeId === HQ_STORE_ID) {
    return res.status(403).json({ error: 'The HQ store is managed internally' });
  }

  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
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
    const passwordHash = await bcrypt.hash(tempPassword, 10);

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
      console.error('[admin:create-store-user]', error);
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
  res.status(201).json(
    createdAccess ?? { id: user.id, username: user.username, email: user.email ?? null, role }
  );
});

// Super admin — revoke a user's access to a store
adminRouter.delete('/stores/:id/users/:userId', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const storeId = Number.parseInt(req.params.id);
  const userId = Number.parseInt(req.params.userId);
  if (Number.isNaN(storeId) || Number.isNaN(userId)) {
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
  db.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_id = ?').run(
    userId,
    storeId
  );
  res.json({ ok: true });
});

// Super admin — delete store + all associated data
adminRouter.delete('/stores/:id', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const storeId = Number(req.params.id);
  if (storeId === HQ_STORE_ID) {
    return res.status(403).json({ error: 'The HQ store is managed internally' });
  }
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
  const storeId = Number.parseInt(req.params.id);
  if (Number.isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });
  if (storeId === HQ_STORE_ID) {
    return res.status(403).json({ error: 'The HQ store is managed internally' });
  }
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
      storeId
    );
    db.prepare('UPDATE users SET store_name = ? WHERE store_id = ?').run(name.trim(), storeId);

    const updatedStore = db
      .prepare(
        'SELECT id, name, street, zipcode, state, phone, email, logo, status FROM stores WHERE id = ?'
      )
      .get(storeId);

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

  // Resets also hand back a one-time password and route the user through the same
  // forced password-change flow as a newly created account.
  res.json({ tempPassword, username: user.username });
});
