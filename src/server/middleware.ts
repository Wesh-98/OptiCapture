import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db.js';
import { isTokenRevoked } from './cache.js';
import type { JwtPayload, AuthRequest, ResolvedUser } from './types.js';

// Fail at module-load time — prevents silent jwt.verify calls with undefined secret
// if middleware is ever imported outside the normal server.ts bootstrap.
if (!process.env.JWT_SECRET) {
  throw new Error('[middleware] JWT_SECRET environment variable is not set');
}

export const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'https://localhost:3000/api/auth/google/callback'
);

// In tests, all requests originate from 127.0.0.1 (supertest's loopback address).
// Rate limiters key off IP, so even a 20-request auth test suite would trip the
// authLimiter midway through. We disable all three limiters when NODE_ENV=test.
// Production and development still get the full enforcement.
const noop: express.RequestHandler = (_req, _res, next) => next();
const isTest = process.env.NODE_ENV === 'test';

// Auth endpoints: max 20 requests per 15 min per IP
export const authLimiter = isTest
  ? noop
  : rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// General API limiter: max 2000 requests per 15 min per IP
// 1000-item scan sessions require ~500 scan POSTs + ~450 poll GETs per IP per 15-min window
export const apiLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 2000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later.' },
    });

// Unauthenticated scan endpoints: stricter limit to prevent OTP brute-force across sessions
export const scanLimiter = isTest
  ? noop
  : rateLimit({
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
    (req.method === 'GET' &&
      (req.path === '/me' || req.path === '/my-stores' || req.path === '/store/settings')) ||
    (req.method === 'POST' && (req.path === '/logout' || req.path === '/switch-store')) ||
    (req.method === 'PUT' && req.path === '/store/password')
  );
}

function isStoreContextOptionalRequest(req: express.Request): boolean {
  if (req.baseUrl !== '/api/auth') {
    return false;
  }

  // These endpoints operate at the account layer, so they can respond even
  // when a multi-store user has not picked an active store for this tab yet.
  return (
    (req.method === 'GET' && (req.path === '/me' || req.path === '/my-stores')) ||
    (req.method === 'POST' && (req.path === '/logout' || req.path === '/switch-store')) ||
    (req.method === 'PUT' && req.path === '/store/password')
  );
}

function parseRequestedStoreId(req: express.Request): number | null {
  const rawHeader = req.headers['x-store-id'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerValue !== 'string' || !headerValue.trim()) {
    return null;
  }

  const storeId = Number.parseInt(headerValue, 10);
  return Number.isNaN(storeId) ? null : storeId;
}

export const authenticateToken = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (isTokenRevoked(token)) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(
    token,
    process.env.JWT_SECRET!,
    { algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app' },
    (err, payload) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      const user = payload as JwtPayload;
      const dbUser = db
        .prepare(
          'SELECT id, username, role, token_version, must_reset_password FROM users WHERE id = ?'
        )
        .get(user.id) as
        | {
            id: number;
            username: string;
            role: string;
            token_version: number;
            must_reset_password: number;
          }
        | undefined;
      if (!dbUser || (dbUser.token_version ?? 1) !== (user.token_version ?? 1)) {
        return res.status(401).json({ error: 'Session invalidated. Please log in again.' });
      }

      const isSuperadmin = dbUser.role === 'superadmin';
      const mustResetPassword = dbUser.must_reset_password === 1;

      // Force the temp-password user through Settings before they can reach normal app routes.
      if (mustResetPassword && !isSuperadmin && !isPasswordResetAllowedRequest(req)) {
        return res.status(403).json({ error: 'Password reset required before continuing.' });
      }

      if (isSuperadmin) {
        (req as AuthRequest).user = {
          id: dbUser.id,
          username: dbUser.username,
          role: 'superadmin',
          token_version: dbUser.token_version ?? 1,
          must_reset_password: mustResetPassword,
        };
        return next();
      }

      const accessibleStores = db
        .prepare(
          `
        SELECT s.id, s.name, s.logo, s.status, us.role
        FROM user_stores us
        JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = ?
        ORDER BY s.name ASC
      `
        )
        .all(dbUser.id) as Array<{
        id: number;
        name: string;
        logo: string | null;
        status: string;
        role: string;
      }>;

      const activeStores = accessibleStores.filter(store => store.status === 'active');
      const requestedStoreId = parseRequestedStoreId(req);
      let resolvedStore = null as (typeof activeStores)[number] | null;

      if (requestedStoreId !== null) {
        resolvedStore = accessibleStores.find(store => store.id === requestedStoreId) ?? null;
        if (!resolvedStore) {
          return res.status(403).json({ error: 'No access to that store' });
        }
      } else if (activeStores.length === 1) {
        // Preserve the old simple UX for single-store users by auto-resolving
        // the only active store when no header is present.
        [resolvedStore] = activeStores;
      }

      const baseUser: ResolvedUser = {
        id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
        token_version: dbUser.token_version ?? 1,
        must_reset_password: mustResetPassword,
        needs_store_selection: resolvedStore == null && activeStores.length > 1,
      };

      if (!resolvedStore) {
        if (isStoreContextOptionalRequest(req)) {
          // Let account-scoped routes return enough information for the client to
          // render the store picker instead of failing the whole request.
          (req as AuthRequest).user = baseUser;
          return next();
        }

        return res.status(409).json({
          error: 'Store selection required',
          needs_store_selection: true,
        });
      }

      if (resolvedStore.status !== 'active') {
        return res.status(403).json({ error: 'Store account suspended' });
      }

      (req as AuthRequest).user = {
        ...baseUser,
        role: resolvedStore.role,
        store_id: resolvedStore.id,
        store_name: resolvedStore.name,
        store_logo: resolvedStore.logo,
        needs_store_selection: false,
      };
      return next();
    }
  );
};

// Role guard — only owners and superadmins may manage categories, export, or batch import
export const requireOwner = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const { role } = (req as AuthRequest).user;
  if (role !== 'owner' && role !== 'superadmin')
    return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

// Role guard — owners, superadmins, and takers may add/edit/delete individual inventory items
export const requireOwnerOrTaker = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const { role } = (req as AuthRequest).user;
  if (role !== 'owner' && role !== 'superadmin' && role !== 'taker')
    return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};
