import { createHash } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { db } from '../db.js';
import { authenticateToken, requireOwner, requireOwnerOrTaker, asyncRoute } from '../middleware.js';
import {
  saveBase64Image,
  normalizeImageUrl,
  toIsoUtc,
  toSqliteUtc,
  firstQueryValue,
  removeUploadedFiles,
  savedUploadPath,
  searchCondition,
  upcVariants,
  isValidGtin,
  normalizeUpc,
  UnsupportedImageTypeError,
} from '../helpers.js';
import { isReservedCategoryName } from './categories.js';
import { IMPORT_FIELDS, isGenericSheetName, isKnownHeader } from '../../shared/importHeaders.js';
import type { AuthRequest } from '../types.js';
import { logError } from '../logger.js';
import { discardUploads } from '../uploads.js';

export const inventoryRouter = express.Router();

const IMPORT_DESTINATION_FIELDS = new Set<string>(['__ignore__', ...IMPORT_FIELDS]);
const IMPORT_IDENTIFIER_FIELDS = new Set(['upc', 'number', 'external_item_id', 'external_sku']);

// Import ceilings. The whole file used to be written inside one synchronous transaction, so
// a large import blocked the event loop from first row to last — long enough for /api/health
// to stop answering and a load balancer to take the instance out of rotation. Rows are now
// committed in chunks with a turn of the event loop between them, and the per-row diagnostics
// are capped so neither the response nor the audit log row can grow without bound.
const MAX_IMPORT_ROWS = 50_000;
const IMPORT_CHUNK_ROWS = 1_000;
const MAX_REPORTED_ERRORS = 100;
const MAX_REPORTED_SKIPPED_ROWS = 100;

interface ImportPreviewSheet {
  name: string;
  headers: string[];
  headerRowNumber: number;
  sourceColumnCount: number;
  preview: Record<string, any>[];
  rows: Record<string, any>[];
  /** The row each entry of `rows` came from in the file, so results can point at it. */
  rowNumbers: number[];
  rowCount: number;
}

/**
 * The one way batch-upload answers with a parsed file, whatever its format, so the row
 * ceiling is checked before the user maps any columns. Rejecting only at batch-confirm
 * would let a user map a 50,001-row file and then lose that work to a 413.
 */
function sendImportPreview(
  res: express.Response,
  sheets: ImportPreviewSheet[],
  hiddenSheets: string[] = []
) {
  const totalRows = sheets.reduce((n, s) => n + s.rowCount, 0);
  if (totalRows > MAX_IMPORT_ROWS) {
    return res.status(413).json({
      error: `This file has ${totalRows.toLocaleString('en-US')} rows. Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows — split the file and import it in parts.`,
    });
  }
  return res.json({ sheets, totalRows, hiddenSheets });
}

// Multer — memory storage for file uploads (xlsx/csv import)
// The 20 MB ceiling is deliberate: a full 50,000-row spreadsheet import runs past Sonar's
// 8 MB default, and the routes using this are authenticated and capped by MAX_IMPORT_ROWS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fieldSize: 10 * 1024 }, // NOSONAR(S5693) 20 MB file, 10 KB per non-file field
});

const IMPORT_FORMAT_BY_EXTENSION: Record<string, 'xlsx' | 'csv' | 'json'> = {
  '.xlsx': 'xlsx',
  '.csv': 'csv',
  '.json': 'json',
};
const IMPORT_FORMAT_BY_MIME: Record<string, 'xlsx' | 'csv' | 'json'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/json': 'json',
};

/**
 * Which parser an uploaded import file gets, or null when it is not one we read. The file
 * name decides first: the type a browser reports depends on the machine, and Windows with
 * Excel installed sends a .csv as application/vnd.ms-excel (or as nothing at all), which the
 * old type-only check turned away. The reported type is the fallback for a file with no
 * recognised extension. Either way the parser still has to accept the contents.
 */
export function importFileFormat(
  filename: string | undefined,
  mimetype: string | undefined
): 'xlsx' | 'csv' | 'json' | null {
  const dot = filename?.lastIndexOf('.') ?? -1;
  const extension = dot >= 0 ? filename!.slice(dot).toLowerCase() : '';
  if (Object.hasOwn(IMPORT_FORMAT_BY_EXTENSION, extension)) {
    return IMPORT_FORMAT_BY_EXTENSION[extension];
  }
  // A recognisable but unsupported extension (.xls, .txt, .exe) is refused outright.
  if (extension) return null;
  return Object.hasOwn(IMPORT_FORMAT_BY_MIME, mimetype ?? '')
    ? IMPORT_FORMAT_BY_MIME[mimetype ?? '']
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function richTextValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (isRecord(value) && Array.isArray(value.richText)) {
    return value.richText
      .map(entry => (isRecord(entry) && typeof entry.text === 'string' ? entry.text : ''))
      .join('')
      .trim();
  }
  return '';
}

// ExcelJS hands back an object for hyperlink, formula, error and rich-text cells. Null means
// the object has none of the fields those carry.
function normalizeImportedCellObject(
  value: Record<string, unknown>
): string | number | boolean | null {
  // An error cell (#N/A, #REF!), or a formula whose result is one, holds no value. Importing
  // it used to write the text {"error":"#N/A"} into the item.
  if (typeof value.error === 'string') return '';
  if (value.result !== undefined && value.result !== null) {
    return normalizeImportedCellValue(value.result);
  }
  // A link shows its text in the sheet; that text is the value. The address is only used
  // when the cell shows nothing else, as with a pasted image link.
  const text = richTextValue(value.text) || richTextValue(value);
  if (text) return text;
  if (typeof value.hyperlink === 'string' && value.hyperlink.trim()) {
    return value.hyperlink.trim();
  }
  return null;
}

function normalizeImportedCellValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(entry => String(normalizeImportedCellValue(entry))).join(', ');
  }
  if (isRecord(value)) {
    const fromCell = normalizeImportedCellObject(value);
    if (fromCell !== null) return fromCell;
  }
  return typeof value === 'bigint' ? value.toString() : (JSON.stringify(value) ?? '');
}

/**
 * A link cell whose text and address differ ("Drive Link" → https://drive…). Both are kept
 * until the column's destination is known: the address is the value of an Image column, the
 * text is the value of anything else. Taking the address everywhere used to turn a linked
 * product name into a URL.
 */
interface ImportedLinkCell {
  text: string;
  hyperlink: string;
}

function worksheetCellValue(value: unknown): string | number | boolean | ImportedLinkCell {
  if (isRecord(value) && typeof value.hyperlink === 'string' && value.hyperlink.trim()) {
    const text = richTextValue(value.text);
    const hyperlink = value.hyperlink.trim();
    if (text && text !== hyperlink) return { text, hyperlink };
  }
  return normalizeImportedCellValue(value);
}

/** The address of a link cell, for an Image column; any other value as it is. */
function linkTarget(value: unknown): unknown {
  return isRecord(value) && typeof value.hyperlink === 'string' ? value.hyperlink : value;
}

function readImportedString(value: unknown): string {
  const normalized = normalizeImportedCellValue(value);
  return typeof normalized === 'string' ? normalized.trim() : String(normalized).trim();
}

function detectWorksheetHeader(ws: ExcelJS.Worksheet): {
  rowNumber: number;
  columns: Array<{ columnNumber: number; header: string }>;
  sourceColumnCount: number;
} {
  const lastCandidateRow = Math.min(Math.max(ws.rowCount, 1), 100);
  let bestRowNumber = 1;
  let bestScore = -1;
  let sourceColumnCount = 0;

  ws.eachRow(row => {
    const values = (row.values as unknown[]).slice(1);
    for (let index = values.length - 1; index >= 0; index--) {
      if (readImportedString(values[index])) {
        sourceColumnCount = Math.max(sourceColumnCount, index + 1);
        break;
      }
    }
  });

  // A header row is labels: words the import knows, and text rather than numbers. Row width
  // used to dominate the score, so one data row with a note in a spare column, or a header
  // with one unlabeled column, made a data row the header and dropped everything above it.
  for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const labels = (row.values as unknown[]).slice(1).map(readImportedString).filter(Boolean);
    if (labels.length === 0) continue;

    const recognizedCount = labels.filter(isKnownHeader).length;
    const numericCount = labels.filter(label => /^[\d\s.,$%()-]+$/.test(label)).length;
    const textCount = labels.length - numericCount;
    const score = recognizedCount * 10 + textCount * 2 + labels.length - numericCount * 3;
    if (score > bestScore) {
      bestScore = score;
      bestRowNumber = rowNumber;
    }
  }

  const headerValues = (ws.getRow(bestRowNumber).values as unknown[]).slice(1);
  const usedHeaders = new Map<string, number>();
  const columns = headerValues.flatMap((value, index) => {
    const baseHeader = readImportedString(value);
    if (!baseHeader) return [];

    const normalizedHeader = baseHeader.toLocaleLowerCase();
    const occurrence = (usedHeaders.get(normalizedHeader) ?? 0) + 1;
    usedHeaders.set(normalizedHeader, occurrence);
    return [
      {
        columnNumber: index + 1,
        header: occurrence === 1 ? baseHeader : `${baseHeader} (${occurrence})`,
      },
    ];
  });

  return { rowNumber: bestRowNumber, columns, sourceColumnCount };
}

