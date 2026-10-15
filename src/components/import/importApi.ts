import type {
  AutoDetectField,
  ColumnMapping,
  DestinationField,
  ImportResult,
  ParsedImportFile,
  RowData,
  SheetData,
  SkippedRow,
} from './types';
import { suggestCategoryName } from './mapping';
import {
  EXACT_ONLY_SYNONYMS,
  EXPORT_HEADERS,
  HEADER_SYNONYMS,
  NON_FIELD_HEADER_WORDS,
  headerContainsSynonym,
  normalizeHeaderLabel,
} from '../../shared/importHeaders';

type SynonymEntry = { field: AutoDetectField; synonym: string };

// Longest first, so "retail price" is tried before "price".
const SYNONYM_ENTRIES: readonly SynonymEntry[] = (
  Object.entries(HEADER_SYNONYMS) as Array<[AutoDetectField, readonly string[]]>
)
  .flatMap(([field, synonyms]) => synonyms.map(synonym => ({ field, synonym })))
  .sort((a, b) => b.synonym.length - a.synonym.length);

/** The field a header names outright: the export's own column name, or an exact synonym. */
function exactField(label: string, used: ReadonlySet<AutoDetectField>): AutoDetectField | null {
  if (Object.hasOwn(EXPORT_HEADERS, label)) {
    const field = EXPORT_HEADERS[label];
    if (field && !used.has(field)) return field;
  }
  return SYNONYM_ENTRIES.find(entry => entry.synonym === label && !used.has(entry.field))?.field ?? null;
}

/** The field whose synonym appears as whole words in the header, unless the header is about something we do not import. */
function partialField(label: string, used: ReadonlySet<AutoDetectField>): AutoDetectField | null {
  if (NON_FIELD_HEADER_WORDS.some(word => headerContainsSynonym(label, word))) return null;
  return (
    SYNONYM_ENTRIES.find(
      ({ field, synonym }) =>
        !used.has(field) &&
        !EXACT_ONLY_SYNONYMS.has(synonym) &&
        headerContainsSynonym(label, synonym)
    )?.field ?? null
  );
}

/**
 * Suggests a field for each header. Exact names are settled across every header first, so a
 * vague header earlier in the file ("Item Type") cannot take a field a later one names
 * outright ("Category"); only then are the rest matched word by word.
 */
export function autoDetect(headers: readonly string[]): ColumnMapping {
  const chosen = new Map<string, DestinationField>();
  const used = new Set<AutoDetectField>();
  const claim = (header: string, field: AutoDetectField | null) => {
    chosen.set(header, field ?? '__ignore__');
    if (field) used.add(field);
  };

  for (const header of headers) {
    const label = normalizeHeaderLabel(header);
    // Columns the export writes for information only stay unmapped.
    if (Object.hasOwn(EXPORT_HEADERS, label) && EXPORT_HEADERS[label] === null) {
      claim(header, null);
      continue;
    }
    const field = exactField(label, used);
    if (field) claim(header, field);
  }
  for (const header of headers) {
    if (!chosen.has(header)) claim(header, partialField(normalizeHeaderLabel(header), used));
  }

  // Many POS exports call the item's name "Description". With no other name column, that is
  // what it is, and without a name no new item can be imported.
  if (!used.has('item_name')) {
    const descriptionHeader = headers.find(header => chosen.get(header) === 'description');
    if (descriptionHeader) chosen.set(descriptionHeader, 'item_name');
  }

  return Object.fromEntries(headers.map(header => [header, chosen.get(header) ?? '__ignore__']));
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

/** The server's row numbers for a sheet, or null when absent or not one per row. */
function normalizeRowNumbers(value: unknown, rowCount: number): number[] | null {
  if (!Array.isArray(value) || value.length !== rowCount) return null;
  return value.every(n => Number.isInteger(n) && n >= 1) ? (value as number[]) : null;
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
  const name =
    typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : `Sheet ${index + 1}`;

  return {
    name,
    categoryName: suggestCategoryName(name),
    headers,
    headerRowNumber:
      typeof sheet.headerRowNumber === 'number' &&
      Number.isInteger(sheet.headerRowNumber) &&
      sheet.headerRowNumber >= 1
        ? sheet.headerRowNumber
        : null,
    sourceColumnCount: normalizeRowCount(sheet.sourceColumnCount, headers.length),
    preview,
    rows,
    rowNumbers: normalizeRowNumbers(sheet.rowNumbers, rows.length),
    rowCount: normalizeRowCount(sheet.rowCount, rows.length),
    mapping: autoDetect(headers),
  };
}

function parseUploadResponse(data: unknown): ParsedImportFile {
  if (!isRecord(data) || !Array.isArray(data.sheets)) {
    throw new Error('Invalid response from server while parsing file.');
  }

  const sheets = data.sheets.map((sheet, index) => normalizeSheetData(sheet, index));
  if (sheets.length === 0) {
    throw new Error('No data sheets found in file. Please check the file and try again.');
  }

  return { sheets, hiddenSheets: normalizeStringList(data.hiddenSheets) };
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
    // The server caps the message list; fall back to its length when the total is absent.
    errors_total:
      typeof data.errors_total === 'number' &&
      Number.isFinite(data.errors_total) &&
      data.errors_total >= 0
        ? Math.trunc(data.errors_total)
        : normalizeStringList(data.errors).length,
    skipped_rows: normalizeSkippedRows(data.skipped_rows),
  };
}

export async function uploadFile(file: File): Promise<ParsedImportFile> {
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
    categoryName: sheet.categoryName,
    rows: sheet.rows,
    ...(sheet.rowNumbers ? { rowNumbers: sheet.rowNumbers } : {}),
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
