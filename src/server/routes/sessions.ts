import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { authenticateToken, requireOwner, scanLimiter } from '../middleware.js';
import { upcCache, upcCacheSet, UPC_CACHE_TTL } from '../cache.js';
import { lookupProductByUpc, upcVariants, generateOTP } from '../helpers.js';
import { SESSION_STATUS } from '../types.js';

export const sessionsRouter = express.Router();

sessionsRouter.post('/session/create', authenticateToken, (req: any, res) => {
  // Reuse an existing active empty session for this user — prevents a new session
  // being registered every time the Scan page is opened without scanning anything
  const existing = db.prepare(`
    SELECT session_id, otp FROM scan_sessions
    WHERE user_id = ? AND store_id = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND session_id NOT IN (SELECT DISTINCT session_id FROM session_items)
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id, req.user.store_id) as any;

  if (existing) {
    // Upgrade OTP if it's in the old 6-digit format
    const otp = existing.otp.length < 8 ? generateOTP() : existing.otp;
    db.prepare("UPDATE scan_sessions SET otp = ?, expires_at = datetime('now', '+8 hours') WHERE session_id = ?")
      .run(otp, existing.session_id);
    return res.json({ sessionId: existing.session_id, otp });
  }

  const sessionId = randomUUID();
  const otp = generateOTP();
  try {
    db.prepare('INSERT INTO scan_sessions (session_id, otp, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run(sessionId, otp, req.user.id, req.user.store_id);
    try {
      db.prepare("UPDATE scan_sessions SET expires_at = datetime('now', '+8 hours') WHERE session_id = ?")
        .run(sessionId);
    } catch {}
    res.json({ sessionId, otp });
  } catch (err: any) {
    console.error('Failed to create scan session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

sessionsRouter.get('/sessions/active', authenticateToken, (req: any, res: any) => {
  const sessions = db.prepare(`
    SELECT s.session_id, s.status, s.created_at, s.expires_at, s.otp, s.label,
           COUNT(si.id) AS item_count,
           MAX(si.scanned_at) AS last_scan_at,
           u.username AS created_by
    FROM scan_sessions s
    LEFT JOIN session_items si ON si.session_id = s.session_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.store_id = ? AND s.status IN ('active', 'draft')
      AND s.expires_at > datetime('now')
    GROUP BY s.session_id
    HAVING item_count > 0
    ORDER BY s.created_at DESC
    LIMIT 10
  `).all(req.user.store_id);
  res.json(sessions);
});

sessionsRouter.patch('/session/:id/status', authenticateToken, (req: any, res: any) => {
  const { id: sessionId } = req.params;
  const { status, label } = req.body;

  if (!['draft', 'active'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be draft or active.' });
  }

  const session = db.prepare(
    'SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?'
  ).get(sessionId, req.user.store_id) as any;

  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (status === SESSION_STATUS.ACTIVE) {
    // Resume: reset expiry
    db.prepare(
      "UPDATE scan_sessions SET status = 'active', expires_at = datetime('now', '+8 hours') WHERE session_id = ?"
    ).run(sessionId);
  } else {
    // Saving as draft — extend expiry 24 hours from now so the owner can review it later
    db.prepare(
      "UPDATE scan_sessions SET status = ?, label = COALESCE(?, label), expires_at = datetime('now', '+24 hours') WHERE session_id = ?"
    ).run(status, label ?? null, sessionId);
  }

  res.json({ success: true, status });
});

sessionsRouter.delete('/session/:id', authenticateToken, (req: any, res: any) => {
  const { id: sessionId } = req.params;
  const session = db.prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(sessionId, req.user.store_id) as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === SESSION_STATUS.COMPLETED) return res.status(403).json({ error: 'Cannot delete a committed session.' });
  // Only remove the session record — session_items kept as audit trail
  db.prepare('DELETE FROM scan_sessions WHERE session_id = ?').run(sessionId);
  res.json({ success: true });
});

sessionsRouter.get('/session/:id/meta', authenticateToken, (req: any, res: any) => {
  const session = db.prepare(
    'SELECT session_id, status, label, created_at, otp FROM scan_sessions WHERE session_id = ? AND store_id = ?'
  ).get(req.params.id, req.user.store_id) as any;
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

sessionsRouter.get('/session/:id/items', scanLimiter, (req: any, res: any) => {
  const { id: sessionId } = req.params;
  const { otp, device_id } = req.query;

  if (!otp) return res.status(400).json({ error: 'OTP required' });

  const session = db.prepare(
    'SELECT * FROM scan_sessions WHERE session_id = ? AND otp = ?'
  ).get(sessionId, otp) as any;

  if (!session) return res.status(403).json({ error: 'Invalid session or OTP' });

  //Exoired sessions shouldn't be readable via OTP.
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Session has expired. Please start a new session.' });
  }
  
  // If caller has a valid JWT, enforce store ownership (defence-in-depth for browser clients)
  try {
    const token = (req as any).cookies?.token;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app',
      }) as any;
      if (payload?.store_id && payload.store_id !== session.store_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
  } catch { /* invalid/expired token — OTP is sufficient for phone clients */ }

  const items = device_id
    ? db.prepare(
        'SELECT * FROM session_items WHERE session_id = ? AND (device_id = ? OR device_id IS NULL) ORDER BY scanned_at ASC'
      ).all(sessionId, device_id) as any[]
    : db.prepare(
        'SELECT * FROM session_items WHERE session_id = ? ORDER BY scanned_at ASC'
      ).all(sessionId) as any[];

  res.json({ status: session.status, items });
});

sessionsRouter.get('/session/:id', authenticateToken, (req: any, res) => {
  const { id } = req.params;
  const { since_id } = req.query; // integer item ID cursor — return only items with id > since_id
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const COLS = `si.id, si.session_id, si.upc, si.quantity, si.scanned_at,
                si.lookup_status, si.product_name, si.brand, si.image,
                si.source, si.exists_in_inventory, si.sale_price, si.unit, si.tag_names`;

  const items = since_id
    ? db.prepare(`SELECT ${COLS} FROM session_items si WHERE si.session_id = ? AND si.id > ? ORDER BY si.id DESC`).all(id, Number(since_id))
    : db.prepare(`SELECT ${COLS} FROM session_items si WHERE si.session_id = ? ORDER BY si.id DESC`).all(id);

  res.json({ items, expires_at: session.expires_at ?? null });
});

sessionsRouter.post('/session/:id/scan', scanLimiter, async (req, res) => {
  const { id } = req.params;
  const { upc, otp, item_name } = req.body;
  const deviceId = (req.headers['x-device-id'] as string | undefined) ?? null;

  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) {
    return res.status(400).json({ error: 'UPC is required' });
  }
  if (cleanUpc.length > 128) {
    return res.status(400).json({ error: 'UPC too long' });
  }

  const session = db.prepare(
    "SELECT * FROM scan_sessions WHERE session_id = ?"
  ).get(id) as any;

  if (!session) {
    return res.status(404).json({ error: 'Session not found or inactive' });
  }

  if (session.status === SESSION_STATUS.DRAFT) {
    return res.status(403).json({ error: 'Session is saved as draft. Resume scanning first.' });
  }

  if (session.status !== SESSION_STATUS.ACTIVE) {
    return res.status(404).json({ error: 'Session not found or inactive' });
  }

  // Check session expiry
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Session has expired. Please start a new session.' });
  }

  // Check OTP attempts
  if (session.otp_attempts >= 5) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Please start a new session.' });
  }

  // If OTP doesn't match, increment attempts
  if (!otp || otp !== session.otp) {
    db.prepare('UPDATE scan_sessions SET otp_attempts = otp_attempts + 1 WHERE session_id = ?').run(session.session_id);
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  // If caller is an authenticated user (has JWT cookie), validate they belong to the same store.
  // Mobile phones have no JWT so this check is skipped for them — OTP alone is their auth.
  try {
    const token = (req as any).cookies?.token;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app',
      }) as any;
      if (payload?.store_id && payload.store_id !== session.store_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
  } catch { /* invalid/expired token — treat as unauthenticated, OTP is sufficient */ }

  // Try exact UPC first, then leading-zero variant (EAN-13 ↔ UPC-A)
  const inventoryMatch = upcVariants(cleanUpc)
    .map(v => db.prepare('SELECT id, item_name, image FROM inventory WHERE upc = ? AND store_id = ? LIMIT 1').get(v, session.store_id) as any)
    .find(Boolean) ?? null;

  // --- Resolve product info (cache-first, non-blocking for external lookups) ---
  let lookupStatus = 'unknown';
  let productName: string | null = null;
  let brand: string | null = null;
  let image: string | null = null;
  let source = 'scan_only';
  let existsInInventory = 0;
  let needsBackgroundLookup = false;

  if (inventoryMatch) {
    // Already in this store's inventory — fastest path
    lookupStatus = 'existing';
    productName = inventoryMatch.item_name || null;
    image = inventoryMatch.image || null;
    source = 'inventory';
    existsInInventory = 1;
  } else if (item_name) {
    // Taker manually typed a name — use it immediately, no API needed
    productName = String(item_name).trim() || null;
    if (productName) lookupStatus = 'new_candidate';
    source = 'manual';
  } else {
    // Check in-memory cache before hitting external APIs — try all UPC variants
    const cached = upcVariants(cleanUpc).map(v => upcCache.get(v)).find(c => c && Date.now() - c.ts < UPC_CACHE_TTL) ?? null;
    if (cached) {
      lookupStatus = cached.product_name ? 'new_candidate' : 'unknown';
      productName = cached.product_name;
      brand = cached.brand;
      image = cached.image;
      source = cached.source;
    } else {
      // Cache miss — write what we have now, resolve in background
      needsBackgroundLookup = true;
    }
  }

  // --- Atomic upsert (respond immediately — no waiting for external API) ---
  // SQLite serializes all write transactions so the SELECT-then-INSERT/UPDATE is race-free.
  const upsertScan = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id FROM session_items WHERE session_id = ? AND upc = ?'
    ).get(id, cleanUpc) as any;

    if (existing) {
      db.prepare(`
        UPDATE session_items
        SET quantity = quantity + 1, scanned_at = CURRENT_TIMESTAMP,
            lookup_status = ?, product_name = COALESCE(?, product_name),
            brand = COALESCE(?, brand), image = COALESCE(?, image),
            source = ?, exists_in_inventory = ?
        WHERE id = ?
      `).run(lookupStatus, productName, brand, image, source, existsInInventory, existing.id);
    } else {
      db.prepare(`
        INSERT INTO session_items (session_id, upc, quantity, lookup_status, product_name, brand, image, source, exists_in_inventory, device_id)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, cleanUpc, lookupStatus, productName, brand, image, source, existsInInventory, deviceId);
    }

    db.prepare("UPDATE scan_sessions SET expires_at = datetime('now', '+8 hours') WHERE session_id = ?").run(id);

    return db.prepare(`
      SELECT id, session_id, upc, quantity, scanned_at, lookup_status, product_name, brand, image, source, exists_in_inventory
      FROM session_items WHERE session_id = ? AND upc = ?
    `).get(id, cleanUpc);
  });

  const updatedItem = upsertScan();

  // Respond immediately — phone is unblocked
  res.json({ success: true, item: updatedItem });

  // Background lookup — fires after response is sent, result visible on next poll
  if (needsBackgroundLookup) {
    lookupProductByUpc(cleanUpc).then(result => {
      const resolvedName    = result?.product_name || null;
      const resolvedBrand   = result?.brand || null;
      const resolvedImage   = result?.image || null;
      const resolvedSource  = result?.source || 'scan_only';
      const resolvedStatus  = resolvedName ? 'new_candidate' : 'unknown';

      // Update cache regardless of whether we found anything
      upcCacheSet(cleanUpc, { product_name: resolvedName, brand: resolvedBrand, image: resolvedImage, source: resolvedSource, ts: Date.now() });

      // Only update DB if we actually got something useful
      if (resolvedName) {
        db.prepare(`
          UPDATE session_items
          SET lookup_status = ?, product_name = COALESCE(?, product_name),
              brand = COALESCE(?, brand), image = COALESCE(?, image), source = ?
          WHERE session_id = ? AND upc = ?
        `).run(resolvedStatus, resolvedName, resolvedBrand, resolvedImage, resolvedSource, id, cleanUpc);
      }
    }).catch(() => {
      // External API failed — cache as unknown so we don't retry until TTL expires
      upcCacheSet(cleanUpc, { product_name: null, brand: null, image: null, source: 'scan_only', ts: Date.now() });
    });
  }
});

