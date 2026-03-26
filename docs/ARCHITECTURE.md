# OptiCapture — Architecture

A high-level reference for how the system is structured, how data flows, and how it scales.

---

## Overview

OptiCapture is a full-stack TypeScript SaaS application with a React frontend, Express backend, and SQLite database. Everything runs in a single Node.js process in development; production splits into a static frontend build served by Express and the same API server.

```
Browser / Phone
      │
      ▼
React 19 (Vite SPA)
      │  HTTP / fetch
      ▼
Express API  ──── better-sqlite3 ──── opticapture.db
      │
      ├── JWT (httpOnly cookie)
      ├── Helmet headers
      └── express-rate-limit
```

---

## Directory Layout

```
OptiCapture/
├── server.ts               # Express API — all routes, auth, DB logic
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Router + protected route wrapper
│   ├── context/
│   │   └── AuthContext.tsx # Global auth state, session refresh
│   ├── components/
│   │   └── Layout.tsx      # Shell: sidebar, header, toasts, store switcher
│   ├── pages/              # One file per route
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Scan.tsx
│   │   ├── MobileScan.tsx  # Phone-side scanner (loaded from QR link)
│   │   ├── Import.tsx
│   │   ├── Logs.tsx
│   │   ├── StoreSettings.tsx
│   │   └── SuperAdmin.tsx
│   └── lib/
│       ├── utils.ts        # cn() tailwind class helper
│       └── constants.ts    # US states list
├── Public/                 # Static assets (logo, favicons)
├── dist/                   # Vite production build output
├── .github/workflows/
│   └── ci.yml              # TypeScript check + build on every push
└── docs/
    ├── ARCHITECTURE.md     # This file
    └── DEMO_SCRIPT.md      # Live demo walkthrough
```

---

## Authentication

| Mechanism | Detail |
|---|---|
| Tokens | JWT signed with `JWT_SECRET`, 8-hour expiry |
| Storage | httpOnly cookie (`secure: true` on HTTPS, `sameSite: strict`) |
| Refresh | `/api/auth/me` polled on load; 401 triggers logout |
| Login lockout | 5 failed attempts → 15-minute cooldown (per username, in-DB) |
| Rate limiting | 300 req / 15 min per IP on all API routes |
| Google OAuth | Optional — requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` |

Passwords are stored as bcrypt hashes (cost factor 10). The `users` table has `login_attempts` and `locked_until` columns to enforce the lockout.

---

## Multi-Tenancy

Every data table carries a `store_id` foreign key. All API queries filter by the `store_id` decoded from the JWT — a user can never read or write data from another tenant.

```
users → store_id
inventory_items → store_id
categories → store_id
activity_logs → store_id
scan_sessions → store_id
```

Switching stores re-issues a new JWT scoped to the selected store. No re-login required.

---

## Database

SQLite via `better-sqlite3` (synchronous API — no callback chains, no connection pool).

```
stores
users             store_id FK
categories        store_id FK
inventory_items   store_id FK, category_id FK
activity_logs     store_id FK, user_id FK
scan_sessions     store_id FK, user_id FK
session_items     session_id FK
```

Schema is created at startup if missing (`CREATE TABLE IF NOT EXISTS`). Migrations are applied in numbered order at boot — adding a column is a one-liner migration file.

**Scaling path:** All queries use parameterised statements via `better-sqlite3`. Switching to Postgres requires swapping the driver and translating `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL` — no query rewrites.

---

## Barcode Scanning

Two input paths converge on the same staged-items list:

### Mobile Camera
1. Desktop creates a scan session → returns `sessionId` + OTP
2. QR code encodes `{tunnelUrl}/mobile-scan?session={sessionId}&otp={otp}`
3. Phone opens URL — `MobileScan.tsx` verifies OTP, activates session
4. `@zxing/browser` decodes frames from the phone camera
5. Each scan POSTs to `/api/session/:id/scan` → UPC lookup → item staged
6. Desktop polls `/api/session/:id` every 2 seconds — new items appear in real time

### Hardware Scanner (USB / Bluetooth HID)
- HID scanners act as keyboards (keyboard-wedge mode)
- `keydown` listener timestamps each keystroke
- If a full barcode arrives in ≤ 80 ms it's classified as scanner input, not human typing
- Same UPC lookup + staging path as mobile

### Product Lookup
UPC → Open Food Facts API (free, no key) → fallback to UPCitemDB (requires key for full access). Name, brand, and image URL are stored on the staged item.

---

## Role-Based Access

| Check | Where enforced |
|---|---|
| Route visibility | `App.tsx` — role in JWT decoded client-side |
| API authorization | `server.ts` — `requireRole()` middleware on every sensitive route |
| UI restrictions | Component-level (e.g. Taker sees Store Settings read-only) |

Three roles: `superadmin` (platform-wide), `owner` (full store access), `taker` (scan + view only).

---

## Bulk Import

1. File dropped → `papaparse` (CSV/JSON) or `xlsx` (Excel) parses client-side
2. Column headers auto-detected via fuzzy match against known field names
3. Multi-sheet Excel: each sheet name becomes a category
4. Preview shown before commit
5. On confirm, batch POST to `/api/import` → inserts wrapped in a single DB transaction

MIME type validated server-side (`multipart/form-data`, checked against allowed list via Helmet + manual check). Rejects anything that doesn't match `.xlsx`, `.xls`, `.csv`, or `.json`.

---

## Frontend Build

| Tool | Role |
|---|---|
| Vite 6 | Dev server (HMR) + production bundler |
| React Router v7 | Client-side routing, `createBrowserRouter` |
| Tailwind CSS v4 | Utility classes, `@theme` for navy palette |
| Motion | Animations (page transitions, toasts) |

Production build: `vite build` → `dist/` — static files served by Express under `app.use(express.static('dist'))`. All unmatched routes return `dist/index.html` for client-side routing.

---

## CI / CD

GitHub Actions on every push to `main`:

1. **TypeScript** job — `npm ci` → `npm run lint` (`tsc --noEmit`)
2. **Build** job (depends on TypeScript) — `npm ci` → `npm run build`

No deployment step yet. The pipeline validates that the codebase compiles and bundles successfully before any merge.

---

## Security Headers

Helmet is mounted globally:

- `Content-Security-Policy` — restricts script/style sources
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` — HSTS in production
- `Referrer-Policy: no-referrer`

---

## Scaling Notes

| Concern | Current | Path to scale |
|---|---|---|
| Database | SQLite (single file) | Swap `better-sqlite3` for `pg` + connection pool — queries are already parameterised |
| Sessions | In-DB poll every 2s | Replace with WebSocket or SSE for push-based updates |
| File storage | Local disk (logos, imports) | Move to S3-compatible object storage with signed URLs |
| Auth | Single JWT secret | Rotate to key-pair RS256 for multi-instance deployments |
| Deployments | Manual | Add a deploy step to CI — Fly.io / Railway / Docker Compose |
