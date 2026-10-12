import { db } from './db.js';
import { removeUploadedFiles, uploadFileName } from './helpers.js';
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
