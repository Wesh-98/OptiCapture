import { createHash } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { db } from '../db.js';
import { authenticateToken, requireOwner, requireOwnerOrTaker, asyncRoute } from '../middleware.js';
import { upcCache } from '../cache.js';
import {
  saveBase64Image,
  normalizeImageUrl,
  toIsoUtc,
  toSqliteUtc,
  firstQueryValue,
  removeUploadedFiles,
  savedUploadPath,
  upcVariants,
  UnsupportedImageTypeError,
} from '../helpers.js';
import { isReservedCategoryName } from './categories.js';
import type { AuthRequest } from '../types.js';
import { logError } from '../logger.js';

export const inventoryRouter = express.Router();

const IMPORT_DESTINATION_FIELDS = new Set([
  '__ignore__',
  'item_name',
  'quantity',
  'upc',
  'number',
  'sale_price',
  'unit',
  'category',
  'status',
  'tax_percent',
  'tag_names',
  'description',
  'image',
  'external_system',
  'external_store_id',
  'external_category_id',
  'external_item_id',
  'external_sku',
]);
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
  rowCount: number;
}

/**
 * The one way batch-upload answers with a parsed file, whatever its format, so the row
 * ceiling is checked before the user maps any columns. Rejecting only at batch-confirm
 * would let a user map a 50,001-row file and then lose that work to a 413.
 */
function sendImportPreview(res: express.Response, sheets: ImportPreviewSheet[]) {
  const totalRows = sheets.reduce((n, s) => n + s.rowCount, 0);
  if (totalRows > MAX_IMPORT_ROWS) {
    return res.status(413).json({
      error: `This file has ${totalRows.toLocaleString('en-US')} rows. Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows — split the file and import it in parts.`,
    });
  }
  return res.json({ sheets, totalRows });
}

// Multer — memory storage for file uploads (xlsx/csv import)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, fieldSize: 10 * 1024 }, // 20 MB file, 10 KB per non-file field
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    if (typeof value.hyperlink === 'string' && value.hyperlink.trim()) {
      return value.hyperlink.trim();
    }
    if (value.result !== undefined && value.result !== null) {
      return normalizeImportedCellValue(value.result);
    }
    if (Array.isArray(value.richText)) {
      const text = value.richText
        .map(entry => (isRecord(entry) && typeof entry.text === 'string' ? entry.text : ''))
        .join('')
        .trim();
      if (text) return text;
    }
    if (typeof value.text === 'string' && value.text.trim()) {
      return value.text.trim();
    }
  }
  return String(value);
}

function readImportedString(value: unknown): string {
  const normalized = normalizeImportedCellValue(value);
  return typeof normalized === 'string' ? normalized.trim() : String(normalized).trim();
}

const IMPORT_HEADER_HINTS = new Set([
  'item_name',
  'item name',
  'name',
  'product name',
  'description',
  'quantity',
  'qty',
  'stock',
  'upc',
  'barcode',
  'number',
  'sku',
  'item number',
  'sale_price',
  'sale price',
  'price',
  'unit',
  'category',
  'status',
  'tax_percent',
  'tax',
  'tag_names',
  'tags',
  'image',
  'image url',
  'external_system',
  'external system',
  'external_store_id',
  'external category id',
  'external_category_id',
  'external_item_id',
  'external item id',
  'external_sku',
  'external sku',
]);

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

  for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values = (row.values as unknown[]).slice(1);
    const labels = values.map(readImportedString);
    const nonEmptyCount = labels.filter(Boolean).length;
    if (nonEmptyCount === 0) continue;

    const recognizedCount = labels.filter(label =>
      IMPORT_HEADER_HINTS.has(label.toLocaleLowerCase())
    ).length;
    const occupiedWidth = values.length;
    const score = occupiedWidth * 10 + nonEmptyCount + recognizedCount * 3;
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
  if (!cleaned || !Number.isFinite(parsed) || parsed < 0) {
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
    return {
      value: null,
      error: `${field} must be a non-negative${options.integer ? ' integer' : ' number'}${options.max !== undefined ? ` no greater than ${options.max}` : ''}`,
    };
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
  if (values.upc !== undefined && String(values.upc).length > 128)
    return 'UPC must be 128 characters or fewer';
  if (values.unit !== undefined && String(values.unit).length > 50)
    return 'Unit must be 50 characters or fewer';
  if (values.tag_names !== undefined && String(values.tag_names).length > 1000)
    return 'Tags must be 1000 characters or fewer';
  if (values.image !== undefined && String(values.image).length > 7_000_000)
    return 'Image payload is too large';
  return null;
}

