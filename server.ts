import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('opticapture.db');
const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'opticapture-secret-key-change-in-prod';

app.use(express.json({ limit: '50mb' })); // Increased limit for image uploads
app.use(cookieParser());

// Database Initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    store_name TEXT DEFAULT 'Main Store'
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    status TEXT DEFAULT 'Active',
    icon TEXT
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT,
    description TEXT,
    quantity INTEGER,
    unit TEXT,
    category_id INTEGER,
    status TEXT DEFAULT 'Active',
    sale_price REAL,
    tax_percent REAL,
    image TEXT,
    upc TEXT UNIQUE,
    number TEXT,
    tag_names TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    user_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scan_sessions (
    session_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS session_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    upc TEXT,
    quantity INTEGER DEFAULT 1,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES scan_sessions(session_id)
  );
`);

// Seed initial data
const checkUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!checkUser) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role, store_name) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, 'owner', 'OptiMart Downtown');
  
  const takerPass = bcrypt.hashSync('taker123', 10);
  db.prepare('INSERT INTO users (username, password, role, store_name) VALUES (?, ?, ?, ?)').run('taker', takerPass, 'taker', 'OptiMart Downtown');
}

// Seed some categories if empty
const checkCats = db.prepare('SELECT count(*) as count FROM categories').get() as any;
if (checkCats.count === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)');
  insertCat.run('Beverages', 'CupSoda');
  insertCat.run('Snacks', 'Cookie');
  insertCat.run('Tobacco', 'Cigarette');
  insertCat.run('Household', 'Home');
  insertCat.run('Automotive', 'Car');
}

// Middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

// API Routes

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, store_name: user.store_name }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  res.json({ id: user.id, username: user.username, role: user.role, store_name: user.store_name });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json((req as any).user);
});

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const totalCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get() as any;
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM inventory').get() as any;
  const inStock = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity > 0').get() as any;
  const outOfStock = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity = 0').get() as any;

  res.json({
    totalCategories: totalCategories.count,
    totalItems: totalItems.count,
    inStock: inStock.count,
    outOfStock: outOfStock.count
  });
});

// Categories
app.get('/api/categories', authenticateToken, (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, 
    (SELECT COUNT(*) FROM inventory i WHERE i.category_id = c.id) as item_count,
    (SELECT SUM(quantity) FROM inventory i WHERE i.category_id = c.id) as total_stock
    FROM categories c
    ORDER BY c.name ASC
  `).all();
  res.json(categories);
});

app.put('/api/categories/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  
  db.transaction(() => {
    db.prepare('UPDATE categories SET status = ? WHERE id = ?').run(status, id);
    if (status === 'Inactive') {
      db.prepare('UPDATE inventory SET status = ? WHERE category_id = ?').run('Inactive', id);
    }
  })();
  
  res.json({ success: true });
});

app.delete('/api/categories/:id/items', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM inventory WHERE category_id = ?').run(id);
  res.json({ success: true });
});

// Inventory
app.get('/api/inventory', authenticateToken, (req, res) => {
  const { category_id } = req.query;
  let query = 'SELECT i.*, c.name as category_name FROM inventory i LEFT JOIN categories c ON i.category_id = c.id';
  const params = [];

  if (category_id) {
    query += ' WHERE i.category_id = ?';
    params.push(category_id);
  }

  query += ' ORDER BY i.updated_at DESC';
  
  const items = db.prepare(query).all(...params);
  res.json(items);
});

