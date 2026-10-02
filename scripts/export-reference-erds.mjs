import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../docs/', import.meta.url);
const TEAL = '#287f87';
const TEAL_DARK = '#245f64';
const RELATION_RED = '#c54038';
const currentSql = readFileSync(fileURLToPath(new URL('database-schema.sql', root)), 'utf8');
const proposedSql = readFileSync(fileURLToPath(new URL('integration-schema-proposal.sql', root)), 'utf8');
const current = new Database(':memory:');
const integrated = new Database(':memory:');
current.exec(currentSql);
integrated.exec(currentSql + '\n' + proposedSql);

const currentNames = tableNames(current);
const integratedNames = tableNames(integrated);
const plannedNames = integratedNames.filter(name => !currentNames.includes(name));
if (currentNames.length !== 9 || plannedNames.length !== 16) {
  throw new Error(`Expected 9 current and 16 planned tables, found ${currentNames.length} and ${plannedNames.length}`);
}
if (current.pragma('foreign_key_check').length || integrated.pragma('foreign_key_check').length) {
  throw new Error('Schema has foreign key violations');
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name);
}

function fks(db) {
  return tableNames(db).flatMap(child => {
    const byId = new Map();
    for (const row of db.pragma(`foreign_key_list(${child})`)) {
      if (!byId.has(row.id)) byId.set(row.id, []);
      byId.get(row.id).push(row);
    }
    return [...byId.values()].map(rows => {
      rows.sort((a, b) => a.seq - b.seq);
      const columns = db.pragma(`table_info(${child})`);
      return {
        child,
        parent: rows[0].table,
        from: rows.map(row => row.from).join(', '),
        to: rows.map(row => row.to).join(', '),
        required: rows.every(row => columns.find(col => col.name === row.from)?.notnull),
        onDelete: rows[0].on_delete,
      };
    });
  });
}

const currentFks = fks(current);
const integratedFks = fks(integrated);
if (currentFks.length !== 7 || integratedFks.length !== 56) {
  throw new Error(`Unexpected FK counts: ${currentFks.length} current, ${integratedFks.length} integrated`);
}

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);
const text = (x, y, value, className = 'body', extra = '') =>
  `<text x="${x}" y="${y}" class="${className}" ${extra}>${esc(value)}</text>`;
const rect = (x, y, width, height, fill, stroke = 'none', radius = 0, extra = '') =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
const wrap = (value, limit = 74) => {
  const lines = [''];
  for (const word of value.split(/\s+/)) {
    const last = lines.length - 1;
    if (lines[last] && `${lines[last]} ${word}`.length > limit) lines.push(word);
    else lines[last] += `${lines[last] ? ' ' : ''}${word}`;
  }
  return lines;
};
function indexLines(db, table) {
  const lines = db.pragma(`index_list(${table})`).flatMap(index => {
    const columns = db.pragma(`index_xinfo(${index.name})`)
      .filter(column => column.key && column.cid >= 0)
      .map(column => `${column.name}${column.desc ? ' DESC' : ''}`).join(', ');
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(index.name)?.sql;
    const predicate = sql?.match(/\bWHERE\s+([\s\S]+)$/i)?.[1]?.trim();
    const kind = index.origin === 'pk' ? 'PRIMARY KEY' : index.unique ? 'UNIQUE' : 'INDEX';
    const name = index.origin === 'c' ? ` ${index.name}` : '';
    return wrap(`${kind}${name} (${columns})${predicate ? ` WHERE ${predicate}` : ''}`);
  });
  return lines.length ? lines : ['No secondary indexes'];
}
const svgStart = (width, height, title, description) => [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
  `<title id="title">${esc(title)}</title>`,
  `<desc id="desc">${esc(description)}</desc>`,
  `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${RELATION_RED}"/></marker></defs>`,
  '<style><![CDATA[',
  'text { font-family: Segoe UI, Arial, sans-serif; }',
  '.title { font-size: 32px; font-weight: 700; fill: #212121; }',
  '.sub { font-size: 14px; fill: #5f6b6c; }',
  '.domain { font-size: 20px; font-weight: 700; fill: #245f64; }',
  '.name { font-size: 19px; font-weight: 700; fill: #ffffff; }',
  '.name-small { font-size: 14px; font-weight: 700; fill: #333333; }',
  '.body { font-size: 13px; fill: #333333; }',
  '.small { font-size: 11.5px; fill: #5d6667; }',
  '.tiny { font-size: 10.5px; fill: #5d6667; }',
  '.section { font-size: 12px; font-weight: 700; fill: #245f64; }',
  '.key { font-size: 11px; font-weight: 700; fill: #287f87; }',
  '.note-red { font-size: 20px; font-weight: 700; fill: #a63d37; }',
  '.white-small { font-size: 12px; fill: #e8f7f8; }',
  ']]></style>',
  rect(0, 0, width, height, '#f8fbfb'),
];

