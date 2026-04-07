import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import PDFDocument from 'pdfkit';
import { db } from '../db.js';
import { authenticateToken, requireOwner } from '../middleware.js';
import { upcCache } from '../cache.js';
import { saveBase64Image, normalizeImageUrl, UnsupportedImageTypeError } from '../helpers.js';

export const inventoryRouter = express.Router();

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

inventoryRouter.get('/inventory', authenticateToken, (req: any, res) => {
  const { category_id, q } = req.query;
  const storeId = req.user.store_id;
  let query =
    'SELECT i.*, c.name as category_name FROM inventory i LEFT JOIN categories c ON i.category_id = c.id WHERE i.store_id = ?';
  const params: any[] = [storeId];

  if (category_id) {
    query += ' AND i.category_id = ?';
    params.push(category_id);
  }

  if (q) {
    const pattern = `%${String(q).toLowerCase()}%`;
    query +=
      " AND (LOWER(i.item_name) LIKE ? OR LOWER(i.upc) LIKE ? OR LOWER(COALESCE(c.name,'')) LIKE ?)";
    params.push(pattern, pattern, pattern);
  }

  query += ' ORDER BY i.updated_at DESC';

  const items = db.prepare(query).all(...params);
  res.json(items);
});

// Export inventory — XLSX, CSV, JSON, PDF
inventoryRouter.get('/inventory/export', authenticateToken, requireOwner, async (req: any, res) => {
  const fmt = ['xlsx', 'csv', 'json', 'pdf'].includes(req.query.format as string)
    ? (req.query.format as string)
    : 'xlsx';

  const rows = db
    .prepare(
      `
    SELECT i.item_name, i.description, i.quantity, i.unit, i.sale_price,
           i.tax_percent, i.upc, i.number, i.tag_names, i.status,
           c.name AS category, i.created_at
    FROM inventory i
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.store_id = ?
    ORDER BY c.name, i.item_name
  `
    )
    .all(req.user.store_id) as any[];

  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
    'EXPORT',
    `Exported ${rows.length} items as ${fmt.toUpperCase()}`,
    req.user.id,
    req.user.store_id
  );

  const filename = `inventory-${Date.now()}`;

  // Group rows by category — shared across xlsx and pdf
  const grouped: Record<string, any[]> = {};
  for (const r of rows) {
    const cat = r.category || 'Uncategorized';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  }

  if (fmt === 'csv') {
    const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const CSV_COLS = [
      'item_name',
      'description',
      'quantity',
      'unit',
      'sale_price',
      'tax_percent',
      'upc',
      'number',
      'tag_names',
      'status',
      'created_at',
    ];
    const lines: string[] = [CSV_COLS.map(csvCell).join(',')];
    for (const [cat, items] of Object.entries(grouped)) {
      lines.push(`"### ${cat}"`);
      for (const r of items) lines.push(CSV_COLS.map(c => csvCell(r[c])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(lines.join('\n'));
  }

  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.send(
      JSON.stringify(
        { exported_at: new Date().toISOString(), total: rows.length, items: rows },
        null,
        2
      )
    );
  }

  if (fmt === 'pdf') {
    //const PDFDocument = require('pdfkit');
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
    for (const [cat, items] of Object.entries(grouped)) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#0a192f').text(cat);
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
  const XLSX_COLS = [
    'item_name',
    'description',
    'quantity',
    'unit',
    'sale_price',
    'tax_percent',
    'upc',
    'number',
    'tag_names',
    'status',
    'created_at',
  ];
  const wb = new ExcelJS.Workbook();
  for (const [cat, items] of Object.entries(grouped)) {
    // Excel sheet names: max 31 chars, strip invalid characters [ ] : * ? / \
    const sheetName = cat.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Sheet';
    const ws = wb.addWorksheet(sheetName);
    ws.addRow(XLSX_COLS);
    for (const r of items) ws.addRow(XLSX_COLS.map(c => r[c] ?? ''));
  }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(Buffer.from(buf));
});

inventoryRouter.post('/inventory', authenticateToken, requireOwner, (req: any, res) => {
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
  if (description && String(description).length > 2000)
    return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });

  const existing = db
    .prepare('SELECT id FROM inventory WHERE item_name = ? AND store_id = ?')
    .get(item_name, user.store_id);
  if (existing) {
    return res.status(409).json({ error: 'Item with this name already exists' });
  }

  try {
    const savedImage = image ? saveBase64Image(image) : null;
    const info = db
      .prepare(
        `
      INSERT INTO inventory (item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names, upc, store_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        item_name,
        quantity,
        category_id,
        status,
        savedImage,
        unit,
        sale_price,
        tax_percent,
        description,
        tag_names,
        upc || null,
        user.store_id
      );

    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
      'CREATE',
      `Added item "${item_name}"`,
      user.id,
      user.store_id
    );

    res.json({ id: info.lastInsertRowid });
  } catch (err: any) {
    if (err instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[inventory:create]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

inventoryRouter.put('/inventory/:id', authenticateToken, requireOwner, (req: any, res) => {
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
  } = req.body;
  const { id } = req.params;
  const user = req.user;

  if (item_name !== undefined && (typeof item_name !== 'string' || item_name.length > 500))
    return res.status(400).json({ error: 'Item name must be 500 characters or fewer' });
  if (description !== undefined && String(description).length > 2000)
    return res.status(400).json({ error: 'Description must be 2000 characters or fewer' });

  try {
    const savedImage = image ? saveBase64Image(image) : null;
    db.prepare(
      `
      UPDATE inventory
      SET item_name = ?, quantity = ?, category_id = ?, status = ?, unit = ?, sale_price = ?, tax_percent = ?,
          description = ?, tag_names = ?, image = COALESCE(?, image),
          upc = COALESCE(NULLIF(?, ''), upc), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `
    ).run(
      item_name,
      quantity,
      category_id,
      status,
      unit,
      sale_price,
      tax_percent,
      description,
      tag_names,
      savedImage,
      upc || null,
      id,
      user.store_id
    );

    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
      'UPDATE',
      `Updated item "${item_name}"`,
      user.id,
      user.store_id
    );

    // Invalidate UPC cache so mobile scanners see the updated product name immediately
    const effectiveUpc =
      upc ||
      (
        db
          .prepare('SELECT upc FROM inventory WHERE id = ? AND store_id = ?')
          .get(id, user.store_id) as any
      )?.upc;
    if (effectiveUpc) upcCache.delete(String(effectiveUpc));

    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[inventory:update]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

inventoryRouter.delete('/inventory/:id', authenticateToken, requireOwner, (req: any, res) => {
  const { id } = req.params;
  const user = req.user;

  const deletedItem = db
    .prepare('SELECT item_name, description FROM inventory WHERE id = ? AND store_id = ?')
    .get(id, user.store_id) as any;
  db.prepare('DELETE FROM inventory WHERE id = ? AND store_id = ?').run(id, user.store_id);
  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
    'DELETE',
    `Deleted item "${deletedItem?.item_name ?? id}"`,
    user.id,
    user.store_id
  );

  res.json({ success: true });
});

// Batch Import
inventoryRouter.post('/inventory/batch', authenticateToken, requireOwner, (req: any, res) => {
  const { items } = req.body;
  const user = req.user;
  const results = { added: 0, updated: 0, errors: [] as string[] };

  const defaultCat = db
    .prepare('SELECT id FROM categories WHERE store_id = ? LIMIT 1')
    .get(user.store_id) as any;
  const defaultCatId = defaultCat ? defaultCat.id : 1;

  const insertStmt = db.prepare(`
    INSERT INTO inventory (item_name, quantity, upc, number, tag_names, category_id, description, store_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(
    'UPDATE inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE upc = ? AND store_id = ?'
  );
  const checkStmt = db.prepare('SELECT * FROM inventory WHERE upc = ? AND store_id = ?');

  const transaction = db.transaction((batchItems: any[]) => {
    for (const item of batchItems) {
      try {
        if (!item.upc) continue;
        const existing = checkStmt.get(item.upc, user.store_id);
        if (existing) {
          updateStmt.run(item.quantity, item.upc, user.store_id);
          results.updated++;
        } else {
          insertStmt.run(
            item.description || 'Unknown Item',
            item.quantity,
            item.upc,
            item.number || '',
            item.tag_names || '',
            defaultCatId,
            item.description || '',
            user.store_id
          );
          results.added++;
        }
      } catch (err: any) {
        results.errors.push(`Failed to process UPC ${item.upc}: ${err.message}`);
      }
    }
  });

  try {
    transaction(items);
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
      'BATCH',
      `Processed ${items.length} items`,
      user.id,
      user.store_id
    );
    res.json(results);
  } catch (err: any) {
    console.error('[inventory:batch]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Batch Upload — parse ALL sheets, return headers + preview + full rows per sheet
inventoryRouter.post(
  '/inventory/batch-upload',
  authenticateToken,
  requireOwner,
  upload.single('file'),
  async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // After receiving the uploaded file, check MIME type
    const allowedUploadTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/vnd.ms-excel', // xls
      'text/csv',
      'application/csv',
      'application/json',
    ];
    if (!allowedUploadTypes.includes(req.file.mimetype)) {
      return res
        .status(400)
        .json({ error: 'Invalid file type. Only Excel, CSV, and JSON files are allowed.' });
    }

    const isJson =
      req.file.originalname?.toLowerCase().endsWith('.json') ||
      req.file.mimetype === 'application/json';

    try {
      if (isJson) {
        const parsed = JSON.parse(req.file.buffer.toString('utf8'));
        // Support both raw array and our export format { items: [...] }
        const rows: Record<string, any>[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
        if (rows.length === 0) return res.status(400).json({ error: 'JSON file has no items' });
        const sheets = [
          {
            name: 'Inventory',
            headers: Object.keys(rows[0]),
            preview: rows.slice(0, 5),
            rows,
            rowCount: rows.length,
          },
        ];
        return res.json({ sheets, totalRows: rows.length });
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
        const sheets = [
          {
            name: 'Sheet1',
            headers: rows.length > 0 ? Object.keys(rows[0]) : [],
            preview: rows.slice(0, 5),
            rows,
            rowCount: rows.length,
          },
        ];
        return res.json({ sheets, totalRows: rows.length });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheets = (
        await Promise.all(
          workbook.worksheets.map(async ws => {
            const headerRow = (ws.getRow(1).values as any[]).slice(1).map(readImportedString); // exceljs rows are 1-indexed; slice off leading undefined
            const rows: Record<string, any>[] = [];
            ws.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;
              const vals = (row.values as any[]).slice(1);
              const obj: Record<string, any> = {};
              headerRow.forEach((header, i: number) => {
                obj[header] = normalizeImportedCellValue(vals[i]);
              });
              rows.push(obj);
            });
            return {
              name: ws.name,
              headers: headerRow,
              preview: rows.slice(0, 5),
              rows,
              rowCount: rows.length,
            };
          })
        )
      ).filter(s => s.rowCount > 0);

      if (sheets.length === 0)
        return res.status(400).json({ error: 'File is empty or has no data rows' });

      res.json({ sheets, totalRows: sheets.reduce((n, s) => n + s.rowCount, 0) });
    } catch (err: any) {
      console.error('[import:upload]', err);
      res
        .status(400)
        .json({ error: 'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.' });
    }
  }
);

// Batch Confirm — full sync with per-sheet column mapping
// Accepts JSON body: { sheetsData: [{ sheetName, rows, mapping }] }
// M-3: Only this route needs large payloads (full sheet rows)
inventoryRouter.post(
  '/inventory/batch-confirm',
  authenticateToken,
  requireOwner,
  (req: any, res) => {
    const { sheetsData } = req.body as {
      sheetsData: {
        sheetName: string;
        rows: Record<string, any>[];
        mapping: Record<string, string>;
      }[];
    };
    if (!sheetsData?.length) return res.status(400).json({ error: 'No sheets data provided' });

    const user = req.user;
    const results = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      skipped_rows: [] as { row_num: number; sheet: string; item_name: string }[],
    };

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

    const getCategoryId = (name: string): number | null => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return null;
      const existing = db
        .prepare('SELECT id FROM categories WHERE name = ? AND store_id = ?')
        .get(trimmed, user.store_id) as any;
      if (existing) return existing.id;
      const icon = categoryIconMap[trimmed.toLowerCase()] ?? 'Package';
      const info = db
        .prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)')
        .run(trimmed, icon, user.store_id);
      return info.lastInsertRowid as number;
    };

    const checkUpc = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?');
    const checkNum = db.prepare('SELECT id FROM inventory WHERE number = ? AND store_id = ?');

    const insertStmt = db.prepare(`
    INSERT INTO inventory (item_name, description, quantity, unit, sale_price, tax_percent, upc, number, tag_names, category_id, status, image, store_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const updateStmt = db.prepare(`
    UPDATE inventory
    SET item_name   = COALESCE(NULLIF(?, ''), item_name),
        quantity    = ?,
        unit        = COALESCE(NULLIF(?, ''), unit),
        sale_price  = COALESCE(NULLIF(?, ''), sale_price),
        tax_percent = COALESCE(NULLIF(?, ''), tax_percent),
        tag_names   = COALESCE(NULLIF(?, ''), tag_names),
        category_id = COALESCE(?, category_id),
        status      = COALESCE(NULLIF(?, ''), status),
        image       = COALESCE(NULLIF(?, ''), image),
        updated_at  = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `);

    const transaction = db.transaction(() => {
      for (const sheet of sheetsData) {
        // Sheet name is the category for all rows on this sheet
        const catId = getCategoryId(sheet.sheetName);

        for (const [rowIdx, row] of sheet.rows.entries()) {
          const item: Record<string, any> = {};
          for (const [src, dest] of Object.entries(sheet.mapping)) {
            if (dest && dest !== '__ignore__') item[dest] = row[src];
          }

          const upc = readImportedString(item.upc);
          const number = readImportedString(item.number);
          if (!upc && !number) {
            results.skipped++;
            const rawName =
              String(item.item_name || '').trim() ||
              Object.values(row)
                .map(v => String(v).trim())
                .find(v => v !== '') ||
              '(blank)';
            results.skipped_rows.push({
              row_num: rowIdx + 2,
              sheet: sheet.sheetName,
              item_name: rawName,
            });
            continue;
          }

          // Default quantity = 50 when blank or unmapped
          const quantityValue = normalizeImportedCellValue(item.quantity);
          const qty =
            quantityValue !== ''
              ? Number.parseFloat(String(quantityValue)) || 50
              : 50;

          const salePrice = Number.parseFloat(readImportedString(item.sale_price)) || null;
          const taxPct = Number.parseFloat(readImportedString(item.tax_percent)) || null;
          const status = readImportedString(item.status) || 'Active';
          const itemName = readImportedString(item.item_name);
          const desc = readImportedString(item.description);
          const unit = readImportedString(item.unit);
          const tags = readImportedString(item.tag_names);
          const rawImage = readImportedString(item.image);
          const image = rawImage ? normalizeImageUrl(rawImage) : null;

          const existing: any =
            (upc ? checkUpc.get(upc, user.store_id) : null) ??
            (number ? checkNum.get(number, user.store_id) : null);

          try {
            if (existing) {
              updateStmt.run(
                itemName,
                qty,
                unit,
                salePrice,
                taxPct,
                tags,
                catId,
                status,
                image,
                existing.id,
                user.store_id
              );
              results.updated++;
            } else {
              insertStmt.run(
                itemName || 'Unknown',
                desc,
                qty,
                unit,
                salePrice,
                taxPct,
                upc || null,
                number || null,
                tags,
                catId,
                status,
                image,
                user.store_id
              );
              results.added++;
            }
          } catch (err: any) {
            results.errors.push(`"${itemName || upc || number}": ${err.message}`);
          }
        }
      }
    });

    try {
      transaction();
      const totalRows = sheetsData.reduce((n, s) => n + s.rows.length, 0);
      const skippedSummary =
        results.skipped_rows.length > 0 ? ` | skipped:${JSON.stringify(results.skipped_rows)}` : '';
      db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
        'IMPORT',
        `Imported ${totalRows} rows across ${sheetsData.length} sheet(s): +${results.added} new, ~${results.updated} updated, ${results.skipped} skipped${skippedSummary}`,
        user.id,
        user.store_id
      );
      res.json(results);
    } catch (err: any) {
      console.error('[inventory:batch-confirm]', err);
      res.status(500).json({ error: 'An internal error occurred' });
    }
  }
);