app.post('/api/inventory', authenticateToken, (req, res) => {
  const { item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names } = req.body;
  const user = (req as any).user;
  
  // Check for duplicate item name
  const existing = db.prepare('SELECT id FROM inventory WHERE item_name = ?').get(item_name);
  if (existing) {
    return res.status(409).json({ error: 'Item with this name already exists' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO inventory (item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names);
    
    db.prepare('INSERT INTO logs (action, details, user_id) VALUES (?, ?, ?)').run('CREATE', `Added item ${item_name}`, user.id);
    
    res.json({ id: info.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inventory/:id', authenticateToken, (req, res) => {
  const { item_name, quantity, category_id, status, unit, sale_price, tax_percent, description, tag_names } = req.body;
  const { id } = req.params;
  const user = (req as any).user;

  try {
    db.prepare(`
      UPDATE inventory 
      SET item_name = ?, quantity = ?, category_id = ?, status = ?, unit = ?, sale_price = ?, tax_percent = ?, description = ?, tag_names = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(item_name, quantity, category_id, status, unit, sale_price, tax_percent, description, tag_names, id);
    
    db.prepare('INSERT INTO logs (action, details, user_id) VALUES (?, ?, ?)').run('UPDATE', `Updated item ${id}`, user.id);
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventory/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  
  db.prepare('DELETE FROM inventory WHERE id = ?').run(id);
  db.prepare('INSERT INTO logs (action, details, user_id) VALUES (?, ?, ?)').run('DELETE', `Deleted item ${id}`, user.id);
  
  res.json({ success: true });
});

// Batch Scan / Import (Updated for new schema)
app.post('/api/inventory/batch', authenticateToken, (req, res) => {
  const { items } = req.body;
  const user = (req as any).user;
  const results = { added: 0, updated: 0, errors: [] as string[] };

  // Default category for imports if not specified
  const defaultCat = db.prepare('SELECT id FROM categories LIMIT 1').get() as any;
  const defaultCatId = defaultCat ? defaultCat.id : 1;

  const insertStmt = db.prepare(`
    INSERT INTO inventory (item_name, quantity, upc, number, tag_names, category_id, description) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE upc = ?');
  const checkStmt = db.prepare('SELECT * FROM inventory WHERE upc = ?');

  const transaction = db.transaction((batchItems) => {
    for (const item of batchItems) {
      try {
        if (!item.upc) continue;
        const existing = checkStmt.get(item.upc);
        if (existing) {
          updateStmt.run(item.quantity, item.upc);
          results.updated++;
        } else {
          insertStmt.run(
            item.description || 'Unknown Item', 
            item.quantity, 
            item.upc, 
            item.number || '', 
            item.tag_names || '',
            defaultCatId,
            item.description || ''
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
    db.prepare('INSERT INTO logs (action, details, user_id) VALUES (?, ?, ?)').run('BATCH', `Processed ${items.length} items`, user.id);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Scan Session Routes
app.post('/api/session/create', authenticateToken, (req, res) => {
  const sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  db.prepare('INSERT INTO scan_sessions (session_id) VALUES (?)').run(sessionId);
  res.json({ sessionId });
});

app.get('/api/session/:id', (req, res) => {
  const { id } = req.params;
  const items = db.prepare(`
    SELECT si.*, i.item_name, i.image 
    FROM session_items si 
    LEFT JOIN inventory i ON si.upc = i.upc 
    WHERE si.session_id = ? 
    ORDER BY si.scanned_at DESC
  `).all(id);
  res.json(items);
});

app.post('/api/session/:id/scan', (req, res) => {
  const { id } = req.params;
  const { upc } = req.body;
  
  // Check if session exists and is active
  const session = db.prepare('SELECT * FROM scan_sessions WHERE session_id = ? AND status = "active"').get(id);
  if (!session) return res.status(404).json({ error: 'Session not found or inactive' });

  // Check if item exists in session to increment quantity, or insert new
  const existing = db.prepare('SELECT * FROM session_items WHERE session_id = ? AND upc = ?').get(id, upc) as any;
  
  if (existing) {
    db.prepare('UPDATE session_items SET quantity = quantity + 1, scanned_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO session_items (session_id, upc, quantity) VALUES (?, ?, ?)').run(id, upc, 1);
  }
  
  res.json({ success: true });
});

app.post('/api/session/:id/commit', authenticateToken, (req, res) => {
  const { id } = req.params;
  const user = (req as any).user;
  
  const items = db.prepare('SELECT * FROM session_items WHERE session_id = ?').all(id) as any[];
  
  if (items.length === 0) return res.json({ message: 'No items to commit' });

  const updateInventory = db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE upc = ?');
  const insertInventory = db.prepare('INSERT INTO inventory (item_name, upc, quantity, category_id, status) VALUES (?, ?, ?, 1, "Active")'); // Default cat ID 1
  const checkInventory = db.prepare('SELECT * FROM inventory WHERE upc = ?');

  const transaction = db.transaction((sessionItems) => {
    for (const item of sessionItems) {
      const invItem = checkInventory.get(item.upc);
      if (invItem) {
        updateInventory.run(item.quantity, item.upc);
      } else {
        insertInventory.run('Unknown Scanned Item', item.upc, item.quantity);
      }
    }
    // Deactivate session
    db.prepare('UPDATE scan_sessions SET status = "completed" WHERE session_id = ?').run(id);
  });

  try {
    transaction(items);
    db.prepare('INSERT INTO logs (action, details, user_id) VALUES (?, ?, ?)').run('BATCH', `Committed remote session ${id}`, user.id);
    res.json({ success: true, count: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Logs
app.get('/api/logs', authenticateToken, (req, res) => {
  const logs = db.prepare('SELECT logs.*, users.username FROM logs JOIN users ON logs.user_id = users.id ORDER BY timestamp DESC LIMIT 100').all();
  res.json(logs);
});

// Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