function normalizeInventoryStatus(value: unknown, fallback = 'Active'): 'Active' | 'Inactive' {
  const status = readImportedString(value) || fallback;
  if (status !== 'Active' && status !== 'Inactive') {
    throw new Error('status must be Active or Inactive');
  }
  return status;
}

function isGenericImportSheetName(name: string): boolean {
  return /^(inventory|sheet\s*\d*|worksheet\s*\d*|items?|products?|catalog|data)$/i.test(
    name.trim()
  );
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
    // Escape LIKE metacharacters so user input like "%" or "_" matches literally
    const escaped = String(q)
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped}%`;
    conditions.push(
      "(LOWER(i.item_name) LIKE ? ESCAPE '\\' OR LOWER(i.upc) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.name,'')) LIKE ? ESCAPE '\\')"
    );
    params.push(pattern, pattern, pattern);
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

// Export inventory — XLSX, CSV, JSON, PDF
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
      // Quoting alone does not stop Excel/Sheets treating a leading =, +, -, @ (or a
      // leading tab/CR) as a formula. An item named `=cmd|'/c calc'!A0` would then
      // execute when an owner opens the export. Prefix those cells with a single
      // quote so the spreadsheet renders them as literal text.
      const csvCell = (v: unknown) => {
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
      const body = lines.join('\n');
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
        .text(`Generated: ${new Date().toLocaleString()}   |   Total items: ${rows.length}`, {
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
      return;
    }

    // xlsx — one sheet per category, sheet name = category name
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

inventoryRouter.post(
  '/inventory',
  authenticateToken,
  requireOwnerOrTaker,
  (req: AuthRequest, res) => {
    const {
      item_name,
      quantity,
      category_id,
      status,
      image,
      unit,
      sale_price,
      tax_percent,
      description,
      tag_names,
      upc,
    } = req.body;
    const user = req.user;

    if (!item_name || typeof item_name !== 'string' || item_name.trim().length === 0)
      return res.status(400).json({ error: 'Item name is required' });
    if (item_name.length > 500)
      return res.status(400).json({ error: 'Item name must be 500 characters or fewer' });
    if (description !== undefined && description !== null && typeof description !== 'string')
      return res.status(400).json({ error: 'Description must be a string' });
    if (description && description.length > 2000)
      return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });
    if (quantity === null) return res.status(400).json({ error: 'quantity must be a number' });
    const quantityValue = parseInventoryNumber(quantity, 'quantity', {
      integer: true,
      max: 1_000_000,
      fallback: 0,
    });
    if (quantityValue.error) return res.status(400).json({ error: quantityValue.error });
    const salePriceValue = parseInventoryNumber(sale_price, 'sale_price', { max: 1_000_000 });
    if (salePriceValue.error) return res.status(400).json({ error: salePriceValue.error });
    const taxValue = parseInventoryNumber(tax_percent, 'tax_percent', { max: 100 });
    if (taxValue.error) return res.status(400).json({ error: taxValue.error });
    const stringError = validateInventoryStrings({ upc, unit, tag_names, image });
    if (stringError) return res.status(400).json({ error: stringError });
    if (status !== undefined && !['Active', 'Inactive'].includes(status))
      return res.status(400).json({ error: 'status must be Active or Inactive' });
    if (!isCategoryInStore(category_id, user.store_id))
      return res.status(400).json({ error: 'Invalid category' });

    const itemName = item_name.trim();
    // '' is an absent category, not category 0. Passing it straight through hit the
    // category_id foreign key and surfaced as a 500; the PUT route already normalises it.
    const categoryIdValue =
      category_id === '' || category_id === null || category_id === undefined
        ? null
        : Number(category_id);
    const cleanUpc = typeof upc === 'string' ? upc.trim() : '';
    const existing = db
      .prepare('SELECT id FROM inventory WHERE LOWER(TRIM(item_name)) = LOWER(?) AND store_id = ?')
      .get(itemName, user.store_id);
    if (existing) {
      return res.status(409).json({ error: 'Item with this name already exists' });
    }
    if (
      cleanUpc &&
      db
        .prepare('SELECT 1 FROM inventory WHERE upc = ? AND store_id = ?')
        .get(cleanUpc, user.store_id)
    ) {
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
        INSERT INTO inventory (item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names, upc, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
          )
          .run(
            itemName,
            quantityValue.value,
            categoryIdValue,
            status ?? 'Active',
            savedImage,
            unit,
            salePriceValue.value,
            taxValue.value,
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
      if (err instanceof UnsupportedImageTypeError) {
        return res.status(400).json({ error: err.message });
      }
      // A concurrent insert can still hit the unique (upc, store_id) or item-number index.
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'An item with that UPC or number already exists' });
      }
      logError('inventory:create', err);
      res.status(500).json({ error: 'An internal error occurred' });
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

export function updateInventoryItem(
  storeId: number | undefined,
  userId: number,
  itemId: unknown,
  body: Record<string, any>,
  options: ItemUpdateOptions = {}
): { status: number; body: Record<string, unknown> } {
  const {
    item_name,
    quantity,
    category_id,
    status,
    unit,
    sale_price,
    tax_percent,
    description,
    tag_names,
    image,
    upc,
  } = body;
  const bad = (error: string) => ({ status: 400, body: { error } });

  // Reject blank strings — the POST route already guards this but PUT skipped the trim check
  if (
    item_name !== undefined &&
    (typeof item_name !== 'string' || item_name.trim().length === 0 || item_name.length > 500)
  )
    return bad('Item name must be a non-empty string of 500 characters or fewer');
  if (description !== undefined && description !== null && typeof description !== 'string')
    return bad('Description must be a string');
  if (description && description.length > 2000)
    return bad('Description must be 2000 characters or fewer');
  if (quantity === null) return bad('quantity must be a number');
  const quantityValue = parseInventoryNumber(quantity, 'quantity', {
    integer: true,
    max: 1_000_000,
  });
  if (quantityValue.error) return bad(quantityValue.error);
  const salePriceValue = parseInventoryNumber(sale_price, 'sale_price', { max: 1_000_000 });
  if (salePriceValue.error) return bad(salePriceValue.error);
  const taxValue = parseInventoryNumber(tax_percent, 'tax_percent', { max: 100 });
  if (taxValue.error) return bad(taxValue.error);
  const stringError = validateInventoryStrings({ upc, unit, tag_names, image });
  if (stringError) return bad(stringError);
  if (status !== undefined && !['Active', 'Inactive'].includes(status))
    return bad('status must be Active or Inactive');
  if (!isCategoryInStore(category_id, storeId)) return bad('Invalid category');

  const existingItem = db
    .prepare('SELECT item_name, upc FROM inventory WHERE id = ? AND store_id = ?')
    .get(itemId, storeId) as { item_name: string; upc: string | null } | undefined;
  if (!existingItem) return { status: 404, body: { error: 'Item not found' } };

  // A new image is written to disk before the update runs. If the update then fails, no row
  // points at that file, so it is removed rather than left behind.
  let createdUpload: string | null = null;
  const discardUpload = () => {
    if (createdUpload) void removeUploadedFiles([createdUpload]);
  };

  try {
    const assignments = ['updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (item_name !== undefined) assign('item_name', item_name.trim());
    if (quantity !== undefined) assign('quantity', quantityValue.value);
    if (category_id !== undefined)
      assign(
        'category_id',
        category_id === '' || category_id === null ? null : Number(category_id)
      );
    if (status !== undefined) assign('status', status);
    if (unit !== undefined) assign('unit', unit === '' || unit === null ? null : String(unit));
    if (sale_price !== undefined) assign('sale_price', salePriceValue.value);
    if (tax_percent !== undefined) assign('tax_percent', taxValue.value);
    if (description !== undefined) assign('description', description || null);
    if (tag_names !== undefined) assign('tag_names', tag_names || null);
    if (image !== undefined) {
      const normalizedImage = image ? normalizeImageUrl(String(image)) : null;
      const savedImage = normalizedImage ? saveBase64Image(normalizedImage) : null;
      createdUpload =
        normalizedImage && savedImage ? savedUploadPath(normalizedImage, savedImage) : null;
      assign('image', savedImage);
    }
    if (upc !== undefined) assign('upc', upc === null ? null : String(upc).trim() || null);
    // 0 changes means either the id doesn't exist or it belongs to a different
    // store. Return 404 either way — this prevents cross-tenant writes from
    // silently succeeding with a 200 while actually touching nothing.
    const changes = db.transaction(() => {
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
           SET ${assignments.join(', ')}
           WHERE id = ? AND store_id = ?`
        )
        .run(...values, itemId, storeId);
      if (r.changes > 0) {
        let details = `Updated item "${item_name?.trim() || existingItem.item_name}"`;
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
      }
      return r.changes;
    })();

    if (changes === 0) {
      discardUpload();
      return { status: 404, body: { error: 'Item not found' } };
    }

    // Invalidate UPC cache so mobile scanners see the updated product name immediately
    if (existingItem.upc) upcCache.delete(existingItem.upc);
    if (upc) upcCache.delete(String(upc));

    return { status: 200, body: { success: true } };
  } catch (err: any) {
    discardUpload();
    if (err instanceof ItemUpdateConflict) {
      return {
        status: 409,
        body: { error: 'This item was changed since you opened it. Reload it and try again.' },
      };
    }
    if (err instanceof ItemUpdateNoChange) return bad('Nothing to change');
    if (err instanceof UnsupportedImageTypeError) return bad(err.message);
    if (err.message?.includes('UNIQUE')) {
      return { status: 409, body: { error: 'An item with that UPC or name already exists' } };
    }
    logError('inventory:update', err, 'Failed to update inventory item', { itemId });
    return { status: 500, body: { error: 'An internal error occurred' } };
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
      .prepare('SELECT item_name, description FROM inventory WHERE id = ? AND store_id = ?')
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

    res.json({ success: true });
  }
);

