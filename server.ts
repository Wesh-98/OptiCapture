import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import https from 'https';
import fs from 'fs';
import { randomUUID, randomBytes } from 'crypto';
import multer from 'multer';
import { read as xlsxRead, utils as xlsxUtils, write as xlsxWrite } from 'xlsx';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('opticapture.db');
const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
);

// Temporary store for pending OAuth registrations (10-min TTL)
const pendingOAuth = new Map<string, { googleId: string; email: string; name: string; expiresAt: number }>();

// M-5: Clean up expired pending OAuth entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingOAuth.entries()) {
    if (entry.expiresAt < now) pendingOAuth.delete(key);
  }
}, 5 * 60 * 1000);

// Multer — memory storage for file uploads (xlsx/csv import)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Uploads directory for product images
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Vite dev requires inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://world.openfoodfacts.org", "https://api.upcitemdb.com", "wss:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// Auth endpoints: max 20 requests per 15 min per IP
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// General API limiter: max 300 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/icons', express.static(path.join(process.cwd(), 'public', 'icons')));

// Database Initialization
// Migration version tracking
db.prepare(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`).run();

const appliedMigrations = new Set(
  (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version)
);

function runMigration(version: number, fn: () => void) {
  if (appliedMigrations.has(version)) return;
  fn();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  appliedMigrations.add(version);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plan_tier TEXT DEFAULT 'starter',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    store_name TEXT DEFAULT 'Main Store',
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    icon TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(name, store_id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
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
    upc TEXT,
    number TEXT,
    tag_names TEXT,
    store_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(upc, store_id),
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scan_sessions (
    session_id TEXT PRIMARY KEY,
    otp TEXT,
    user_id INTEGER,
    store_id INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS session_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    upc TEXT,
    quantity INTEGER DEFAULT 1,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    lookup_status TEXT DEFAULT 'unknown',
    product_name TEXT,
    brand TEXT,
    image TEXT,
    source TEXT DEFAULT 'scan_only',
    exists_in_inventory INTEGER DEFAULT 0,
    FOREIGN KEY(session_id) REFERENCES scan_sessions(session_id)
  );
`);

// Index: allow deduplication by item number per store (for imports without UPC)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_number_store
    ON inventory(number, store_id)
    WHERE number IS NOT NULL AND number != '';
`);

// user_stores junction table — multi-store access
db.exec(`
  CREATE TABLE IF NOT EXISTS user_stores (
    user_id INTEGER NOT NULL,
    store_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    PRIMARY KEY (user_id, store_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(store_id) REFERENCES stores(id)
  );
`);

// Migrate existing users into user_stores (runs once — INSERT OR IGNORE skips duplicates)
db.prepare(`
  INSERT OR IGNORE INTO user_stores (user_id, store_id, role)
  SELECT id, store_id, role FROM users WHERE store_id != 0
`).run();

// Schema migrations for stores table
runMigration(1, () => {
  ['street', 'zipcode', 'state', 'logo'].forEach(col => {
    const exists = db.prepare(`PRAGMA table_info(stores)`).all().some((c: any) => c.name === col);
    if (!exists) db.prepare(`ALTER TABLE stores ADD COLUMN ${col} TEXT`).run();
  });
});

// Schema migrations for session_items table
runMigration(2, () => {
  ['tag_names', 'sale_price', 'unit'].forEach(col => {
    const exists = db.prepare(`PRAGMA table_info(session_items)`).all().some((c: any) => c.name === col);
    if (!exists) db.prepare(`ALTER TABLE session_items ADD COLUMN ${col} TEXT`).run();
  });
});

// Schema migrations for scan_sessions table — add OTP security columns
runMigration(3, () => {
  try { db.prepare("ALTER TABLE scan_sessions ADD COLUMN otp_attempts INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE scan_sessions ADD COLUMN expires_at TEXT").run(); } catch {}
});

// Schema migrations for users table — add account lockout columns
runMigration(4, () => {
  try { db.prepare("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL").run(); } catch {}
});

// Seed sentinel store (id=0) for superadmin — must exist before superadmin user is inserted
const checkHQ = db.prepare('SELECT id FROM stores WHERE id = 0').get();
if (!checkHQ) {
  db.prepare("INSERT INTO stores (id, name, plan_tier) VALUES (0, 'OptiCapture HQ', 'internal')").run();
}

// Seed store
const checkStore = db.prepare('SELECT id FROM stores WHERE id = 1').get();
if (!checkStore) {
  db.prepare("INSERT INTO stores (id, name, plan_tier) VALUES (1, 'OptiMart Downtown', 'professional')").run();
}

// Seed demo accounts only in development (C-2: never seed known credentials in production)
if (process.env.NODE_ENV !== 'production') {
  const checkUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!checkUser) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('admin', hashedPassword, 'owner', 1, 'OptiMart Downtown');

    const takerPass = bcrypt.hashSync('taker123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('taker', takerPass, 'taker', 1, 'OptiMart Downtown');
  }

  const checkSuper = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
  if (!checkSuper) {
    const superPass = bcrypt.hashSync('superadmin123', 10);
    db.prepare('INSERT INTO users (username, password, role, store_id, store_name) VALUES (?, ?, ?, ?, ?)')
      .run('superadmin', superPass, 'superadmin', 0, 'OptiCapture HQ');
  }
}

// Seed default categories — always upsert icon so image paths stay current
const upsertCat = db.prepare(`
  INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)
  ON CONFLICT(name, store_id) DO UPDATE SET icon = excluded.icon
