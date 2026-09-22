import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { authenticateToken, requireOwner, scanLimiter } from '../middleware.js';
import type { AuthRequest } from '../types.js';
import { isTokenRevoked, upcCache, upcCacheSet, UPC_CACHE_TTL } from '../cache.js';
import {
  UnsupportedImageTypeError,
  generateOTP,
  lookupProductByUpc,
  normalizeImageUrl,
  saveBase64Image,
  upcVariants,
} from '../helpers.js';
import { SESSION_STATUS } from '../types.js';
import { logError } from '../logger.js';

export const sessionsRouter = express.Router();

function getMergedDeviceId(
  existingDeviceId: string | null,
  nextDeviceId: string | null
): string | null {
  if (existingDeviceId === null || nextDeviceId === null) return null;
  return existingDeviceId === nextDeviceId ? existingDeviceId : null;
}

function isValidSessionCursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(trimmed)
  );
}

function parseRequestedStoreIdHeader(req: express.Request): number | null {
  const rawHeader = req.headers['x-store-id'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue !== 'string' || !headerValue.trim()) {
    return null;
  }

  const storeId = Number.parseInt(headerValue, 10);
  return Number.isNaN(storeId) ? null : storeId;
}

function getSessionAccessError(
  req: express.Request,
  sessionStoreId: number
): { error: string; status: number } | null {
  const store = db.prepare('SELECT status FROM stores WHERE id = ?').get(sessionStoreId) as
    | { status: string }
    | undefined;
  if (!store || store.status !== 'active') {
    return { error: 'Store account suspended', status: 403 };
  }

  const token = (req as any).cookies?.token;
  if (!token) {
    return null;
  }
  if (isTokenRevoked(token)) {
    return { error: 'Unauthorized', status: 401 };
  }

  try {
    // Auth cookies are now account-scoped, so browser requests hitting OTP
    // routes still need an explicit membership check against user_stores.
    const payload = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
      issuer: 'opticapture',
      audience: 'opticapture-app',
    }) as { id?: number | string; token_version?: number };

    const requestedStoreId = parseRequestedStoreIdHeader(req);
    // If the browser already declared an active store for this tab, require it
    // to match the store backing the OTP session.
    if (requestedStoreId !== null && requestedStoreId !== sessionStoreId) {
      return { error: 'Forbidden', status: 403 };
    }

    const userId = Number.parseInt(String(payload?.id), 10);
    if (Number.isNaN(userId)) {
      return null;
    }

    const dbUser = db
      .prepare('SELECT id, role, token_version, must_reset_password FROM users WHERE id = ?')
      .get(userId) as
      | { id: number; role: string; token_version: number; must_reset_password: number }
      | undefined;

    if (!dbUser || (dbUser.token_version ?? 1) !== (payload.token_version ?? 1)) {
      return { error: 'Unauthorized', status: 401 };
    }
    if (dbUser.must_reset_password === 1 && dbUser.role !== 'superadmin') {
      return { error: 'Password reset required before continuing.', status: 403 };
    }
    if (dbUser.role === 'superadmin') {
      return null;
    }

    const hasAccess = db
      .prepare(
        `
        SELECT 1
        FROM user_stores us
        JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = ? AND us.store_id = ? AND s.status = 'active'
      `
      )
      .get(userId, sessionStoreId);

    if (!hasAccess) {
      return { error: 'Forbidden', status: 403 };
    }
  } catch {
    // Invalid or expired cookies are ignored here so OTP-only phone clients
    // can continue scanning without a browser session.
    return null;
  }

  return null;
}

