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

function isPasswordResetAllowedRequest(req: express.Request): boolean {
  if (req.baseUrl !== '/api/auth') {
    return false;
  }

  // While a temporary password is active, only allow the handful of auth routes
  // needed to inspect the account, switch stores, log out, or complete the reset.
  return (
    (req.method === 'GET' && (req.path === '/me' || req.path === '/my-stores' || req.path === '/store/settings')) ||
    (req.method === 'POST' && (req.path === '/logout' || req.path === '/switch-store')) ||
    (req.method === 'PUT' && req.path === '/store/password')
  );
}

export const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (isTokenRevoked(token)) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app' }, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    const user = payload as JwtPayload;
    const dbUser = db
      .prepare('SELECT token_version, must_reset_password FROM users WHERE id = ?')
      .get(user.id) as { token_version: number; must_reset_password: number } | undefined;
    if (!dbUser || (dbUser.token_version ?? 1) !== (user.token_version ?? 1)) {
      return res.status(401).json({ error: 'Session invalidated. Please log in again.' });
    }
    const mustResetPassword = dbUser.must_reset_password === 1;
    // Force the temp-password user through Settings before they can reach normal app routes.
    if (mustResetPassword && user.role !== 'superadmin' && !isPasswordResetAllowedRequest(req)) {
      return res.status(403).json({ error: 'Password reset required before continuing.' });
    }
    if (user.role !== 'superadmin') {
      const store = db.prepare('SELECT status FROM stores WHERE id = ?').get(user.store_id) as { status: string } | undefined;
      if (!store || store.status === 'suspended') {
        return res.status(403).json({ error: 'Store account suspended' });
      }
    }
    (req as AuthRequest).user = { ...user, must_reset_password: mustResetPassword };
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