`);
const seedCats: [string, string][] = [
  ['Soft Drinks',              '/icons/soft-drinks.png'],
  ['Snacks',                 '/icons/snack.png'],
  ['Candy',                  '/icons/candy.png'],
  ['Tobacco',                'Cigarette'],
  ['Household Items',        '/icons/household-items.png'],
  ['Automotive',             '/icons/automotive.png'],
  ['Cold Coffee',            '/icons/cold-coffee.png'],
  ['Dairy',                  '/icons/dairy.png'],
  ['Electronics',            '/icons/electronics.png'],
  ['Wine & Beer',            '/icons/beer-wine.png'],
  ['Pets',                   '/icons/pet-food.png'],
  ['Pastries',               '/icons/pastry.png'],
  ['Newspapers',             '/icons/newspaper.png'],
  ['Energy Drinks',          '/icons/energy-drink.png'],
  ['Frozen Food',           '/icons/frozen-food.png'],
  ['Grocery',                '/icons/grocery.png'],
  ['Gum & Mints',            '/icons/gum-mint.png'],
  ['Juices, Teas, Lemonades',  '/icons/juice-tea-lemonade.png'],
  ['Non-Tobacco',            '/icons/non-tobacco.png'],
  ['Nutrition Snacks',     '/icons/nutrition-snacks.png'],
  ['Personal Care',          '/icons/personal-care.png'],
  ['Sports Drinks',          '/icons/sports-drink.png'],
  ['Water',                  '/icons/water.png'],
  ['Scratch Tickets',        '/icons/scratch-tickets.png'],
  ['Phone Cards',            '/icons/phone-cards.png'],
];
for (const [name, icon] of seedCats) upsertCat.run(name, icon, 1);

// Migrate stores table — add columns if missing
runMigration(5, () => {
  const storesCols = (db.prepare('PRAGMA table_info(stores)').all() as any[]).map((c: any) => c.name);
  if (!storesCols.includes('address')) db.prepare("ALTER TABLE stores ADD COLUMN address TEXT DEFAULT ''").run();
  if (!storesCols.includes('phone'))   db.prepare("ALTER TABLE stores ADD COLUMN phone TEXT DEFAULT ''").run();
  if (!storesCols.includes('email'))   db.prepare("ALTER TABLE stores ADD COLUMN email TEXT DEFAULT ''").run();
  if (!storesCols.includes('status'))  db.prepare("ALTER TABLE stores ADD COLUMN status TEXT DEFAULT 'active'").run();
});

// Migrate users table — add OAuth columns if missing
runMigration(6, () => {
  const usersCols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c: any) => c.name);
  if (!usersCols.includes('oauth_provider')) db.prepare("ALTER TABLE users ADD COLUMN oauth_provider TEXT DEFAULT NULL").run();
  if (!usersCols.includes('oauth_id'))       db.prepare("ALTER TABLE users ADD COLUMN oauth_id TEXT DEFAULT NULL").run();
  if (!usersCols.includes('email'))          db.prepare("ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL").run();
});
db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
  ON users(oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL
`).run();

// One-time migration: convert old uc?export=view Drive URLs to thumbnail format
db.prepare(`
  UPDATE inventory
  SET image = 'https://drive.google.com/thumbnail?id=' || SUBSTR(image, INSTR(image, 'id=') + 3) || '&sz=w800'
  WHERE image LIKE '%drive.google.com/uc?export=view%'
    AND image NOT LIKE '%thumbnail%'
`).run();

// Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET!, { algorithms: ['HS256'], issuer: 'opticapture', audience: 'opticapture-app' }, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    if (user.role !== 'superadmin') {
      const store = db.prepare('SELECT status FROM stores WHERE id = ?').get(user.store_id) as any;
      if (!store || store.status === 'suspended') {
        return res.status(403).json({ error: 'Store account suspended' });
      }
    }
    req.user = user;
    next();
  });
};

// Role guard — takers can view and scan, but cannot write/delete inventory or categories
const requireOwner = (req: any, res: any, next: any) => {
  if (req.user.role === 'taker') return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

// M-7: Only allow safe image extensions from base64 uploads
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp',
};

// Save base64 image to disk, return file path. Pass-through for URLs/paths.
function saveBase64Image(base64Data: string): string {
  const match = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return base64Data;

  // Only allow safe image types
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
  if (!mimeMatch || !allowedMimeTypes.includes(mimeMatch[1])) {
    return ''; // Reject disallowed types silently
  }

  const ext = ALLOWED_IMAGE_TYPES[match[1].toLowerCase()];
  if (!ext) return ''; // reject svg, php, or any unknown type
  const buffer = Buffer.from(match[2], 'base64');
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// Normalize Google Drive sharing URLs to embeddable thumbnail URLs
function normalizeImageUrl(url: string): string {
  // Sharing URL: /file/d/FILE_ID/view
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w800`;
  // Already-converted uc?export=view&id=FILE_ID URLs
  const ucMatch = url.match(/drive\.google\.com.*[?&]id=([a-zA-Z0-9_-]+)/);
  if (ucMatch) return `https://drive.google.com/thumbnail?id=${ucMatch[1]}&sz=w800`;
  return url;
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper to get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Auth helpers
function issueJwt(res: any, user: { id: number; username: string; role: string; store_name: string; store_id: number }) {
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, store_name: user.store_name, store_id: user.store_id },
    JWT_SECRET!,
    { expiresIn: '8h', algorithm: 'HS256', issuer: 'opticapture', audience: 'opticapture-app' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });
  return token;
}

// Apply general rate limiting to all API routes
app.use('/api', apiLimiter);

// Auth
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check if account is locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `Account locked. Try again in ${minutesLeft} minute(s).` });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    if (newAttempts >= 5) {
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?').run(newAttempts, lockedUntil, user.id);
    } else {
      db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(newAttempts, user.id);
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Reset failed attempts on successful login
  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  issueJwt(res, user);
  res.json({ id: user.id, username: user.username, role: user.role, store_name: user.store_name, store_id: user.store_id });
});

// Google OAuth — start
app.get('/api/auth/google', authLimiter, (req, res) => {
  const intent = req.query.intent === 'signup' ? 'signup' : 'login';
  const csrfToken = randomBytes(16).toString('hex');
  // Store state nonce in a short-lived httpOnly cookie to prevent CSRF (H-1)
  res.cookie('oauth_state', `${csrfToken}:${intent}`, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000,
  });
  const url = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state: csrfToken,
    prompt: 'select_account',
  });
  res.redirect(url);
});

