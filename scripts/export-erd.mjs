import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const byName = (a, b) => a.localeCompare(b);

const schemaPath = fileURLToPath(new URL('../docs/database-schema.sql', import.meta.url));
const outputPath = fileURLToPath(new URL('../docs/opticapture-erd.svg', import.meta.url));
const TEAL = '#287f87';
const RELATION_RED = '#c54038';
const db = new Database(':memory:');
db.exec(readFileSync(schemaPath, 'utf8'));

const layout = [
  ['stores', 'categories', 'inventory'],
  ['users', 'user_stores', 'logs'],
  ['scan_sessions', 'session_items', 'schema_migrations'],
];
const schemaTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map(row => row.name)
  .sort(byName);
const layoutTables = layout.flat().sort(byName);
if (JSON.stringify(schemaTables) !== JSON.stringify(layoutTables)) {
  throw new Error('ERD layout must include every schema table exactly once');
}

const escape = value =>
  String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);

const wrap = (value, limit = 75) => {
  const lines = [''];
  for (const word of value.split(/\s+/)) {
    const current = lines.length - 1;
    if (lines[current] && `${lines[current]} ${word}`.length > limit) lines.push(word);
    else lines[current] += `${lines[current] ? ' ' : ''}${word}`;
  }
  return lines;
};

const indexDescription = index => {
  const columns = db
    .pragma(`index_xinfo(${index.name})`)
    .filter(column => column.key && column.cid >= 0)
    .map(column => `${column.name}${column.desc ? ' DESC' : ''}`)
    .join(', ');
  const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(index.name)?.sql;
  const predicate = sql?.match(/\bWHERE\s+([\s\S]+)$/i)?.[1]?.trim();
  const kind = index.origin === 'pk' ? 'PRIMARY KEY' : index.unique ? 'UNIQUE' : 'INDEX';
  const name = index.origin === 'c' ? ` ${index.name}` : '';
  return `${kind}${name} (${columns})${predicate ? ` WHERE ${predicate}` : ''}`;
};

const cards = new Map();
const cardWidth = 575;
const rowHeight = 39;
const headerHeight = 50;
const fieldsHeaderHeight = 28;
const columnX = [56, 680, 1304];
for (const [column, tables] of layout.entries()) {
  let y = 180;
  for (const table of tables) {
    const columns = db.pragma(`table_info(${table})`);
    const foreignKeys = db.pragma(`foreign_key_list(${table})`);
    const fkByColumn = new Map(foreignKeys.map(key => [key.from, key]));
    const indexRows = db.pragma(`index_list(${table})`).flatMap(index => wrap(indexDescription(index)));
    if (indexRows.length === 0) indexRows.push('No secondary indexes');
    const height = headerHeight + fieldsHeaderHeight + columns.length * rowHeight + 34 + indexRows.length * 20 + 18;
    cards.set(table, { table, x: columnX[column], y, width: cardWidth, height, columns, fkByColumn, indexRows });
    y += height + 104;
  }
}

const edges = [
  ['stores', 'users', 'store_id'],
  ['stores', 'user_stores', 'store_id'],
  ['stores', 'categories', 'store_id'],
  ['stores', 'inventory', 'store_id'],
  ['users', 'user_stores', 'user_id'],
  ['categories', 'inventory', 'category_id'],
  ['scan_sessions', 'session_items', 'session_id'],
];
const actualEdges = layout.flat().flatMap(child =>
  db.pragma(`foreign_key_list(${child})`).map(key => `${key.table}/${child}/${key.from}`)
).sort(byName);
const drawnEdges = edges.map(edge => edge.join('/')).sort(byName);
if (JSON.stringify(actualEdges) !== JSON.stringify(drawnEdges)) {
  throw new Error('ERD connections do not match the schema foreign keys');
}

const card = name => cards.get(name);
const midX = name => card(name).x + cardWidth / 2;
const bottom = name => card(name).y + card(name).height;
const rowY = (name, column) => {
  const item = card(name);
  const index = item.columns.findIndex(entry => entry.name === column);
  return item.y + headerHeight + fieldsHeaderHeight + index * rowHeight + rowHeight / 2;
};
const lines = [
  // FK paths are routed through the gaps between table cards.
  `M ${card('stores').x + cardWidth} ${rowY('stores', 'id')} H 656 V ${rowY('users', 'store_id')} H ${card('users').x}`,
  `M ${midX('stores')} ${card('stores').y} V 142 H 1279 V ${card('user_stores').y - 32} H ${midX('user_stores')} V ${card('user_stores').y}`,
  `M ${midX('stores')} ${bottom('stores')} V ${card('categories').y}`,
  `M ${card('stores').x} ${rowY('stores', 'id')} H 28 V ${card('inventory').y + 65} H ${card('inventory').x}`,
  `M ${midX('users')} ${bottom('users')} V ${card('user_stores').y}`,
  `M ${midX('categories')} ${bottom('categories')} V ${card('inventory').y}`,
  `M ${midX('scan_sessions')} ${bottom('scan_sessions')} V ${card('session_items').y}`,
];

