# OptiCapture — Technical Reference

> For engineering collaborators. Covers architecture, data model, API contracts,
> session lifecycle, security posture, and known trade-offs.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [Local Setup](#4-local-setup)
5. [Architecture](#5-architecture)
6. [Database Schema](#6-database-schema)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Scan Session Lifecycle](#8-scan-session-lifecycle)
9. [UPC Resolution Pipeline](#9-upc-resolution-pipeline)
10. [API Reference](#10-api-reference)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Batch Import Pipeline](#12-batch-import-pipeline)
13. [Security Posture](#13-security-posture)
14. [Performance Characteristics](#14-performance-characteristics)
15. [Key Files to Review](#15-key-files-to-review)
16. [Technical Debt & Roadmap](#16-technical-debt--roadmap)

---

## 1. Project Overview

OptiCapture is a **retail inventory management system** built for small to mid-size stores. Its core differentiator is a **mobile-assisted barcode scanning workflow**: an operator opens a desktop session, a QR code appears, store staff scan products with their phones — and items populate in real time on the desktop without any app install.

**Key capabilities:**
- Multi-store, multi-role user model (owner / taker / superadmin)
- OTP-gated mobile scan sessions (no mobile login required)
- Real-time polling with async UPC product lookup
- Named draft sessions — pause, rename, resume, hand off between staff
- Batch inventory import via XLSX / CSV / JSON with column mapping
- Export to XLSX, CSV, JSON, PDF
- Google OAuth with email auto-link guard
- Superadmin panel for full multi-tenant management

---

## 2. Repository Layout

```
OptiCapture/
├── server.ts                  # Entire Express backend (~2,000 LOC)
├── src/
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # Router + route guards
│   ├── context/
│   │   └── AuthContext.tsx    # Global auth state + store switching
│   ├── pages/
│   │   ├── Dashboard.tsx      # Inventory hub (categories, items, export)
│   │   ├── Scan.tsx           # Session management + real-time polling
│   │   ├── Import.tsx         # 3-step batch import wizard
│   │   ├── Logs.tsx           # Activity audit log
│   │   ├── StoreSettings.tsx  # Store profile + password change
│   │   ├── SuperAdmin.tsx     # Multi-tenant admin panel
│   │   ├── Login.tsx          # Credential + OAuth login
│   │   ├── Signup.tsx         # Store + owner registration
│   │   └── MobileScan.tsx     # Phone-side QR scan UI
│   ├── components/
│   │   └── Layout.tsx         # Sidebar + top header shell
│   └── lib/
│       ├── utils.ts           # cn() Tailwind merge helper
│       └── constants.ts       # US states list
├── Public/
│   └── icons/                 # 24 PNG category icons
├── docs/
│   ├── TECHNICAL.md           # This file
│   └── ARCHITECTURE.md        # High-level diagram prose
├── .github/workflows/ci.yml   # Type-check + build CI
├── vite.config.ts
├── tsconfig.json
├── package.json
└── .npmrc                     # legacy-peer-deps=true (ESLint peer dep fix)
```

---

## 3. Tech Stack

| Layer | Library | Version | Notes |
|-------|---------|---------|-------|
| Runtime | Node.js | ≥ 20 | ESM-compatible via tsx |
| Backend | Express | 4.21 | Monolithic single-file server |
| Database | better-sqlite3 | 12.4 | Synchronous driver; WAL mode |
| Auth | jsonwebtoken | 9.0 | HS256, 8-hour TTL, httpOnly cookie |
| Password | bcryptjs | 3.0 | 10 rounds |
| Security | helmet | 8.1 | CSP, HSTS, frame guards |
| Rate Limiting | express-rate-limit | 8.3 | Three-tier (auth / API / scan) |
| OAuth | google-auth-library | 10.6 | ID token verification |
| File Upload | multer | 2.1 | In-memory buffer |
| Excel | xlsx | 0.18 | Parse + generate XLSX |
| PDF | pdfkit | 0.18 | Grouped inventory export |
| Frontend | React + TypeScript | 19 + 5.8 | react-jsx transform |
| Router | react-router-dom | 7.13 | Client-side SPA routing |
| Build | Vite | 6.2 | HMR, lazy route splitting |
| Styling | Tailwind CSS | 4.1 | JIT via @tailwindcss/vite |
| Animation | Motion | 12.23 | Framer Motion fork |
| Icons | lucide-react | 0.546 | 50+ icons |

---

## 4. Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Required env vars — create a .env file
JWT_SECRET=<at-least-32-char-secret>
GOOGLE_CLIENT_ID=<optional, for OAuth>
GOOGLE_CLIENT_SECRET=<optional, for OAuth>
UPCITEMDB_API_KEY=<optional, fallback UPC lookup>

# 3. Start full-stack dev (Vite:5173 + Express:3000 + HTTPS certs)
npm run dev

# 4. Start with CloudFlare tunnel (mobile scanning from external network)
npm run dev:scan

# 5. Type-check
npm run lint

# 6. Production build
npm run build
```

**Dev proxy:** Vite forwards `/api/*` to `http://localhost:3000` — no CORS issues in dev.

**HTTPS in dev:** `generate-certs.js` creates self-signed `dev-key.pem` / `dev-cert.pem` for local HTTPS. Required for camera access on mobile browsers.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Desktop)                       │
│  React SPA (Vite:5173 dev / dist/ prod)                     │
│  AuthContext → JWT in httpOnly cookie                        │
└────────────────────────┬────────────────────────────────────┘
                         │ /api/* (proxied in dev)
┌────────────────────────▼────────────────────────────────────┐
│                   Express Server (:3000)                     │
│                                                             │
│  Middleware stack:                                          │
│    helmet → cookieParser → cors → rateLimit →              │
│    authenticateToken → requireOwner (route-level)          │
│                                                             │
│  Routes:  /api/auth/*   /api/inventory/*                   │
│           /api/session/* /api/admin/*                      │
│           /api/dashboard/* /api/logs/*                     │
│           /api/categories/* /api/store/*                   │
└────────────────────────┬────────────────────────────────────┘
                         │ better-sqlite3 (synchronous)
┌────────────────────────▼────────────────────────────────────┐
│                   SQLite (WAL mode)                         │
│   opticapture.db — single file, ~100KB per 100 items        │
└─────────────────────────────────────────────────────────────┘

                ┌────────────────────┐
                │   Mobile Browser   │  ← scans QR code
                │  MobileScan.tsx    │
                │  POST /api/session │  ← OTP-only, no login
                │       /:id/scan    │
                └────────────────────┘
```

**Multi-tenancy model:** Every DB query is filtered by `store_id` drawn from the validated JWT. Superadmin uses `store_id = 0` as a sentinel and bypasses store-scope filters.

---

## 6. Database Schema

### Tables

#### `stores`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
plan_tier TEXT DEFAULT 'starter'      -- starter | professional | internal
status TEXT DEFAULT 'active'          -- active | suspended
street, zipcode, state, address
logo TEXT                             -- base64 or URL
phone, email
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

#### `users`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
username TEXT UNIQUE NOT NULL
password TEXT                         -- bcrypt hash; NULL for pure-OAuth accounts
role TEXT NOT NULL                    -- owner | taker | superadmin
store_id INTEGER                      -- primary store; 0 for superadmin
store_name TEXT                       -- denormalized for JWT
email TEXT
oauth_provider TEXT                   -- 'google' or NULL
oauth_id TEXT                         -- UNIQUE (provider, id) pair
failed_login_attempts INTEGER DEFAULT 0
locked_until DATETIME
```

#### `user_stores`
```sql
user_id INTEGER REFERENCES users(id)
store_id INTEGER REFERENCES stores(id)
role TEXT NOT NULL                    -- owner | taker
PRIMARY KEY (user_id, store_id)
```
> Junction table enabling multi-store access. A user can be owner of store A and taker at store B.

#### `categories`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
icon TEXT                             -- Lucide icon name or /Public/icons/ path
status TEXT DEFAULT 'Active'          -- Active | Inactive
store_id INTEGER REFERENCES stores(id)
UNIQUE(name, store_id)
```

#### `inventory`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
item_name TEXT NOT NULL              -- max 500 chars
description TEXT                     -- max 2000 chars
quantity INTEGER DEFAULT 0
unit TEXT DEFAULT 'each'
category_id INTEGER REFERENCES categories(id)
status TEXT DEFAULT 'In Stock'
sale_price REAL
tax_percent REAL DEFAULT 0
image TEXT                           -- /uploads/{uuid}.{ext}
upc TEXT
number TEXT                          -- SKU / internal number
tag_names TEXT                       -- comma-separated
store_id INTEGER REFERENCES stores(id)
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
UNIQUE(upc, store_id)
UNIQUE(number, store_id) WHERE number IS NOT NULL
```

#### `scan_sessions`
```sql
session_id TEXT PRIMARY KEY          -- UUID v4
otp TEXT NOT NULL                    -- 8-char alphanumeric (CSPRNG)
user_id INTEGER REFERENCES users(id)
store_id INTEGER REFERENCES stores(id)
status TEXT DEFAULT 'active'         -- active | draft | completed
label TEXT                           -- user-assigned name (e.g. "Morning · Aisle 3")
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
expires_at DATETIME                  -- 8 hours from creation/last scan
otp_attempts INTEGER DEFAULT 0      -- 5-strike OTP lockout
```

#### `session_items`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
session_id TEXT REFERENCES scan_sessions(session_id)
upc TEXT NOT NULL
quantity INTEGER DEFAULT 1
scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
lookup_status TEXT DEFAULT 'unknown' -- unknown | new_candidate | existing
product_name TEXT
brand TEXT
image TEXT
source TEXT   -- scan_only | open_food_facts | upcitemdb | inventory | manual
exists_in_inventory INTEGER DEFAULT 0
sale_price REAL
unit TEXT
tag_names TEXT
```

#### `logs`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
action TEXT NOT NULL  -- CREATE | UPDATE | DELETE | IMPORT | BATCH | EXPORT | LOGIN
details TEXT
user_id INTEGER
store_id INTEGER
timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
```

#### `schema_migrations`
```sql
version INTEGER PRIMARY KEY
```

### Indexes
```sql
idx_session_items_session_upc    ON session_items(session_id, upc)
idx_session_items_session_at     ON session_items(session_id, scanned_at DESC)
idx_inventory_upc_store          ON inventory(upc, store_id)
idx_scan_sessions_store_status   ON scan_sessions(store_id, status, expires_at)
idx_inventory_number_store       ON inventory(number, store_id) WHERE number IS NOT NULL
idx_users_oauth                  ON users(oauth_provider, oauth_id) WHERE both non-null
```

### Migration Pattern

Migrations use a `runMigration(version, fn)` helper that wraps each change in a check against `schema_migrations`. Safe to re-run; idempotent.

```typescript
runMigration(7, () => {
  const cols = db.prepare('PRAGMA table_info(scan_sessions)').all();
  if (!cols.find(c => c.name === 'label'))
    db.prepare("ALTER TABLE scan_sessions ADD COLUMN label TEXT DEFAULT NULL").run();
});
```

8 migrations defined at server startup. New columns are added via `ALTER TABLE ... ADD COLUMN`.

---

## 7. Authentication & Authorization

### JWT Flow

```
POST /api/auth/login
  → validate credentials / OAuth token
  → issueJwt(user)  →  Set-Cookie: token=<jwt>; httpOnly; secure; sameSite
  → return user object (no token in body)

Subsequent requests
  → authenticateToken middleware reads cookie
  → verifies HS256 signature + issuer/audience
  → checks store status (suspended → 401)
  → attaches req.user = { id, username, role, store_id, store_name }
```

**JWT claims:**
```json
{
  "sub": "42",
  "username": "jane",
  "role": "owner",
  "store_id": 7,
  "store_name": "Main St Store",
  "iss": "opticapture",
  "aud": "opticapture-client",
  "exp": "<8 hours>"
}
```

### Role Guards

| Middleware | Passes | Blocks |
|-----------|--------|--------|
| `authenticateToken` | Any valid JWT | Expired / invalid / suspended store |
| `requireOwner` | role = owner or superadmin | role = taker |

Routes that use `requireOwner`: inventory write (POST/PUT/DELETE), session commit, store settings write, all admin endpoints.

### Account Lockout

- 5 consecutive failed logins → `locked_until = NOW + 15 minutes`
- Lock cleared on: successful login, superadmin password reset, or user changes their own password
- Response: `{ error: 'Account locked. Try again in X minutes.' }`

### Google OAuth

```
GET /api/auth/google              → redirect to Google consent screen
GET /api/auth/google/callback     → verify state nonce (CSRF), exchange code
  → verify ID token with google-auth-library
  → lookup user by oauth_id; if missing, try email auto-link:
      only if payload.email_verified AND existing user has no password
  → if still no user, store pending profile in memory (10-min TTL)
  → redirect to /login?linked=1 or /login?pending=1
```

### Store Switching

Calling `POST /api/auth/switch-store` with `{ storeId }` reissues the JWT scoped to the target store. The user must have an entry in `user_stores` for that store. Frontend reloads to flush all cached state.

### Mobile OTP Auth

Mobile clients never log in. They authenticate using `sessionId + OTP`:

- OTP: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars I/O/1/0)
- Entropy: 32^8 ≈ 2^40 combinations
- Rate limited: 60 req/min per IP on scan endpoints
- OTP lockout: 5 wrong attempts → session locked

---

## 8. Scan Session Lifecycle

```
OWNER (Desktop)                     STAFF (Mobile Phone)
─────────────────────────────────   ─────────────────────────
POST /api/session/create
  ← { sessionId, otp }
Render QR code (sessionId+otp)      Scan QR code
                                    POST /api/session/:id/scan
                                      body: { upc, otp }
                                      ← 200 OK immediately
                                      [background: UPC lookup]

GET /api/session/:id?since=T  ──────────── polling every 1–3s
  ← { items: [...], expires_at }
  (delta updates via `since` param)

[User reviews items]
PATCH /api/session/:id/status       [Staff saves draft]
  body: { status: 'draft',
          label: 'Morning · Aisle 3' }

[Owner resumes, reviews]
POST /api/session/:id/commit
  body: { selectedIds: [1,2,3], category_id: 5 }
  ← { inserted, skippedExisting, skippedUnknown }

Session status → 'completed'
```

### Session Reuse

If the authenticated user already has an **empty active session** (no items, same store), `POST /api/session/create` reuses it instead of creating a duplicate. If the existing OTP is the old 6-digit format, it is regenerated transparently.

### Named Drafts

```
PATCH /api/session/:id/status
  { status: 'draft', label: 'Aisle 3 · Mon 9am' }
```

`label` uses `COALESCE(?, label)` so it only updates when explicitly provided. Dashboard displays the label on each session card so multiple concurrent drafts are distinguishable.

### Commit Transaction Logic

```typescript
db.transaction(() => {
  for (const item of selectedItems) {
    if (item.lookup_status !== 'new_candidate') continue;  // skip unknowns
    const existing = db.prepare('SELECT id FROM inventory WHERE upc = ? AND store_id = ?')
                       .get(item.upc, storeId);
    if (existing) continue;  // skip already-in-inventory
    db.prepare('INSERT INTO inventory (...) VALUES (...)').run(item);
  }
  db.prepare("UPDATE scan_sessions SET status = 'completed' WHERE session_id = ?").run(sessionId);
})();
```

---

## 9. UPC Resolution Pipeline

Each scan triggers this lookup chain:

```
1. Check inventory table (upc, store_id) ─── instant
       ↓ miss
2. Check in-memory UPC cache (7-day TTL) ─── instant
       ↓ miss
3. POST /api/session/:id/scan returns 200 immediately
       ↓ (background promise)
4. Fetch Open Food Facts API
       ↓ miss or unavailable
5. Fetch UPCitemDB API (if UPCITEMDB_API_KEY set)
       ↓ result or null
6. Update session_item in DB
7. Store result in upcCache (even nulls — prevents re-hammering)
```

**Why async?** External UPC APIs can take 2–3 seconds. The mobile client can't block on that — it needs to confirm the scan immediately so staff can move on. The desktop sees updated metadata on the next polling interval.

**Cache invalidation:** When an inventory item is updated via `PUT /api/inventory/:id`, the server deletes its UPC entry from `upcCache` so the next lookup gets fresh data.

---

## 10. API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Login (credentials or OAuth pending) |
| POST | `/api/auth/register` | — | Register new store + owner |
| POST | `/api/auth/logout` | Cookie | Clear JWT cookie |
| GET | `/api/auth/me` | Cookie | Get current user |
| GET | `/api/auth/my-stores` | Cookie | List accessible stores |
| POST | `/api/auth/switch-store` | Cookie | Reissue JWT for different store |
| GET | `/api/auth/google` | — | Begin OAuth flow |
| GET | `/api/auth/google/callback` | — | OAuth callback |

### Inventory

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/inventory` | Cookie | List items (`?category_id=&q=`) |
| POST | `/api/inventory` | Owner | Create item |
| PUT | `/api/inventory/:id` | Owner | Update item + invalidate UPC cache |
| DELETE | `/api/inventory/:id` | Owner | Delete item |
| POST | `/api/inventory/export` | Cookie | Export (body: `{ format: 'xlsx'\|'csv'\|'json'\|'pdf' }`) |
| POST | `/api/inventory/batch-upload` | Owner | Parse file → preview |
| POST | `/api/inventory/batch-confirm` | Owner | Commit mapped import |

### Scan Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/session/create` | Cookie | Create or reuse empty session |
| GET | `/api/sessions/active` | Cookie | List active/draft sessions (store-scoped) |
| GET | `/api/session/:id` | OTP param | Poll items (`?otp=&since=ISO`) |
| POST | `/api/session/:id/scan` | OTP body | Record scan (mobile, rate-limited) |
| PATCH | `/api/session/:id/status` | Cookie | Toggle draft/active + optional label |
| PATCH | `/api/session/:id/items/:itemId` | Cookie | Edit scanned item |
| DELETE | `/api/session/:id/items/:itemId` | Cookie | Remove scanned item |
| POST | `/api/session/:id/commit` | Owner | Commit selected items to inventory |

### Dashboard & Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/stats` | Cookie | Count totals per store |
| GET | `/api/categories` | Cookie | List with item_count + total_stock |
| POST | `/api/categories` | Owner | Create category |
| PUT | `/api/categories/:id` | Owner | Update name/icon |
| PATCH | `/api/categories/:id/status` | Owner | Toggle Active/Inactive |
| DELETE | `/api/categories/:id` | Owner | Delete + cascade items |

### Store Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/store/settings` | Cookie | Get store profile |
| PUT | `/api/store/settings` | Owner | Update profile + logo |
| PUT | `/api/store/password` | Cookie | Change own password |

### Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/logs` | Cookie | Activity log (`?from=&to=&limit=1000&action=`) |

### Admin (Superadmin only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/stores` | Superadmin | All stores with counts |
| PUT | `/api/admin/stores/:id` | Superadmin | Edit store |
| PUT | `/api/admin/stores/:id/status` | Superadmin | Suspend/activate |
| DELETE | `/api/admin/stores/:id` | Superadmin | Cascade-delete all store data |
| GET | `/api/admin/stores/:id/users` | Superadmin | List users + roles |
| POST | `/api/admin/stores/:id/users` | Superadmin | Grant access |
| DELETE | `/api/admin/stores/:id/users/:userId` | Superadmin | Revoke access |
| POST | `/api/admin/users/:userId/reset-password` | Superadmin | Generate temp password |

### Utility

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/server-info` | Cookie | LAN IP, port, tunnel URL |

---

## 11. Frontend Architecture

### Route Guards

```typescript
// App.tsx
<ProtectedRoute>   // requires any authenticated user; redirects superadmin → /admin
<AdminRoute>       // requires role === 'superadmin'
```

### Code Splitting

Heavy pages are lazy-loaded to reduce initial bundle:

```typescript
const Scan         = lazy(() => import('./pages/Scan'));
const Import       = lazy(() => import('./pages/Import'));
const Logs         = lazy(() => import('./pages/Logs'));
const StoreSettings = lazy(() => import('./pages/StoreSettings'));
```

Initial bundle: ~947KB. Each lazy page adds ~50–150KB on first navigation.

### AuthContext

```typescript
interface User {
  id: number;
  username: string;
  role: 'owner' | 'taker' | 'superadmin';
  store_name: string;
  store_logo?: string | null;
}
```

On mount: fetches `/api/auth/me` and `/api/auth/my-stores`. Exposes `login`, `logout`, `switchStore` functions.

### Styling Conventions

- Tailwind CSS 4.1 utility classes throughout
- `cn(...classes)` — `clsx` + `tailwind-merge` for conditional class merging
- Color system: `navy-{700,800,900}` for sidebar/header chrome; `slate-{50,100,...}` for content areas
- `motion/react` for animated dropdowns, modals, mobile menu
- `useReducedMotion()` disables animations for accessibility

### Scan.tsx State Machine

```
idle → loading → ready → active ─┐
                  ↑               │ save as draft
                  └── draft ◄─────┘
                         │ commit (owner only)
                         ▼
                    completed (read-only)
```

Key refs used to avoid stale closure bugs in polling callbacks:
- `sessionStatusRef` — mirrors `sessionStatus` for use inside intervals
- `isBusyRef` — prevents concurrent poll requests
- `lastScannedUpcRef` + `lastScannedAtRef` — hardware scanner dedup (1.5s window)
- `expiryWarnedRef` — fire expiry toast only once

---

## 12. Batch Import Pipeline

### Flow

```
File upload (XLSX/CSV/JSON ≤ 20MB)
  ↓
POST /api/inventory/batch-upload
  Server parses with xlsx library
  Returns: { sheets: [{ name, headers, preview[5], rows, rowCount, mapping }] }
  ↓
Column mapping UI (auto-detect via synonym dictionary)
  "SKU" → number, "Qty" / "Quantity" → quantity, etc.
  One mapping per sheet; "Apply to all sheets" button
  ↓
POST /api/inventory/batch-confirm  (express.json 50MB limit)
  Transaction per sheet:
    • Category auto-create if missing (icon auto-assigned)
    • Upsert: UPC match → update; SKU match → update; else insert
    • Skips rows where both UPC and SKU are empty
  Returns: { added, updated, skipped, errors[], skipped_rows[] }
```

### Multi-Sheet Behavior

Each Excel sheet maps to one category. If the sheet name matches an existing category, items go there. Otherwise a new category is created. This matches the common workflow where a buyer organizes spreadsheets by product type.

### Google Drive Image Normalization

Import accepts Google Drive sharing URLs. The server extracts the file ID via regex and converts to the thumbnail API format:

```
https://drive.google.com/file/d/{FILE_ID}/view
  → https://drive.google.com/thumbnail?id={FILE_ID}&sz=w800
```

---

## 13. Security Posture

### Rate Limiting (Three Tiers)

| Tier | Scope | Limit | Reason |
|------|-------|-------|--------|
| Auth | `authLimiter` | 20 req / 15 min per IP | Brute-force on login/register |
| API | `apiLimiter` | 2,000 req / 15 min per IP | Covers 1,000-item sessions with headroom |
| Scan | `scanLimiter` | 60 req / 60 s per IP | OTP brute-force across session IDs |

### Threats Mitigated

| Threat | Mitigation |
|--------|-----------|
| CSRF on OAuth | State nonce in httpOnly cookie (10-min TTL) |
| OAuth account takeover | Auto-link only if `email_verified` AND target account has no password |
| Brute-force login | Account lockout after 5 attempts (15-min lock) + auth rate limit |
| OTP brute-force | 5-strike session lockout + scan rate limit |
| SQL injection | Prepared statements throughout (better-sqlite3) |
| XSS via image upload | MIME type whitelist: JPEG, PNG, GIF, WebP only — SVG/PHP rejected |
| Cross-store data leakage | All queries filtered by `req.user.store_id` from JWT |
| Credential exposure on reset | Temp password displayed once, never stored in plaintext |

### Notable Design Choices

**JWT in httpOnly cookie, not localStorage** — prevents XSS from reading the token.

**OTP scoped to session, not to user** — mobile clients don't need an account. The OTP is the only credential they present. Its short life (8 hours) and high entropy (2^40) make it safe for this use case.

**SQLite single-file DB** — acceptable at the current scale (one store = hundreds to low thousands of items). WAL mode allows concurrent reads while a write is in progress, which matters during multi-phone scan sessions.

---

## 14. Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Scan (POST) | < 50 ms | In-memory upsert; UPC lookup is async |
| Session poll (GET) | < 30 ms | Delta via `since` param; indexed query |
| Inventory list (GET) | < 100 ms | Paginated + indexed |
| Batch import (1k rows) | ~2–5 s | Single transaction |
| PDF export (1k items) | ~1 s | PDFKit streaming |
| Full UPC lookup cycle | 2–4 s | External API; hidden by async pattern |

### Concurrency Ceiling

SQLite WAL supports roughly **10–50 concurrent writers** before contention becomes noticeable. For a typical deployment (1–3 phones scanning + 1 desktop polling), this is more than sufficient. Migration to PostgreSQL would be the path if concurrent user count grows beyond ~20.

---

## 15. Key Files to Review

When onboarding, read these in order:

| Priority | File | Why |
|----------|------|-----|
| 1 | `server.ts` | Entire backend — schema, routes, auth, business logic |
| 2 | `src/context/AuthContext.tsx` | Auth state that every page depends on |
| 3 | `src/pages/Scan.tsx` | Core product differentiator — session + polling logic |
| 4 | `src/App.tsx` | Route guards + lazy loading |
| 5 | `src/components/Layout.tsx` | Navigation shell, store switcher |
| 6 | `src/pages/Dashboard.tsx` | Inventory management hub |
| 7 | `src/pages/Import.tsx` | Batch import wizard |
| 8 | `src/pages/SuperAdmin.tsx` | Multi-tenant admin ops |
| 9 | `vite.config.ts` | Dev proxy + HMR config |
| 10 | `.github/workflows/ci.yml` | CI gates |

---

## 16. Technical Debt & Roadmap

### Current Debt

| Item | Impact | Effort |
|------|--------|--------|
| `server.ts` is ~2,000 LOC monolith | Maintainability | Medium — split into route modules |
| No input validation schema (Zod/Joi) | Reliability, security | Medium |
| No unit or integration tests | Confidence in refactors | High effort to retrofit |
| Images stored as base64 in `/uploads` | Storage bloat; no CDN | Medium — migrate to S3/R2 |
| In-memory UPC cache (lost on restart) | Cold-start performance | Low — add Redis or SQLite cache table |
| No log rotation / external log aggregation | Operations | Low |
| Inconsistent API error response format | DX for consumers | Low |

### Suggested Next Steps (v2)

1. **Split server.ts** into `routes/auth.ts`, `routes/inventory.ts`, `routes/sessions.ts`, etc.
2. **Add Zod schemas** for all request bodies — replaces inline validation
3. **Integration tests** for session lifecycle + commit transaction
4. **Object storage** for product images (Cloudflare R2 or AWS S3)
5. **Persistent UPC cache** (SQLite table with TTL column) — survives server restarts
6. **PostgreSQL migration** path if multi-store load increases significantly
7. **Deployment guide** for production (PM2 / Docker + nginx reverse proxy)

---

*Last updated: 2026-03-31*
