import type {
  AutoDetectField,
  ColumnMapping,
  DestinationField,
  ImportResult,
  RowData,
  SheetData,
  SkippedRow,
} from './types';

const SYNONYMS: Record<AutoDetectField, readonly string[]> = {
  item_name: ['item description', 'product name', 'name', 'title', 'item name', 'description'],
  quantity: ['quantity', 'qty', 'stock', 'on hand', 'count', 'units on hand'],
  upc: ['upc', 'barcode', 'ean', 'gtin', 'upc code'],
  number: ['number', 'sku', 'item number', 'part number', 'product id', 'item #'],
  sale_price: ['sale price', 'price', 'retail price', 'msrp', 'unit price', 'sell price'],
  unit: ['unit', 'uom', 'unit of measure'],
  category: ['category', 'department', 'section', 'type', 'category name'],
  status: ['status', 'active', 'availability'],
  tax_percent: ['tax', 'tax %', 'tax rate', 'vat', 'tax percent'],
  tag_names: ['tags', 'tag names', 'labels'],
  description: ['notes', 'memo', 'detail', 'long description', 'product description'],
  image: ['image', 'image url', 'photo', 'picture', 'img'],
};

function autoDetect(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedDest = new Set<AutoDetectField>();

  for (const header of headers) {
    const lower = header.toLowerCase().trim();
    let matched: DestinationField = '__ignore__';

    for (const [dest, synonyms] of Object.entries(SYNONYMS) as Array<
      [AutoDetectField, readonly string[]]
    >) {
      if (!usedDest.has(dest) && synonyms.some(s => lower === s || lower.includes(s))) {
        matched = dest;
        usedDest.add(dest);
        break;
      }
    }

    mapping[header] = matched;
  }

  return mapping;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) return payload.error;
  }

  const text = await res.text().catch(() => '');
  return text.trim() || fallback;
}

function normalizeHeaders(headers: unknown): string[] {
  if (!Array.isArray(headers)) return [];

  return headers
    .filter(
      (header): header is string | number =>
        typeof header === 'string' || typeof header === 'number'
    )
    .map(header => String(header).trim())
    .filter(Boolean);
}

function normalizeRecords(records: unknown): RowData[] {
  if (!Array.isArray(records)) return [];

  return records.filter(isRecord);
}

function normalizeRowCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

function normalizeSheetData(sheet: unknown, index: number): SheetData {
  if (!isRecord(sheet)) {
    throw new Error('Invalid response from server while parsing file.');
  }

  const headers = normalizeHeaders(sheet.headers);
  const preview = normalizeRecords(sheet.preview);
  const rows = normalizeRecords(sheet.rows);

  return {
    name:
      typeof sheet.name === 'string' && sheet.name.trim()
        ? sheet.name.trim()
        : `Sheet ${index + 1}`,
    headers,
    preview,
    rows,
    rowCount: normalizeRowCount(sheet.rowCount, rows.length),
    mapping: autoDetect(headers),
  };
}

function parseUploadResponse(data: unknown): SheetData[] {
  if (!isRecord(data) || !Array.isArray(data.sheets)) {
    throw new Error('Invalid response from server while parsing file.');
  }

  const sheets = data.sheets.map((sheet, index) => normalizeSheetData(sheet, index));
  if (sheets.length === 0) {
    throw new Error('No data sheets found in file. Please check the file and try again.');
  }

  return sheets;
}

function readRequiredCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  throw new Error('Invalid response from server during import.');
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizeSkippedRows(value: unknown): SkippedRow[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(row => {
    if (!isRecord(row)) return [];

    return [
      {
        row_num: normalizeRowCount(row.row_num, 0),
        sheet:
          typeof row.sheet === 'string' && row.sheet.trim() ? row.sheet.trim() : 'Unknown sheet',
        item_name:
          typeof row.item_name === 'string' && row.item_name.trim()
            ? row.item_name.trim()
            : 'Unknown item',
      },
    ];
  });
}

function parseImportResult(data: unknown): ImportResult {
  if (!isRecord(data)) {
    throw new Error('Invalid response from server during import.');
  }

  return {
    added: readRequiredCount(data.added),
    updated: readRequiredCount(data.updated),
    skipped: readRequiredCount(data.skipped),
    errors: normalizeStringList(data.errors),
    skipped_rows: normalizeSkippedRows(data.skipped_rows),
  };
}

export async function uploadFile(file: File): Promise<SheetData[]> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch('/api/inventory/batch-upload', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to parse file'));
  }

  const data = await res.json().catch(() => null);
  return parseUploadResponse(data);
}

export async function confirmImport(sheets: readonly SheetData[]): Promise<ImportResult> {
  const sheetsData = sheets.map(sheet => ({
    sheetName: sheet.name,
    rows: sheet.rows,
    mapping: sheet.mapping,
  }));

  const res = await fetch('/api/inventory/batch-confirm', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetsData }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Import failed'));
  }

  const data = await res.json().catch(() => null);
  return parseImportResult(data);
}