sessionsRouter.post('/session/create', authenticateToken, (req: AuthRequest, res) => {
  // Reuse an existing active empty session for this user — prevents a new session
  // being registered every time the Scan page is opened without scanning anything
  const existing = db
    .prepare(
      `
    SELECT session_id, otp FROM scan_sessions
    WHERE user_id = ? AND store_id = ? AND status = 'active'
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      AND session_id NOT IN (SELECT DISTINCT session_id FROM session_items)
    ORDER BY created_at DESC LIMIT 1
  `
    )
    .get(req.user.id, req.user.store_id) as any;

  if (existing) {
    // Upgrade OTP if it's in the old 6-digit format
    const otp = existing.otp.length < 8 ? generateOTP() : existing.otp;
    db.prepare(
      `
      UPDATE scan_sessions
      SET otp = ?, otp_attempts = 0, expires_at = datetime('now', '+8 hours')
      WHERE session_id = ?
    `
    ).run(otp, existing.session_id);
    return res.json({ sessionId: existing.session_id, otp });
  }

  const sessionId = randomUUID();
  const otp = generateOTP();
  try {
    // Set expires_at in the same INSERT so it can never be NULL on a fresh session.
    // A separate UPDATE could silently fail (was swallowed by a bare catch), leaving
    // the session with no expiry and making it effectively immortal.
    db.prepare(
      "INSERT INTO scan_sessions (session_id, otp, user_id, store_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+8 hours'))"
    ).run(sessionId, otp, req.user.id, req.user.store_id);
    res.json({ sessionId, otp });
  } catch (err: any) {
    logError('session:create', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

sessionsRouter.get('/sessions/active', authenticateToken, (req: AuthRequest, res) => {
  const sessions = db
    .prepare(
      `
    SELECT s.session_id, s.status, s.created_at, s.expires_at, s.otp, s.label,
           COUNT(si.id) AS item_count,
           MAX(si.scanned_at) AS last_scan_at,
           u.username AS created_by
    FROM scan_sessions s
    LEFT JOIN session_items si ON si.session_id = s.session_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.store_id = ? AND s.status IN ('active', 'draft')
      AND datetime(s.expires_at) > datetime('now')
    GROUP BY s.session_id
    HAVING item_count > 0
    ORDER BY s.created_at DESC
    LIMIT 10
  `
    )
    .all(req.user.store_id);
  res.json(sessions);
});

sessionsRouter.patch('/session/:id/status', authenticateToken, (req: AuthRequest, res) => {
  const { id: sessionId } = req.params;
  const { status, label } = req.body;

  if (!['draft', 'active'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be draft or active.' });
  }

  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(sessionId, req.user.store_id) as any;

  if (!session) return res.status(404).json({ error: 'Session not found' });

  // A committed session is the permanent audit record of a completed inventory run.
  // Allowing it to be re-activated would let items be committed twice.
  if (session.status === SESSION_STATUS.COMPLETED) {
    return res.status(403).json({ error: 'Cannot change the status of a committed session.' });
  }

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

sessionsRouter.delete('/session/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id: sessionId } = req.params;
  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(sessionId, req.user.store_id) as any;
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === SESSION_STATUS.COMPLETED)
    return res.status(403).json({ error: 'Cannot delete a committed session.' });
  db.transaction(() => {
    db.prepare('DELETE FROM session_items WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM scan_sessions WHERE session_id = ?').run(sessionId);
  })();
  res.json({ success: true });
});

sessionsRouter.get('/session/:id/meta', authenticateToken, (req: AuthRequest, res) => {
  const session = db
    .prepare(
      'SELECT session_id, status, label, created_at, otp FROM scan_sessions WHERE session_id = ? AND store_id = ?'
    )
    .get(req.params.id, req.user.store_id) as any;
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

sessionsRouter.get('/session/:id/items', scanLimiter, (req, res) => {
  const { id: sessionId } = req.params;
  const otp = req.query.otp;
  // Apply the same 128-char cap used by the POST /scan route — the GET path
  // was missed in the prior fix round.
  const device_id =
    typeof req.query.device_id === 'string'
      ? req.query.device_id.slice(0, 128)
      : req.query.device_id;

  if (!otp) return res.status(400).json({ error: 'OTP required' });

  const session = db
    .prepare(
      `SELECT *,
              CASE WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')
                   THEN 1 ELSE 0 END AS is_expired
       FROM scan_sessions
       WHERE session_id = ? AND otp = ?`
    )
    .get(sessionId, otp) as any;

  if (!session) {
    // Mirror the POST /scan path: a wrong OTP burns an attempt here too, otherwise
    // this route offers an attempt-counter-free oracle for guessing a session's OTP.
    db.prepare('UPDATE scan_sessions SET otp_attempts = otp_attempts + 1 WHERE session_id = ?').run(
      sessionId
    );
    return res.status(403).json({ error: 'Invalid session or OTP' });
  }

  if (session.otp_attempts >= 5) {
    return res
      .status(429)
      .json({ error: 'Too many incorrect attempts. Please start a new session.' });
  }

  // Expired sessions shouldn't be readable via OTP.
  if (session.is_expired) {
    return res.status(410).json({ error: 'Session has expired. Please start a new session.' });
  }

  // If a browser session is present, require the authenticated account to still
  // have access to the store backing this OTP session.
  const sessionAccessError = getSessionAccessError(req, session.store_id);
  if (sessionAccessError) {
    return res.status(sessionAccessError.status).json({ error: sessionAccessError.error });
  }

  const items = device_id
    ? (db
        .prepare(
          'SELECT * FROM session_items WHERE session_id = ? AND (device_id = ? OR device_id IS NULL) ORDER BY scanned_at ASC'
        )
        .all(sessionId, device_id) as any[])
    : (db
        .prepare('SELECT * FROM session_items WHERE session_id = ? ORDER BY scanned_at ASC')
        .all(sessionId) as any[]);

  res.json({ status: session.status, items });
});

sessionsRouter.get('/session/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;
  const sinceUpdatedAt = isValidSessionCursorTimestamp(req.query.since_updated_at)
    ? req.query.since_updated_at.trim()
    : null;
  // Use Number.isFinite — Number('abc') produces NaN, which passes a != null check and
  // silently freezes the live feed by causing the cursor branch to return no rows.
  const rawSinceId = typeof req.query.since_id === 'string' ? Number(req.query.since_id) : null;
  const sinceId = rawSinceId !== null && Number.isFinite(rawSinceId) ? rawSinceId : null;
  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const COLS = `si.id, si.session_id, si.upc, si.quantity, si.scanned_at,
                si.lookup_status, si.product_name, si.brand, si.image,
                si.source, si.exists_in_inventory, si.sale_price, si.unit, si.tag_names, si.updated_at`;

  const items =
    sinceUpdatedAt && sinceId != null
      ? db
          .prepare(
            `
        SELECT ${COLS}
        FROM session_items si
        WHERE si.session_id = ?
          AND (
            julianday(si.updated_at) > julianday(?)
            OR (julianday(si.updated_at) = julianday(?) AND si.id > ?)
          )
        ORDER BY julianday(si.updated_at) DESC, si.id DESC
      `
          )
          .all(id, sinceUpdatedAt, sinceUpdatedAt, sinceId)
      : db
          .prepare(
            `
        SELECT ${COLS}
        FROM session_items si
        WHERE si.session_id = ?
        ORDER BY julianday(si.updated_at) DESC, si.id DESC
      `
          )
          .all(id);

  res.json({
    items,
    expires_at: session.expires_at ?? null,
    status: session.status,
    label: session.label ?? null,
  });
});

sessionsRouter.post('/session/:id/scan', scanLimiter, async (req, res) => {
  const { id } = req.params;
  const { upc, otp, item_name } = req.body;
  const rawDeviceId = req.headers['x-device-id'] as string | undefined;
  // Truncate to prevent oversized device IDs being written to the database on every scan upsert
  const deviceId = rawDeviceId ? rawDeviceId.slice(0, 128) : null;

  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) {
    return res.status(400).json({ error: 'UPC is required' });
  }
  if (cleanUpc.length > 128) {
    return res.status(400).json({ error: 'UPC too long' });
  }

  const session = db
    .prepare(
      `SELECT *,
              CASE WHEN expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')
                   THEN 1 ELSE 0 END AS is_expired
       FROM scan_sessions
       WHERE session_id = ?`
    )
    .get(id) as any;

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
  if (session.is_expired) {
    return res.status(410).json({ error: 'Session has expired. Please start a new session.' });
  }

  // Check OTP attempts
  if (session.otp_attempts >= 5) {
    return res
      .status(429)
      .json({ error: 'Too many incorrect attempts. Please start a new session.' });
  }

  // If OTP doesn't match, increment attempts
  if (!otp || otp !== session.otp) {
    db.prepare('UPDATE scan_sessions SET otp_attempts = otp_attempts + 1 WHERE session_id = ?').run(
      session.session_id
    );
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  // Reset attempts on success so a user who mistyped a few times and then scanned
  // correctly doesn't find themselves one wrong guess from permanent lockout.
  db.prepare('UPDATE scan_sessions SET otp_attempts = 0 WHERE session_id = ?').run(
    session.session_id
  );

  // If a browser session is present, require the authenticated account to still
  // have access to the store backing this OTP session.
  const sessionAccessError = getSessionAccessError(req, session.store_id);
  if (sessionAccessError) {
    return res.status(sessionAccessError.status).json({ error: sessionAccessError.error });
  }

  // Try exact UPC first, then leading-zero variant (EAN-13 ↔ UPC-A)
  const inventoryMatch =
    upcVariants(cleanUpc)
      .map(
        v =>
          db
            .prepare(
              'SELECT id, item_name, image, unit FROM inventory WHERE upc = ? AND store_id = ? LIMIT 1'
            )
            .get(v, session.store_id) as any
      )
      .find(Boolean) ?? null;

  // --- Resolve product info (cache-first, non-blocking for external lookups) ---
  let lookupStatus = 'unknown';
  let productName: string | null = null;
  let brand: string | null = null;
  let image: string | null = null;
  let unit: string | null = null;
  let source = 'scan_only';
  let existsInInventory = 0;
  let needsBackgroundLookup = false;

  if (inventoryMatch) {
    // Already in this store's inventory — fastest path
    lookupStatus = 'existing';
    productName = inventoryMatch.item_name || null;
    image = inventoryMatch.image || null;
    unit = inventoryMatch.unit || null;
    source = 'inventory';
    existsInInventory = 1;
  } else if (item_name) {
    // Taker manually typed a name — cap at 500 chars to match the inventory item_name column limit
    productName = String(item_name).trim().slice(0, 500) || null;
    if (productName) lookupStatus = 'new_candidate';
    source = 'manual';
  } else {
    // Check in-memory cache before hitting external APIs — try all UPC variants
    const cached =
      upcVariants(cleanUpc)
        .map(v => upcCache.get(v))
        .find(c => c && Date.now() - c.ts < UPC_CACHE_TTL) ?? null;
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
    const existing = db
      .prepare('SELECT id, device_id FROM session_items WHERE session_id = ? AND upc = ?')
      .get(id, cleanUpc) as any;

    if (existing) {
      const mergedDeviceId = getMergedDeviceId(existing.device_id ?? null, deviceId);
      db.prepare(
        `
        UPDATE session_items
        SET quantity = quantity + 1,
            scanned_at = strftime('%Y-%m-%d %H:%M:%f', 'now'),
            updated_at = CASE
              WHEN julianday(updated_at) >= julianday('now')
                THEN strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds')
              ELSE strftime('%Y-%m-%d %H:%M:%f', 'now')
            END,
            lookup_status = CASE WHEN source = 'manual' THEN lookup_status ELSE ? END,
            product_name = CASE WHEN source = 'manual' THEN product_name ELSE COALESCE(?, product_name) END,
            brand = CASE WHEN source = 'manual' THEN brand ELSE COALESCE(?, brand) END,
            image = CASE WHEN source = 'manual' THEN image ELSE COALESCE(?, image) END,
            unit = CASE WHEN source = 'manual' THEN unit ELSE COALESCE(?, unit) END,
            source = CASE WHEN source = 'manual' THEN source ELSE ? END,
            exists_in_inventory = ?, device_id = ?
        WHERE id = ?
      `
      ).run(
        lookupStatus,
        productName,
        brand,
        image,
        unit,
        source,
        existsInInventory,
        mergedDeviceId,
        existing.id
      );
    } else {
      db.prepare(
        `
        INSERT INTO session_items (
          session_id, upc, quantity, scanned_at, updated_at, lookup_status,
          product_name, brand, image, source, exists_in_inventory, unit, device_id
        )
        VALUES (?, ?, 1, strftime('%Y-%m-%d %H:%M:%f', 'now'),
                strftime('%Y-%m-%d %H:%M:%f', 'now'), ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        id,
        cleanUpc,
        lookupStatus,
        productName,
        brand,
        image,
        source,
        existsInInventory,
        unit,
        deviceId
      );
    }

    db.prepare(
      "UPDATE scan_sessions SET expires_at = datetime('now', '+8 hours') WHERE session_id = ?"
    ).run(id);

    return db
      .prepare(
        `
      SELECT id, session_id, upc, quantity, scanned_at, updated_at, lookup_status, product_name, brand, image, source, exists_in_inventory, unit
      FROM session_items WHERE session_id = ? AND upc = ?
    `
      )
      .get(id, cleanUpc);
  });

  const updatedItem = upsertScan();

  // Respond immediately — phone is unblocked
  res.json({ success: true, item: updatedItem });

  // Background lookup — fires after response is sent, result visible on next poll
  if (needsBackgroundLookup) {
    lookupProductByUpc(cleanUpc)
      .then(result => {
        const resolvedName = result?.product_name || null;
        const resolvedBrand = result?.brand || null;
        const resolvedImage = result?.image || null;
        const resolvedSource = result?.source || 'scan_only';
        const resolvedStatus = resolvedName ? 'new_candidate' : 'unknown';

        // Update cache regardless of whether we found anything
        upcCacheSet(cleanUpc, {
          product_name: resolvedName,
          brand: resolvedBrand,
          image: resolvedImage,
          source: resolvedSource,
          ts: Date.now(),
        });

        // Only update DB if we actually got something useful
        if (resolvedName) {
          db.prepare(
            `
          UPDATE session_items
          SET updated_at = CASE
                WHEN julianday(updated_at) >= julianday('now')
                  THEN strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds')
                ELSE strftime('%Y-%m-%d %H:%M:%f', 'now')
              END,
              lookup_status = ?, product_name = COALESCE(?, product_name),
              brand = COALESCE(?, brand), image = COALESCE(?, image), source = ?
          WHERE session_id = ? AND upc = ? AND source != 'manual'
        `
          ).run(
            resolvedStatus,
            resolvedName,
            resolvedBrand,
            resolvedImage,
            resolvedSource,
            id,
            cleanUpc
          );
        }
      })
      .catch(() => {
        // External API failed — cache as unknown so we don't retry until TTL expires
        upcCacheSet(cleanUpc, {
          product_name: null,
          brand: null,
          image: null,
          source: 'scan_only',
          ts: Date.now(),
        });
      });
  }
});

sessionsRouter.patch('/session/:id/items/:itemId', authenticateToken, (req: AuthRequest, res) => {
  const { id, itemId } = req.params;
  const { product_name, brand, quantity, upc, image, tag_names, sale_price, unit } = req.body;

  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Clamp quantity: coerce to int, default 1, min 1, max 1_000_000
  const sanitizedQty = Math.max(1, Math.min(Number.parseInt(String(quantity), 10) || 1, 1_000_000));

  // Cap string fields to prevent multi-megabyte blobs being stored on every PATCH.
  // Lengths mirror the inventory table column conventions.
  //
  // An omitted key (undefined) means "leave unchanged"; an explicit null or empty
  // string means "clear this field". Previously every one of these columns was
  // overwritten unconditionally, so a partial PATCH silently erased the fields it
  // did not mention.
  const sanitizedProductName = product_name ? String(product_name).slice(0, 500) : null;
  const sanitizedBrand = brand ? String(brand).slice(0, 200) : null;
  const sanitizedTagNames = tag_names ? String(tag_names).slice(0, 1000) : null;
  const sanitizedUnit = unit ? String(unit).slice(0, 50) : null;
  const sanitizedUpcRaw = upc != null ? String(upc).trim() : '';
  if (sanitizedUpcRaw.length > 128) {
    return res.status(400).json({ error: 'UPC must be 128 characters or fewer' });
  }
  const sanitizedUpc = sanitizedUpcRaw || null;
  // Coerce sale_price to a non-negative finite number — raw strings like "9.99abc"
  // would otherwise be stored as text and silently evaluate to 0 at commit time.
  const rawPrice = sale_price != null ? Number.parseFloat(String(sale_price)) : NaN;
  const sanitizedPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null;
  const rawImage = typeof image === 'string' ? image.trim() : '';

  try {
    const sanitizedImage = rawImage ? saveBase64Image(normalizeImageUrl(rawImage)) : null;

    if (sanitizedImage && sanitizedImage.length > 2000) {
      return res.status(400).json({ error: 'Image URL must be 2000 characters or fewer' });
    }

    // Build the SET list from the keys the client actually sent so an omitted
    // field keeps its stored value instead of being nulled out.
    const assignments: string[] = [
      "lookup_status = 'new_candidate'",
      "source = 'manual'",
      `updated_at = CASE
        WHEN julianday(updated_at) >= julianday('now')
          THEN strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds')
        ELSE strftime('%Y-%m-%d %H:%M:%f', 'now')
      END`,
    ];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (product_name !== undefined) assign('product_name', sanitizedProductName);
    if (brand !== undefined) assign('brand', sanitizedBrand);
    if (quantity !== undefined) assign('quantity', sanitizedQty);
    if (image !== undefined) assign('image', sanitizedImage);
    if (tag_names !== undefined) assign('tag_names', sanitizedTagNames);
    if (sale_price !== undefined) assign('sale_price', sanitizedPrice);
    if (unit !== undefined) assign('unit', sanitizedUnit);
    // UPC keeps its COALESCE guard — it is the item's identity within the session,
    // so an empty value must never blank it out.
    if (upc !== undefined) {
      assignments.push('upc = COALESCE(?, upc)');
      values.push(sanitizedUpc);
    }

    const result = db
      .prepare(
        `
      UPDATE session_items
      SET ${assignments.join(', ')}
      WHERE id = ? AND session_id = ?
    `
      )
      .run(...values, itemId, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session item not found' });
    }

    const updatedItem = db
      .prepare(
        `
      SELECT id, session_id, upc, quantity, scanned_at, updated_at, lookup_status,
             product_name, brand, image, source, exists_in_inventory, sale_price, unit, tag_names
      FROM session_items
      WHERE id = ? AND session_id = ?
    `
      )
      .get(itemId, id);

    return res.json({ success: true, item: updatedItem });
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: error.message });
    }

    logError('session:item-patch', error, 'Failed to update scanned item', {
      sessionId: req.params.id,
      itemId: req.params.itemId,
    });
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

sessionsRouter.delete('/session/:id/items', authenticateToken, (req: AuthRequest, res) => {
  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(req.params.id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status === SESSION_STATUS.COMPLETED)
    return res.status(403).json({ error: 'Cannot clear a committed session' });
  db.prepare('DELETE FROM session_items WHERE session_id = ?').run(req.params.id);
  res.json({ success: true });
});

sessionsRouter.delete('/session/:id/items/:itemId', authenticateToken, (req: AuthRequest, res) => {
  const { id, itemId } = req.params;
  const session = db
    .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  if (session.status === SESSION_STATUS.COMPLETED)
    return res.status(403).json({ error: 'Cannot delete items from a committed session' });
  db.prepare('DELETE FROM session_items WHERE id = ? AND session_id = ?').run(itemId, id);
  res.json({ success: true });
});

sessionsRouter.post(
  '/session/:id/commit',
  authenticateToken,
  requireOwner,
  (req: AuthRequest, res) => {
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
      return res
        .status(400)
        .json({ error: 'assignments (or selectedIds + category_id) is required' });
    }

    // Verify session belongs to this store
    const session = db
      .prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?')
      .get(id, user.store_id) as any;
    if (!session) return res.status(403).json({ error: 'Forbidden' });

    // Validate every category_id in the map belongs to this store.
    // Reject non-integers up front: Number(undefined) yields NaN, which better-sqlite3
    // refuses to bind, turning a malformed request into a 500 instead of a 400.
    const uniqueCatIds = [...new Set(assignmentMap.values())];
    if (uniqueCatIds.some(catId => !Number.isInteger(catId))) {
      return res.status(400).json({ error: 'One or more categories are invalid' });
    }
    const validCats = db
      .prepare(
        `SELECT id, name FROM categories WHERE store_id = ? AND id IN (${uniqueCatIds.map(() => '?').join(',')})`
      )
      .all(user.store_id, ...uniqueCatIds) as any[];
    if (validCats.length !== uniqueCatIds.length) {
      return res.status(400).json({ error: 'One or more categories are invalid' });
    }
    const catNameMap = new Map(validCats.map((c: any) => [c.id, c.name]));

    // Load only the items that are in the assignment map
    const allItems = db
      .prepare('SELECT * FROM session_items WHERE session_id = ?')
      .all(id) as any[];
    const items = allItems.filter((item: any) => assignmentMap.has(item.id));

    if (items.length === 0) return res.json({ message: 'No items to commit' });

    const insertInventory = db.prepare(`
    INSERT INTO inventory (item_name, upc, quantity, category_id, status, image, sale_price, unit, tag_names, store_id)
    VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?)
  `);
    const checkInventory = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?');
    const deleteSessionItem = db.prepare('DELETE FROM session_items WHERE id = ?');

    const transaction = db.transaction((sessionItems: any[]) => {
      let inserted = 0;
      let skippedExisting = 0;
      let skippedUnknown = 0;
      const byCategory: Record<number, number> = {};

      for (const item of sessionItems) {
        if (checkInventory.get(item.upc, user.store_id)) {
          skippedExisting++;
          continue;
        }
        if (item.lookup_status !== 'new_candidate') {
          skippedUnknown++;
          continue;
        }

        const catId = assignmentMap.get(item.id)!;
        const qty = Math.max(0, Math.min(Number.parseFloat(item.quantity) || 0, 1_000_000));
        const price =
          item.sale_price != null ? Math.max(0, Number.parseFloat(item.sale_price) || 0) : null;
        insertInventory.run(
          item.product_name || 'Unknown Scanned Item',
          item.upc,
          qty,
          catId,
          item.image || null,
          price,
          item.unit || null,
          item.tag_names || null,
          user.store_id
        );
        deleteSessionItem.run(item.id);
        byCategory[catId] = (byCategory[catId] ?? 0) + 1;
        inserted++;
      }

      // Only complete the session if every item was either committed or skipped
      const remaining = db
        .prepare('SELECT COUNT(*) as n FROM session_items WHERE session_id = ?')
        .get(id) as any;
      const nextStatus = remaining.n === 0 ? 'completed' : session.status;
      if (remaining.n === 0) {
        db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(id);
      }
      return { inserted, skippedExisting, skippedUnknown, byCategory, status: nextStatus };
    });

    try {
      const result = transaction(items);
      const catSummary = Object.entries(result.byCategory)
        .map(([cid, n]) => `${catNameMap.get(Number(cid)) ?? cid}: ${n}`)
        .join(', ');
      db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
        'BATCH',
        `Committed session ${id} | inserted=${result.inserted} skippedExisting=${result.skippedExisting} skippedUnknown=${result.skippedUnknown} | ${catSummary}`,
        user.id,
        user.store_id
      );
      res.json({
        success: true,
        total: items.length,
        inserted: result.inserted,
        skippedExisting: result.skippedExisting,
        skippedUnknown: result.skippedUnknown,
        status: result.status,
      });
    } catch (err: any) {
      logError('session:commit', err, 'Failed to commit scan session', {
        sessionId: req.params.id,
      });
      res.status(500).json({ error: 'An internal error occurred' });
    }
  }
);
