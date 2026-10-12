import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { LookupResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Uploads live at the project root (two levels up from src/server/) unless UPLOADS_DIR
// names somewhere else: a mounted volume in production, a throwaway folder under test.
export const UPLOADS_DIR = process.env.UPLOADS_DIR?.trim()
  ? path.resolve(process.env.UPLOADS_DIR.trim())
  : path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// M-7: The only image types a base64 upload may be, and the extension each is saved under.
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class UnsupportedImageTypeError extends Error {
  constructor(message = 'Unsupported image format. Use JPG, PNG, GIF, or WEBP.') {
    super(message);
    this.name = 'UnsupportedImageTypeError';
  }
}

/**
 * Express parses a repeated query parameter (?q=a&q=b) into an array. Those arrays reached
 * better-sqlite3's binder, which refuses them, turning a malformed URL into a 500 — on
 * /session/:id/items that was reachable without authenticating. Collapse to the first value,
 * matching how a single value behaves, and drop anything that is not a string.
 */
export function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const [first] = value;
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

export function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Verify the buffer's actual binary magic bytes match the declared MIME type.
// The MIME string in the data URI is attacker-controlled; magic bytes are not.
function verifyImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimeType === 'image/gif') {
    return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

// Save base64 image to disk, return file path. Pass-through for URLs/paths.
export function saveBase64Image(base64Data: string): string {
  // Any data URL must be one of the allowed images. Anything else used to fall through and
  // be stored raw in the database (an SVG, or a non-image data URL).
  if (!/^\s*data:/i.test(base64Data)) return base64Data;
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64Data);
  if (!match) throw new UnsupportedImageTypeError();

  // Only allow safe image types
  const mimeType = match[1];
  if (!Object.hasOwn(IMAGE_EXTENSIONS, mimeType)) throw new UnsupportedImageTypeError();
  const ext = IMAGE_EXTENSIONS[mimeType];
  const buffer = Buffer.from(match[2], 'base64');

  // Size guard — 5 MB cap before writing to disk (body-parser limit is the outer bound)
  if (buffer.length > 5 * 1024 * 1024) {
    throw new UnsupportedImageTypeError('Image too large. Maximum size is 5 MB.');
  }

  // Magic-byte check — validate actual binary content matches the declared MIME type
  if (!verifyImageMagicBytes(buffer, mimeType)) {
    throw new UnsupportedImageTypeError();
  }

  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

/**
 * The upload this saveBase64Image call created, or null when it created nothing.
 *
 * saveBase64Image returns its input unchanged for anything that is not a data URI, so an
 * imported spreadsheet cell holding an existing '/uploads/...' path comes back verbatim.
 * Treating that as a file this import wrote would put somebody else's upload on the
 * rollback cleanup list, and deleting a path is not recoverable.
 */
export function savedUploadPath(input: string, result: string): string | null {
  if (result === input) return null;
  return result.startsWith('/uploads/') ? result : null;
}

/**
 * The file in UPLOADS_DIR that a stored upload reference resolves to. Every check of
 * whether a file is still in use must compare by this, the same key the unlink uses:
 * '/uploads/sub/x.png' and '/uploads/x.png' are different strings but the same file.
 */
export function uploadFileName(value: string): string {
  return path.basename(value.split(/[?#]/)[0]);
}

/**
 * Deletes files previously returned by saveBase64Image. Used when the work that saved them
 * is rolled back or its owning store is deleted — otherwise every rolled-back import and
 * every deleted store leaves its images on disk forever.
 *
 * Callers must pass only paths they own: a '/uploads/...' value stored in a row is not
 * proof that the row's store owns the file, because an import can write an arbitrary path
 * into inventory.image. Paths are reduced to uploadFileName so a stored value can never
 * escape the uploads directory, and a missing file is not an error.
 *
 * Unlinking is async so neither a store deletion nor an import rollback blocks the event
 * loop while it walks a long list.
 */
export async function removeUploadedFiles(paths: Iterable<string>): Promise<number> {
  let removed = 0;
  for (const value of paths) {
    if (typeof value !== 'string' || !value.startsWith('/uploads/')) continue;
    try {
      await fs.promises.unlink(path.join(UPLOADS_DIR, uploadFileName(value)));
      removed++;
    } catch {
      // Already gone, or never written — nothing to clean up.
    }
  }
  return removed;
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

// Stored timestamps are UTC in SQLite's text form 'YYYY-MM-DD HH:MM:SS', the same
// value CURRENT_TIMESTAMP and datetime('now') produce, so they compare correctly
// with SQL date functions and sort as text.
export function toSqliteUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Parse a stored UTC timestamp to epoch milliseconds (NaN when invalid). Values
// without a zone suffix are UTC; Date.parse alone would read them as local time.
export function parseSqliteUtc(value: string): number {
  const trimmed = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

// Files leaving OptiCapture carry ISO 8601 UTC with an explicit 'Z'.
export function toIsoUtc(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  const ms = parseSqliteUtc(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
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

function gs1CheckDigitValid(digits: string): boolean {
  // Weights alternate 3,1,3,... starting from the digit just left of the check digit.
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

// UPC-E (8 digits: number system 0/1, six compressed digits, check digit) to UPC-A.
function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = code;
  let body: string;
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/**
 * Check-digit validation for retail barcodes (EAN-8/UPC-E, UPC-A, EAN-13, GTIN-14).
 * Returns null for codes that are not in a GTIN format (store-internal codes, Code 128
 * text, other lengths) because there is no check digit to verify.
 */
export function isValidGtin(code: string): boolean | null {
  const value = code.trim();
  if (!/^\d+$/.test(value)) return null;
  if (value.length === 8) {
    const upcA = expandUpcE(value);
    return gs1CheckDigitValid(value) || (upcA !== null && gs1CheckDigitValid(upcA));
  }
  if (value.length === 12 || value.length === 13 || value.length === 14) {
    return gs1CheckDigitValid(value);
  }
  return null;
}

/**
 * What one provider said about a barcode. `failed` means it could not answer (network
 * error, timeout, rate limit, server error) — which is not the same as "no such product",
 * and must not be remembered as one.
 */
export interface ProviderOutcome {
  product: LookupResult | null;
  failed: boolean;
}

const NOT_FOUND: ProviderOutcome = { product: null, failed: false };
const FAILED: ProviderOutcome = { product: null, failed: true };

// A provider answers 404 (or 400 for a code it will not look up) when it has no such
// product. Anything else that is not a success means it could not answer.
const answeredNotFound = (status: number) => status === 404 || status === 400;

async function goUpcOutcome(upc: string, signal: AbortSignal): Promise<ProviderOutcome> {
  try {
    const apiKey = process.env.GO_UPC_API_KEY?.trim();
    // Go-UPC API requires an API key for lookups
    if (!apiKey) return NOT_FOUND;

    const url = `https://go-upc.com/api/v1/code/${encodeURIComponent(upc)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'OptiCapture/1.0',
    };

    const res = await fetch(url, { headers, signal });
    if (!res.ok) return answeredNotFound(res.status) ? NOT_FOUND : FAILED;
    const data = (await res.json()) as any;

    const product = data?.product;
    const product_name = product?.name?.trim() || null;
    if (!product_name) return NOT_FOUND;

    return {
      product: {
        product_name,
        brand: product.brand?.trim() || null,
        image: product.imageUrl || null,
        source: 'go_upc',
      },
      failed: false,
    };
  } catch {
    return FAILED;
  }
}

async function openFoodFactsOutcome(upc: string, signal: AbortSignal): Promise<ProviderOutcome> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json`,
      { headers: { 'User-Agent': 'OptiCapture/1.0' }, signal }
    );
    if (!res.ok) return answeredNotFound(res.status) ? NOT_FOUND : FAILED;
    const data = (await res.json()) as any;
    const p = data?.product;
    if (!p) return NOT_FOUND;
    const product_name = p.product_name?.trim() || p.product_name_en?.trim() || null;
    if (!product_name) return NOT_FOUND;
    const brand =
      typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0].trim() : null;
    const image = p.image_front_url || p.image_url || null;
    return { product: { product_name, brand, image, source: 'open_food_facts' }, failed: false };
  } catch {
    return FAILED;
  }
}

async function upcItemDbOutcome(upc: string, signal: AbortSignal): Promise<ProviderOutcome> {
  try {
    const apiKey = process.env.UPCITEMDB_API_KEY?.trim();
    // Use paid /v1 endpoint when a key is configured, trial endpoint otherwise
    const url = `https://api.upcitemdb.com/prod/${apiKey ? 'v1' : 'trial'}/lookup?upc=${encodeURIComponent(upc)}`;
    const headers: Record<string, string> = apiKey ? { 'x-user-key': apiKey } : {};
    const res = await fetch(url, { headers, signal });
    if (!res.ok) return answeredNotFound(res.status) ? NOT_FOUND : FAILED;
    const data = (await res.json()) as any;
    const item = data?.items?.[0];
    if (!item?.title) return NOT_FOUND;
    return {
      product: {
        product_name: item.title.trim(),
        brand: item.brand?.trim() || null,
        image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
        source: 'upcitemdb',
      },
      failed: false,
    };
  } catch {
    return FAILED;
  }
}

export async function fetchGoUpc(upc: string, signal: AbortSignal): Promise<LookupResult | null> {
  return (await goUpcOutcome(upc, signal)).product;
}

export async function fetchOpenFoodFacts(
  upc: string,
  signal: AbortSignal
): Promise<LookupResult | null> {
  return (await openFoodFactsOutcome(upc, signal)).product;
}

export async function fetchUpcItemDb(
  upc: string,
  signal: AbortSignal
): Promise<LookupResult | null> {
  return (await upcItemDbOutcome(upc, signal)).product;
}

/** A lookup's product, and whether "no product" can be trusted as an answer. */
export interface ProductLookup {
  product: LookupResult | null;
  /** False when nothing was found and at least one provider could not answer. */
  conclusive: boolean;
}

export async function lookupProduct(upc: string): Promise<ProductLookup> {
  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) return { product: null, conclusive: true };

  const variants = upcVariants(cleanUpc);

  // Run every configured provider concurrently so a slow premium provider never
  // delays the two fallbacks. Each provider has its own timeout.
  const acrossVariants = async (
    provider: (upc: string, signal: AbortSignal) => Promise<ProviderOutcome>
  ): Promise<ProviderOutcome> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      let failed = false;
      for (const variant of variants) {
        const outcome = await provider(variant, controller.signal);
        if (outcome.product) return outcome;
        failed ||= outcome.failed;
      }
      return { product: null, failed };
    } finally {
      clearTimeout(timeout);
    }
  };

  const [goUpc, off, upcItemDb] = await Promise.all([
    acrossVariants(goUpcOutcome),
    acrossVariants(openFoodFactsOutcome),
    acrossVariants(upcItemDbOutcome),
  ]);

  const pick = (): LookupResult | null => {
    // Prefer the paid provider when configured and it returned a product. The
    // concurrent execution above keeps its latency from blocking the fallbacks.
    if (goUpc.product) return goUpc.product;

    // Prefer whichever result has more complete data (name + image beats name-only).
    // When both have an image, prefer UPCitemdb — cleaner retail labelling.
    // When only one has a name, use that one regardless of source.
    if (off.product && upcItemDb.product) {
      if (upcItemDb.product.image) return upcItemDb.product; // UPCitemdb has image — use it
      if (off.product.image) return off.product; // OFF has image, UPCitemdb doesn't
      return upcItemDb.product; // Both name-only — UPCitemdb has cleaner names
    }
    return upcItemDb.product ?? off.product ?? null;
  };

  const product = pick();
  return {
    product,
    conclusive: product !== null || !(goUpc.failed || off.failed || upcItemDb.failed),
  };
}

export async function lookupProductByUpc(upc: string): Promise<LookupResult | null> {
  return (await lookupProduct(upc)).product;
}
