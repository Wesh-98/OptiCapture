import express from 'express';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import { escapeLike, firstQueryValue, LIKE_ESCAPE, toSqliteUtc } from '../helpers.js';
import type { AuthRequest } from '../types.js';

export const logsRouter = express.Router();

interface LogFilters {
  conditions: string[];
  params: any[];
}

type LogQuery = express.Request['query'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Each of these adds its conditions to `filters` and returns an error message for a bad value.

function addDayRange(filters: LogFilters, query: LogQuery): string | null {
  const from = firstQueryValue(query.from);
  const to = firstQueryValue(query.to);
  // Validate date format before passing to SQLite — malformed strings are not
  // rejected by the parameterised query and cause the comparison to silently
  // match no rows or all rows depending on SQLite's NULL arithmetic.
  if (from && !ISO_DATE_RE.test(from)) return 'from must be YYYY-MM-DD';
  if (to && !ISO_DATE_RE.test(to)) return 'to must be YYYY-MM-DD';

  // Compare as dates rather than as text. Timestamps are stored as 'YYYY-MM-DD HH:MM:SS',
  // but the upper bound was built as `to + 'T23:59:59'`, which only sorted correctly because
  // a space happens to precede 'T' in ASCII — and silently excluded any legacy row still
  // stored in the ISO 'T' form. date() parses both spellings.
  if (from && firstQueryValue(query.from_utc) === undefined) {
    filters.conditions.push('date(logs.timestamp) >= date(?)');
    filters.params.push(from);
  }
  if (to && firstQueryValue(query.to_utc) === undefined) {
    filters.conditions.push('date(logs.timestamp) <= date(?)');
    filters.params.push(to);
  }
  return null;
}

// The page sends its day boundaries as instants (local midnight of the first day, local
// midnight after the last), because a plain date is read as a UTC day: for a store in
// the US, an evening's entries fell on "tomorrow". These win over from/to when present.
function addInstantRange(filters: LogFilters, query: LogQuery): string | null {
  const bounds = [
    ['from_utc', 'logs.timestamp >= ?'],
    ['to_utc', 'logs.timestamp < ?'],
  ] as const;
  for (const [name, condition] of bounds) {
    const value = firstQueryValue(query[name]);
    if (value === undefined) continue;
    const ms = ISO_INSTANT_RE.test(value) ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(ms)) return `${name} must be an ISO 8601 UTC timestamp`;
    // Stored timestamps are UTC 'YYYY-MM-DD HH:MM:SS', which compares correctly as text.
    filters.conditions.push(condition);
    filters.params.push(toSqliteUtc(new Date(ms)));
  }
  return null;
}

function addTextFilters(filters: LogFilters, query: LogQuery): string | null {
  const action = firstQueryValue(query.action);
  const q = firstQueryValue(query.q);
  if (action) {
    if (action.length > 50) return 'action is too long';
    filters.conditions.push('logs.action = ?');
    filters.params.push(action);
  }
  if (q?.trim()) {
    if (q.length > 200) return 'q is too long';
    const pattern = `%${escapeLike(q.trim().toLowerCase())}%`;
    filters.conditions.push(
      `(LOWER(COALESCE(logs.details, '')) LIKE ? ${LIKE_ESCAPE} OR LOWER(COALESCE(users.username, '')) LIKE ? ${LIKE_ESCAPE})`
    );
    filters.params.push(pattern, pattern);
  }
  return null;
}

// Owners only: the log names every account's actions, including password resets and access
// changes, which a taker has no need to read.
logsRouter.get('/logs', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  const storeId = req.user.store_id;
  const pageParam = firstQueryValue(req.query.page);
  const limitParam = firstQueryValue(req.query.limit);
  const parsedLimit = Number.parseInt(limitParam ?? '', 10);
  const page = Math.max(Number.parseInt(pageParam ?? '', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 1000, 1), 5000);

  const filters: LogFilters = { conditions: ['logs.store_id = ?'], params: [storeId] };
  const filterError =
    addDayRange(filters, req.query) ??
    addInstantRange(filters, req.query) ??
    addTextFilters(filters, req.query);
  if (filterError) return res.status(400).json({ error: filterError });
  const { conditions, params } = filters;

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