// Batch Upload — parse ALL sheets, return headers + preview + full rows per sheet
inventoryRouter.post(
  '/inventory/batch-upload',
  authenticateToken,
  requireOwner,
  upload.single('file'),
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // After receiving the uploaded file, check MIME type
    const allowedUploadTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'text/csv',
      'application/csv',
      'application/json',
    ];
    if (!allowedUploadTypes.includes(req.file.mimetype)) {
      return res
        .status(400)
        .json({ error: 'Invalid file type. Only XLSX, CSV, and JSON files are allowed.' });
    }

    const isJson =
      req.file.originalname?.toLowerCase().endsWith('.json') ||
      req.file.mimetype === 'application/json';

    try {
      if (isJson) {
        const parsed = JSON.parse(req.file.buffer.toString('utf8'));
        // Support both raw array and our export format { items: [...] }
        const rows: Record<string, any>[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
        if (!Array.isArray(rows) || rows.some(row => !isRecord(row))) {
          return res.status(400).json({ error: 'JSON items must be an array of objects' });
        }
        if (rows.length === 0) return res.status(400).json({ error: 'JSON file has no items' });
        const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
        return sendImportPreview(res, [
          {
            name: 'Inventory',
            headers,
            headerRowNumber: 1,
            sourceColumnCount: headers.length,
            preview: rows.slice(0, 5),
            rows,
            rowCount: rows.length,
          },
        ]);
      }

      const isCsv =
        req.file.mimetype === 'text/csv' ||
        req.file.mimetype === 'application/csv' ||
        req.file.originalname?.toLowerCase().endsWith('.csv');

      if (isCsv) {
        const { data, errors } = Papa.parse<Record<string, any>>(req.file.buffer.toString('utf8'), {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
        });
        if (errors.length && data.length === 0)
          return res.status(400).json({ error: 'Could not parse CSV file.' });
        const rows = data as Record<string, any>[];
        const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
        return sendImportPreview(res, [
          {
            name: 'Sheet1',
            headers,
            headerRowNumber: 1,
            sourceColumnCount: headers.length,
            preview: rows.slice(0, 5),
            rows,
            rowCount: rows.length,
          },
        ]);
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheets = workbook.worksheets
        .map(ws => {
          const detectedHeader = detectWorksheetHeader(ws);
          const headerRow = detectedHeader.columns.map(column => column.header);
          const rows: Record<string, any>[] = [];
          ws.eachRow((row, rowNumber) => {
            if (rowNumber <= detectedHeader.rowNumber) return;
            const obj: Record<string, any> = {};
            detectedHeader.columns.forEach(column => {
              obj[column.header] = normalizeImportedCellValue(
                row.getCell(column.columnNumber).value
              );
            });
            if (Object.values(obj).some(value => readImportedString(value))) rows.push(obj);
          });
          return {
            name: ws.name,
            headers: headerRow,
            headerRowNumber: detectedHeader.rowNumber,
            sourceColumnCount: detectedHeader.sourceColumnCount,
            preview: rows.slice(0, 5),
            rows,
            rowCount: rows.length,
          };
        })
        .filter(s => s.rowCount > 0);

      if (sheets.length === 0)
        return res.status(400).json({ error: 'File is empty or has no data rows' });

      sendImportPreview(res, sheets);
    } catch (err: any) {
      logError('import:upload', err);
      res
        .status(400)
        .json({ error: 'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.' });
    }
  })
);

