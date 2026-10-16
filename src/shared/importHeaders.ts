/**
 * The import's column vocabulary, shared by the server (which finds the header row of a
 * worksheet) and the mapping screen (which suggests a field for each header). Keeping one
 * list means a header the screen recognises is also one the server treats as a header.
 */

/** Every inventory field an import column can be mapped to. */
export const IMPORT_FIELDS = [
  'item_name',
  'brand',
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
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header spellings for each field, lower case. */
export const HEADER_SYNONYMS: Record<ImportField, readonly string[]> = {
  item_name: ['item description', 'product name', 'name', 'title', 'item name', 'item', 'product'],
  brand: ['brand', 'brand name', 'manufacturer', 'make'],
  quantity: ['quantity', 'qty', 'stock', 'on hand', 'count', 'units on hand'],
  upc: ['upc', 'barcode', 'ean', 'gtin', 'upc code'],
  number: ['number', 'sku', 'item number', 'part number', 'product id', 'item #', 'plu'],
  sale_price: ['sale price', 'price', 'retail price', 'retail', 'msrp', 'unit price', 'sell price'],
  unit: ['unit', 'uom', 'unit of measure', 'size'],
  category: ['category', 'department', 'section', 'category name'],
  status: ['status', 'active', 'availability'],
  tax_percent: ['tax', 'tax %', 'tax rate', 'vat', 'tax percent'],
  tag_names: ['tags', 'tag names', 'labels'],
  description: [
    'description',
    'notes',
    'memo',
    'detail',
    'long description',
    'product description',
  ],
  image: ['image', 'image url', 'photo', 'picture', 'img'],
  external_system: ['external system', 'source system', 'platform', 'system'],
  external_store_id: ['external store id', 'store id', 'location id', 'external location id'],
  external_category_id: ['external category id', 'department id', 'category id'],
  external_item_id: [
    'external item id',
    'external product id',
    'platform item id',
    'platform product id',
    'inventory item id',
  ],
  external_sku: ['external sku', 'platform sku', 'source sku'],
};

/**
 * Synonyms that only count as the whole header, never as words inside a longer one: "item"
 * would otherwise claim "Item Type", "product" would claim "Product Type", and "active" would
 * claim "Inactive Date".
 */
export const EXACT_ONLY_SYNONYMS: ReadonlySet<string> = new Set([
  'item',
  'product',
  'make',
  'size',
  'active',
]);

/**
 * Words that mean a header is about something we do not import, so it is never matched by a
 * synonym it happens to contain: "Cost Price" is not a sale price, "Discount" is not a count,
 * "Vendor Name" is not the item's name.
 */
export const NON_FIELD_HEADER_WORDS: readonly string[] = [
  'cost',
  'discount',
  'exempt',
  'vendor',
  'supplier',
  'account',
  'margin',
  'markup',
];

/**
 * The column names OptiCapture's own export writes. They map exactly, before any synonym,
 * so a round trip cannot mistake `external_category_id` for `category`. Null means the
 * column is exported for information only and is not imported.
 */
export const EXPORT_HEADERS: Readonly<Record<string, ImportField | null>> = {
  item_name: 'item_name',
  brand: 'brand',
  description: 'description',
  quantity: 'quantity',
  upc: 'upc',
  number: 'number',
  sku: 'number',
  sale_price: 'sale_price',
  unit: 'unit',
  category: 'category',
  status: 'status',
  tax_percent: 'tax_percent',
  tag_names: 'tag_names',
  image: 'image',
  external_system: 'external_system',
  external_store_id: 'external_store_id',
  external_category_id: 'external_category_id',
  external_item_id: 'external_item_id',
  external_sku: 'external_sku',
  sync_status: null,
  last_imported_at: null,
  last_exported_at: null,
  created_at: null,
};

/** A header compared the way every lookup here compares it: trimmed, lower case, single-spaced. */
export function normalizeHeaderLabel(header: string): string {
  return header.trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
}

/**
 * True when every word of `synonym` appears, in order and side by side, among the header's
 * words. Whole words only, so "count" is not found in "Discount" or "Country". Punctuation
 * separates words, so "Price ($)" and "external_item_id" are read word by word.
 */
export function headerContainsSynonym(label: string, synonym: string): boolean {
  const toWords = (text: string) => text.split(/[^\p{L}\p{N}%#]+/u).filter(Boolean);
  const words = toWords(label);
  const wanted = toWords(synonym);
  if (wanted.length === 0) return false;
  for (let start = 0; start + wanted.length <= words.length; start++) {
    if (wanted.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

const ALL_SYNONYMS: readonly string[] = Object.values(HEADER_SYNONYMS).flat();

/**
 * True when the header names an import field by the rules the mapping screen suggests
 * fields by: the export's own names and exact synonyms, or a synonym's whole words inside a
 * longer header ("Product Name Details") unless the header is about something not imported.
 * The server finds a worksheet's header row with this, so a header the screen would map is
 * never outscored by a data row that merely contains one header-like word.
 */
export function isKnownHeader(header: string): boolean {
  const label = normalizeHeaderLabel(header);
  if (!label) return false;
  if (Object.hasOwn(EXPORT_HEADERS, label)) return true;
  if (ALL_SYNONYMS.includes(label)) return true;
  if (NON_FIELD_HEADER_WORDS.some(word => headerContainsSynonym(label, word))) return false;
  return ALL_SYNONYMS.some(
    synonym => !EXACT_ONLY_SYNONYMS.has(synonym) && headerContainsSynonym(label, synonym)
  );
}

/**
 * Sheet names that say nothing about what is on the sheet, so they are never offered as the
 * sheet's category. "Uncategorized" is the sheet OptiCapture's own export writes for items
 * without a category; re-importing it must leave them without one.
 */
export function isGenericSheetName(name: string): boolean {
  return /^(inventory|sheet\s*\d*|worksheet\s*\d*|items?|products?|catalog|data|uncategori[sz]ed)$/i.test(
    name.trim()
  );
}
