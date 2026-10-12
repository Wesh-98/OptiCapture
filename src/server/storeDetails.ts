import { db } from './db.js';
import { saveBase64Image } from './helpers.js';
import { discardUploads } from './uploads.js';
import { isEmailShaped } from '../lib/emailFormat.js';

/** The editable fields of a store, as sent by the store owner or the superadmin. */
export interface StoreDetails {
  name: string;
  street?: string | null;
  city?: string | null;
  zipcode?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
}

type StoreContact = Omit<Partial<StoreDetails>, 'name'>;

// Each check returns the message for the first problem it finds, or null.

export function storeNameError(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Store name is required';
  if (name.length > 100) return 'Store name must be 100 characters or fewer';
  return null;
}

export function storeFieldLengthError(fields: StoreContact): string | null {
  if (fields.street && fields.street.length > 200)
    return 'Street address must be 200 characters or fewer';
  if (fields.city && fields.city.length > 100) return 'City/Town must be 100 characters or fewer';
  if (fields.email && fields.email.length > 200) return 'Email must be 200 characters or fewer';
  return null;
}

export function storeContactFormatError(fields: StoreContact): string | null {
  if (fields.email && !isEmailShaped(fields.email)) return 'Invalid email address';
  if (fields.phone && !/^\d{10}$/.test(String(fields.phone).replaceAll(/\D/g, '')))
    return 'Phone must be 10 digits';
  if (fields.zipcode && !/^\d{5}(-\d{4})?$/.test(fields.zipcode))
    return 'Zipcode format: 12345 or 12345-6789';
  return null;
}

/**
 * Writes a store's details and carries a new name over to its users. An omitted logo keeps
 * the current one; null or an empty string clears it, and a replaced logo file is deleted.
 * Throws UnsupportedImageTypeError when the logo is not an accepted image.
 */
export function saveStoreDetails(
  storeId: number,
  details: StoreDetails,
  logo: string | null | undefined
): void {
  const previous = db.prepare('SELECT logo FROM stores WHERE id = ?').get(storeId) as
    | { logo: string | null }
    | undefined;
  const keepLogo = logo === undefined;
  const savedLogo = logo ? saveBase64Image(logo) : null;
  const name = details.name.trim();
  db.prepare(
    `UPDATE stores SET name = ?, street = ?, city = ?, zipcode = ?, state = ?, phone = ?, email = ?${
      keepLogo ? '' : ', logo = ?'
    } WHERE id = ?`
  ).run(
    name,
    details.street || null,
    details.city || null,
    details.zipcode || null,
    details.state || null,
    details.phone || null,
    details.email || null,
    ...(keepLogo ? [] : [savedLogo]),
    storeId
  );
  db.prepare('UPDATE users SET store_name = ? WHERE store_id = ?').run(name, storeId);
  if (!keepLogo) discardUploads([previous?.logo]);
}
