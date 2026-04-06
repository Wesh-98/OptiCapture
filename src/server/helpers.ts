import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { upcCache, upcCacheSet, UPC_CACHE_TTL } from './cache.js';
import type { LookupResult, UpcCacheEntry } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Uploads directory lives at project root — two levels up from src/server/
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// M-7: Only allow safe image extensions from base64 uploads
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp',
};

// Save base64 image to disk, return file path. Pass-through for URLs/paths.
export function saveBase64Image(base64Data: string): string {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(base64Data);
  if (!match) return base64Data;

  // Only allow safe image types
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mimeMatch = /^data:([^;]+);base64,/.exec(base64Data);
  if (!mimeMatch || !allowedMimeTypes.includes(mimeMatch[1])) {
    return ''; // Reject disallowed types silently
  }

  const ext = ALLOWED_IMAGE_TYPES[match[1].toLowerCase()];
  if (!ext) return ''; // reject svg, php, or any unknown type
  const buffer = Buffer.from(match[2], 'base64');
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// Normalize Google Drive sharing URLs to embeddable thumbnail URLs
export function normalizeImageUrl(url: string): string {
  if (!url.includes('drive.google.com') && !url.includes('docs.google.com')) return url;
  // /file/d/FILE_ID/view — standard sharing link
  const fileMatch = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (fileMatch) return `/api/drive-image/${fileMatch[1]}`;
  // thumbnail?id=FILE_ID — already-converted thumbnail URLs
  const thumbMatch = /thumbnail\?id=([a-zA-Z0-9_-]+)/.exec(url);
  if (thumbMatch) return `/api/drive-image/${thumbMatch[1]}`;
  // uc?export=view&id=FILE_ID or open?id=FILE_ID — query-string formats
  const idMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(url);
  if (idMatch) return `/api/drive-image/${idMatch[1]}`;
  return url;
}

export function generateTempPassword(): string {
  return randomBytes(8).toString('base64url').slice(0, 10);
}

// Helper to get local IP address
export function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

export function getTunnelUrl(): string | null {
  // .tunnel-url file lives at project root — two levels up from src/server/
  const tunnelFile = path.join(__dirname, '..', '..', '.tunnel-url');
  try {
    if (fs.existsSync(tunnelFile)) {
      const url = fs.readFileSync(tunnelFile, 'utf8').trim();
      if (url.startsWith('https://')) return url;
    }
  } catch {}
  return null;
}

// C-4: Use CSPRNG for both session IDs and OTPs
export function generateOTP(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no ambiguous 0/O/I/1
  let result = '';
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateStoreCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
  return code;
}

// UPC/EAN barcodes sometimes arrive with or without a leading zero.
// EAN-13 = 13 digits; UPC-A = 12 digits (EAN-13 with leading 0 dropped).
// Try both variants so a scan of "012345678905" also matches "12345678905".
export function upcVariants(upc: string): string[] {
  const variants = [upc];
  if (/^\d+$/.test(upc)) {
    if (upc.length === 13 && upc.startsWith('0')) variants.push(upc.slice(1));
    if (upc.length === 12) variants.push('0' + upc);
  }
  return variants;
}

export async function fetchOpenFoodFacts(upc: string, signal: AbortSignal): Promise<LookupResult | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json`,
      { headers: { 'User-Agent': 'OptiCapture/1.0' }, signal }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const p = data?.product;
    if (!p) return null;
    const product_name = p.product_name?.trim() || p.product_name_en?.trim() || null;
    if (!product_name) return null;
    const brand = typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0].trim() : null;
    const image = p.image_front_url || p.image_url || null;
    return { product_name, brand, image, source: 'open_food_facts' };
  } catch {
    return null;
  }
}

export async function fetchUpcItemDb(upc: string, signal: AbortSignal): Promise<LookupResult | null> {
  try {
    const apiKey = process.env.UPCITEMDB_API_KEY?.trim();
    // Use paid /v1 endpoint when a key is configured, trial endpoint otherwise
    const url = `https://api.upcitemdb.com/prod/${apiKey ? 'v1' : 'trial'}/lookup?upc=${encodeURIComponent(upc)}`;
    const headers: Record<string, string> = apiKey ? { 'x-user-key': apiKey } : {};
    const res = await fetch(url, { headers, signal });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const item = data?.items?.[0];
    if (!item?.title) return null;
    return {
      product_name: item.title.trim(),
      brand: item.brand?.trim() || null,
      image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
      source: 'upcitemdb',
    };
  } catch {
    return null;
  }
}

export async function lookupProductByUpc(upc: string): Promise<LookupResult | null> {
  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) return null;

  const c1 = new AbortController();
  const c2 = new AbortController();
  const t1 = setTimeout(() => c1.abort(), 5000);
  const t2 = setTimeout(() => c2.abort(), 5000);

  // Try all UPC variants (with/without leading zero) — first non-null result wins per source
  const variants = upcVariants(cleanUpc);
  const [offResult, upcResult] = await Promise.allSettled([
    (async () => { for (const v of variants) { const r = await fetchOpenFoodFacts(v, c1.signal); if (r) return r; } return null; })(),
    (async () => { for (const v of variants) { const r = await fetchUpcItemDb(v, c2.signal); if (r) return r; } return null; })(),
  ]);

  clearTimeout(t1);
  clearTimeout(t2);

  const off = offResult.status === 'fulfilled' ? offResult.value : null;
  const upc_ = upcResult.status === 'fulfilled' ? upcResult.value : null;

  // Prefer whichever result has more complete data (name + image beats name-only).
  // When both have an image, prefer UPCitemdb — cleaner retail labelling.
  // When only one has a name, use that one regardless of source.
  if (off && upc_) {
    if (upc_.image) return upc_;   // UPCitemdb has image — use it
    if (off.image) return off;     // OFF has image, UPCitemdb doesn't
    return upc_;                   // Both name-only — UPCitemdb has cleaner names
  }
  return upc_ ?? off ?? null;
}
