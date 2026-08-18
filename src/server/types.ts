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
  token_version: number;
  must_reset_password: boolean;
  default_store_id?: number | null;
  role?: string;
  store_name?: string;
  store_id?: number;
}

export interface ResolvedUser extends JwtPayload {
  role: string;
  store_id?: number;
  store_name?: string;
  store_logo?: string | null;
  needs_store_selection?: boolean;
}

export interface AuthRequest extends express.Request {
  user: ResolvedUser;
}

export type LookupResult = {
  product_name: string;
  brand: string | null;
  image: string | null;
  source: string;
};

export const SESSION_STATUS = { ACTIVE: 'active', DRAFT: 'draft', COMPLETED: 'completed' } as const;
