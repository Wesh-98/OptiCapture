import express from 'express';
import { db } from '../db.js';
import { authenticateToken } from '../middleware.js';

export const logsRouter = express.Router();

logsRouter.get('/logs', authenticateToken, (req: any, res) => {
  const storeId = req.user.store_id;
  const { from, to, limit: limitParam } = req.query as { from?: string; to?: string; limit?: string };
  const limit = Math.min(Number(limitParam) || 1000, 5000);

  const conditions: string[] = ['logs.store_id = ?'];
  const params: any[] = [storeId];

  if (from) { conditions.push("logs.timestamp >= ?"); params.push(from); }
  if (to)   { conditions.push("logs.timestamp <= ?"); params.push(to + 'T23:59:59'); }

  params.push(limit);

  const logs = db.prepare(`
    SELECT logs.*, users.username
    FROM logs
    JOIN users ON logs.user_id = users.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params);
  res.json(logs);
});