sessionsRouter.patch('/session/:id/items/:itemId', authenticateToken, (req: any, res) => {
  const { id, itemId } = req.params;
  const { product_name, brand, quantity, upc, image, tag_names, sale_price, unit } = req.body;

  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`
    UPDATE session_items
    SET product_name = ?, brand = ?, quantity = ?, upc = COALESCE(?, upc),
        image = ?, tag_names = ?, sale_price = ?, unit = ?, lookup_status = 'new_candidate'
    WHERE id = ? AND session_id = ?
  `).run(product_name || null, brand || null, quantity || 1, upc || null, image || null, tag_names || null, sale_price || null, unit || null, itemId, id);

  res.json({ success: true });
});

sessionsRouter.delete('/session/:id/items', authenticateToken, (req: any, res: any) => {
  const session = db.prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(req.params.id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status === 'completed') return res.status(403).json({ error: 'Cannot clear a committed session' });
  db.prepare('DELETE FROM session_items WHERE session_id = ?').run(req.params.id);
  res.json({ success: true });
});

sessionsRouter.delete('/session/:id/items/:itemId', authenticateToken, (req: any, res) => {
  const { id, itemId } = req.params;
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM session_items WHERE id = ? AND session_id = ?').run(itemId, id);
  res.json({ success: true });
});

