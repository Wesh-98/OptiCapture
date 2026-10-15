import { db } from './db.js';
import {
  UnsupportedImageTypeError,
  removeUploadedFiles,
  savedUploadPath,
  uploadFileName,
} from './helpers.js';
import { logError } from './logger.js';

/**
 * The upload files some row still points at. A '/uploads/...' value in a row is not proof
 * that the row owns the file — inventory POST/PUT and imports can write an arbitrary path
 * into inventory.image — so a file is only ever unlinked once nothing points at it.
 *
 * Compared by uploadFileName, the key the unlink uses, not by the stored string:
 * '/uploads/sub/x.png' and an absolute 'https://…/uploads/x.png' both name x.png. One scan
 * builds the set rather than one query per file being deleted.
 */
export function referencedUploadFileNames(): Set<string> {
  const rows = db
    .prepare(
      `SELECT image AS path FROM inventory WHERE image LIKE '%/uploads/%'
       UNION SELECT logo AS path FROM stores WHERE logo LIKE '%/uploads/%'
       UNION SELECT image AS path FROM session_items WHERE image LIKE '%/uploads/%'`
    )
    .all() as Array<{ path: string }>;
  return new Set(rows.map(row => uploadFileName(row.path)));
}

/**
 * Unlinks the given uploads that no row points at any more. Call it after the rows that
 * named them have been deleted or changed, and after that transaction has committed — a
 * rollback must not take the files with it.
 */
export async function removeUnreferencedUploads(
  candidates: Iterable<string | null | undefined>
): Promise<number> {
  const paths = [...candidates].filter(
    (value): value is string => typeof value === 'string' && value.startsWith('/uploads/')
  );
  if (paths.length === 0) return 0;
  const stillReferenced = referencedUploadFileNames();
  return removeUploadedFiles(paths.filter(path => !stillReferenced.has(uploadFileName(path))));
}

/**
 * The same, for a route that has already done its work: the cleanup runs behind the response
 * and a failure is logged, never surfaced. Deleting an item, replacing its image or discarding
 * a scan session used to leave the image on disk for good.
 */
export function discardUploads(candidates: Iterable<string | null | undefined>): void {
  removeUnreferencedUploads(candidates).catch(error =>
    logError('uploads', error, 'Failed to remove unused uploads')
  );
}

/**
 * True when a row of this store already points at the upload: one of its items, a staged
 * scan in one of its sessions, or its logo. An item may name an existing upload (re-saving an
 * item keeps its photo; re-importing an export keeps its images) but only one of its own
 * store's, or a store could show, and later lay claim to, another tenant's file. Compared by
 * uploadFileName, the key the unlink uses.
 */
export function storeReferencesUpload(storeId: number | undefined, value: string): boolean {
  const name = uploadFileName(value);
  if (!name) return false;
  const rows = db
    .prepare(
      `SELECT image AS path FROM inventory WHERE store_id = ? AND instr(image, ?) > 0
       UNION ALL
       SELECT si.image FROM session_items si JOIN scan_sessions s ON s.session_id = si.session_id
        WHERE s.store_id = ? AND instr(si.image, ?) > 0
       UNION ALL
       SELECT logo FROM stores WHERE id = ? AND instr(logo, ?) > 0`
    )
    .all(storeId, name, storeId, name, storeId, name) as Array<{ path: string }>;
  return rows.some(row => uploadFileName(row.path) === name);
}

/**
 * Throws when `saved` (what saveBase64Image returned for `normalized`) names an existing
 * upload this store does not reference. A photo the call has just written is the store's own.
 */
export function assertStoreUpload(
  storeId: number | undefined,
  normalized: string,
  saved: string | null
): void {
  if (!saved?.startsWith('/uploads/') || savedUploadPath(normalized, saved) !== null) return;
  if (!storeReferencesUpload(storeId, saved)) {
    throw new UnsupportedImageTypeError('That photo is not one of this store’s uploads');
  }
}
