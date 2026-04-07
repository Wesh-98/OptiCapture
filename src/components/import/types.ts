export type UploadStep = 'upload' | 'map' | 'importing' | 'done';
export type RowData = Record<string, unknown>;
export type DestinationField =
  | '__ignore__'
  | 'item_name'
  | 'quantity'
  | 'upc'
  | 'number'
  | 'sale_price'
  | 'unit'
  | 'category'
  | 'status'
  | 'tax_percent'
  | 'tag_names'
  | 'description'
  | 'image';
export type AutoDetectField = Exclude<DestinationField, '__ignore__'>;
export type ColumnMapping = Record<string, DestinationField>;

export interface SkippedRow {
  row_num: number;
  sheet: string;
  item_name: string;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  skipped_rows: SkippedRow[];
}

export interface SheetData {
  name: string;
  headers: string[];
  preview: RowData[];
  rows: RowData[];
  rowCount: number;
  mapping: ColumnMapping;
}

export interface ImportState {
  step: UploadStep;
  file: File | null;
  sheets: SheetData[];
  activeSheet: number;
  result: ImportResult | null;
  parseError: string | null;
  isParsing: boolean;
}

export const DEST_FIELDS: ReadonlyArray<{ value: DestinationField; label: string }> = [
  { value: '__ignore__', label: '- ignore -' },
  { value: 'item_name', label: 'Item Name' },
  { value: 'quantity', label: 'Stock Quantity (# units in stock)' },
  { value: 'upc', label: 'UPC / Barcode' },
  { value: 'number', label: 'SKU / Item Number' },
  { value: 'sale_price', label: 'Sale Price ($)' },
  { value: 'unit', label: 'Unit of Measure (e.g. 3oz, 1ct, 1L)' },
  { value: 'category', label: 'Category (locked in multi-sheet mode)' },
  { value: 'status', label: 'Status' },
  { value: 'tax_percent', label: 'Tax (%)' },
  { value: 'tag_names', label: 'Tags' },
  { value: 'description', label: 'Description' },
  { value: 'image', label: 'Image URL (https:// or Google Drive link)' },
];

export const IMPORT_STEPS = ['upload', 'map', 'done'] as const;