// Spreadsheet numbers arrive as text such as "$3.99", "1,200" or "8.25%". Strip that
// formatting, then either return a clean number (null when the cell is empty) or say why the
// value was rejected, so the row is reported instead of silently saved without it.
export function parseImportNumber(
  value: unknown,
  label: string,
  options: { integer?: boolean; max?: number } = {}
): { value: number | null; error?: string } {
  const text = readImportedString(value);
  if (!text) return { value: null };
  let cleaned = text.replace(/^[$£€¥]\s*/, '').replace(/(?<=\d),(?=\d{3}\b)/g, '');
  // Drop a trailing "%" and any space before it, without a regex that can backtrack.
  if (cleaned.endsWith('%')) cleaned = cleaned.slice(0, -1).trimEnd();
  const parsed = Number(cleaned);
  const max = options.max ?? 1_000_000;
  // Plain decimals only. Number() alone also read "0x10" as 16 and "1e3" as 1000.
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(cleaned) || !Number.isFinite(parsed)) {
    return { value: null, error: `${label} "${text}" is not a valid non-negative number` };
  }
  if (options.integer && !Number.isInteger(parsed)) {
    return { value: null, error: `${label} "${text}" must be a whole number` };
  }
  if (parsed > max) {
    return {
      value: null,
      error: `${label} "${text}" is larger than ${max.toLocaleString('en-US')}`,
    };
  }
  return { value: parsed };
}

function parseInventoryNumber(
  value: unknown,
  field: string,
  options: { integer?: boolean; max?: number; fallback?: number | null } = {}
): { value: number | null; error?: string } {
  if (value === undefined || value === null || value === '') {
    return { value: options.fallback ?? null };
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    (options.integer === true && !Number.isInteger(parsed)) ||
    (options.max !== undefined && parsed > options.max)
  ) {
    const kind = options.integer ? 'integer' : 'number';
    const ceiling = options.max === undefined ? '' : ` no greater than ${options.max}`;
    return { value: null, error: `${field} must be a non-negative ${kind}${ceiling}` };
  }

  return { value: parsed };
}

function validateInventoryStrings(values: {
  upc?: unknown;
  unit?: unknown;
  tag_names?: unknown;
  image?: unknown;
}): string | null {
  const labels: Record<keyof typeof values, string> = {
    upc: 'UPC',
    unit: 'Unit',
    tag_names: 'Tags',
    image: 'Image',
  };
  for (const [field, value] of Object.entries(values) as Array<[keyof typeof values, unknown]>) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${labels[field]} must be a string`;
    }
  }
  // Everything left is a string, null or undefined.
  const longerThan = (value: unknown, max: number) =>
    typeof value === 'string' && value.length > max;
  if (longerThan(values.upc, 128)) return 'UPC must be 128 characters or fewer';
  if (longerThan(values.unit, 50)) return 'Unit must be 50 characters or fewer';
  if (longerThan(values.tag_names, 1000)) return 'Tags must be 1000 characters or fewer';
  if (longerThan(values.image, 7_000_000)) return 'Image payload is too large';
  return null;
}

// How spreadsheets write an item's status. Anything else is refused rather than guessed.
const IMPORT_STATUS_WORDS: Record<string, 'Active' | 'Inactive'> = {
  active: 'Active',
  yes: 'Active',
  y: 'Active',
  true: 'Active',
  '1': 'Active',
  inactive: 'Inactive',
  no: 'Inactive',
  n: 'Inactive',
  false: 'Inactive',
  '0': 'Inactive',
};

/** An imported status cell as Active or Inactive, or null when the cell is blank. */
export function parseImportStatus(value: unknown): { value: 'Active' | 'Inactive' | null; error?: string } {
  const text = readImportedString(value);
  if (!text) return { value: null };
  const key = text.toLowerCase();
  if (Object.hasOwn(IMPORT_STATUS_WORDS, key)) return { value: IMPORT_STATUS_WORDS[key] };
  return { value: null, error: `Status "${text}" must be Active or Inactive (or Yes/No)` };
}

// The inventory.category_id foreign key only proves the category exists — not that
// it belongs to the caller's store. Without this check a client can attach its items
// to another tenant's category, whose name then leaks back through the
// `LEFT JOIN categories` in GET /inventory. Returns true when the id is absent
// (category_id is nullable) or owned by this store.
function isCategoryInStore(categoryId: unknown, storeId: number | undefined): boolean {
  if (categoryId === undefined || categoryId === null || categoryId === '') return true;
  const parsed = Number(categoryId);
  if (!Number.isInteger(parsed)) return false;
  return Boolean(
    db.prepare('SELECT 1 FROM categories WHERE id = ? AND store_id = ?').get(parsed, storeId)
  );
}

/**
 * The store's item carrying this barcode, in either of its forms: a UPC-A code and the same
 * code written as EAN-13 with a leading zero are one product. Every path that adds or
 * re-labels an item checks through this, so a store can never hold the same barcode twice.
 */
export function findItemIdByUpc(upc: string, storeId: number | undefined): number | null {
  const statement = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?');
  for (const variant of upcVariants(upc)) {
    const row = statement.get(variant, storeId) as { id: number } | undefined;
    if (row) return row.id;
  }
  return null;
}

// What the item form allows. An import is held to the same lengths.
const ITEM_LIMITS = {
  item_name: 500,
  description: 2000,
  upc: 128,
  unit: 50,
  tag_names: 1000,
  category: 100,
  number: 128,
  brand: 200,
  external: 200,
} as const;

/**
 * One page of a store's items, filtered the way the inventory page filters them. Shared by
 * GET /inventory (the caller's active store) and the superadmin's per-store view (the store
 * named in the URL), so both read the same rows. Returns an error string for a bad filter.
 */
// Optional `sort` values. Without one the list keeps its usual most-recently-updated order.
const INVENTORY_SORTS: Record<string, string> = {
  recent: 'i.created_at DESC, i.id DESC',
  name_asc: 'i.item_name COLLATE NOCASE ASC, i.id ASC',
  name_desc: 'i.item_name COLLATE NOCASE DESC, i.id DESC',
};

export function listStoreInventory(
  storeId: number | undefined,
  query: express.Request['query']
): { error: string } | { items: unknown[]; total: number; page: number; limit: number } {
  const category_id = firstQueryValue(query.category_id);
  const q = firstQueryValue(query.q);
  const status = firstQueryValue(query.status);
  const pageParam = firstQueryValue(query.page);
  const limitParam = firstQueryValue(query.limit);
  const sort = firstQueryValue(query.sort);

  if (sort && !Object.hasOwn(INVENTORY_SORTS, sort)) {
    return { error: `sort must be one of: ${Object.keys(INVENTORY_SORTS).join(', ')}` };
  }
  const orderBy = sort ? INVENTORY_SORTS[sort] : 'i.updated_at DESC';

  // Build WHERE conditions separately so we can reuse for COUNT + data queries
  const conditions: string[] = ['i.store_id = ?'];
  const params: unknown[] = [storeId];

  if (category_id) {
    conditions.push('i.category_id = ?');
    params.push(category_id);
  }

  if (status) {
    if (status !== 'Active' && status !== 'Inactive') {
      return { error: 'status must be Active or Inactive' };
    }
    conditions.push('i.status = ?');
    params.push(status);
  }

  if (q) {
    const text = searchCondition(['i.item_name', 'i.upc', 'c.name', 'i.tag_names'], String(q));
    conditions.push(text.sql);
    params.push(...text.params);
  }

  const from = `FROM inventory i LEFT JOIN categories c ON i.category_id = c.id WHERE ${conditions.join(' AND ')}`;
  const select = `SELECT i.*, c.name as category_name ${from}`;

  const parsedPage = Number.parseInt(String(pageParam ?? ''), 10);
  const pageNum = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limitParam ?? ''), 10) || 50, 1), 500);
  const offset = (pageNum - 1) * safeLimit;
  const { total } = db.prepare(`SELECT COUNT(*) as total ${from}`).get(...params) as {
    total: number;
  };
  const items = db
    .prepare(`${select} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, safeLimit, offset);
  return { items, total, page: pageNum, limit: safeLimit };
}

inventoryRouter.get('/inventory', authenticateToken, (req: AuthRequest, res) => {
  const result = listStoreInventory(req.user.store_id, req.query);
  if ('error' in result) return res.status(400).json(result);
  res.json(result);
});

// IDs of every item in one category, for select-all across pages
inventoryRouter.get('/inventory/ids', authenticateToken, (req: AuthRequest, res) => {
  const categoryId = Number(req.query.category_id);
  const storeId = req.user.store_id;
  if (!Number.isInteger(categoryId)) {
    return res.status(400).json({ error: 'Invalid category ID' });
  }

  const category = db
    .prepare('SELECT 1 FROM categories WHERE id = ? AND store_id = ?')
    .get(categoryId, storeId);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const rows = db
    .prepare('SELECT id FROM inventory WHERE category_id = ? AND store_id = ? ORDER BY id')
    .all(categoryId, storeId) as Array<{ id: number }>;
  res.json({ ids: rows.map(row => row.id) });
});

const EXPORT_COLUMNS = [
  { key: 'external_system', label: 'external_system' },
  { key: 'external_store_id', label: 'external_store_id' },
  { key: 'external_category_id', label: 'external_category_id' },
  { key: 'external_item_id', label: 'external_item_id' },
  { key: 'external_sku', label: 'external_sku' },
  { key: 'item_name', label: 'item_name' },
  { key: 'brand', label: 'brand' },
  { key: 'description', label: 'description' },
  { key: 'quantity', label: 'quantity' },
  { key: 'unit', label: 'unit' },
  { key: 'sale_price', label: 'sale_price' },
  { key: 'tax_percent', label: 'tax_percent' },
  { key: 'upc', label: 'upc' },
  { key: 'number', label: 'sku' },
  { key: 'tag_names', label: 'tag_names' },
  { key: 'image', label: 'image' },
  { key: 'category', label: 'category' },
  { key: 'status', label: 'status' },
  { key: 'sync_status', label: 'sync_status' },
  { key: 'last_imported_at', label: 'last_imported_at' },
  { key: 'last_exported_at', label: 'last_exported_at' },
  { key: 'created_at', label: 'created_at' },
] as const;

type ExportGroups = Map<string, any[]>;

