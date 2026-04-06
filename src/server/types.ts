import express from 'express';

export interface UpcCacheEntry {
  product_name: string | null;
  brand: string | null;
  image: string | null;
  source: string;
  ts: number;
}

export interface JwtPayload {
  id: number;
  username: string;
  role: string;
  store_name: string;
  store_id: number;
  token_version: number;
}

export interface AuthRequest extends express.Request {
  user: JwtPayload;
}

export type LookupResult = { product_name: string; brand: string | null; image: string | null; source: string };

export const SESSION_STATUS = { ACTIVE: 'active', DRAFT: 'draft', COMPLETED: 'completed' } as const;
