import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { UpcCacheEntry } from './types.js';

// UPC lookup cache — avoids hitting external APIs for barcodes already resolved.
// TTL: 7 days. Cleared on server restart (intentional — forces fresh data periodically).
export const UPC_CACHE_MAX = 5000;
export const upcCache = new Map<string, UpcCacheEntry>();
export const UPC_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export function upcCacheSet(key: string, value: UpcCacheEntry) {
  if (upcCache.size >= UPC_CACHE_MAX) upcCache.delete(upcCache.keys().next().value!);
  upcCache.set(key, value);
}

// Temporary store for pending OAuth registrations (10-min TTL, max 500 entries)
export const pendingOAuth = new Map<string, { googleId: string; email: string; name: string; expiresAt: number }>();
const PENDING_OAUTH_MAX = 500;
export function pendingOAuthSet(key: string, value: { googleId: string; email: string; name: string; expiresAt: number }) {
  if (pendingOAuth.size >= PENDING_OAUTH_MAX) pendingOAuth.delete(pendingOAuth.keys().next().value!);
  pendingOAuth.set(key, value);
}

// M-5: Clean up expired pending OAuth entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingOAuth.entries()) {
    if (entry.expiresAt < now) pendingOAuth.delete(key);
  }
}, 5 * 60 * 1000);

// Dummy bcrypt hash used for constant-time comparison when login username is not found.
// Prevents username enumeration via timing: without this, missing-user requests return in
// ~0ms while real-user+wrong-password requests take ~100ms (bcrypt cost).
export const DUMMY_HASH = bcrypt.hashSync('opticapture-timing-sentinel', 10);

// Revoked token store: maps JWT string → expiry timestamp (ms).
// Entries expire lazily on access and are pruned hourly to keep memory bounded.
export const revokedTokens = new Map<string, number>();
export function revokeToken(token: string): void {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 8 * 60 * 60 * 1000;
  revokedTokens.set(token, expMs);
}
export function isTokenRevoked(token: string): boolean {
  const expMs = revokedTokens.get(token);
  if (expMs === undefined) return false;
  if (Date.now() > expMs) { revokedTokens.delete(token); return false; }
  return true;
}
// Prune expired revocations every hour — keeps memory bounded without requiring Redis
setInterval(() => {
  const now = Date.now();
  for (const [tok, expMs] of revokedTokens) {
    if (now > expMs) revokedTokens.delete(tok);
  }
}, 60 * 60 * 1000).unref();
