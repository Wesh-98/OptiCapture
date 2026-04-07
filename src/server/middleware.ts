import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db.js';
import { isTokenRevoked } from './cache.js';
import type { JwtPayload, AuthRequest } from './types.js';

export const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'https://localhost:3000/api/auth/google/callback'
);

// Auth endpoints: max 20 requests per 15 min per IP
export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// General API limiter: max 2000 requests per 15 min per IP
// 1000-item scan sessions require ~500 scan POSTs + ~450 poll GETs per IP per 15-min window
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Unauthenticated scan endpoints: stricter limit to prevent OTP brute-force across sessions
export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scan requests. Please wait a moment.' },
});

export const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (isTokenRevoked(token)) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app' }, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    const user = payload as JwtPayload;
    const dbUser = db.prepare('SELECT token_version FROM users WHERE id = ?').get(user.id) as { token_version: number } | undefined;
    if (!dbUser || (dbUser.token_version ?? 1) !== (user.token_version ?? 1)) {
      return res.status(401).json({ error: 'Session invalidated. Please log in again.' });
    }
    if (user.role !== 'superadmin') {
      const store = db.prepare('SELECT status FROM stores WHERE id = ?').get(user.store_id) as { status: string } | undefined;
      if (!store || store.status === 'suspended') {
        return res.status(403).json({ error: 'Store account suspended' });
      }
    }
    (req as AuthRequest).user = user;
    next();
  });
};

// Role guard — only owners and superadmins may manage categories, export, or batch import
export const requireOwner = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { role } = (req as AuthRequest).user;
  if (role !== 'owner' && role !== 'superadmin')
    return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

// Role guard — owners, superadmins, and takers may add/edit/delete individual inventory items
export const requireOwnerOrTaker = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { role } = (req as AuthRequest).user;
  if (role !== 'owner' && role !== 'superadmin' && role !== 'taker')
    return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};