// Batch Confirm — full sync with per-sheet column mapping
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
        mapping: Record<string, string>;
      }[];
    };
    if (
      !Array.isArray(sheetsData) ||
      sheetsData.length === 0 ||
      sheetsData.some(
        sheet =>
          !isRecord(sheet) ||
          typeof sheet.sheetName !== 'string' ||
          (sheet.categoryName !== undefined &&
            sheet.categoryName !== null &&
            (typeof sheet.categoryName !== 'string' || sheet.categoryName.length > 120)) ||
          !Array.isArray(sheet.rows) ||
          !isRecord(sheet.mapping) ||
          Object.values(sheet.mapping).some(
            destination =>
              typeof destination !== 'string' || !IMPORT_DESTINATION_FIELDS.has(destination)
          ) ||
          sheet.rows.some(row => !isRecord(row))
      )
    ) {
      return res.status(400).json({ error: 'Invalid sheets data' });
    }

    for (const sheet of sheetsData) {
      const destinations = Object.values(sheet.mapping).filter(
        destination => destination !== '__ignore__'
      );
      const duplicateDestination = destinations.find(
        (destination, index) => destinations.indexOf(destination) !== index
      );
      if (duplicateDestination) {
        return res.status(400).json({
          error: `Sheet "${sheet.sheetName}" maps more than one column to ${duplicateDestination}.`,
        });
      }
      if (!destinations.some(destination => IMPORT_IDENTIFIER_FIELDS.has(destination))) {
        return res.status(400).json({
          error: `Sheet "${sheet.sheetName}" must map UPC, SKU / Item Number, External Item ID, or External SKU.`,
        });
      }
      if (destinations.includes('external_item_id') && !destinations.includes('external_system')) {
        return res.status(400).json({
          error: `Sheet "${sheet.sheetName}" maps External Item ID but not External System. Map the column that names the source platform, or unmap External Item ID.`,
        });
      }
    }

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
      const trimmed = String(name || '').trim();
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

    const checkUpc = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?');
    // A barcode with or without its leading zero is the same item. The scan commit path has
    // always matched both; this one matched the literal string only, so importing a POS file
    // created a second row for every item a scan had already added under the other variant.
    const findByUpc = (value: string): { id: number } | null => {
      for (const variant of upcVariants(value)) {
        const row = checkUpc.get(variant, user.store_id) as { id: number } | undefined;
        if (row) return row;
      }
      return null;
    };
    const checkNum = db.prepare('SELECT id FROM inventory WHERE number = ? AND store_id = ?');
    const checkExternalSku = db.prepare(
      'SELECT id FROM inventory WHERE external_sku = ? AND store_id = ?'
    );

    const insertStmt = db.prepare(`
    INSERT INTO inventory (
      item_name, description, quantity, unit, sale_price, tax_percent, upc, number,
      tag_names, category_id, status, image, external_system, external_store_id,
      external_category_id, external_item_id, external_sku, last_imported_at,
      sync_status, store_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const updateStmt = db.prepare(`
    UPDATE inventory
    SET item_name   = COALESCE(NULLIF(?, ''), item_name),
        description = COALESCE(NULLIF(?, ''), description),
        quantity    = COALESCE(?, quantity),
        unit        = COALESCE(NULLIF(?, ''), unit),
        sale_price  = COALESCE(NULLIF(?, ''), sale_price),
        tax_percent = COALESCE(NULLIF(?, ''), tax_percent),
        tag_names   = COALESCE(NULLIF(?, ''), tag_names),
        category_id = COALESCE(?, category_id),
        status      = COALESCE(NULLIF(?, ''), status),
        image       = COALESCE(NULLIF(?, ''), image),
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
      rowIdx: number;
      sheetCatId: number | null;
    }

    const processRow = ({ sheet, row, rowIdx, sheetCatId }: ImportWorkItem) => {
      const item: Record<string, any> = {};
      for (const [src, dest] of Object.entries(sheet.mapping)) {
        if (dest && dest !== '__ignore__') item[dest] = row[src];
      }

      const upc = readImportedString(item.upc);
      const number = readImportedString(item.number);
      const externalSystem = readImportedString(item.external_system);
      const externalStoreId = readImportedString(item.external_store_id);
      const externalCategoryId = readImportedString(item.external_category_id);
      const externalItemId = readImportedString(item.external_item_id);
      const externalSku = readImportedString(item.external_sku);
      const itemName = readImportedString(item.item_name);
      if (!externalItemId && !upc && !number && !externalSku) {
        const rawName =
          itemName ||
          Object.values(row)
            .map(v => String(v).trim())
            .find(v => v !== '') ||
          '(blank)';
        addSkippedRow({
          row_num: rowIdx + 2,
          sheet: sheet.sheetName,
          item_name: rawName,
        });
        return;
      }

      // An external item ID is only an identity together with its source system;
      // without one it could merge with another platform's item of the same ID.
      if (externalItemId && !externalSystem) {
        addError(
          `"${itemName || upc || number || externalItemId}": External System is required when External Item ID is set`
        );
        return;
      }

      const rowLabel = itemName || upc || number || externalItemId || externalSku;
      const qtyResult = parseImportNumber(item.quantity, 'Quantity', { integer: true });
      const priceResult = parseImportNumber(item.sale_price, 'Sale price');
      const taxResult = parseImportNumber(item.tax_percent, 'Tax percent', { max: 100 });
      const numberError = qtyResult.error ?? priceResult.error ?? taxResult.error;
      if (numberError) {
        addError(`"${rowLabel}": ${numberError}`);
        return;
      }

      // The file this row saved, if any — known before the write so a failed write can
      // still be cleaned up.
      let createdUpload: string | null = null;
      try {
        const qty = qtyResult.value;
        const salePrice = priceResult.value;
        const taxPct = taxResult.value;
        const statusText = readImportedString(item.status);
        const status = statusText ? normalizeInventoryStatus(statusText) : null;
        const desc = readImportedString(item.description);
        const unit = readImportedString(item.unit);
        const tags = readImportedString(item.tag_names);
        const rowCategory = readImportedString(item.category);
        const catId = rowCategory ? getCategoryId(rowCategory) : sheetCatId;

        const existing: any =
          (externalItemId
            ? checkExternalItem.get(externalItemId, user.store_id, externalSystem)
            : null) ??
          (upc ? findByUpc(upc) : null) ??
          (number ? checkNum.get(number, user.store_id) : null) ??
          (externalSku ? checkExternalSku.get(externalSku, user.store_id) : null);

        // A new item needs a real name; a placeholder would reach the catalog as if it were
        // one. Checked before the image is saved, so a rejected row writes nothing to disk.
        if (!existing && !itemName) {
          addError(`"${rowLabel}": Item name is required for a new item`);
          return;
        }

        const rawImage = readImportedString(item.image);
        const normalizedImage = rawImage ? normalizeImageUrl(rawImage) : null;
        let image = normalizedImage ? saveBase64Image(normalizedImage) : null;
        // Only what this import actually wrote counts as its own, so a rollback cannot
        // delete a file the sheet merely referenced.
        createdUpload = normalizedImage && image ? savedUploadPath(normalizedImage, image) : null;
        if (
          !createdUpload &&
          image?.startsWith('/uploads/') &&
          !storeOwnsUpload.get(user.store_id, image)
        ) {
          addError(
            `"${rowLabel}": image "${image}" is not an upload of this store, so it was left off the item`
          );
          image = null;
        }
        const importedAt = toSqliteUtc();

        if (existing) {
          updateStmt.run(
            itemName,
            desc,
            qty,
            unit,
            salePrice,
            taxPct,
            tags,
            catId,
            status,
            image,
            externalSystem,
            externalStoreId,
            externalCategoryId,
            externalItemId,
            externalSku,
            importedAt,
            existing.id,
            user.store_id
          );
          results.updated++;
        } else {
          // Quantity stays empty rather than inventing stock.
          insertStmt.run(
            itemName,
            desc,
            qty,
            unit,
            salePrice,
            taxPct,
            upc || null,
            number || null,
            tags,
            catId,
            status ?? 'Active',
            image,
            externalSystem || null,
            externalStoreId || null,
            externalCategoryId || null,
            externalItemId || null,
            externalSku || null,
            importedAt,
            'imported',
            user.store_id
          );
          results.added++;
        }
        if (createdUpload) savedImagePaths.push(createdUpload);
      } catch (err: any) {
        // The row was not written, so nothing refers to the image it saved. The chunk still
        // commits, so the rollback cleanup would never see this file.
        if (createdUpload) rejectedUploads.push(createdUpload);
        // A full disk or an I/O error makes SQLite roll back the whole transaction. Every
        // later row would then commit on its own, outside the chunk, so stop the chunk here.
        if (!db.inTransaction) throw err;
        addError(`"${itemName || upc || number}": ${err.message}`);
      }
    };

    const commitChunk = db.transaction((chunk: ImportWorkItem[]) => {
      for (const workItem of chunk) processRow(workItem);
    });

    // Resolve each sheet's fallback category once, then flatten every row into one list so
    // the commit loop below can slice it into chunks regardless of sheet boundaries.
    const work: ImportWorkItem[] = [];
    for (const sheet of sheetsData) {
      const fallbackCategoryName = Object.hasOwn(sheet, 'categoryName')
        ? readImportedString(sheet.categoryName)
        : !isGenericImportSheetName(sheet.sheetName)
          ? sheet.sheetName
          : '';
      const sheetCatId = fallbackCategoryName ? getCategoryId(fallbackCategoryName) : null;
      for (const [rowIdx, row] of sheet.rows.entries()) {
        work.push({ sheet, row, rowIdx, sheetCatId });
      }
    }

    // What the committed chunks wrote. `results` also counts the rows of a chunk that later
    // rolls back, so a failure partway through reports from this instead.
    const committed = { rows: 0, added: 0, updated: 0, skipped: 0, errors_total: 0 };

    try {
      for (let start = 0; start < work.length; start += IMPORT_CHUNK_ROWS) {
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
    }
  })
);
