import { isGenericSheetName } from '../../shared/importHeaders';
import { DEST_FIELDS, IDENTIFIER_DESTINATIONS } from './types';
import type { ColumnMapping, DestinationField, RowData, SheetData } from './types';

export interface MappedColumn {
  source: string;
  destination: Exclude<DestinationField, '__ignore__'>;
  label: string;
}

export interface MappingIssue {
  category: string;
  sheetName: string;
  message: string;
}

const destinationLabels = new Map(DEST_FIELDS.map(field => [field.value, field.label]));

function normalizeHeader(header: string): string {
  return header.trim().toLocaleLowerCase();
}

export function suggestCategoryName(sheetName: string): string | null {
  const trimmed = sheetName.trim();
  return !trimmed || isGenericSheetName(trimmed) ? null : trimmed;
}

/** A parsed cell as display text. Cells arrive as JSON primitives or link cells; anything else is shown as JSON. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // A spreadsheet link cell: shown as the text the sheet shows.
  if (typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }
  return JSON.stringify(value) ?? '';
}

function hasValue(value: unknown): boolean {
  return cellText(value).trim().length > 0;
}

export function isIdentifierDestination(
  destination: DestinationField
): destination is (typeof IDENTIFIER_DESTINATIONS)[number] {
  return IDENTIFIER_DESTINATIONS.includes(destination);
}

export function getDestinationLabel(destination: DestinationField): string {
  return destinationLabels.get(destination) ?? destination;
}

export function getMappedColumns(sheet: SheetData): MappedColumn[] {
  return sheet.headers.flatMap(source => {
    const destination = sheet.mapping[source] ?? '__ignore__';
    if (destination === '__ignore__') return [];

    return [
      {
        source,
        destination,
        label: getDestinationLabel(destination),
      },
    ];
  });
}

export function getDuplicateDestinations(sheet: SheetData): DestinationField[] {
  const seen = new Set<DestinationField>();
  const duplicates = new Set<DestinationField>();

  for (const { destination } of getMappedColumns(sheet)) {
    if (seen.has(destination)) duplicates.add(destination);
    seen.add(destination);
  }

  return [...duplicates];
}

export function getRowsWithoutIdentifiers(sheet: SheetData): number {
  const identifierHeaders = getMappedColumns(sheet)
    .filter(column => isIdentifierDestination(column.destination))
    .map(column => column.source);

  if (identifierHeaders.length === 0) return sheet.rows.length;
  return sheet.rows.filter(row => identifierHeaders.every(header => !hasValue(row[header]))).length;
}

export function getImportMappingIssues(sheets: readonly SheetData[]): MappingIssue[] {
  return sheets.flatMap(sheet => {
    const mappedColumns = getMappedColumns(sheet);
    const issues: MappingIssue[] = [];
    const duplicates = getDuplicateDestinations(sheet);

    if (sheet.sourceColumnCount > sheet.headers.length) {
      issues.push({
        category: 'Missing column headers',
        sheetName: sheet.name,
        message: `the worksheet uses ${sheet.sourceColumnCount} columns, but only ${sheet.headers.length} named header${sheet.headers.length === 1 ? ' was' : 's were'} detected.`,
      });
    }

    if (!mappedColumns.some(column => isIdentifierDestination(column.destination))) {
      issues.push({
        category: 'Missing identifier',
        sheetName: sheet.name,
        message: 'map UPC / Barcode, SKU / Item Number, External Item ID, or External SKU.',
      });
    }

    if (duplicates.length > 0) {
      issues.push({
        category: 'Duplicate field mapping',
        sheetName: sheet.name,
        message: `each Inventory Portal field can only be mapped once (${duplicates
          .map(getDestinationLabel)
          .join(', ')} is duplicated).`,
      });
    }

    return issues;
  });
}

/**
 * Things worth a second look that do not stop the import. A sheet with no Item Name column
 * is valid — a UPC + price sheet updates existing items — but every new item on it is
 * refused for want of a name, which an owner who missed an unrecognised name column would
 * only find out from the result.
 */
export function getImportMappingWarnings(sheets: readonly SheetData[]): MappingIssue[] {
  return sheets.flatMap(sheet =>
    getMappedColumns(sheet).some(column => column.destination === 'item_name')
      ? []
      : [
          {
            category: 'No item name column',
            sheetName: sheet.name,
            message:
              'items already in your catalog will update, but new items will be skipped. Map the column that holds product names to Item Name to add them.',
          },
        ]
  );
}

export function setMappingDestination(
  sheet: SheetData,
  sourceHeader: string,
  destination: DestinationField
): ColumnMapping {
  const mapping: ColumnMapping = {};

  for (const header of sheet.headers) {
    const current = sheet.mapping[header] ?? '__ignore__';
    mapping[header] =
      destination !== '__ignore__' && header !== sourceHeader && current === destination
        ? '__ignore__'
        : current;
  }

  mapping[sourceHeader] = destination;
  return mapping;
}

export function applyMappingToMatchingHeaders(
  sheets: readonly SheetData[],
  sourceSheetIndex: number
): SheetData[] {
  const sourceSheet = sheets[sourceSheetIndex];
  if (!sourceSheet) return [...sheets];

  const sourceMappingByHeader = new Map(
    sourceSheet.headers.map(header => [
      normalizeHeader(header),
      sourceSheet.mapping[header] ?? '__ignore__',
    ])
  );

  return sheets.map((sheet, index) => {
    if (index === sourceSheetIndex) return sheet;

    const mapping: ColumnMapping = {};
    const usedDestinations = new Set<DestinationField>();
    const matchedHeaders = new Set<string>();

    // Exact, case-insensitive header matches get the source sheet's choice first.
    for (const header of sheet.headers) {
      const sourceDestination = sourceMappingByHeader.get(normalizeHeader(header));
      if (sourceDestination === undefined) continue;

      matchedHeaders.add(header);
      mapping[header] = claimDestination(sourceDestination, usedDestinations);
    }

    // Different headers retain their own auto-detected or manually selected mappings.
    for (const header of sheet.headers) {
      if (matchedHeaders.has(header)) continue;
      const current = sheet.mapping[header] ?? '__ignore__';
      mapping[header] = claimDestination(current, usedDestinations);
    }

    return { ...sheet, mapping };
  });
}

/** Keeps `wanted` unless another column on the sheet already took that destination. */
function claimDestination(wanted: DestinationField, used: Set<DestinationField>): DestinationField {
  if (wanted === '__ignore__' || used.has(wanted)) return '__ignore__';
  used.add(wanted);
  return wanted;
}

export function projectMappedRow(row: RowData, columns: readonly MappedColumn[]): RowData {
  return Object.fromEntries(columns.map(column => [column.destination, row[column.source]]));
}