function exportCsv(grouped: ExportGroups): string {
  // Quoting alone does not stop Excel/Sheets treating a leading =, +, -, @ (or a
  // leading tab/CR) as a formula. An item named `=cmd|'/c calc'!A0` would then
  // execute when an owner opens the export. Prefix those cells with a single
  // quote so the spreadsheet renders them as literal text.
  const csvCell = (v: string | number | null | undefined) => {
    const raw = String(v ?? '');
    const escaped = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${escaped.replaceAll('"', '""')}"`;
  };
  // One header row and data rows only: the category is already a column, and divider
  // rows would break any system that imports this file.
  const lines: string[] = [EXPORT_COLUMNS.map(column => csvCell(column.label)).join(',')];
  for (const items of grouped.values()) {
    for (const r of items)
      lines.push(EXPORT_COLUMNS.map(column => csvCell(r[column.key])).join(','));
  }
  return lines.join('\n');
}

async function writeExportPdf(
  res: express.Response,
  filename: string,
  total: number,
  grouped: ExportGroups
) {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.fontSize(18).font('Helvetica-Bold').text('Inventory Report', { align: 'center' });
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#666')
    .text(`Generated: ${new Date().toLocaleString()}   |   Total items: ${total}`, {
      align: 'center',
    });
  doc.moveDown(1.5);
  for (const [cat, items] of grouped) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#214c51').text(cat);
    doc.moveDown(0.3);
    for (const item of items) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#333')
        .text(
          `  ${item.item_name || '—'}   UPC: ${item.upc || '—'}   Qty: ${item.quantity ?? '—'}   Price: $${item.sale_price ?? '—'}   Unit: ${item.unit || '—'}   Status: ${item.status || '—'}`
        );
    }
    doc.moveDown(0.8);
  }
  doc.end();
}

// xlsx — one sheet per category, sheet name = category name
function buildExportWorkbook(grouped: ExportGroups) {
  const wb = new ExcelJS.Workbook();
  const usedSheetNames = new Set<string>();
  for (const [cat, items] of grouped) {
    // Excel sheet names: max 31 chars, strip invalid characters [ ] : * ? / \
    const baseName = cat.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Sheet';
    let sheetName = baseName;
    let suffix = 2;
    while (usedSheetNames.has(sheetName.toLocaleLowerCase())) {
      const suffixText = ` (${suffix++})`;
      sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    }
    usedSheetNames.add(sheetName.toLocaleLowerCase());
    const ws = wb.addWorksheet(sheetName);
    ws.addRow(EXPORT_COLUMNS.map(column => column.label));
    for (const r of items) ws.addRow(EXPORT_COLUMNS.map(column => r[column.key] ?? ''));
  }
  return wb;
}

// Export inventory — XLSX, CSV, JSON, PDF
inventoryRouter.get(
  '/inventory/export',
  authenticateToken,
  requireOwner,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    const fmt = ['xlsx', 'csv', 'json', 'pdf'].includes(req.query.format as string)
      ? (req.query.format as string)
      : 'xlsx';

    // Only data files can be re-imported elsewhere, so only they mark items as
    // exported, and only once the file has been built (a PDF is a report).
    const marksExported = fmt !== 'pdf';
    const exportTimestamp = toSqliteUtc();
    const markExported = () => {
      if (!marksExported) return;
      db.prepare(
        `
        UPDATE inventory
        SET last_exported_at = ?, sync_status = 'exported'
        WHERE store_id = ?
      `
      ).run(exportTimestamp, req.user.store_id);
    };

    const rows = db
      .prepare(
        `
    SELECT i.external_system, i.external_store_id, i.external_category_id,
           i.external_item_id, i.external_sku, i.item_name, i.brand, i.description,
           i.quantity, i.unit, i.sale_price, i.tax_percent, i.upc, i.number, i.image,
           i.tag_names, i.status, i.sync_status, i.last_imported_at,
           i.last_exported_at, c.name AS category, i.created_at
    FROM inventory i
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.store_id = ?
    ORDER BY c.name, i.item_name
  `
      )
      .all(req.user.store_id)
      .map((row: any) => ({
        ...row,
        // The file reflects the state this export records.
        sync_status: marksExported ? 'exported' : row.sync_status,
        created_at: toIsoUtc(row.created_at),
        last_imported_at: toIsoUtc(row.last_imported_at),
        last_exported_at: toIsoUtc(marksExported ? exportTimestamp : row.last_exported_at),
      })) as any[];

    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
      'EXPORT',
      `Exported ${rows.length} items as ${fmt.toUpperCase()}`,
      req.user.id,
      req.user.store_id
    );

    const filename = `inventory-${Date.now()}`;

    const serializeExportRow = (row: any) => {
      const { number, ...rest } = row;
      return { ...rest, sku: number };
    };

    // Group rows by category — shared across xlsx and pdf
    const grouped = new Map<string, any[]>();
    for (const r of rows) {
      const cat = r.category || 'Uncategorized';
      const items = grouped.get(cat) ?? [];
      items.push(r);
      grouped.set(cat, items);
    }

    if (fmt === 'csv') {
      const body = exportCsv(grouped);
      markExported();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(body);
    }

    if (fmt === 'json') {
      const body = JSON.stringify(
        {
          exported_at: toIsoUtc(exportTimestamp),
          total: rows.length,
          items: rows.map(serializeExportRow),
        },
        null,
        2
      );
      markExported();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      return res.send(body);
    }

    if (fmt === 'pdf') {
      await writeExportPdf(res, filename, rows.length, grouped);
      return;
    }

    const wb = buildExportWorkbook(grouped);
    const buf = await wb.xlsx.writeBuffer();
    markExported();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(Buffer.from(buf));
  })
);

// The checks on a new item run in this order so the first problem reported is the same one
// the form shows first: name and description, then the numbers, then everything else.

function categoryIdOrNull(value: unknown): number | null {
  return value === '' || value === null || value === undefined ? null : Number(value);
}

function createItemFailure(err: any): { status: number; error: string } {
  if (err instanceof UnsupportedImageTypeError) return { status: 400, error: err.message };
  // A concurrent insert can still hit the unique (upc, store_id) or item-number index.
  if (err.message?.includes('UNIQUE')) {
    return { status: 409, error: 'An item with that UPC or number already exists' };
  }
  logError('inventory:create', err);
  return { status: 500, error: 'An internal error occurred' };
}

function newItemTextError(body: any): string | null {
  const { item_name, description } = body;
  if (!item_name || typeof item_name !== 'string' || item_name.trim().length === 0)
    return 'Item name is required';
  if (item_name.length > 500) return 'Item name must be 500 characters or fewer';
  if (description !== undefined && description !== null && typeof description !== 'string')
    return 'Description must be a string';
  if (description && description.length > 2000)
    return 'Description must be 2000 characters or fewer';
  return null;
}

interface ItemNumbers {
  quantity: number | null;
  salePrice: number | null;
  tax: number | null;
}

/** `quantityFallback` is the quantity of a new item that names none; an update has no fallback. */
function parseItemNumbers(body: any, quantityFallback?: number): { error: string } | ItemNumbers {
  if (body.quantity === null) return { error: 'quantity must be a number' };
  const quantity = parseInventoryNumber(body.quantity, 'quantity', {
    integer: true,
    max: 1_000_000,
    fallback: quantityFallback,
  });
  if (quantity.error) return { error: quantity.error };
  const salePrice = parseInventoryNumber(body.sale_price, 'sale_price', { max: 1_000_000 });
  if (salePrice.error) return { error: salePrice.error };
  const tax = parseInventoryNumber(body.tax_percent, 'tax_percent', { max: 100 });
  if (tax.error) return { error: tax.error };
  return { quantity: quantity.value, salePrice: salePrice.value, tax: tax.value };
}

function newItemAttributeError(body: any, storeId: number | undefined): string | null {
  const { upc, unit, tag_names, image, status, category_id } = body;
  const stringError = validateInventoryStrings({ upc, unit, tag_names, image });
  if (stringError) return stringError;
  // A manual add must carry a UPC; the image is optional.
  if (typeof upc !== 'string' || !upc.trim()) return 'UPC is required';
  if (status !== undefined && !['Active', 'Inactive'].includes(status))
    return 'status must be Active or Inactive';
  if (!isCategoryInStore(category_id, storeId)) return 'Invalid category';
  return null;
}

inventoryRouter.post(
  '/inventory',
  authenticateToken,
  requireOwnerOrTaker,
  (req: AuthRequest, res) => {
    const { item_name, category_id, status, image, unit, description, tag_names, upc } = req.body;
    const user = req.user;

    const textError = newItemTextError(req.body);
    if (textError) return res.status(400).json({ error: textError });
    const numbers = parseItemNumbers(req.body, 0);
    if ('error' in numbers) return res.status(400).json({ error: numbers.error });
    const attributeError = newItemAttributeError(req.body, user.store_id);
    if (attributeError) return res.status(400).json({ error: attributeError });
    const upcResult = normalizeUpc(upc);
    if ('error' in upcResult) return res.status(400).json({ error: upcResult.error });

    const itemName = item_name.trim();
    // '' is an absent category, not category 0. Passing it straight through hit the
    // category_id foreign key and surfaced as a 500; the PUT route already normalises it.
    const categoryIdValue = categoryIdOrNull(category_id);
    const cleanUpc = upcResult.value;
    // Two items may share a name (the same product in two sizes); they may not share a UPC.
    if (cleanUpc && findItemIdByUpc(cleanUpc, user.store_id) !== null) {
      return res.status(409).json({ error: 'An item with that UPC already exists' });
    }

    // Removed again if the insert fails, so a refused item leaves no file behind.
    let createdUpload: string | null = null;
    try {
      const normalizedImage = image ? normalizeImageUrl(image) : null;
      const savedImage = normalizedImage ? saveBase64Image(normalizedImage) : null;
      createdUpload =
        normalizedImage && savedImage ? savedUploadPath(normalizedImage, savedImage) : null;
      const info = db.transaction(() => {
        const row = db
          .prepare(
            `
        INSERT INTO inventory (item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names, upc, store_id, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
      `
          )
          .run(
            itemName,
            numbers.quantity,
            categoryIdValue,
            status ?? 'Active',
            savedImage,
            unit,
            numbers.salePrice,
            numbers.tax,
            description,
            tag_names,
            cleanUpc || null,
            user.store_id
          );
        db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
          'CREATE',
          `Added item "${itemName}"`,
          user.id,
          user.store_id
        );
        return row;
      })();

      res.json({ id: info.lastInsertRowid });
    } catch (err: any) {
      if (createdUpload) void removeUploadedFiles([createdUpload]);
      const failure = createItemFailure(err);
      res.status(failure.status).json({ error: failure.error });
    }
  }
);