const note = card('schema_migrations');
const noteY = bottom('schema_migrations') + 48;
const noteHeight = 414;
const height = Math.max(...[...cards.values()].map(item => item.y + item.height), noteY + noteHeight) + 110;
const width = 1936;
const namedIndexCount = db
  .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
  .get().count;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
  '<title id="title">OptiCapture database entity relationship diagram</title>',
  '<desc id="desc">Complete current SQLite schema with column types, nullability, defaults, keys, indexes, seven enforced relationships, and four app-level associations.</desc>',
  '<defs>',
  `  <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M 0 0 L 9 4.5 L 0 9 Z" fill="${RELATION_RED}"/></marker>`,
  '  <style><![CDATA[',
  '    text { font-family: Inter, Segoe UI, Arial, sans-serif; }',
  '    .title { font-size: 33px; font-weight: 750; fill: #212121; }',
  '    .subtitle { font-size: 14px; fill: #666666; }',
  '    .table { font-size: 20px; font-weight: 700; fill: #ffffff; }',
  '    .count { font-size: 12px; fill: #d9f4f6; }',
  '    .field { font-size: 14px; font-weight: 600; fill: #333333; }',
  '    .type { font-size: 12px; fill: #555555; }',
  '    .badge { font-size: 11px; font-weight: 700; fill: #287f87; }',
  '    .detail { font-size: 11.5px; fill: #666666; }',
  '    .section { font-size: 12px; font-weight: 700; fill: #245f64; }',
  '    .index { font-size: 11.5px; fill: #333333; }',
  '    .note { font-size: 12.5px; fill: #333333; }',
  '    .note-title { font-size: 16px; font-weight: 700; fill: #a63d37; }',
  '  ]]></style>',
  '</defs>',
  `<rect width="${width}" height="${height}" fill="#f8fbfb"/>`,
  '<text x="56" y="60" class="title">OptiCapture database ERD</text>',
  `<text x="56" y="88" class="subtitle">Current SQLite schema · ${cards.size} tables · ${namedIndexCount} named indexes · ${edges.length} enforced foreign keys</text>`,
  '<text x="1880" y="60" class="subtitle" text-anchor="end">Red arrow: 1 → many, pointing to the FK table</text>',
  '<text x="1880" y="86" class="subtitle" text-anchor="end">NULLABLE / NOT NULL reflect SQLite column declarations</text>',
  '<rect x="56" y="111" width="1824" height="1" fill="#d9e8e9"/>',
  ...lines.map(path => `<path d="${path}" fill="none" stroke="${RELATION_RED}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)"/>`),
];