sessionsRouter.post('/session/:id/commit', authenticateToken, requireOwner, (req: any, res) => {
  const { id } = req.params;
  // assignments: per-item [{id, category_id}] — new format
  // selectedIds + category_id — legacy fallback (single category for all)
  const { assignments, selectedIds, category_id } = req.body as {
    assignments?: Array<{ id: number; category_id: number }>;
    selectedIds?: number[];
    category_id?: number;
  };
  const user = req.user;

  // Build a normalised id→category_id map
  let assignmentMap: Map<number, number>;
  if (assignments?.length) {
    assignmentMap = new Map(assignments.map(a => [Number(a.id), Number(a.category_id)]));
  } else if (category_id && selectedIds?.length) {
    assignmentMap = new Map(selectedIds.map(id => [Number(id), Number(category_id)]));
  } else {
    return res.status(400).json({ error: 'assignments (or selectedIds + category_id) is required' });
  }

  // Verify session belongs to this store
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Validate every category_id in the map belongs to this store
  const uniqueCatIds = [...new Set(assignmentMap.values())];
  const validCats = db.prepare(
    `SELECT id, name FROM categories WHERE store_id = ? AND id IN (${uniqueCatIds.map(() => '?').join(',')})`
  ).all(user.store_id, ...uniqueCatIds) as any[];
  if (validCats.length !== uniqueCatIds.length) {
    return res.status(400).json({ error: 'One or more categories are invalid' });
  }
  const catNameMap = new Map(validCats.map((c: any) => [c.id, c.name]));

  // Load only the items that are in the assignment map
  const allItems = db.prepare('SELECT * FROM session_items WHERE session_id = ?').all(id) as any[];
  const items = allItems.filter((item: any) => assignmentMap.has(item.id));

  if (items.length === 0) return res.json({ message: 'No items to commit' });

  const insertInventory = db.prepare(`
    INSERT INTO inventory (item_name, upc, quantity, category_id, status, image, sale_price, unit, store_id)
    VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)
  `);
  const checkInventory = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?');
  const deleteSessionItem = db.prepare('DELETE FROM session_items WHERE id = ?');

  const transaction = db.transaction((sessionItems: any[]) => {
    let inserted = 0;
    let skippedExisting = 0;
    let skippedUnknown = 0;
    const byCategory: Record<number, number> = {};

    for (const item of sessionItems) {
      if (checkInventory.get(item.upc, user.store_id)) { skippedExisting++; continue; }
      if (item.lookup_status !== 'new_candidate') { skippedUnknown++; continue; }

      const catId = assignmentMap.get(item.id)!;
      const qty = Math.max(0, Math.min(Number.parseFloat(item.quantity) || 0, 1_000_000));
      const price = item.sale_price != null ? Math.max(0, Number.parseFloat(item.sale_price) || 0) : null;
      insertInventory.run(
        item.product_name || 'Unknown Scanned Item',
        item.upc, qty, catId,
        item.image || null,
        price,
        item.unit || null,
        user.store_id
      );
      deleteSessionItem.run(item.id);
      byCategory[catId] = (byCategory[catId] ?? 0) + 1;
      inserted++;
    }

    // Only complete the session if every item was either committed or skipped
    const remaining = db.prepare('SELECT COUNT(*) as n FROM session_items WHERE session_id = ?').get(id) as any;
    if (remaining.n === 0) {
      db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(id);
    }
    return { inserted, skippedExisting, skippedUnknown, byCategory };
  });

  try {
    const result = transaction(items);
    const catSummary = Object.entries(result.byCategory)
      .map(([cid, n]) => `${catNameMap.get(Number(cid)) ?? cid}: ${n}`)
      .join(', ');
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run('BATCH',
        `Committed session ${id} | inserted=${result.inserted} skippedExisting=${result.skippedExisting} skippedUnknown=${result.skippedUnknown} | ${catSummary}`,
        user.id, user.store_id);
    res.json({ success: true, total: items.length, inserted: result.inserted, skippedExisting: result.skippedExisting, skippedUnknown: result.skippedUnknown });
  } catch (err: any) {
    console.error('[session:commit]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});