function write(name, content) {
  const path = fileURLToPath(new URL(name, root));
  const data = content.join('\n') + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== data) throw new Error(`${name} is out of date`);
  } else writeFileSync(path, data);
}

function currentQuick() {
  const width = 1684, height = 1191;
  const out = svgStart(width, height, 'OptiCapture current schema quick ERD', 'One-page quick reference for the nine current tables and seven enforced foreign keys.');
  out.push(text(58, 62, 'OptiCapture · current database', 'title'));
  out.push(text(58, 91, 'Quick ERD · 9 existing tables · 7 enforced foreign keys · one-page landscape', 'sub'));
  out.push(text(1622, 65, 'RED ARROWS = enforced database FKs', 'sub', 'text-anchor="end"'));
  out.push(rect(58, 112, 1568, 1, '#d9e8e9'));
  const data = [
    { name: 'stores', x: 58, y: 177, desc: 'Tenant / owning inventory entity', fields: ['id PK', 'store_code UNIQUE', 'name, status'] },
    { name: 'users', x: 612, y: 177, desc: 'Local / OAuth account', fields: ['id PK', 'store_id FK → stores', 'username + store_id UNIQUE'] },
    { name: 'user_stores', x: 1166, y: 177, desc: 'Per-store access and role', fields: ['user_id PK/FK → users', 'store_id PK/FK → stores', 'role'] },
    { name: 'categories', x: 58, y: 447, desc: 'Store catalog grouping', fields: ['id PK', 'store_id FK → stores', 'name + store_id UNIQUE'] },
    { name: 'inventory', x: 612, y: 447, desc: 'Local catalog and quantity', fields: ['id PK', 'store_id FK → stores', 'category_id FK → categories', 'external_item_id mapping'] },
    { name: 'logs', x: 1166, y: 447, desc: '90-day audit log', fields: ['id PK', 'store_id, user_id (no FK)', 'timestamp'] },
    { name: 'scan_sessions', x: 58, y: 717, desc: 'Desktop/mobile scan lifecycle', fields: ['session_id PK', 'store_id, user_id (no FK)', 'otp, status, expires_at'] },
    { name: 'session_items', x: 612, y: 717, desc: 'Mutable staged scans', fields: ['id PK', 'session_id FK → scan_sessions', 'upc, quantity, device_id'] },
    { name: 'schema_migrations', x: 1166, y: 717, desc: 'Applied schema versions', fields: ['version PK', 'applied_at'] },
  ];
  const byName = new Map(data.map(item => [item.name, item]));
  for (const item of data) {
    out.push(`<g id="table-${item.name}">`);
    out.push(rect(item.x, item.y, 460, 198, '#ffffff', '#b7e9ed', 12));
    out.push(rect(item.x, item.y, 460, 43, TEAL, 'none', 10));
    out.push(text(item.x + 16, item.y + 28, item.name, 'name'));
    out.push(text(item.x + 16, item.y + 65, item.desc, 'small'));
    item.fields.forEach((field, index) => out.push(text(item.x + 18, item.y + 91 + index * 23, field, 'body')));
    out.push('</g>');
  }
  const line = path => out.push(`<path d="${path}" fill="none" stroke="${RELATION_RED}" stroke-width="2.5" marker-end="url(#arrow)"/>`);
  const s = byName.get('stores'), u = byName.get('users'), us = byName.get('user_stores');
  line(`M ${s.x + 460} 250 H ${u.x}`);
  line(`M ${u.x + 460} 250 H ${us.x}`);
  line(`M ${s.x + 230} ${s.y} V 146 H ${us.x + 230} V ${us.y}`);
  line(`M ${s.x + 230} ${s.y + 198} V ${byName.get('categories').y}`);
  line(`M ${s.x + 460} 350 H 585 V 440 H ${byName.get('inventory').x + 230} V 447`);
  line(`M ${byName.get('categories').x + 460} 543 H ${byName.get('inventory').x}`);
  line(`M ${byName.get('scan_sessions').x + 460} 813 H ${byName.get('session_items').x}`);
  out.push(rect(58, 975, 1568, 140, '#fff5f4', '#edc9c6', 10));
  out.push(text(78, 1003, 'Important rules', 'note-red'));
  out.push(text(78, 1031, 'Only solid connectors are SQLite foreign keys. logs and scan_sessions contain store/user IDs without FK constraints.', 'body'));
  out.push(text(78, 1057, 'Inventory is store-scoped; category/store consistency and active-store access are enforced in application routes.', 'body'));
  out.push(text(78, 1083, 'This is the current schema. Count-result snapshots, SSO handoff history, export history, and reconciliation are planned separately.', 'body'));
  out.push('</svg>');
  return out;
}

