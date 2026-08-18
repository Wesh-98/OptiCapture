import express from 'express';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import type { AuthRequest } from '../types.js';

export const logsRouter = express.Router();

logsRouter.get('/logs', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const {
    from,
    to,
    limit: limitParam,
  } = req.query as { from?: string; to?: string; limit?: string };
  const limit = Math.min(Number(limitParam) || 1000, 5000);

  const conditions: string[] = ['logs.store_id = ?'];
  const params: any[] = [storeId];

  // Validate date format before passing to SQLite — malformed strings are not
  // rejected by the parameterised query and cause the comparison to silently
  // match no rows or all rows depending on SQLite's NULL arithmetic.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !ISO_DATE_RE.test(from))
    return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  if (to && !ISO_DATE_RE.test(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });

  if (from) {
    conditions.push('logs.timestamp >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('logs.timestamp <= ?');
    params.push(to + 'T23:59:59');
  }

  params.push(limit);

  const logs = db
    .prepare(
      `
    SELECT logs.*, users.username
    FROM logs
    LEFT JOIN users ON logs.user_id = users.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT ?
  `
    )
    .all(...params);
  res.json(logs);
});