// Google OAuth — callback
app.get('/api/auth/google/callback', async (req: any, res) => {
  const { code, state } = req.query as { code: string; state: string };

  // H-1: Validate CSRF state nonce
  const storedState = req.cookies?.oauth_state as string | undefined;
  res.clearCookie('oauth_state');
  if (!storedState || !state || !storedState.startsWith(state + ':')) {
    return res.redirect('/login?error=oauth_failed');
  }

  try {
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;
    const googleId = payload.sub;
    const email    = payload.email || '';
    const name     = payload.name  || '';

    // 1. Look up by oauth_id
    let user = db.prepare("SELECT * FROM users WHERE oauth_provider = 'google' AND oauth_id = ?").get(googleId) as any;

    // 2. Fall back to matching by email (auto-link existing account)
    if (!user && email) {
      const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
      if (byEmail) {
        db.prepare("UPDATE users SET oauth_provider = 'google', oauth_id = ? WHERE id = ?").run(googleId, byEmail.id);
        user = { ...byEmail, oauth_provider: 'google', oauth_id: googleId };
      }
    }

    if (user) {
      issueJwt(res, user);
      return res.redirect(user.role === 'superadmin' ? '/admin' : '/');
    }

    // New user — save pending profile and redirect to signup
    const key = randomUUID();
    pendingOAuth.set(key, { googleId, email, name, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.redirect(`/signup?pending=${key}`);
  } catch {
    // H-2: Use opaque error code, not raw message
    res.redirect('/login?error=oauth_failed');
  }
});

// Google OAuth — retrieve pending profile (called by signup page)
app.get('/api/auth/google/pending', (req, res) => {
  const key = req.query.key as string;
  const entry = pendingOAuth.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingOAuth.delete(key);
    return res.status(404).json({ error: 'Session expired. Please try signing in with Google again.' });
  }
  res.json({ email: entry.email, name: entry.name });
});

// Register new store + owner
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { store_name, street, zipcode, state, phone, email, username, password, oauth_key } = req.body;
  if (!store_name || !username)
    return res.status(400).json({ error: 'Store name and username are required' });
  if (!password && !oauth_key)
    return res.status(400).json({ error: 'Password is required' });
  if (password && (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)))
    return res.status(400).json({ error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
  if (phone && !/^\d{10}$/.test(phone.replace(/\D/g, '')))
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode))
    return res.status(400).json({ error: 'Zipcode format: 12345 or 12345-6789' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  // Validate OAuth key if provided
  const oauthEntry = oauth_key ? pendingOAuth.get(oauth_key) : null;
  if (oauth_key && (!oauthEntry || oauthEntry.expiresAt < Date.now())) {
    pendingOAuth.delete(oauth_key);
    return res.status(400).json({ error: 'Google session expired. Please sign in with Google again.' });
  }

  const register = db.transaction(() => {
    const storeInfo = db.prepare(
      'INSERT INTO stores (name, street, zipcode, state, phone, email, plan_tier) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(store_name, street || null, zipcode || null, state || null, phone || '', email || '', 'starter');
    const storeId = storeInfo.lastInsertRowid as number;

    const hashed = password ? bcrypt.hashSync(password, 10) : null;
    const userInfo = db.prepare(
      'INSERT INTO users (username, password, role, store_id, store_name, oauth_provider, oauth_id, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      username, hashed, 'owner', storeId, store_name,
      oauthEntry ? 'google' : null,
      oauthEntry ? oauthEntry.googleId : null,
      oauthEntry ? oauthEntry.email : (email || null)
    );
    const userId = userInfo.lastInsertRowid as number;
    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(userId, storeId, 'owner');

    // Seed 4 default categories for the new store
    const catInsert = db.prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)');
    const defaults: [string, string][] = [
      ['Snacks', '/icons/snack.png'],
      ['Beverages', '/icons/soft-drinks.png'],
      ['Candy', '/icons/candy.png'],
      ['Grocery', '/icons/grocery.png'],
    ];
    for (const [name, icon] of defaults) catInsert.run(name, icon, storeId);

    return { storeId };
  });

  try {
    const { storeId } = register();
    if (oauthEntry) {
      pendingOAuth.delete(oauth_key);
      const newUser = db.prepare("SELECT * FROM users WHERE store_id = ? AND role = 'owner'").get(storeId) as any;
      issueJwt(res, newUser);
      return res.status(201).json({ message: 'Store registered', store_id: storeId, redirect: '/' });
    }
    res.status(201).json({ message: 'Store registered successfully', store_id: storeId });
  } catch (err: any) {
    console.error('[]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Super admin — list all stores
app.get('/api/admin/stores', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const stores = db.prepare(`
    SELECT s.*,
      COUNT(DISTINCT u.id) AS user_count,
      COUNT(DISTINCT i.id) AS item_count
    FROM stores s
    LEFT JOIN users u ON u.store_id = s.id
    LEFT JOIN inventory i ON i.store_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all();
  res.json(stores);
});

// Super admin — activate or suspend a store
app.put('/api/admin/stores/:id/status', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE stores SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// Super admin — list users with access to a store
app.get('/api/admin/stores/:id/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, us.role
    FROM user_stores us
    JOIN users u ON u.id = us.user_id
    WHERE us.store_id = ?
    ORDER BY us.role, u.username
  `).all(req.params.id);
  res.json(users);
});

// Super admin — grant a user access to a store
app.post('/api/admin/stores/:id/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { username, role } = req.body;
  if (!username || !['owner', 'taker'].includes(role))
    return res.status(400).json({ error: 'Valid username and role required' });
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  const existing = db.prepare('SELECT 1 FROM user_stores WHERE user_id = ? AND store_id = ?').get(user.id, req.params.id);
  if (existing) return res.status(409).json({ error: 'User already has access to this store' });
  db.prepare('INSERT INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(user.id, req.params.id, role);
  res.json({ ok: true });
});

// Super admin — revoke a user's access to a store
app.delete('/api/admin/stores/:id/users/:userId', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  // Prevent removing the last owner
  const ownerCount = (db.prepare("SELECT COUNT(*) as c FROM user_stores WHERE store_id = ? AND role = 'owner'").get(req.params.id) as any).c;
  const target = db.prepare('SELECT role FROM user_stores WHERE user_id = ? AND store_id = ?').get(req.params.userId, req.params.id) as any;
  if (target?.role === 'owner' && ownerCount <= 1)
    return res.status(400).json({ error: 'Cannot remove the last owner of a store' });
  db.prepare('DELETE FROM user_stores WHERE user_id = ? AND store_id = ?').run(req.params.userId, req.params.id);
  res.json({ ok: true });
});

// Super admin — edit store details
app.put('/api/admin/stores/:id', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const { name, street, zipcode, state, phone, email, plan_tier, logo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Store name is required' });
  db.prepare('UPDATE stores SET name = ?, street = ?, zipcode = ?, state = ?, phone = ?, email = ?, plan_tier = ?, logo = ? WHERE id = ?')
    .run(name.trim(), street || null, zipcode || null, state || null, phone || null, email || null, plan_tier || 'starter', logo || null, req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/users/:userId/reset-password', authenticateToken, (req: any, res: any) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });

  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = generateTempPassword();
  const hash = bcrypt.hashSync(tempPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);

  res.json({ tempPassword, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authenticateToken, (req: any, res) => {
  const store = db.prepare('SELECT logo FROM stores WHERE id = ?').get(req.user.store_id) as any;
  res.json({ ...req.user, store_logo: store?.logo || null });
});

// My stores — list all stores this user has access to
app.get('/api/auth/my-stores', authenticateToken, (req: any, res) => {
  const stores = db.prepare(`
    SELECT s.id, s.name, s.logo, s.status, us.role
    FROM user_stores us
    JOIN stores s ON s.id = us.store_id
    WHERE us.user_id = ?
    ORDER BY s.name ASC
  `).all(req.user.id);
  res.json(stores);
});

// Switch store — re-issues JWT scoped to a different store
app.post('/api/auth/switch-store', authenticateToken, (req: any, res) => {
  const { store_id } = req.body;
  const access = db.prepare('SELECT role FROM user_stores WHERE user_id = ? AND store_id = ?')
    .get(req.user.id, store_id) as any;
  if (!access) return res.status(403).json({ error: 'No access to that store' });

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(store_id) as any;
  if (!store || store.status === 'suspended') return res.status(403).json({ error: 'Store is suspended' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
  // Temporarily override store context for JWT issuance
  user.store_id = store.id;
  user.store_name = store.name;
  user.role = access.role;
  issueJwt(res, user);
  res.json({ success: true, store_name: store.name, store_logo: store.logo || null });
});

// Store Settings — get
app.get('/api/store/settings', authenticateToken, (req: any, res) => {
  const store = db.prepare('SELECT id, name, street, zipcode, state, phone, email, plan_tier, status, logo FROM stores WHERE id = ?')
    .get(req.user.store_id) as any;
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json(store);
});

// Store Settings — update store info
app.put('/api/store/settings', authenticateToken, (req: any, res) => {
  const { name, street, zipcode, state, phone, email, logo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Store name is required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (phone && !/^\d{10}$/.test(phone.replace(/\D/g, ''))) return res.status(400).json({ error: 'Phone must be 10 digits' });
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode)) return res.status(400).json({ error: 'Zipcode format: 12345 or 12345-6789' });
  const savedLogo = logo ? (saveBase64Image(logo) || null) : null;
  db.prepare('UPDATE stores SET name = ?, street = ?, zipcode = ?, state = ?, phone = ?, email = ?, logo = ? WHERE id = ?')
    .run(name.trim(), street || null, zipcode || null, state || null, phone || null, email || null, savedLogo, req.user.store_id);
  res.json({ success: true });
});

// Store Settings — change password
app.put('/api/store/password', authenticateToken, (req: any, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both fields are required' });
  if (new_password.length < 8 || !/[A-Z]/.test(new_password) || !/\d/.test(new_password))
    return res.status(400).json({ error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
  if (!user || !bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Current password is incorrect' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, (req: any, res) => {
  const storeId = req.user.store_id;
  const totalCategories = db.prepare('SELECT COUNT(*) as count FROM categories WHERE store_id = ?').get(storeId) as any;
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE store_id = ?').get(storeId) as any;
  const inStock = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity > 0 AND store_id = ?').get(storeId) as any;
  const outOfStock = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE quantity = 0 AND store_id = ?').get(storeId) as any;

  res.json({
    totalCategories: totalCategories.count,
    totalItems: totalItems.count,
    inStock: inStock.count,
    outOfStock: outOfStock.count
  });
});

// Categories
app.get('/api/categories', authenticateToken, (req: any, res) => {
  const storeId = req.user.store_id;
  const categories = db.prepare(`
    SELECT c.*,
    (SELECT COUNT(*) FROM inventory i WHERE i.category_id = c.id AND i.store_id = ?) as item_count,
    (SELECT SUM(quantity) FROM inventory i WHERE i.category_id = c.id AND i.store_id = ?) as total_stock
    FROM categories c
    WHERE c.store_id = ?
    ORDER BY c.name ASC
  `).all(storeId, storeId, storeId);
  res.json(categories);
});

app.put('/api/categories/:id/status', authenticateToken, requireOwner, (req: any, res) => {
  const { status } = req.body;
  const { id } = req.params;
  const storeId = req.user.store_id;

  db.transaction(() => {
    db.prepare('UPDATE categories SET status = ? WHERE id = ? AND store_id = ?').run(status, id, storeId);
    if (status === 'Inactive') {
      db.prepare('UPDATE inventory SET status = ? WHERE category_id = ? AND store_id = ?').run('Inactive', id, storeId);
    }
  })();

  res.json({ success: true });
});

app.delete('/api/categories/:id/items', authenticateToken, requireOwner, (req: any, res) => {
  const { id } = req.params;
  const storeId = req.user.store_id;
  db.prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?').run(id, storeId);
  res.json({ success: true });
});

app.post('/api/categories', authenticateToken, requireOwner, (req: any, res) => {
  const { name, icon } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  const storeId = req.user.store_id;
  try {
    const info = db.prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)')
      .run(name.trim(), icon || 'Package', storeId);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' });
    console.error('[categories:create]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

app.put('/api/categories/:id', authenticateToken, requireOwner, (req: any, res) => {
  const { name, icon } = req.body;
  const { id } = req.params;
  const storeId = req.user.store_id;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ? AND store_id = ?')
      .run(name.trim(), icon || 'Package', id, storeId);
    res.json({ success: true });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' });
    console.error('[categories:update]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

app.delete('/api/categories/:id', authenticateToken, requireOwner, (req: any, res) => {
  const { id } = req.params;
  const storeId = req.user.store_id;
  db.transaction(() => {
    db.prepare('DELETE FROM inventory WHERE category_id = ? AND store_id = ?').run(id, storeId);
    db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').run(id, storeId);
  })();
  res.json({ success: true });
});

// Inventory
app.get('/api/inventory', authenticateToken, (req: any, res) => {
  const { category_id, q } = req.query;
  const storeId = req.user.store_id;
  let query = 'SELECT i.*, c.name as category_name FROM inventory i LEFT JOIN categories c ON i.category_id = c.id WHERE i.store_id = ?';
  const params: any[] = [storeId];

  if (category_id) {
    query += ' AND i.category_id = ?';
    params.push(category_id);
  }

  if (q) {
    const pattern = `%${String(q).toLowerCase()}%`;
    query += ' AND (LOWER(i.item_name) LIKE ? OR LOWER(i.upc) LIKE ? OR LOWER(COALESCE(c.name,\'\')) LIKE ?)';
    params.push(pattern, pattern, pattern);
  }

  query += ' ORDER BY i.updated_at DESC';

  const items = db.prepare(query).all(...params);
  res.json(items);
});

// Export inventory — XLSX, CSV, JSON, PDF
app.get('/api/inventory/export', authenticateToken, requireOwner, async (req: any, res) => {
  const fmt = ['xlsx','csv','json','pdf'].includes(req.query.format as string) ? req.query.format as string : 'xlsx';

  const rows = db.prepare(`
    SELECT i.item_name, i.description, i.quantity, i.unit, i.sale_price,
           i.tax_percent, i.upc, i.number, i.tag_names, i.status,
           c.name AS category, i.created_at
    FROM inventory i
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.store_id = ?
    ORDER BY c.name, i.item_name
  `).all(req.user.store_id) as any[];

  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
    .run('EXPORT', `Exported ${rows.length} items as ${fmt.toUpperCase()}`, req.user.id, req.user.store_id);

  const filename = `inventory-${Date.now()}`;
  const COLS = ['item_name','description','quantity','unit','sale_price','tax_percent','upc','number','tag_names','status','category','created_at'];

  if (fmt === 'csv') {
    const csv = [COLS.join(','), ...rows.map(r => COLS.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }

  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify({ exported_at: new Date().toISOString(), total: rows.length, items: rows }, null, 2));
  }

  if (fmt === 'pdf') {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);
    doc.fontSize(18).font('Helvetica-Bold').text('Inventory Report', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#666')
      .text(`Generated: ${new Date().toLocaleString()}   |   Total items: ${rows.length}`, { align: 'center' });
    doc.moveDown(1.5);
    const grouped = rows.reduce((acc: any, r: any) => {
      const cat = r.category || 'Uncategorized';
      (acc[cat] ??= []).push(r);
      return acc;
    }, {});
    for (const [cat, items] of Object.entries(grouped) as [string, any[]][]) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#0a192f').text(cat);
      doc.moveDown(0.3);
      for (const item of items) {
        doc.fontSize(9).font('Helvetica').fillColor('#333')
          .text(`  ${item.item_name || '—'}   UPC: ${item.upc || '—'}   Qty: ${item.quantity ?? '—'}   Price: $${item.sale_price ?? '—'}   Unit: ${item.unit || '—'}   Status: ${item.status || '—'}`);
      }
      doc.moveDown(0.8);
    }
    doc.end();
    return;
  }

  // Default: xlsx — reuse imported xlsxUtils
  const ws = xlsxUtils.json_to_sheet(rows);
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, ws, 'Inventory');
  const buf = xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
});

app.post('/api/inventory', authenticateToken, requireOwner, (req: any, res) => {
  const { item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names, upc } = req.body;
  const user = req.user;

  const existing = db.prepare('SELECT id FROM inventory WHERE item_name = ? AND store_id = ?').get(item_name, user.store_id);
  if (existing) {
    return res.status(409).json({ error: 'Item with this name already exists' });
  }

  try {
    const savedImage = image ? saveBase64Image(image) : null;
    const info = db.prepare(`
      INSERT INTO inventory (item_name, quantity, category_id, status, image, unit, sale_price, tax_percent, description, tag_names, upc, store_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item_name, quantity, category_id, status, savedImage, unit, sale_price, tax_percent, description, tag_names, upc || null, user.store_id);

    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run('CREATE', `Added item ${item_name}`, user.id, user.store_id);

    res.json({ id: info.lastInsertRowid });
  } catch (err: any) {
    console.error('[]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

app.put('/api/inventory/:id', authenticateToken, requireOwner, (req: any, res) => {
  const { item_name, quantity, category_id, status, unit, sale_price, tax_percent, description, tag_names, image, upc } = req.body;
  const { id } = req.params;
  const user = req.user;

  try {
    const savedImage = image ? saveBase64Image(image) : null;
    db.prepare(`
      UPDATE inventory
      SET item_name = ?, quantity = ?, category_id = ?, status = ?, unit = ?, sale_price = ?, tax_percent = ?,
          description = ?, tag_names = ?, image = COALESCE(?, image),
          upc = COALESCE(NULLIF(?, ''), upc), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).run(item_name, quantity, category_id, status, unit, sale_price, tax_percent, description, tag_names, savedImage, upc || null, id, user.store_id);

    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run('UPDATE', `Updated item ${id}`, user.id, user.store_id);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

app.delete('/api/inventory/:id', authenticateToken, requireOwner, (req: any, res) => {
  const { id } = req.params;
  const user = req.user;

  db.prepare('DELETE FROM inventory WHERE id = ? AND store_id = ?').run(id, user.store_id);
  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
    .run('DELETE', `Deleted item ${id}`, user.id, user.store_id);

  res.json({ success: true });
});

// Batch Import
app.post('/api/inventory/batch', authenticateToken, requireOwner, (req: any, res) => {
  const { items } = req.body;
  const user = req.user;
  const results = { added: 0, updated: 0, errors: [] as string[] };

  const defaultCat = db.prepare('SELECT id FROM categories WHERE store_id = ? LIMIT 1').get(user.store_id) as any;
  const defaultCatId = defaultCat ? defaultCat.id : 1;

  const insertStmt = db.prepare(`
    INSERT INTO inventory (item_name, quantity, upc, number, tag_names, category_id, description, store_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE upc = ? AND store_id = ?');
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
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run('BATCH', `Processed ${items.length} items`, user.id, user.store_id);
    res.json(results);
  } catch (err: any) {
    console.error('[]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Server info
function getTunnelUrl(): string | null {
  const tunnelFile = path.join(__dirname, '.tunnel-url');
  try {
    if (fs.existsSync(tunnelFile)) {
      const url = fs.readFileSync(tunnelFile, 'utf8').trim();
      if (url.startsWith('https://')) return url;
    }
  } catch {}
  return null;
}

app.get('/api/server-info', authenticateToken, (_req, res) => {
  const ip = getLocalIP();
  const protocol = (app as any).protocol || 'http';
  const lanUrl = `${protocol}://${ip}:${PORT}`;
  const tunnelUrl = getTunnelUrl();
  res.json({
    ip,
    port: PORT,
    protocol,
    mobileUrl: tunnelUrl ?? lanUrl,
    tunnelUrl: tunnelUrl ?? null,
  });
});

// C-4: Use CSPRNG for both session IDs and OTPs
function generateOTP(length = 6): string {
  return randomBytes(4).readUInt32BE(0).toString(10).slice(-length).padStart(length, '0');
}

app.post('/api/session/create', authenticateToken, (req: any, res) => {
  const sessionId = randomUUID(); // C-4: cryptographically random
  const otp = generateOTP(6);
  db.prepare('INSERT INTO scan_sessions (session_id, otp, user_id, store_id, expires_at) VALUES (?, ?, ?, ?, datetime("now", "+2 hours"))')
    .run(sessionId, otp, req.user.id, req.user.store_id);
  res.json({ sessionId, otp });
});

async function lookupProductByUpc(upc: string) {
  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) return null;

  try {
    const offRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanUpc)}.json`, {
      headers: { 'User-Agent': 'OptiCapture/1.0' },
    });

    if (offRes.ok) {
      const offData = await offRes.json() as any;
      const product = offData?.product;

      if (product) {
        const productName = product.product_name?.trim() || product.product_name_en?.trim() || null;
        const brand = typeof product.brands === 'string' && product.brands.trim()
          ? product.brands.split(',')[0].trim()
          : null;
        const image = product.image_front_url || product.image_url || null;

        if (productName) {
          return { product_name: productName, brand, image, source: 'open_food_facts' };
        }
      }
    }
  } catch (error) {
    console.warn('Open Food Facts lookup failed:', error);
  }

  try {
    const apiKey = process.env.UPCITEMDB_API_KEY;
    if (apiKey) {
      const upcRes = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(cleanUpc)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (upcRes.ok) {
        const upcData = await upcRes.json() as any;
        const item = upcData?.items?.[0];

        if (item?.title) {
          return {
            product_name: item.title?.trim() || null,
            brand: item.brand?.trim() || null,
            image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
            source: 'upcitemdb',
          };
        }
      }
    }
  } catch (error) {
    console.warn('UPCitemDB lookup failed:', error);
  }

  return null;
}

app.get('/api/session/:id', authenticateToken, (req: any, res) => {
  const { id } = req.params;
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const items = db.prepare(`
    SELECT si.id, si.session_id, si.upc, si.quantity, si.scanned_at,
           si.lookup_status, si.product_name, si.brand, si.image,
           si.source, si.exists_in_inventory
    FROM session_items si
    WHERE si.session_id = ?
    ORDER BY si.scanned_at DESC
  `).all(id);
  res.json(items);
});

app.post('/api/session/:id/scan', async (req, res) => {
  const { id } = req.params;
  const { upc, otp, item_name } = req.body;

  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) {
    return res.status(400).json({ error: 'UPC is required' });
  }

  const session = db.prepare(
    "SELECT * FROM scan_sessions WHERE session_id = ? AND status = 'active'"
  ).get(id) as any;

  if (!session) {
    return res.status(404).json({ error: 'Session not found or inactive' });
  }

  // Check session expiry
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Session has expired. Please start a new session.' });
  }

  // Check OTP attempts
  if (session.otp_attempts >= 5) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Please start a new session.' });
  }

  // If OTP doesn't match, increment attempts
  if (!otp || otp !== session.otp) {
    db.prepare('UPDATE scan_sessions SET otp_attempts = otp_attempts + 1 WHERE session_id = ?').run(session.session_id);
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  const inventoryMatch = db.prepare(`
    SELECT id, item_name, image FROM inventory WHERE upc = ? AND store_id = ? LIMIT 1
  `).get(cleanUpc, session.store_id) as any;

  const existingSessionItem = db.prepare(`
    SELECT * FROM session_items WHERE session_id = ? AND upc = ?
  `).get(id, cleanUpc) as any;

  let lookupStatus = 'unknown';
  let productName: string | null = null;
  let brand: string | null = null;
  let image: string | null = null;
  let source = 'scan_only';
  let existsInInventory = 0;

  if (inventoryMatch) {
    lookupStatus = 'existing';
    productName = inventoryMatch.item_name || null;
    image = inventoryMatch.image || null;
    source = 'inventory';
    existsInInventory = 1;
  } else {
    const lookupResult = await lookupProductByUpc(cleanUpc);
    if (lookupResult?.product_name) {
      lookupStatus = 'new_candidate';
      productName = lookupResult.product_name;
      brand = lookupResult.brand || null;
      image = lookupResult.image || null;
      source = lookupResult.source || 'lookup';
    }
    // Use manually entered item name as fallback when lookup finds nothing
    if (!productName && item_name) {
      productName = String(item_name).trim() || null;
      if (productName) lookupStatus = 'new_candidate';
    }
  }

  if (existingSessionItem) {
    db.prepare(`
      UPDATE session_items
      SET quantity = quantity + 1, scanned_at = CURRENT_TIMESTAMP,
          lookup_status = ?, product_name = COALESCE(?, product_name),
          brand = COALESCE(?, brand), image = COALESCE(?, image),
          source = ?, exists_in_inventory = ?
      WHERE id = ?
    `).run(lookupStatus, productName, brand, image, source, existsInInventory, existingSessionItem.id);
  } else {
    db.prepare(`
      INSERT INTO session_items (session_id, upc, quantity, lookup_status, product_name, brand, image, source, exists_in_inventory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanUpc, 1, lookupStatus, productName, brand, image, source, existsInInventory);
  }

  const updatedItem = db.prepare(`
    SELECT id, session_id, upc, quantity, scanned_at, lookup_status, product_name, brand, image, source, exists_in_inventory
    FROM session_items WHERE session_id = ? AND upc = ?
  `).get(id, cleanUpc);

  res.json({ success: true, item: updatedItem });
});

app.patch('/api/session/:id/items/:itemId', authenticateToken, (req: any, res) => {
  const { id, itemId } = req.params;
  const { product_name, brand, quantity, upc, image, tag_names, sale_price, unit } = req.body;

  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`
    UPDATE session_items
    SET product_name = ?, brand = ?, quantity = ?, upc = COALESCE(?, upc),
        image = ?, tag_names = ?, sale_price = ?, unit = ?, lookup_status = 'new_candidate'
    WHERE id = ? AND session_id = ?
  `).run(product_name || null, brand || null, quantity || 1, upc || null, image || null, tag_names || null, sale_price || null, unit || null, itemId, id);

  res.json({ success: true });
});

app.delete('/api/session/:id/items/:itemId', authenticateToken, (req: any, res) => {
  const { id, itemId } = req.params;
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, req.user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM session_items WHERE id = ? AND session_id = ?').run(itemId, id);
  res.json({ success: true });
});

app.post('/api/session/:id/commit', authenticateToken, (req: any, res) => {
  const { id } = req.params;
  const { selectedIds, category_id } = req.body as { selectedIds?: number[]; category_id?: number };
  const user = req.user;

  if (!category_id) return res.status(400).json({ error: 'category_id is required' });

  // H-6: Verify session belongs to this store
  const session = db.prepare("SELECT * FROM scan_sessions WHERE session_id = ? AND store_id = ?")
    .get(id, user.store_id) as any;
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Verify category belongs to this store
  const cat = db.prepare('SELECT id, name FROM categories WHERE id = ? AND store_id = ?').get(category_id, user.store_id) as any;
  if (!cat) return res.status(400).json({ error: 'Invalid category' });

  const allItems = db.prepare('SELECT * FROM session_items WHERE session_id = ?').all(id) as any[];
  const items = selectedIds?.length
    ? allItems.filter((item: any) => selectedIds.includes(item.id))
    : allItems;

  if (items.length === 0) {
    return res.json({ message: 'No items to commit' });
  }

  const resolvedCategoryId = category_id;
  const insertInventory = db.prepare(`
    INSERT INTO inventory (item_name, upc, quantity, category_id, status, image, sale_price, unit, store_id)
    VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)
  `);
  const checkInventory = db.prepare('SELECT * FROM inventory WHERE upc = ? AND store_id = ?');

  const transaction = db.transaction((sessionItems: any[]) => {
    let inserted = 0;
    let skippedExisting = 0;
    let skippedUnknown = 0;

    for (const item of sessionItems) {
      const invItem = checkInventory.get(item.upc, user.store_id);

      if (invItem) {
        skippedExisting++;
        continue;
      }

      if (item.lookup_status !== 'new_candidate') {
        skippedUnknown++;
        continue;
      }

      insertInventory.run(
        item.product_name || 'Unknown Scanned Item',
        item.upc,
        item.quantity,
        resolvedCategoryId,
        item.image || null,
        item.sale_price ? parseFloat(item.sale_price) : null,
        item.unit || null,
        user.store_id
      );
      inserted++;
    }

    db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(id);

    return { inserted, skippedExisting, skippedUnknown };
  });

  try {
    const result = transaction(items);
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run(
        'BATCH',
        `Committed remote session ${id} to category "${cat.name}" | inserted=${result.inserted} skippedExisting=${result.skippedExisting} skippedUnknown=${result.skippedUnknown}`,
        user.id,
        user.store_id
      );

    res.json({
      success: true,
      total: items.length,
      inserted: result.inserted,
      skippedExisting: result.skippedExisting,
      skippedUnknown: result.skippedUnknown
    });
  } catch (err: any) {
    console.error('[session:commit]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Batch Upload — parse ALL sheets, return headers + preview + full rows per sheet
app.post('/api/inventory/batch-upload', authenticateToken, requireOwner, upload.single('file'), (req: any, res) => {
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
    return res.status(400).json({ error: 'Invalid file type. Only Excel, CSV, and JSON files are allowed.' });
  }

  const isJson = req.file.originalname?.toLowerCase().endsWith('.json') ||
    req.file.mimetype === 'application/json';

  try {
    if (isJson) {
      const parsed = JSON.parse(req.file.buffer.toString('utf8'));
      // Support both raw array and our export format { items: [...] }
      const rows: Record<string, any>[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      if (rows.length === 0) return res.status(400).json({ error: 'JSON file has no items' });
      const sheets = [{
        name: 'Inventory',
        headers: Object.keys(rows[0]),
        preview: rows.slice(0, 5),
        rows,
        rowCount: rows.length,
      }];
      return res.json({ sheets, totalRows: rows.length });
    }

    const workbook = xlsxRead(req.file.buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames.map(name => {
      const rows: Record<string, any>[] = xlsxUtils.sheet_to_json(workbook.Sheets[name], { defval: '' });
      return {
        name,
        headers: rows.length > 0 ? Object.keys(rows[0]) : [],
        preview: rows.slice(0, 5),
        rows,
        rowCount: rows.length,
      };
    }).filter(s => s.rowCount > 0);

    if (sheets.length === 0) return res.status(400).json({ error: 'File is empty or has no data rows' });

    res.json({ sheets, totalRows: sheets.reduce((n, s) => n + s.rowCount, 0) });
  } catch (err: any) {
    console.error('[import:upload]', err);
    res.status(400).json({ error: 'Could not parse file. Ensure it is a valid XLSX, CSV, or JSON.' });
  }
});

// Batch Confirm — full sync with per-sheet column mapping
// Accepts JSON body: { sheetsData: [{ sheetName, rows, mapping }] }
// M-3: Only this route needs large payloads (full sheet rows)
app.post('/api/inventory/batch-confirm', authenticateToken, requireOwner, express.json({ limit: '50mb' }), (req: any, res) => {
  const { sheetsData } = req.body as {
    sheetsData: { sheetName: string; rows: Record<string, any>[]; mapping: Record<string, string> }[];
  };
  if (!sheetsData?.length) return res.status(400).json({ error: 'No sheets data provided' });

  const user = req.user;
  const results = {
    added: 0, updated: 0, skipped: 0,
    errors: [] as string[],
    skipped_rows: [] as { row_num: number; sheet: string; item_name: string }[],
  };

  const categoryIconMap: Record<string, string> = {
    beverages: '/icons/soft-drinks.png', drinks: '/icons/soft-drinks.png', soda: '/icons/soft-drinks.png', 'soft drinks': '/icons/soft-drinks.png',
    water: '/icons/water.png',
    juice: '/icons/juice-tea-lemonade.png', tea: '/icons/juice-tea-lemonade.png', lemonade: '/icons/juice-tea-lemonade.png', 'juice, tea & lemonade': '/icons/juice-tea-lemonade.png',
    'energy drinks': '/icons/energy-drink.png', 'energy drink': '/icons/energy-drink.png', energy: '/icons/energy-drink.png',
    'sports drinks': '/icons/sports-drink.png', 'sports drink': '/icons/sports-drink.png',
    wine: '/icons/beer-wine.png', beer: '/icons/beer-wine.png', 'wine & beer': '/icons/beer-wine.png', spirits: '/icons/beer-wine.png', alcohol: '/icons/beer-wine.png', liquor: '/icons/beer-wine.png',
    'cold coffee': '/icons/cold-coffee.png', coffee: '/icons/cold-coffee.png', 'iced coffee': '/icons/cold-coffee.png',
    milk: '/icons/dairy.png', dairy: '/icons/dairy.png',
    snacks: '/icons/snack.png', chips: '/icons/snack.png',
    'nutrition & snacks': '/icons/nutrition-snacks.png', nutrition: '/icons/nutrition-snacks.png',
    candy: '/icons/candy.png', sweets: '/icons/candy.png', chocolate: '/icons/candy.png', confectionery: '/icons/candy.png',
    'gum & mints': '/icons/gum-mint.png', gum: '/icons/gum-mint.png', mints: '/icons/gum-mint.png',
    bakery: '/icons/pastry.png', bread: '/icons/pastry.png', pastry: '/icons/pastry.png', pastries: '/icons/pastry.png',
    newspaper: '/icons/newspaper.png', newspapers: '/icons/newspaper.png', magazines: '/icons/newspaper.png', press: '/icons/newspaper.png',
    frozen: '/icons/frozen-food.png', 'frozen food': '/icons/frozen-food.png', 'frozen foods': '/icons/frozen-food.png',
    grocery: '/icons/grocery.png', food: '/icons/grocery.png', groceries: '/icons/grocery.png',
    tobacco: 'Cigarette', cigarettes: 'Cigarette', vaping: 'Cigarette',
    'non-tobacco': '/icons/non-tobacco.png', 'non tobacco': '/icons/non-tobacco.png',
    'household items': '/icons/household-items.png', household: '/icons/household-items.png', cleaning: '/icons/household-items.png',
    automotive: '/icons/automotive.png', auto: '/icons/automotive.png', vehicles: '/icons/automotive.png',
    electronics: '/icons/electronics.png', tech: '/icons/electronics.png', phones: '/icons/electronics.png',
    'personal care': '/icons/personal-care.png', beauty: '/icons/personal-care.png', salon: '/icons/personal-care.png', hygiene: '/icons/personal-care.png',
    pets: '/icons/pet-food.png', 'pet supplies': '/icons/pet-food.png', 'pet food': '/icons/pet-food.png', animals: '/icons/pet-food.png',
    clothing: 'Shirt', apparel: 'Shirt', fashion: 'Shirt',
    health: 'Pill', pharmacy: 'Pill', medicine: 'Pill', vitamins: 'Pill',
    baby: 'Baby', 'baby care': 'Baby',
    fitness: 'Dumbbell', sports: 'Dumbbell', gym: 'Dumbbell',
    books: 'Book', school: 'Book', office: 'Briefcase',
    gifts: 'Gift', toys: 'Gift', games: 'Gamepad2',
    garden: 'Leaf', plants: 'LeafyGreen', flowers: 'Flower2',
  };

  const getCategoryId = (name: string): number | null => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const existing = db.prepare('SELECT id FROM categories WHERE name = ? AND store_id = ?').get(trimmed, user.store_id) as any;
    if (existing) return existing.id;
    const icon = categoryIconMap[trimmed.toLowerCase()] ?? 'Package';
    const info = db.prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)').run(trimmed, icon, user.store_id);
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

        const upc    = String(item.upc    || '').trim();
        const number = String(item.number || '').trim();
        if (!upc && !number) {
          results.skipped++;
          const rawName = String(item.item_name || '').trim()
            || Object.values(row).map(v => String(v).trim()).find(v => v !== '')
            || '(blank)';
          results.skipped_rows.push({ row_num: rowIdx + 2, sheet: sheet.sheetName, item_name: rawName });
          continue;
        }

        // Default quantity = 50 when blank or unmapped
        const qty = (item.quantity !== undefined && String(item.quantity).trim() !== '')
          ? parseFloat(String(item.quantity)) || 50
          : 50;

        const salePrice = parseFloat(String(item.sale_price  || '')) || null;
        const taxPct    = parseFloat(String(item.tax_percent || '')) || null;
        const status    = String(item.status   || 'Active').trim() || 'Active';
        const itemName  = String(item.item_name || '').trim();
        const desc      = String(item.description || '').trim();
        const unit      = String(item.unit || '').trim();
        const tags      = String(item.tag_names || '').trim();
        const rawImage  = String(item.image || '').trim();
        const image     = rawImage ? normalizeImageUrl(rawImage) : null;

        const existing: any = (upc ? checkUpc.get(upc, user.store_id) : null)
                           ?? (number ? checkNum.get(number, user.store_id) : null);

        try {
          if (existing) {
            updateStmt.run(itemName, qty, unit, salePrice, taxPct, tags, catId, status, image, existing.id, user.store_id);
            results.updated++;
          } else {
            insertStmt.run(
              itemName || 'Unknown', desc, qty, unit, salePrice, taxPct,
              upc || null, number || null, tags, catId, status, image, user.store_id
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
    const skippedSummary = results.skipped_rows.length > 0
      ? ` | skipped:${JSON.stringify(results.skipped_rows)}`
      : '';
    db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)')
      .run('IMPORT', `Imported ${totalRows} rows across ${sheetsData.length} sheet(s): +${results.added} new, ~${results.updated} updated, ${results.skipped} skipped${skippedSummary}`, user.id, user.store_id);
    res.json(results);
  } catch (err: any) {
    console.error('[]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Logs
app.get('/api/logs', authenticateToken, (req: any, res) => {
  const storeId = req.user.store_id;
  const logs = db.prepare(`
    SELECT logs.*, users.username
    FROM logs
    JOIN users ON logs.user_id = users.id
    WHERE logs.store_id = ?
    ORDER BY timestamp DESC
    LIMIT 100
  `).all(storeId);
  res.json(logs);
});

// HTTPS certificate helper
function getHttpsOptions() {
  const devKeyPath = path.join(__dirname, 'dev-key.pem');
  const devCertPath = path.join(__dirname, 'dev-cert.pem');

  if (fs.existsSync(devKeyPath) && fs.existsSync(devCertPath)) {
    console.log('✓ Using SSL certificates (dev-key.pem / dev-cert.pem)');
    return {
      key: fs.readFileSync(devKeyPath),
      cert: fs.readFileSync(devCertPath)
    };
  }

  return null;
}

// Vite Middleware + Server Start
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

  let protocol = 'http';
  const httpsOptions = getHttpsOptions();

  try {
    if (httpsOptions) {
      protocol = 'https';
      https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
        console.log(`🔒 HTTPS Server running on https://localhost:${PORT}`);
        console.log(`🔒 HTTPS Server running on https://127.0.0.1:${PORT}`);
        console.log(`✓ Camera scanning enabled via HTTPS`);
      });
    } else {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`🔓 HTTP Server running on http://localhost:${PORT}`);
        console.log(`ℹ No SSL cert files found. HTTPS is required for camera scanning.`);
      });
    }
  } catch (err: any) {
    console.log(`ℹ HTTPS setup failed, using HTTP: ${err.message}`);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  (app as any).protocol = protocol;
}

startServer();