for (const item of cards.values()) {
  svg.push(`<g id="table-${escape(item.table)}">`);
  svg.push(`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="12" fill="#ffffff" stroke="#b7e9ed" stroke-width="1.5"/>`);
  svg.push(`<path d="M ${item.x + 12} ${item.y} H ${item.x + item.width - 12} Q ${item.x + item.width} ${item.y} ${item.x + item.width} ${item.y + 12} V ${item.y + headerHeight} H ${item.x} V ${item.y + 12} Q ${item.x} ${item.y} ${item.x + 12} ${item.y}" fill="${TEAL}"/>`);
  svg.push(`<text x="${item.x + 18}" y="${item.y + 32}" class="table">${escape(item.table)}</text>`);
  svg.push(`<text x="${item.x + item.width - 18}" y="${item.y + 31}" text-anchor="end" class="count">${item.columns.length} columns</text>`);
  svg.push(`<rect x="${item.x + 1}" y="${item.y + headerHeight}" width="${item.width - 2}" height="${fieldsHeaderHeight}" fill="#e9f7f8"/>`);
  svg.push(`<text x="${item.x + 16}" y="${item.y + headerHeight + 19}" class="section">COLUMN</text>`);
  svg.push(`<text x="${item.x + 305}" y="${item.y + headerHeight + 19}" class="section">TYPE</text>`);
  svg.push(`<text x="${item.x + 405}" y="${item.y + headerHeight + 19}" class="section">NULL?</text>`);
  svg.push(`<text x="${item.x + item.width - 16}" y="${item.y + headerHeight + 19}" text-anchor="end" class="section">KEY</text>`);
  for (const [index, column] of item.columns.entries()) {
    const y = item.y + headerHeight + fieldsHeaderHeight + index * rowHeight;
    if (index % 2 === 1) svg.push(`<rect x="${item.x + 1}" y="${y}" width="${item.width - 2}" height="${rowHeight}" fill="#f5fbfb"/>`);
    const fk = item.fkByColumn.get(column.name);
    const badges = [column.pk ? 'PK' : '', fk ? 'FK' : ''].filter(Boolean).join(' / ');
    const defaultValue = column.dflt_value === null ? 'none' : column.dflt_value;
    const detail = `${fk ? `references ${fk.table}.${fk.to}  ·  ` : ''}default: ${defaultValue}`;
    svg.push(`<text x="${item.x + 16}" y="${y + 17}" class="field">${escape(column.name)}</text>`);
    svg.push(`<text x="${item.x + 305}" y="${y + 17}" class="type">${escape(column.type || 'ANY')}</text>`);
    const nonNull = column.notnull || (column.pk && column.type.trim().toUpperCase() === 'INTEGER');
    svg.push(`<text x="${item.x + 405}" y="${y + 17}" class="type">${nonNull ? 'NOT NULL' : 'NULLABLE'}</text>`);
    if (badges) svg.push(`<text x="${item.x + item.width - 16}" y="${y + 17}" class="badge" text-anchor="end">${badges}</text>`);
    svg.push(`<text x="${item.x + 16}" y="${y + 33}" class="detail">${escape(detail)}</text>`);
  }
  const indexY = item.y + headerHeight + fieldsHeaderHeight + item.columns.length * rowHeight;
  svg.push(`<rect x="${item.x + 1}" y="${indexY}" width="${item.width - 2}" height="31" fill="#e9f7f8"/>`);
  svg.push(`<text x="${item.x + 16}" y="${indexY + 21}" class="section">INDEXES AND UNIQUE CONSTRAINTS</text>`);
  item.indexRows.forEach((line, index) => {
    svg.push(`<text x="${item.x + 16}" y="${indexY + 51 + index * 20}" class="index">${escape(line)}</text>`);
  });
  svg.push('</g>');
}

svg.push(`<rect x="${note.x}" y="${noteY}" width="${cardWidth}" height="${noteHeight}" rx="12" fill="#fff5f4" stroke="#edc9c6"/>`);
svg.push(`<text x="${note.x + 18}" y="${noteY + 31}" class="note-title">Relationship details</text>`);
svg.push(`<text x="${note.x + 18}" y="${noteY + 53}" class="detail">Each child row points to at most one parent; a parent can have many children.</text>`);
for (const [index, [parent, child, from]] of edges.entries()) {
  const key = db.pragma(`foreign_key_list(${child})`).find(entry => entry.from === from);
  const required = card(child).columns.find(column => column.name === from).notnull ? 'required' : 'optional';
  const label = `${child}.${from} → ${parent}.${key.to}  (${required})`;
  svg.push(`<text x="${note.x + 18}" y="${noteY + 82 + index * 23}" class="note">${escape(label)}</text>`);
}
svg.push(`<text x="${note.x + 18}" y="${noteY + 264}" class="note-title">App associations without FK constraints</text>`);
for (const [index, label] of [
  'scan_sessions.user_id → users.id',
  'scan_sessions.store_id → stores.id',
  'logs.user_id → users.id',
  'logs.store_id → stores.id',
].entries()) {
  svg.push(`<text x="${note.x + 18}" y="${noteY + 291 + index * 22}" class="note">${escape(label)}</text>`);
}
svg.push(`<text x="56" y="${height - 38}" class="subtitle">PK = primary key · FK = enforced foreign key · All FK delete actions are NO ACTION · Source: docs/database-schema.sql</text>`);
svg.push('</svg>');
db.close();

const content = `${svg.join('\n')}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== content) {
    throw new Error('docs/opticapture-erd.svg is out of date; regenerate it');
  }
} else {
  writeFileSync(outputPath, content);
}
console.log(`ERD verified: ${cards.size} tables, ${edges.length} foreign keys`);
