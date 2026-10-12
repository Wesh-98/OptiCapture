import express from 'express';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import { escapeLike, firstQueryValue, LIKE_ESCAPE, toSqliteUtc } from '../helpers.js';
import type { AuthRequest } from '../types.js';

export const logsRouter = express.Router();

// Owners only: the log names every account's actions, including password resets and access
// changes, which a taker has no need to read.
logsRouter.get('/logs', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const from = firstQueryValue(req.query.from);
  const to = firstQueryValue(req.query.to);
  const q = firstQueryValue(req.query.q);
  const action = firstQueryValue(req.query.action);
  const pageParam = firstQueryValue(req.query.page);
  const limitParam = firstQueryValue(req.query.limit);
  const parsedLimit = Number.parseInt(limitParam ?? '', 10);
  const page = Math.max(Number.parseInt(pageParam ?? '', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 1000, 1), 5000);

  const conditions: string[] = ['logs.store_id = ?'];
  const params: any[] = [storeId];
  const fromInstant = firstQueryValue(req.query.from_utc);
  const toInstant = firstQueryValue(req.query.to_utc);

  // Validate date format before passing to SQLite — malformed strings are not
  // rejected by the parameterised query and cause the comparison to silently
  // match no rows or all rows depending on SQLite's NULL arithmetic.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !ISO_DATE_RE.test(from))
    return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  if (to && !ISO_DATE_RE.test(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });

  // Compare as dates rather than as text. Timestamps are stored as 'YYYY-MM-DD HH:MM:SS',
  // but the upper bound was built as `to + 'T23:59:59'`, which only sorted correctly because
  // a space happens to precede 'T' in ASCII — and silently excluded any legacy row still
  // stored in the ISO 'T' form. date() parses both spellings.
  if (from && fromInstant === undefined) {
    conditions.push('date(logs.timestamp) >= date(?)');
    params.push(from);
  }
  if (to && toInstant === undefined) {
    conditions.push('date(logs.timestamp) <= date(?)');
    params.push(to);
  }

  // The page sends its day boundaries as instants (local midnight of the first day, local
  // midnight after the last), because a plain date is read as a UTC day: for a store in
  // the US, an evening's entries fell on "tomorrow". These win over from/to when present.
  for (const [name, value] of [
    ['from_utc', fromInstant],
    ['to_utc', toInstant],
  ] as const) {
    if (value === undefined) continue;
    const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
      ? Date.parse(value)
      : Number.NaN;
    if (Number.isNaN(ms)) {
      return res.status(400).json({ error: `${name} must be an ISO 8601 UTC timestamp` });
    }
    // Stored timestamps are UTC 'YYYY-MM-DD HH:MM:SS', which compares correctly as text.
    conditions.push(name === 'from_utc' ? 'logs.timestamp >= ?' : 'logs.timestamp < ?');
    params.push(toSqliteUtc(new Date(ms)));
  }

  if (action) {
    if (action.length > 50) return res.status(400).json({ error: 'action is too long' });
    conditions.push('logs.action = ?');
    params.push(action);
  }
  if (q?.trim()) {
    if (q.length > 200) return res.status(400).json({ error: 'q is too long' });
    const pattern = `%${escapeLike(q.trim().toLowerCase())}%`;
    conditions.push(
      `(LOWER(COALESCE(logs.details, '')) LIKE ? ${LIKE_ESCAPE} OR LOWER(COALESCE(users.username, '')) LIKE ? ${LIKE_ESCAPE})`
    );
    params.push(pattern, pattern);
  }

  const fromSql = `FROM logs LEFT JOIN users ON logs.user_id = users.id WHERE ${conditions.join(' AND ')}`;
  const total = (
    db.prepare(`SELECT COUNT(*) AS count ${fromSql}`).get(...params) as {
      count: number;
    }
  ).count;
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
    ORDER BY logs.timestamp DESC, logs.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, limit, (page - 1) * limit);

  // One shape, always. This used to return a bare array when ?page was absent and an
  // envelope when it was present, so every caller had to handle both.
  res.json({ items: logs, total, store_total: storeTotal, page, limit });
});