function integrationQuick() {
  const width = 1684, height = 1191;
  const out = svgStart(width, height, 'OptiCapture proposed integration quick ERD', `One-page table-level ERD with all ${integratedNames.length} current and proposed tables, every foreign-key parent, and highlighted foreign-key arrows.`);
  out.push(text(48, 55, 'OptiCapture - integration target', 'title'));
  out.push(text(48, 82, `Quick ERD - ${currentNames.length} current + ${plannedNames.length} proposed tables - ${integratedFks.length} foreign keys`, 'sub'));
  out.push(text(1636, 82, 'RED ARROWS = SQL FOREIGN KEYS', 'sub', 'text-anchor="end"'));
  out.push(rect(48, 103, 1588, 1, '#d9e8e9'));
  const columns = [
    { title: 'Roots & operations', tables: ['stores','users','integration_sources','logs','schema_migrations'] },
    { title: 'Access & SSO', tables: ['user_stores','store_external_mappings','external_user_identities','sso_store_grants','sso_launch_receipts'] },
    { title: 'Catalog', tables: ['categories','inventory','catalog_imports','catalog_import_rows'] },
    { title: 'Capture', tables: ['scan_sessions','session_devices','scan_events','session_items'] },
    { title: 'Count snapshot', tables: ['count_commits','count_commit_lines','count_line_contributors'] },
    { title: 'Export & review', tables: ['count_exports','reconciliation_runs','reconciliation_lines','count_export_lines'] },
  ];
  const seen = columns.flatMap(column => column.tables).sort();
  if (JSON.stringify(seen) !== JSON.stringify(integratedNames)) throw new Error('Quick integration ERD is missing tables');
  const parentsByTable = new Map(integratedNames.map(name => [name,
    [...new Set(integratedFks.filter(key => key.child === name).map(key => key.parent))]]));
  const cardWidth = 245, cardHeight = 122, cardTop = 175, rowStep = 145;
  const xs = columns.map((_, index) => 48 + index * 268);
  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    const x = xs[columnIndex];
    out.push(text(x, 144, column.title, 'domain'));
    out.push(rect(x, 153, cardWidth, 2, '#b7e9ed'));
    column.tables.forEach((name, rowIndex) => {
      const y = cardTop + rowIndex * rowStep;
      positions.set(name, { x, y });
      const planned = plannedNames.includes(name);
      out.push('<g id="table-' + name + '">');
      out.push(rect(x, y, cardWidth, cardHeight, '#ffffff', '#9ad9de', 9, planned ? 'stroke-dasharray="6 4"' : ''));
      out.push(rect(x, y, cardWidth, 35, planned ? TEAL_DARK : TEAL, 'none', 8));
      out.push(text(x + 10, y + 23, name, 'white-small'));
      out.push(text(x + cardWidth - 9, y + 47, planned ? 'PROPOSED' : 'CURRENT', 'tiny', 'text-anchor="end"'));
      const parents = parentsByTable.get(name);
      out.push(text(x + 10, y + 47, parents.length ? 'FK parents:' : 'No SQL FK parent', 'key'));
      if (parents.length) {
        const lines = wrap(parents.join(', '), 35);
        if (lines.length > 4) throw new Error('Quick card needs more room for ' + name);
        lines.forEach((line, index) => out.push(text(x + 10, y + 66 + index * 16, line, 'small')));
      }
      out.push('</g>');
    });
  });
  // These are real parent -> child FKs. Every other FK parent is named on its child card.
  const highlighted = [
    ['stores','users'], ['stores','user_stores'], ['users','user_stores'],
    ['integration_sources','store_external_mappings'], ['integration_sources','external_user_identities'],
    ['external_user_identities','sso_store_grants'], ['sso_store_grants','sso_launch_receipts'],
    ['store_external_mappings','catalog_imports'], ['categories','inventory'],
    ['catalog_imports','catalog_import_rows'], ['scan_sessions','session_devices'],
    ['session_devices','scan_events'], ['scan_sessions','count_commits'],
    ['count_commits','count_commit_lines'], ['count_commit_lines','count_line_contributors'],
    ['count_commits','count_exports'], ['count_exports','reconciliation_runs'],
    ['reconciliation_runs','reconciliation_lines'], ['count_commit_lines','count_export_lines'],
  ];
  for (const [parent, child] of highlighted) {
    if (!integratedFks.some(key => key.parent === parent && key.child === child)) {
      throw new Error('Quick ERD connector is not a SQL FK: ' + parent + ' -> ' + child);
    }
    const a = positions.get(parent), b = positions.get(child);
    let d;
    if (a.x < b.x) {
      const turn = a.x + cardWidth + (b.x - a.x - cardWidth) / 2;
      if (b.x - a.x !== xs[1] - xs[0]) throw new Error('Quick ERD connector skips a column: ' + parent + ' -> ' + child);
      d = 'M ' + (a.x + cardWidth + 2) + ' ' + (a.y + 86) + ' H ' + turn + ' V ' + (b.y + 86) + ' H ' + (b.x - 5);
    } else if (a.x === b.x && b.y - a.y === rowStep) {
      d = 'M ' + (a.x + cardWidth / 2) + ' ' + (a.y + cardHeight + 2) + ' V ' + (b.y - 5);
    } else {
      throw new Error('Quick ERD connector needs adjacent cards: ' + parent + ' -> ' + child);
    }
    out.push('<path d="' + d + '" fill="none" stroke="' + RELATION_RED + '" stroke-width="2.2" stroke-opacity="0.75" marker-end="url(#arrow)"/>');
  }
  out.push(rect(48, 1070, 1588, 75, '#fff5f4', '#edc9c6', 8));
  out.push(text(66, 1099, 'Red arrows highlight key parent-to-child FKs. Each table card lists every SQL FK parent.', 'body'));
  out.push(text(66, 1124, `Teal cards = entities; dashed border = proposed. The detailed ERD draws all ${integratedFks.length} FKs with column mappings.`, 'body'));
  out.push('</svg>');
  return out;
}

