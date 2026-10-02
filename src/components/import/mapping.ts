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
  if (
    !trimmed ||
    /^(inventory|sheet\s*\d*|worksheet\s*\d*|items?|products?|catalog|data)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim().length > 0;
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
      mapping[header] =
        sourceDestination !== '__ignore__' && usedDestinations.has(sourceDestination)
          ? '__ignore__'
          : sourceDestination;
      if (mapping[header] !== '__ignore__') usedDestinations.add(mapping[header]);
    }

    // Different headers retain their own auto-detected or manually selected mappings.
    for (const header of sheet.headers) {
      if (matchedHeaders.has(header)) continue;
      const current = sheet.mapping[header] ?? '__ignore__';
      mapping[header] =
        current !== '__ignore__' && usedDestinations.has(current) ? '__ignore__' : current;
      if (mapping[header] !== '__ignore__') usedDestinations.add(mapping[header]);
    }

    return { ...sheet, mapping };
  });
}

export function projectMappedRow(row: RowData, columns: readonly MappedColumn[]): RowData {
  return Object.fromEntries(columns.map(column => [column.destination, row[column.source]]));
}
