import express from 'express';
import { db } from '../db.js';
import { authenticateToken } from '../middleware.js';
import type { AuthRequest } from '../types.js';

export const logsRouter = express.Router();

logsRouter.get('/logs', authenticateToken, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const {
    from,
    to,
    q,
    action,
    page: pageParam,
    limit: limitParam,
  } = req.query as {
    from?: string;
    to?: string;
    q?: string;
    action?: string;
    page?: string;
    limit?: string;
  };
  const parsedLimit = Number.parseInt(limitParam ?? '', 10);
  const page = Math.max(Number.parseInt(pageParam ?? '', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 1000, 1), 5000);

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

  if (action) {
    if (action.length > 50) return res.status(400).json({ error: 'action is too long' });
    conditions.push('logs.action = ?');
    params.push(action);
  }
  if (q?.trim()) {
    if (q.length > 200) return res.status(400).json({ error: 'q is too long' });
    const escaped = q
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped}%`;
    conditions.push(
      `(LOWER(COALESCE(logs.details, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(users.username, '')) LIKE ? ESCAPE '\\')`
    );
    params.push(pattern, pattern);
  }

  const fromSql = `FROM logs LEFT JOIN users ON logs.user_id = users.id WHERE ${conditions.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS count ${fromSql}`).get(...params) as {
    count: number;
  }).count;
  const storeTotal = (
    db.prepare('SELECT COUNT(*) AS count FROM logs WHERE store_id = ?').get(storeId) as {
      count: number;
    }
  ).count;

  const logs = db
    .prepare(
      `
    SELECT logs.*, users.username
    ${fromSql}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, limit, (page - 1) * limit);

  if (!pageParam) return res.json(logs);
  res.json({ items: logs, total, store_total: storeTotal, page, limit });
});