function integrationDetailed() {
  const width = 2860;
  const groups = [
    ['stores','categories','inventory','schema_migrations'],
    ['users','user_stores','logs','scan_sessions','session_items'],
    ['session_devices','scan_events','count_commits','count_commit_lines','count_line_contributors'],
    ['integration_sources','store_external_mappings','external_user_identities','sso_store_grants','sso_launch_receipts'],
    ['catalog_imports','catalog_import_rows','count_exports','count_export_lines','reconciliation_runs','reconciliation_lines'],
  ];
  const seen = groups.flat().sort();
  if (JSON.stringify(seen) !== JSON.stringify(integratedNames)) throw new Error('Detailed integration ERD is missing tables');
  const cards = [];
  const cardWidth = 530;
  const xs = [52, 615, 1178, 1741, 2304];
  for (const [groupIndex, names] of groups.entries()) {
    let y = 170;
    for (const name of names) {
      const columns = integrated.pragma(`table_info(${name})`);
      const keys = integrated.pragma(`foreign_key_list(${name})`);
      const fkNames = new Set(keys.map(key => key.from));
      const indexes = indexLines(integrated, name);
      const height = 75 + columns.length * 32 + 31 + indexes.length * 18 + 20;
      cards.push({ name, x: xs[groupIndex], y, height, columns, fkNames, indexes, planned: plannedNames.includes(name) });
      y += height + 52;
    }
  }
  const ledgerY = Math.max(...cards.map(card => card.y + card.height)) + 75;
  const ledgerRows = Math.ceil(integratedFks.length / 3);
  const relationshipRowHeight = 66;
  const height = ledgerY + 105 + ledgerRows * relationshipRowHeight + 135;
  const out = svgStart(width, height, 'OptiCapture proposed integration detailed ERD', `All current and proposed tables, columns, nullability, defaults, keys, indexes, and ${integratedFks.length} drawn parent-to-child foreign-key arrows with column mappings.`);
  out.push(text(52, 61, 'OptiCapture · detailed integration schema', 'title'));
  out.push(text(52, 91, `Design proposal: ${currentNames.length} current tables + ${plannedNames.length} additive proposed tables. This SQL is not deployed.`, 'sub'));
  out.push(text(2808, 62, 'TEAL = ENTITIES   ·   DASHED = PROPOSED   ·   RED = RELATIONSHIPS', 'sub', 'text-anchor="end"'));
  out.push(rect(52, 112, 2756, 1, '#d9e8e9'));
  for (const card of cards) {
    out.push(`<g id="table-${card.name}">`);
    out.push(rect(card.x, card.y, cardWidth, card.height, '#ffffff', '#9ad9de', 10, card.planned ? 'stroke-dasharray="6 4"' : ''));
    out.push(rect(card.x, card.y, cardWidth, 44, card.planned ? TEAL_DARK : TEAL, 'none', 8));
    out.push(text(card.x + 14, card.y + 29, card.name, 'name'));
    out.push(text(card.x + cardWidth - 13, card.y + 28, card.planned ? 'PROPOSED' : 'CURRENT', 'white-small', 'text-anchor="end"'));
    out.push(rect(card.x + 1, card.y + 44, cardWidth - 2, 29, '#e9f7f8'));
    out.push(text(card.x + 12, card.y + 64, 'COLUMN', 'section'));
    out.push(text(card.x + 245, card.y + 64, 'TYPE', 'section'));
    out.push(text(card.x + 355, card.y + 64, 'NULL?', 'section'));
    out.push(text(card.x + 515, card.y + 64, 'KEY', 'section', 'text-anchor="end"'));
    card.columns.forEach((column, index) => {
      const y = card.y + 73 + index * 32;
      if (index % 2) out.push(rect(card.x + 1, y, cardWidth - 2, 32, '#f7fbfb'));
      out.push(text(card.x + 12, y + 14, column.name, 'body'));
      out.push(text(card.x + 245, y + 14, column.type || 'ANY', 'small'));
      const nonNull = column.notnull || (column.pk && column.type.toUpperCase() === 'INTEGER');
      out.push(text(card.x + 355, y + 14, nonNull ? 'NOT NULL' : 'NULLABLE', 'tiny'));
      const flags = [column.pk ? 'PK' : '', card.fkNames.has(column.name) ? 'FK' : ''].filter(Boolean).join('/');
      if (flags) out.push(text(card.x + 515, y + 14, flags, 'key', 'text-anchor="end"'));
      out.push(text(card.x + 12, y + 28, `default: ${column.dflt_value ?? 'none'}`, 'tiny'));
    });
    const footerY = card.y + 73 + card.columns.length * 32;
    out.push(rect(card.x + 1, footerY, cardWidth - 2, 29, '#e9f7f8'));
    out.push(text(card.x + 12, footerY + 19, 'INDEXES AND UNIQUE CONSTRAINTS', 'section'));
    card.indexes.forEach((line, index) => out.push(text(card.x + 12, footerY + 47 + index * 18, line, 'tiny')));
    out.push('</g>');
  }
  out.push(rect(52, ledgerY, 2756, 80 + ledgerRows * relationshipRowHeight + 110, '#ffffff', '#edc9c6', 10));
  out.push(rect(53, ledgerY + 1, 2754, 70, '#fff5f4', 'none', 9));
  out.push(text(72, ledgerY + 33, 'All SQL foreign-key relationships', 'note-red'));
  out.push(text(72, ledgerY + 57, integratedFks.length + ' arrows - referenced parent to FK child - delete action NO ACTION throughout', 'sub'));
  integratedFks.forEach((key, index) => {
    const col = Math.floor(index / ledgerRows);
    const row = index % ledgerRows;
    const x = 72 + col * 907;
    const y = ledgerY + 84 + row * relationshipRowHeight;
    out.push(rect(x, y, 330, 54, '#edf8f8', '#9ad9de', 7));
    out.push(rect(x + 425, y, 390, 54, '#ffffff', '#9ad9de', 7));
    out.push(text(x + 10, y + 22, key.parent, 'name-small'));
    out.push(text(x + 10, y + 42, 'referenced: ' + key.to, 'tiny'));
    out.push(text(x + 435, y + 22, key.child, 'name-small'));
    out.push(text(x + 435, y + 42, 'FK: ' + key.from, 'tiny'));
    out.push('<path d="M ' + (x + 342) + ' ' + (y + 22) + ' H ' + (x + 414) + '" fill="none" stroke="' + RELATION_RED + '" stroke-width="2.5" marker-end="url(#arrow)" data-parent="' + esc(key.parent) + '" data-child="' + esc(key.child) + '"/>');
    out.push(text(x + 378, y + 45, key.required ? 'required' : 'optional', 'tiny', 'text-anchor="middle"'));
  });
  out.push(text(72, ledgerY + 95 + ledgerRows * relationshipRowHeight, 'No SQL FK: scan_sessions.user_id/store_id and logs.user_id/store_id. Store and source consistency across separate FKs require service validation. scan_events has append-only triggers.', 'body'));
  out.push(text(52, height - 36, 'Source: docs/database-schema.sql + docs/integration-schema-proposal.sql · Proposed tables are a design reference, not a migration', 'sub'));
  out.push('</svg>');
  return out;
}

write('opticapture-erd-quick.svg', currentQuick());
write('opticapture-integration-erd-quick.svg', integrationQuick());
write('opticapture-integration-erd-detailed.svg', integrationDetailed());
current.close();
integrated.close();
console.log(`Verified 3 ERDs: ${currentNames.length} current tables, ${plannedNames.length} planned tables, ${integratedFks.length} integrated FKs`);