/** An inventory row with its category name: the before and after of an update. */
export interface InventoryRowSnapshot {
  id: number;
  item_name: string;
  upc: string | null;
  category_id: number | null;
  category_name: string | null;
  sale_price: number | null;
  tax_percent: number | null;
  unit: string | null;
  status: string;
  description: string | null;
  image: string | null;
  updated_at: string;
}

export interface ItemUpdateOptions {
  /** Refuse with 409 when the row's revision (itemRevision) no longer matches. */
  expectedRevision?: string;
  /**
   * The log line for the change, from the row before and after. Returning null means nothing
   * visible changed, and the update is rolled back with a 400. Without it the store's usual
   * "Updated item" line is written.
   */
  describe?: (before: InventoryRowSnapshot, after: InventoryRowSnapshot) => string | null;
}

class ItemUpdateConflict extends Error {}
class ItemUpdateNoChange extends Error {}

export function readItemSnapshot(itemId: unknown, storeId: number | undefined) {
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name
         FROM inventory i LEFT JOIN categories c ON c.id = i.category_id
        WHERE i.id = ? AND i.store_id = ?`
    )
    .get(itemId, storeId) as InventoryRowSnapshot | undefined;
}

/**
 * Validates and applies one item update for one store, and logs it to that store. Shared by
 * the store's own PUT /inventory/:id and the superadmin's edit route so both follow the same
 * rules. Returns the status and body to send.
 */
// Everything a person could see or change on an item. A save is checked against these, not
// just updated_at: that is whole seconds, so an edit in the same second as the form was
// opened left it unchanged and the stale save went through.
const REVISION_COLUMNS = [
  'item_name',
  'upc',
  'number',
  'brand',
  'category_id',
  'quantity',
  'status',
  'unit',
  'sale_price',
  'tax_percent',
  'description',
  'tag_names',
  'image',
  'updated_at',
] as const;

/** A short fingerprint of an item's contents; any change to the item changes it. */
export function itemRevision(row: object): string {
  const values = REVISION_COLUMNS.map(column => (row as Record<string, unknown>)[column] ?? null);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
}

type ItemUpdateResult = { status: number; body: Record<string, unknown> };

/** How each plain column's value is read from an update. A column the body omits is left alone. */
const UPDATE_COLUMNS: Record<string, (value: any, numbers: ItemNumbers) => unknown> = {
  item_name: value => value.trim(),
  quantity: (_value, numbers) => numbers.quantity,
  category_id: categoryIdOrNull,
  status: value => value,
  unit: value => (value === '' || value === null ? null : String(value)),
  sale_price: (_value, numbers) => numbers.salePrice,
  tax_percent: (_value, numbers) => numbers.tax,
  description: value => value || null,
  tag_names: value => value || null,
  upc: value => (value === null ? null : String(value).trim() || null),
};

function updateTextError(body: Record<string, any>): string | null {
  const { item_name, description } = body;
  // An edit that names no field used to answer 200 and write an "Updated item" audit row.
  if (body.image === undefined && Object.keys(UPDATE_COLUMNS).every(c => body[c] === undefined))
    return 'Nothing to change';
  // Reject blank strings — the POST route already guards this but PUT skipped the trim check
  if (
    item_name !== undefined &&
    (typeof item_name !== 'string' || item_name.trim().length === 0 || item_name.length > 500)
  )
    return 'Item name must be a non-empty string of 500 characters or fewer';
  if (description !== undefined && description !== null && typeof description !== 'string')
    return 'Description must be a string';
  if (description && description.length > 2000)
    return 'Description must be 2000 characters or fewer';
  return null;
}

function updateAttributeError(
  body: Record<string, any>,
  storeId: number | undefined
): string | null {
  const { upc, unit, tag_names, image, status, category_id } = body;
  const stringError = validateInventoryStrings({ upc, unit, tag_names, image });
  if (stringError) return stringError;
  if (status !== undefined && !['Active', 'Inactive'].includes(status))
    return 'status must be Active or Inactive';
  if (!isCategoryInStore(category_id, storeId)) return 'Invalid category';
  return null;
}

// A UPC can be changed but not removed: scans, import matching and the cross-store view
// all find the item by it. Items that never had one can still be edited without one.
function upcChangeError(
  upc: unknown,
  currentUpc: string | null,
  itemId: unknown,
  storeId: number | undefined
): ItemUpdateResult | null {
  const newUpc = typeof upc === 'string' ? upc.trim() : '';
  if (upc !== undefined && currentUpc?.trim() && !newUpc) {
    return { status: 400, body: { error: 'UPC can be changed but not removed' } };
  }
  if (!newUpc) return null;
  const holder = findItemIdByUpc(newUpc, storeId);
  if (holder !== null && holder !== Number(itemId)) {
    return { status: 409, body: { error: 'An item with that UPC already exists' } };
  }
  return null;
}

// Builds the SET list from the fields the client sent. A new image is written to disk here,
// before the update runs; `createdUpload` names that file so it can be removed if the update
// then fails and no row points at it.
function buildItemUpdate(body: Record<string, any>, numbers: ItemNumbers) {
  const assignments = ['updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  for (const [column, toValue] of Object.entries(UPDATE_COLUMNS)) {
    if (body[column] !== undefined) assign(column, toValue(body[column], numbers));
  }
  let createdUpload: string | null = null;
  if (body.image !== undefined) {
    const normalizedImage = body.image ? normalizeImageUrl(String(body.image)) : null;
    const savedImage = normalizedImage ? saveBase64Image(normalizedImage) : null;
    createdUpload =
      normalizedImage && savedImage ? savedUploadPath(normalizedImage, savedImage) : null;
    assign('image', savedImage);
  }
  return { assignments, values, createdUpload };
}

// Runs the UPDATE and its log line in one transaction and returns the rows changed.
// 0 changes means either the id doesn't exist or it belongs to a different
// store. The caller answers 404 either way — this prevents cross-tenant writes from
// silently succeeding with a 200 while actually touching nothing.
function applyItemUpdate(
  target: { itemId: unknown; storeId: number | undefined; userId: number },
  update: { assignments: string[]; values: unknown[] },
  defaultDetails: string,
  options: ItemUpdateOptions
): number {
  const { itemId, storeId, userId } = target;
  return db.transaction(() => {
    // Read inside the transaction so the conflict check and the "before" values
    // describe exactly the row this update replaces.
    const before =
      options.describe || options.expectedRevision !== undefined
        ? readItemSnapshot(itemId, storeId)
        : undefined;
    if (
      options.expectedRevision !== undefined &&
      before &&
      itemRevision(before) !== options.expectedRevision
    ) {
      throw new ItemUpdateConflict();
    }
    const r = db
      .prepare(
        `UPDATE inventory
           SET ${update.assignments.join(', ')}
           WHERE id = ? AND store_id = ?`
      )
      .run(...update.values, itemId, storeId);
    if (r.changes === 0) return 0;

    let details = defaultDetails;
    if (options.describe && before) {
      const after = readItemSnapshot(itemId, storeId);
      const described = after ? options.describe(before, after) : null;
      if (described === null) throw new ItemUpdateNoChange();
      details = described;
    }
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
      'UPDATE',
      details,
      userId,
      storeId
    );
    return r.changes;
  })();
}

function itemUpdateFailure(err: any, itemId: unknown): ItemUpdateResult {
  if (err instanceof ItemUpdateConflict) {
    return {
      status: 409,
      body: { error: 'This item was changed since you opened it. Reload it and try again.' },
    };
  }
  if (err instanceof ItemUpdateNoChange)
    return { status: 400, body: { error: 'Nothing to change' } };
  if (err instanceof UnsupportedImageTypeError)
    return { status: 400, body: { error: err.message } };
  if (err.message?.includes('UNIQUE')) {
    return { status: 409, body: { error: 'An item with that UPC or number already exists' } };
  }
  logError('inventory:update', err, 'Failed to update inventory item', { itemId });
  return { status: 500, body: { error: 'An internal error occurred' } };
}

export function updateInventoryItem(
  storeId: number | undefined,
  userId: number,
  itemId: unknown,
  requestBody: Record<string, any>,
  options: ItemUpdateOptions = {}
): ItemUpdateResult {
  const bad = (error: string) => ({ status: 400, body: { error } });

  // A typed UPC is stored the way scans and imports store it ("0 12345 67890 5" → digits).
  let body = requestBody;
  if (typeof body.upc === 'string') {
    const upcResult = normalizeUpc(body.upc);
    if ('error' in upcResult) return bad(upcResult.error);
    body = { ...body, upc: upcResult.value };
  }

  const textError = updateTextError(body);
  if (textError) return bad(textError);
  const numbers = parseItemNumbers(body);
  if ('error' in numbers) return bad(numbers.error);
  const attributeError = updateAttributeError(body, storeId);
  if (attributeError) return bad(attributeError);

  const existingItem = db
    .prepare('SELECT item_name, upc, image FROM inventory WHERE id = ? AND store_id = ?')
    .get(itemId, storeId) as
    | { item_name: string; upc: string | null; image: string | null }
    | undefined;
  if (!existingItem) return { status: 404, body: { error: 'Item not found' } };
  const upcError = upcChangeError(body.upc, existingItem.upc, itemId, storeId);
  if (upcError) return upcError;

  let createdUpload: string | null = null;
  const discardUpload = () => {
    if (createdUpload) void removeUploadedFiles([createdUpload]);
  };

  try {
    const update = buildItemUpdate(body, numbers);
    createdUpload = update.createdUpload;
    const defaultDetails = `Updated item "${body.item_name?.trim() || existingItem.item_name}"`;
    const changes = applyItemUpdate({ itemId, storeId, userId }, update, defaultDetails, options);
    if (changes === 0) {
      discardUpload();
      return { status: 404, body: { error: 'Item not found' } };
    }

    // A replaced or cleared image is removed unless something still points at it.
    if (body.image !== undefined) discardUploads([existingItem.image]);

    return { status: 200, body: { success: true } };
  } catch (err: any) {
    discardUpload();
    return itemUpdateFailure(err, itemId);
  }
}

inventoryRouter.put(
  '/inventory/:id',
  authenticateToken,
  requireOwnerOrTaker,
  (req: AuthRequest, res) => {
    const result = updateInventoryItem(req.user.store_id, req.user.id, req.params.id, req.body);
    res.status(result.status).json(result.body);
  }
);

inventoryRouter.delete(
  '/inventory/:id',
  authenticateToken,
  requireOwnerOrTaker,
  (req: AuthRequest, res) => {
    const { id } = req.params;
    const user = req.user;

    const deletedItem = db
      .prepare('SELECT item_name, image FROM inventory WHERE id = ? AND store_id = ?')
      .get(id, user.store_id) as any;

    // Item not found in this store — either it doesn't exist or it belongs to
    // another tenant. 404 prevents cross-tenant deletes from silently no-oping
    // with a 200 and avoids confirming whether the item exists in another store.
    if (!deletedItem) return res.status(404).json({ error: 'Item not found' });

    db.transaction(() => {
      db.prepare('DELETE FROM inventory WHERE id = ? AND store_id = ?').run(id, user.store_id);
      db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
        'DELETE',
        `Deleted item "${deletedItem.item_name}"`,
        user.id,
        user.store_id
      );
    })();
    discardUploads([deletedItem.image]);

    res.json({ success: true });
  }
);

/**
 * A CSV file's text. Excel's plain "CSV" save writes Windows-1252, not UTF-8; read as UTF-8
 * that turned "Café" into "Caf�" and "£3.99" into a rejected price. Valid UTF-8 is read as
 * UTF-8, anything else as Windows-1252.
 */
export function decodeCsvText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Trims the keys of CSV and JSON rows, so the headers the mapping screen shows (it trims
 * them) are the keys the rows carry. A file with " UPC " as a header used to import nothing:
 * the mapping said "UPC", every row said " UPC ". Two keys that trim to the same name keep
 * both, the second as "Name (2)", the way worksheet headers already are.
 */
export function trimRowKeys(rawRows: Record<string, unknown>[]): {
  headers: string[];
  rows: Record<string, unknown>[];
} {
  const headerFor = new Map<string, string>();
  const taken = new Set<string>();
  const headers: string[] = [];
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      // Papa Parse collects fields beyond the header here; they have no column to map to.
      if (key === '__parsed_extra' || headerFor.has(key)) continue;
      const base = key.trim();
      if (!base) continue;
      let header = base;
      for (let n = 2; taken.has(header.toLocaleLowerCase()); n++) header = `${base} (${n})`;
      taken.add(header.toLocaleLowerCase());
      headerFor.set(key, header);
      headers.push(header);
    }
  }
  const rows = rawRows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const header = headerFor.get(key);
      if (header) out[header] = value;
    }
    return out;
  });
  return { headers, rows };
}

/** One sheet parsed from a CSV or JSON file, where row N of the data is line N + 1. */
function flatPreviewSheet(name: string, rawRows: Record<string, unknown>[]): ImportPreviewSheet {
  const { headers, rows } = trimRowKeys(rawRows);
  return {
    name,
    headers,
    headerRowNumber: 1,
    sourceColumnCount: headers.length,
    preview: rows.slice(0, 5),
    rows,
    rowNumbers: rows.map((_, index) => index + 2),
    rowCount: rows.length,
  };
}

function worksheetPreview(ws: ExcelJS.Worksheet): ImportPreviewSheet {
  const detectedHeader = detectWorksheetHeader(ws);
  const rows: Record<string, any>[] = [];
  const rowNumbers: number[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= detectedHeader.rowNumber) return;
    const obj: Record<string, any> = {};
    detectedHeader.columns.forEach(column => {
      obj[column.header] = worksheetCellValue(row.getCell(column.columnNumber).value);
    });
    if (Object.values(obj).some(value => readImportedString(value))) {
      rows.push(obj);
      rowNumbers.push(rowNumber);
    }
  });
  return {
    name: ws.name,
    headers: detectedHeader.columns.map(column => column.header),
    headerRowNumber: detectedHeader.rowNumber,
    sourceColumnCount: detectedHeader.sourceColumnCount,
    preview: rows.slice(0, 5),
    rows,
    rowNumbers,
    rowCount: rows.length,
  };
}

function parseJsonImport(res: express.Response, buffer: Buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  // Support both raw array and our export format { items: [...] }
  const rows: Record<string, any>[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  if (!Array.isArray(rows) || rows.some(row => !isRecord(row))) {
    return res.status(400).json({ error: 'JSON items must be an array of objects' });
  }
  if (rows.length === 0) return res.status(400).json({ error: 'JSON file has no items' });
  return sendImportPreview(res, [flatPreviewSheet('Inventory', rows)]);
}

function parseCsvImport(res: express.Response, buffer: Buffer) {
  const { data, errors } = Papa.parse<Record<string, any>>(decodeCsvText(buffer), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (errors.length && data.length === 0)
    return res.status(400).json({ error: 'Could not parse CSV file.' });
  // A header line alone used to come back as an empty sheet with nothing to map.
  if (data.length === 0) return res.status(400).json({ error: 'File is empty or has no data rows' });
  return sendImportPreview(res, [flatPreviewSheet('Sheet1', data)]);
}

async function parseWorkbookImport(res: express.Response, buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  // Hidden sheets are left out: what the owner sees in Excel is what gets imported. Their
  // names go back so the mapping screen can say they were skipped.
  const isHidden = (ws: ExcelJS.Worksheet) => ws.state === 'hidden' || ws.state === 'veryHidden';
  const hiddenSheets = workbook.worksheets.filter(isHidden).map(ws => ws.name);
  const sheets = workbook.worksheets
    .filter(ws => !isHidden(ws))
    .map(worksheetPreview)
    .filter(sheet => sheet.rowCount > 0);
  if (sheets.length === 0)
    return res.status(400).json({ error: 'File is empty or has no data rows' });
  return sendImportPreview(res, sheets, hiddenSheets);
}

// Batch Upload — parse ALL sheets, return headers + preview + full rows per sheet
inventoryRouter.post(
  '/inventory/batch-upload',
  authenticateToken,
  requireOwner,
  upload.single('file'),
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const format = importFileFormat(req.file.originalname, req.file.mimetype);
    if (!format) {
      return res
        .status(400)
        .json({ error: 'Invalid file type. Only XLSX, CSV, and JSON files are allowed.' });
    }

    try {
      if (format === 'json') return parseJsonImport(res, req.file.buffer);
      if (format === 'csv') return parseCsvImport(res, req.file.buffer);
      await parseWorkbookImport(res, req.file.buffer);
    } catch (err: any) {
      logError('import:upload', err);
      res
        .status(400)
        .json({ error: 'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.' });
    }
  })
);

// Batch Confirm — full sync with per-sheet column mapping
// A sheet's chosen category, or its own name when none was chosen and the name says something.
function sheetFallbackCategory(sheet: { sheetName: string; categoryName?: string | null }): string {
  if (Object.hasOwn(sheet, 'categoryName')) return readImportedString(sheet.categoryName);
  return isGenericSheetName(sheet.sheetName) ? '' : sheet.sheetName;
}

// True when the confirm payload is not a list of sheets shaped the way the mapping page sends them.
function hasInvalidSheetsData(sheetsData: any): boolean {
  return (
    !Array.isArray(sheetsData) ||
    sheetsData.length === 0 ||
    sheetsData.some(
      sheet =>
        !isRecord(sheet) ||
        typeof sheet.sheetName !== 'string' ||
        (sheet.categoryName !== undefined &&
          sheet.categoryName !== null &&
          (typeof sheet.categoryName !== 'string' ||
            sheet.categoryName.length > ITEM_LIMITS.category)) ||
        !Array.isArray(sheet.rows) ||
        !isRecord(sheet.mapping) ||
        Object.values(sheet.mapping).some(
          destination =>
            typeof destination !== 'string' || !IMPORT_DESTINATION_FIELDS.has(destination)
        ) ||
        sheet.rows.some(row => !isRecord(row)) ||
        hasInvalidRowNumbers(sheet)
    )
  );
}

// `rowNumbers` is optional (a client built before it existed sends none), but when sent it
// must name one file row per data row.
function hasInvalidRowNumbers(sheet: Record<string, any>): boolean {
  if (sheet.rowNumbers === undefined) return false;
  return (
    !Array.isArray(sheet.rowNumbers) ||
    sheet.rowNumbers.length !== sheet.rows.length ||
    sheet.rowNumbers.some((n: unknown) => !Number.isInteger(n) || (n as number) < 1)
  );
}

// What is wrong with one sheet's column mapping, or null.
function sheetMappingError(sheet: {
  sheetName: string;
  categoryName?: string | null;
  mapping: Record<string, string>;
}): string | null {
  // A sheet's own name becomes its category when none was chosen, so it is held to the
  // category limit too.
  if (!Object.hasOwn(sheet, 'categoryName') && sheet.sheetName.length > ITEM_LIMITS.category) {
    return `A sheet name is longer than ${ITEM_LIMITS.category} characters. Choose a category for that sheet instead.`;
  }
  const destinations = Object.values(sheet.mapping).filter(
    destination => destination !== '__ignore__'
  );
  const duplicateDestination = destinations.find(
    (destination, index) => destinations.indexOf(destination) !== index
  );
  if (duplicateDestination) {
    return `Sheet "${sheet.sheetName}" maps more than one column to ${duplicateDestination}.`;
  }
  if (!destinations.some(destination => IMPORT_IDENTIFIER_FIELDS.has(destination))) {
    return `Sheet "${sheet.sheetName}" must map UPC, SKU / Item Number, External Item ID, or External SKU.`;
  }
  if (destinations.includes('external_item_id') && !destinations.includes('external_system')) {
    return `Sheet "${sheet.sheetName}" maps External Item ID but not External System. Map the column that names the source platform, or unmap External Item ID.`;
  }
  return null;
}

// Accepts JSON body: { sheetsData: [{ sheetName, categoryName, rows, mapping }] }
// M-3: Only this route needs large payloads (full sheet rows)
inventoryRouter.post(
  '/inventory/batch-confirm',
  authenticateToken,
  requireOwner,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    const { sheetsData } = req.body as {
      sheetsData: {
        sheetName: string;
        categoryName?: string | null;
        rows: Record<string, any>[];
        rowNumbers?: number[];
        mapping: Record<string, string>;
      }[];
    };
    if (hasInvalidSheetsData(sheetsData)) {
      return res.status(400).json({ error: 'Invalid sheets data' });
    }

    const mappingError = sheetsData.map(sheetMappingError).find(Boolean);
    if (mappingError) return res.status(400).json({ error: mappingError });

    const requestedRows = sheetsData.reduce((n, sheet) => n + sheet.rows.length, 0);
    if (requestedRows > MAX_IMPORT_ROWS) {
      return res.status(413).json({
        error: `This import has ${requestedRows.toLocaleString('en-US')} rows. Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows — split the file and import it in parts.`,
      });
    }

    const user = req.user;
    const results = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      // The true count, which may exceed the capped `errors` list above.
      errors_total: 0,
      skipped_rows: [] as { row_num: number; sheet: string; item_name: string }[],
    };

    // `results.skipped` and `results.errors_total` stay exact; only the per-row detail lists
    // are capped, so a 50k-row file of bad rows cannot produce a 50k-entry response.
    const addError = (message: string) => {
      results.errors_total++;
      if (results.errors.length < MAX_REPORTED_ERRORS) results.errors.push(message);
    };
    const addSkippedRow = (skipped: { row_num: number; sheet: string; item_name: string }) => {
      results.skipped++;
      if (results.skipped_rows.length < MAX_REPORTED_SKIPPED_ROWS) {
        results.skipped_rows.push(skipped);
      }
    };

    // Images written to disk by this import and attached to a row, so a rolled-back chunk
    // does not leave them behind.
    const savedImagePaths: string[] = [];
    // Images saved for rows whose write then failed; removed once their chunk finishes.
    const rejectedUploads: string[] = [];

    const categoryIconMap: Record<string, string> = {
      beverages: '/icons/soft-drinks.png',
      drinks: '/icons/soft-drinks.png',
      soda: '/icons/soft-drinks.png',
      'soft drinks': '/icons/soft-drinks.png',
      water: '/icons/water.png',
      juice: '/icons/juice-tea-lemonade.png',
      tea: '/icons/juice-tea-lemonade.png',
      lemonade: '/icons/juice-tea-lemonade.png',
      'juice, tea & lemonade': '/icons/juice-tea-lemonade.png',
      'energy drinks': '/icons/energy-drink.png',
      'energy drink': '/icons/energy-drink.png',
      energy: '/icons/energy-drink.png',
      'sports drinks': '/icons/sports-drink.png',
      'sports drink': '/icons/sports-drink.png',
      wine: '/icons/beer-wine.png',
      beer: '/icons/beer-wine.png',
      'wine & beer': '/icons/beer-wine.png',
      spirits: '/icons/beer-wine.png',
      alcohol: '/icons/beer-wine.png',
      liquor: '/icons/beer-wine.png',
      'cold coffee': '/icons/cold-coffee.png',
      coffee: '/icons/cold-coffee.png',
      'iced coffee': '/icons/cold-coffee.png',
      milk: '/icons/dairy.png',
      dairy: '/icons/dairy.png',
      snacks: '/icons/snack.png',
      chips: '/icons/snack.png',
      'nutrition & snacks': '/icons/nutrition-snacks.png',
      nutrition: '/icons/nutrition-snacks.png',
      candy: '/icons/candy.png',
      sweets: '/icons/candy.png',
      chocolate: '/icons/candy.png',
      confectionery: '/icons/candy.png',
      'gum & mints': '/icons/gum-mint.png',
      gum: '/icons/gum-mint.png',
      mints: '/icons/gum-mint.png',
      bakery: '/icons/pastry.png',
      bread: '/icons/pastry.png',
      pastry: '/icons/pastry.png',
      pastries: '/icons/pastry.png',
      newspaper: '/icons/newspaper.png',
      newspapers: '/icons/newspaper.png',
      magazines: '/icons/newspaper.png',
      press: '/icons/newspaper.png',
      frozen: '/icons/frozen-food.png',
      'frozen food': '/icons/frozen-food.png',
      'frozen foods': '/icons/frozen-food.png',
      grocery: '/icons/grocery.png',
      food: '/icons/grocery.png',
      groceries: '/icons/grocery.png',
      tobacco: 'Cigarette',
      cigarettes: 'Cigarette',
      vaping: 'Cigarette',
      'non-tobacco': '/icons/non-tobacco.png',
      'non tobacco': '/icons/non-tobacco.png',
      'household items': '/icons/household-items.png',
      household: '/icons/household-items.png',
      cleaning: '/icons/household-items.png',
      automotive: '/icons/automotive.png',
      auto: '/icons/automotive.png',
      vehicles: '/icons/automotive.png',
      electronics: '/icons/electronics.png',
      tech: '/icons/electronics.png',
      phones: '/icons/electronics.png',
      'personal care': '/icons/personal-care.png',
      beauty: '/icons/personal-care.png',
      salon: '/icons/personal-care.png',
      hygiene: '/icons/personal-care.png',
      pets: '/icons/pet-food.png',
      'pet supplies': '/icons/pet-food.png',
      'pet food': '/icons/pet-food.png',
      animals: '/icons/pet-food.png',
      clothing: 'Shirt',
      apparel: 'Shirt',
      fashion: 'Shirt',
      health: 'Pill',
      pharmacy: 'Pill',
      medicine: 'Pill',
      vitamins: 'Pill',
      baby: 'Baby',
      'baby care': 'Baby',
      fitness: 'Dumbbell',
      sports: 'Dumbbell',
      gym: 'Dumbbell',
      books: 'Book',
      school: 'Book',
      office: 'Briefcase',
      gifts: 'Gift',
      toys: 'Gift',
      games: 'Gamepad2',
      garden: 'Leaf',
      plants: 'LeafyGreen',
      flowers: 'Flower2',
    };

    const categoryIdCache = new Map<string, number | null>();
    const getCategoryId = (name: string): number | null => {
      // "Soft  Drinks" and "Soft Drinks" are one category.
      const trimmed = String(name || '')
        .trim()
        .split(/\s+/)
        .join(' ');
      if (!trimmed) return null;
      // GET /categories hides reserved names, so a category created here under one would
      // leave its items unreachable from the category view. Leave the item uncategorised —
      // it is still listed and searchable under Inventory.
      if (isReservedCategoryName(trimmed)) return null;
      const cacheKey = trimmed.toLowerCase();
      if (categoryIdCache.has(cacheKey)) return categoryIdCache.get(cacheKey) ?? null;
      // Case-insensitive, so "snacks" in a file reuses the store's "Snacks" category.
      const existing = db
        .prepare(
          'SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(?) AND store_id = ? ORDER BY id LIMIT 1'
        )
        .get(trimmed, user.store_id) as any;
      if (existing) {
        categoryIdCache.set(cacheKey, existing.id);
        return existing.id;
      }
      const icon = Object.hasOwn(categoryIconMap, trimmed.toLowerCase())
        ? categoryIconMap[trimmed.toLowerCase()]
        : 'Package';
      const info = db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)')
        .run(trimmed, icon, user.store_id);
      const id = info.lastInsertRowid as number;
      categoryIdCache.set(cacheKey, id);
      return id;
    };

    const checkExternalItem = db.prepare(
      `
      SELECT id FROM inventory
      WHERE external_item_id = ?
        AND store_id = ?
        AND external_system = ?
    `
    );
    // An import may name an existing upload — that is how re-importing an export keeps its
    // images — but only one this store already references. Without that check a sheet could
    // point a row at any other tenant's upload, and the cleanup paths below would then treat
    // it as this store's file to delete.
    const storeOwnsUpload = db.prepare(
      'SELECT 1 FROM inventory WHERE store_id = ? AND image = ? LIMIT 1'
    );
    const checkNum = db.prepare('SELECT id FROM inventory WHERE number = ? AND store_id = ?');
    const checkExternalSku = db.prepare(
      'SELECT id FROM inventory WHERE external_sku = ? AND store_id = ?'
    );
    const readIdentity = db.prepare(
      `SELECT item_name, upc, number, external_system, external_item_id, external_sku
         FROM inventory WHERE id = ? AND store_id = ?`
    );

    const insertStmt = db.prepare(`
    INSERT INTO inventory (
      item_name, brand, description, quantity, unit, sale_price, tax_percent, upc, number,
      tag_names, category_id, status, image, external_system, external_store_id,
      external_category_id, external_item_id, external_sku, last_imported_at,
      sync_status, store_id, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')
  `);

    // An identifier the item lacks is filled in from the row; one it already has is never
    // replaced — a row that disagrees with it is refused before it gets here.
    const updateStmt = db.prepare(`
    UPDATE inventory
    SET item_name   = COALESCE(NULLIF(?, ''), item_name),
        brand       = COALESCE(NULLIF(?, ''), brand),
        description = COALESCE(NULLIF(?, ''), description),
        quantity    = COALESCE(?, quantity),
        unit        = COALESCE(NULLIF(?, ''), unit),
        sale_price  = COALESCE(NULLIF(?, ''), sale_price),
        tax_percent = COALESCE(NULLIF(?, ''), tax_percent),
        tag_names   = COALESCE(NULLIF(?, ''), tag_names),
        category_id = COALESCE(?, category_id),
        status      = COALESCE(NULLIF(?, ''), status),
        image       = COALESCE(NULLIF(?, ''), image),
        upc         = COALESCE(NULLIF(upc, ''), NULLIF(?, '')),
        number      = COALESCE(NULLIF(number, ''), NULLIF(?, '')),
        external_system      = COALESCE(NULLIF(?, ''), external_system),
        external_store_id    = COALESCE(NULLIF(?, ''), external_store_id),
        external_category_id = COALESCE(NULLIF(?, ''), external_category_id),
        external_item_id     = COALESCE(NULLIF(?, ''), external_item_id),
        external_sku         = COALESCE(NULLIF(?, ''), external_sku),
        last_imported_at     = ?,
        sync_status          = 'imported',
        updated_at  = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `);

    interface ImportWorkItem {
      sheet: (typeof sheetsData)[number];
      row: Record<string, any>;
      /** The row's line in the file, for messages that point the owner at it. */
      rowNum: number;
    }

    // "Sheet "Snacks" row 14", so a message can be found in the file.
    const rowPlace = (w: ImportWorkItem) => `Sheet "${w.sheet.sheetName}" row ${w.rowNum}`;
    const rowError = (w: ImportWorkItem, label: string, message: string) =>
      addError(`${rowPlace(w)} ("${label}"): ${message}`);

    // A mapped column's value. The mapping names headers as the screen shows them, trimmed;
    // a row from a client that did not trim its keys is matched on the trimmed key instead.
    const mappedValue = (row: Record<string, any>, source: string): unknown => {
      if (Object.hasOwn(row, source)) return row[source];
      const key = Object.keys(row).find(candidate => candidate.trim() === source.trim());
      return key === undefined ? undefined : row[key];
    };

    // A cell's text, without the apostrophe OptiCapture's CSV export puts in front of a value
    // starting with = + - or @ so spreadsheets do not run it as a formula. Re-importing that
    // export used to save the apostrophe into the item.
    const readText = (value: unknown): string => {
      const text = readImportedString(value);
      return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
    };

    // An imported UPC in its stored form. A number cell holding 11 digits is a 12-digit UPC
    // whose leading zero Excel dropped; it is put back when the result is a valid barcode.
    const readUpc = (value: unknown): { value: string } | { error: string } => {
      const text = readText(value);
      const restored =
        typeof value === 'number' && /^\d{11}$/.test(text) && isValidGtin(`0${text}`)
          ? `0${text}`
          : text;
      return normalizeUpc(restored);
    };

    // Reads one row through its sheet mapping and checks it. A row that cannot be imported is
    // reported (skipped or as an error) and comes back as null.
    const prepareRow = (workItem: ImportWorkItem) => {
      const { sheet, row } = workItem;
      const item: Record<string, any> = {};
      for (const [src, dest] of Object.entries(sheet.mapping)) {
        if (dest && dest !== '__ignore__') item[dest] = mappedValue(row, src);
      }

      const upcRead = readUpc(item.upc);
      const number = readText(item.number);
      const externalSystem = readText(item.external_system);
      const externalStoreId = readText(item.external_store_id);
      const externalCategoryId = readText(item.external_category_id);
      const externalItemId = readText(item.external_item_id);
      const externalSku = readText(item.external_sku);
      const itemName = readText(item.item_name);
      const upcText = 'value' in upcRead ? upcRead.value : readText(item.upc);
      if (!externalItemId && !upcText && !number && !externalSku) {
        const rawName =
          itemName ||
          Object.values(row)
            .map(v => String(v).trim())
            .find(v => v !== '') ||
          '(blank)';
        addSkippedRow({
          row_num: workItem.rowNum,
          sheet: sheet.sheetName,
          item_name: rawName,
        });
        return null;
      }

      const rowLabel = (itemName || upcText || number || externalItemId || externalSku).slice(
        0,
        80
      );
      if ('error' in upcRead) {
        rowError(workItem, rowLabel, upcRead.error);
        return null;
      }
      const upc = upcRead.value;

      // An external item ID is only an identity together with its source system;
      // without one it could merge with another platform's item of the same ID.
      if (externalItemId && !externalSystem) {
        rowError(workItem, rowLabel, 'External System is required when External Item ID is set');
        return null;
      }

      // The same lengths the item form enforces; a file used to be able to store a name,
      // UPC or description of any size.
      const lengthChecks: Array<[label: string, value: string, max: number]> = [
        ['Item name', itemName, ITEM_LIMITS.item_name],
        ['Brand', readText(item.brand), ITEM_LIMITS.brand],
        ['SKU / Item number', number, ITEM_LIMITS.number],
        ['Description', readText(item.description), ITEM_LIMITS.description],
        ['Unit', readText(item.unit), ITEM_LIMITS.unit],
        ['Tags', readText(item.tag_names), ITEM_LIMITS.tag_names],
        ['Category', readText(item.category), ITEM_LIMITS.category],
        ['External system', externalSystem, ITEM_LIMITS.external],
        ['External store ID', externalStoreId, ITEM_LIMITS.external],
        ['External category ID', externalCategoryId, ITEM_LIMITS.external],
        ['External item ID', externalItemId, ITEM_LIMITS.external],
        ['External SKU', externalSku, ITEM_LIMITS.external],
      ];
      const tooLong = lengthChecks.find(([, value, max]) => value.length > max);
      if (tooLong) {
        rowError(workItem, rowLabel, `${tooLong[0]} must be ${tooLong[2]} characters or fewer`);
        return null;
      }
      const qtyResult = parseImportNumber(item.quantity, 'Quantity', { integer: true });
      const priceResult = parseImportNumber(item.sale_price, 'Sale price');
      const taxResult = parseImportNumber(item.tax_percent, 'Tax percent', { max: 100 });
      const statusResult = parseImportStatus(item.status);
      const valueError =
        qtyResult.error ?? priceResult.error ?? taxResult.error ?? statusResult.error;
      if (valueError) {
        rowError(workItem, rowLabel, valueError);
        return null;
      }
      return {
        item,
        itemName,
        upc,
        number,
        externalSystem,
        externalStoreId,
        externalCategoryId,
        externalItemId,
        externalSku,
        rowLabel,
        status: statusResult.value,
        qty: qtyResult.value,
        salePrice: priceResult.value,
        taxPct: taxResult.value,
      };
    };
    type PreparedRow = NonNullable<ReturnType<typeof prepareRow>>;

    interface IdentifierMatch {
      label: string;
      id: number | null;
    }

    // Every identifier the row carries, with the item (if any) that already holds it.
    const identifierMatches = (p: PreparedRow): IdentifierMatch[] => {
      const lookups: Array<[present: string, label: string, find: () => number | null]> = [
        [
          p.externalItemId,
          `External Item ID "${p.externalItemId}"`,
          () =>
            (
              checkExternalItem.get(p.externalItemId, user.store_id, p.externalSystem) as
                | { id: number }
                | undefined
            )?.id ?? null,
        ],
        [p.upc, `UPC ${p.upc}`, () => findItemIdByUpc(p.upc, user.store_id)],
        [
          p.number,
          `SKU "${p.number}"`,
          () =>
            (checkNum.get(p.number, user.store_id) as { id: number } | undefined)?.id ?? null,
        ],
        [
          p.externalSku,
          `External SKU "${p.externalSku}"`,
          () =>
            (checkExternalSku.get(p.externalSku, user.store_id) as { id: number } | undefined)
              ?.id ?? null,
        ],
      ];
      return lookups
        .filter(([present]) => Boolean(present))
        .map(([, label, find]) => ({ label, id: find() }));
    };

    interface ItemIdentity {
      item_name: string | null;
      upc: string | null;
      number: string | null;
      external_system: string | null;
      external_item_id: string | null;
      external_sku: string | null;
    }

    // Why the item matched by one identifier is not the row's item, or null when it is.
    // An identifier the item lacks is fine (it is filled in); one it holds with a different
    // value means the file and the catalog disagree about which product this is.
    const identityMismatch = (p: PreparedRow, item: ItemIdentity): string | null => {
      if (p.upc && item.upc && !upcVariants(p.upc).includes(item.upc)) {
        return `its UPC is ${item.upc}, not ${p.upc}`;
      }
      if (p.number && item.number && item.number !== p.number) {
        return `its SKU is "${item.number}", not "${p.number}"`;
      }
      if (p.externalSku && item.external_sku && item.external_sku !== p.externalSku) {
        return `its External SKU is "${item.external_sku}", not "${p.externalSku}"`;
      }
      if (
        p.externalItemId &&
        item.external_item_id &&
        (item.external_item_id !== p.externalItemId || item.external_system !== p.externalSystem)
      ) {
        return `its External Item ID is "${item.external_item_id}", not "${p.externalItemId}"`;
      }
      return null;
    };

    const identityOf = (id: number) =>
      readIdentity.get(id, user.store_id) as ItemIdentity | undefined;
    const nameOf = (id: number) => identityOf(id)?.item_name ?? `#${id}`;

    // The item this row updates, null for a new item, or a message when the row's identifiers
    // do not all point at one item. Matching on the first identifier found used to rename and
    // restock a different product whenever a file's SKU or external ID disagreed with the
    // catalog, and drop the row's own UPC without a word.
    const resolveExistingItem = (p: PreparedRow): { id: number | null } | { error: string } => {
      const found = identifierMatches(p).filter(
        (match): match is { label: string; id: number } => match.id !== null
      );
      if (found.length === 0) return { id: null };
      const [first] = found;
      const other = found.find(match => match.id !== first.id);
      if (other) {
        return {
          error: `${first.label} belongs to "${nameOf(first.id)}" but ${other.label} belongs to "${nameOf(other.id)}"`,
        };
      }
      const identity = identityOf(first.id);
      const mismatch = identity ? identityMismatch(p, identity) : null;
      if (mismatch) {
        return { error: `${first.label} belongs to "${nameOf(first.id)}", but ${mismatch}` };
      }
      return { id: first.id };
    };

    // Identifiers already written by this import, with where. A file that lists one product
    // twice used to save the first row and then quietly overwrite it with the second.
    const seenIdentifiers = new Map<string, string>();
    const identifierKeys = (p: PreparedRow): string[] => [
      ...(p.upc ? upcVariants(p.upc).map(variant => `upc:${variant}`) : []),
      ...(p.number ? [`number:${p.number}`] : []),
      ...(p.externalSku ? [`external_sku:${p.externalSku}`] : []),
      ...(p.externalItemId ? [`external:${p.externalSystem}\u0000${p.externalItemId}`] : []),
    ];

    // Saves the row's image and returns the value to store. `upload.path` is set to the file
    // this import wrote, if any, before anything else can fail, so a failed write can still
    // be cleaned up.
    const saveRowImage = (
      rawImage: string,
      workItem: ImportWorkItem,
      rowLabel: string,
      upload: { path: string | null }
    ) => {
      const normalizedImage = rawImage ? normalizeImageUrl(rawImage) : null;
      const image = normalizedImage ? saveBase64Image(normalizedImage) : null;
      // Only what this import actually wrote counts as its own, so a rollback cannot
      // delete a file the sheet merely referenced.
      upload.path = normalizedImage && image ? savedUploadPath(normalizedImage, image) : null;
      if (
        !upload.path &&
        image?.startsWith('/uploads/') &&
        !storeOwnsUpload.get(user.store_id, image)
      ) {
        rowError(
          workItem,
          rowLabel,
          `image "${image}" is not an upload of this store, so it was left off the item`
        );
        return null;
      }
      return image;
    };

    // Each sheet's own category is created the first time one of its rows needs it, so a
    // sheet whose rows all name a category (as the export's sheets do) adds no empty one.
    const sheetCategoryIds = new Map<ImportWorkItem['sheet'], number | null>();
    const sheetCategoryId = (sheet: ImportWorkItem['sheet']): number | null => {
      if (!sheetCategoryIds.has(sheet)) {
        const name = sheetFallbackCategory(sheet);
        sheetCategoryIds.set(sheet, name ? getCategoryId(name) : null);
      }
      return sheetCategoryIds.get(sheet) ?? null;
    };

    interface RowFields {
      brand: string;
      desc: string;
      unit: string;
      tags: string;
      catId: number | null;
      image: string | null;
      importedAt: string;
    }

    const updateRow = (existingId: number, p: PreparedRow, fields: RowFields) =>
      updateStmt.run(
        p.itemName,
        fields.brand,
        fields.desc,
        p.qty,
        fields.unit,
        p.salePrice,
        p.taxPct,
        fields.tags,
        fields.catId,
        p.status,
        fields.image,
        p.upc,
        p.number,
        p.externalSystem,
        p.externalStoreId,
        p.externalCategoryId,
        p.externalItemId,
        p.externalSku,
        fields.importedAt,
        existingId,
        user.store_id
      );

    // Quantity stays empty rather than inventing stock.
    const insertRow = (p: PreparedRow, fields: RowFields) =>
      insertStmt.run(
        p.itemName,
        fields.brand || null,
        fields.desc,
        p.qty,
        fields.unit,
        p.salePrice,
        p.taxPct,
        p.upc || null,
        p.number || null,
        fields.tags,
        fields.catId,
        p.status ?? 'Active',
        fields.image,
        p.externalSystem || null,
        p.externalStoreId || null,
        p.externalCategoryId || null,
        p.externalItemId || null,
        p.externalSku || null,
        fields.importedAt,
        'imported',
        user.store_id
      );

    const writeRow = (
      p: PreparedRow,
      workItem: ImportWorkItem,
      upload: { path: string | null }
    ) => {
      const { item } = p;
      const keys = identifierKeys(p);
      const earlier = keys.map(key => seenIdentifiers.get(key)).find(Boolean);
      if (earlier) {
        rowError(workItem, p.rowLabel, `the same item is already in this file at ${earlier}`);
        return;
      }

      const existing = resolveExistingItem(p);
      if ('error' in existing) {
        rowError(workItem, p.rowLabel, existing.error);
        return;
      }
      // A new item needs a real name; a placeholder would reach the catalog as if it were
      // one. Checked before the image is saved, so a rejected row writes nothing to disk.
      if (existing.id === null && !p.itemName) {
        rowError(workItem, p.rowLabel, 'Item name is required for a new item');
        return;
      }

      // Categories are only created for rows that are going to be written.
      const rowCategory = readText(item.category);
      const catId = rowCategory ? getCategoryId(rowCategory) : sheetCategoryId(workItem.sheet);
      const image = saveRowImage(readText(linkTarget(item.image)), workItem, p.rowLabel, upload);
      const fields: RowFields = {
        brand: readText(item.brand),
        desc: readText(item.description),
        unit: readText(item.unit),
        tags: readText(item.tag_names),
        catId,
        image,
        importedAt: toSqliteUtc(),
      };
      if (existing.id === null) {
        insertRow(p, fields);
        results.added++;
      } else {
        updateRow(existing.id, p, fields);
        results.updated++;
      }
      for (const key of keys) seenIdentifiers.set(key, rowPlace(workItem));
    };

    const processRow = (workItem: ImportWorkItem) => {
      const prepared = prepareRow(workItem);
      if (!prepared) return;

      // The file this row saved, if any — known before the write so a failed write can
      // still be cleaned up.
      const upload: { path: string | null } = { path: null };
      try {
        writeRow(prepared, workItem, upload);
        if (upload.path) savedImagePaths.push(upload.path);
      } catch (err: any) {
        // The row was not written, so nothing refers to the image it saved. The chunk still
        // commits, so the rollback cleanup would never see this file.
        if (upload.path) rejectedUploads.push(upload.path);
        // A full disk or an I/O error makes SQLite roll back the whole transaction. Every
        // later row would then commit on its own, outside the chunk, so stop the chunk here.
        if (!db.inTransaction) throw err;
        rowError(workItem, prepared.rowLabel, err.message);
      }
    };

    const commitChunk = db.transaction((chunk: ImportWorkItem[]) => {
      for (const workItem of chunk) processRow(workItem);
    });

    // Flatten every row into one list so the commit loop below can slice it into chunks
    // regardless of sheet boundaries.
    const work: ImportWorkItem[] = [];
    for (const sheet of sheetsData) {
      for (const [rowIdx, row] of sheet.rows.entries()) {
        work.push({ sheet, row, rowNum: sheet.rowNumbers?.[rowIdx] ?? rowIdx + 2 });
      }
    }

    // What the committed chunks wrote. `results` also counts the rows of a chunk that later
    // rolls back, so a failure partway through reports from this instead.
    const committed = { rows: 0, added: 0, updated: 0, skipped: 0, errors_total: 0 };

    // Commits one chunk and cleans up after it.
    const commitChunkAt = async (start: number) => {
      const chunk = work.slice(start, start + IMPORT_CHUNK_ROWS);
      const imagesBeforeChunk = savedImagePaths.length;
      try {
        commitChunk(chunk);
      } catch (chunkError) {
        // The chunk rolled back, so the images it wrote belong to no row any more.
        await removeUploadedFiles(savedImagePaths.splice(imagesBeforeChunk));
        throw chunkError;
      } finally {
        await removeUploadedFiles(rejectedUploads.splice(0));
      }
      Object.assign(committed, {
        rows: start + chunk.length,
        added: results.added,
        updated: results.updated,
        skipped: results.skipped,
        errors_total: results.errors_total,
      });
      // Hand the event loop a turn between chunks so health checks and phone scans are
      // still answered while a large import runs.
      if (start + IMPORT_CHUNK_ROWS < work.length) {
        await new Promise(resolve => setImmediate(resolve));
      }
    };

    // Answers a failed import. Chunks committed before the failure stay in the database, so
    // they are logged and reported rather than passed off as a total failure.
    const respondImportStopped = () => {
      if (committed.rows === 0) {
        res.status(500).json({ error: 'An internal error occurred' });
        return;
      }
      // Earlier chunks are already in the database, so record them and say so. Importing
      // the file again is safe: rows already saved are matched and updated, not duplicated.
      try {
        db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
          'IMPORT',
          `Import stopped after ${committed.rows} of ${work.length} rows across ${sheetsData.length} sheet(s): +${committed.added} new, ~${committed.updated} updated, ${committed.skipped} skipped, ${committed.errors_total} failed`,
          user.id,
          user.store_id
        );
      } catch (logErr) {
        // The failure that stopped the import may stop this write too; the response still goes out.
        logError('inventory:batch-confirm:log', logErr);
      }
      const savedRows = committed.rows.toLocaleString('en-US');
      const totalRows = work.length.toLocaleString('en-US');
      res.status(500).json({
        error: `The import stopped partway: ${savedRows} of ${totalRows} rows were saved (${committed.added} new, ${committed.updated} updated). Import the file again to finish — rows already saved will be updated, not duplicated.`,
        partial: true,
        rows_saved: committed.rows,
        rows_total: work.length,
        added: committed.added,
        updated: committed.updated,
        skipped: committed.skipped,
        errors_total: committed.errors_total,
      });
    };

    try {
      for (let start = 0; start < work.length; start += IMPORT_CHUNK_ROWS) {
        await commitChunkAt(start); // NOSONAR: chunks commit in order, one transaction each
      }

      // Counts only: the full skipped-row list used to be serialised into this one column.
      db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
        'IMPORT',
        `Imported ${work.length} rows across ${sheetsData.length} sheet(s): +${results.added} new, ~${results.updated} updated, ${results.skipped} skipped, ${results.errors_total} failed`,
        user.id,
        user.store_id
      );
      res.json(results);
    } catch (err: any) {
      logError('inventory:batch-confirm', err);
      respondImportStopped();
    }
  })
);
