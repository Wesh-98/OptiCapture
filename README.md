# OptiCapture

**Modern inventory management built for speed, accuracy, and scale.**

OptiCapture replaces manual spreadsheets and legacy tools with a fast, multi-tenant SaaS platform. Store staff scan barcodes from any phone or USB/Bluetooth scanner, products are auto-filled from a live database, and inventory syncs instantly across the team — no dedicated hardware required.

---

## Overview

| Attribute | Details |
| :--- | :--- |
| **Type** | Multi-tenant SaaS (white-label ready) |
| **Target** | Convenience stores, grocery, small retail |
| **Replaces** | Petrosoft, manual Excel, paper logs |
| **Access** | Web — desktop + mobile, any browser |

---

## Project Flow

1. Users log in, and the app loads their role and active store.
2. The React frontend powers the dashboard, scan page, imports, logs, and settings.
3. The Express backend handles auth, inventory, categories, scan sessions, and audit logging.
4. SQLite stores the app data for each store, including products, users, scan sessions, and logs.
5. Scans can come from a phone camera or hardware scanner — the backend checks existing inventory first, then queries configured external UPC sources (Go-UPC, Open Food Facts, and UPCitemDB) in parallel.
6. After scanning, the user selects items and commits them: new items are added to inventory with a per-item or bulk category assignment, and items already in inventory are marked as seen on the shelf without changing their details or stock.

### Stack in Plain English

- `React + React Router + Vite`: builds the web app and handles page navigation.
- `Tailwind CSS v4 + Motion`: styles the UI and adds interaction/animation polish.
- `Express + Node.js + TypeScript`: runs the API, server logic, auth flow, uploads, and scan-session workflows.
- `SQLite + better-sqlite3`: stores inventory, categories, users, stores, sessions, and logs.
- `JWT cookies + bcryptjs + Google OAuth`: handles login, secure sessions, password hashing, and optional Google sign-in.
- `BarcodeDetector + ZXing`: powers mobile barcode scanning with a native-first, lazy-loaded fallback; hardware scanners work as keyboard (HID) input.
- `exceljs + papaparse + multer + pdfkit`: supports import/export workflows for XLSX, CSV, JSON, and PDF.

---

## Features

### Inventory
- Category grid with custom icons (image-based or Lucide) and live stock counters
- Per-item tracking: name, UPC, SKU, quantity, unit, price, tax, tags, image
- Inline add, edit, and delete with two-step delete confirmation
- Global search across all inventory (name, UPC, category)
- Pagination (50 / 100 / 200 items per page)
- Export to XLSX, CSV, JSON, or PDF

### Barcode Scanning
- **Mobile camera** — QR code links any phone to the desktop session in seconds
- **USB / Bluetooth scanner** — plug-and-play HID keyboard-wedge, no drivers or pairing required
- **Product auto-lookup** — UPC queries Go-UPC when configured plus Open Food Facts and UPCitemDB in parallel; the best available result wins
- OTP-secured scan sessions with 8-hour active expiry (24-hour cap) and attempt lockout; the OTP never appears in a URL the server logs
- Draft sessions — pause scanning, name the draft, and resume later
- Per-item category assignment at commit time (individual or bulk)

### Bulk Import
- Drag-and-drop Excel (.xlsx / .xls), CSV, or JSON — max 20 MB
- Auto-detects column headers — no rigid template required
- Multi-sheet Excel: each sheet maps to a category automatically
- Full error reporting: skipped rows, failed rows, added vs. updated counts
- Re-importable exports preserve descriptions, quantities, pricing, tax, tags, status, images, categories, and external IDs

### Access Control
- Three roles: **SuperAdmin**, **Owner**, **Taker**
- Owners manage store settings, inventory, categories, imports, exports, and team
- Takers can scan, and add / edit / delete individual inventory items — category management and bulk import remain owner-only
- SuperAdmin oversees every store: browse and edit any store's inventory, search items across stores, see recently added items and an activity log, and manage stores and their users

### Security
- JWT authentication via httpOnly cookies (8-hour expiry)
- Login lockout after 5 failed attempts (15-minute cooldown)
- Rate limiting on all API routes (2 000 req / 15 min general; 20 req / 15 min auth; scan endpoints limited per device and per session)
- Malformed/non-object JSON rejection and bounded upstream image proxy reads with an 8-second timeout
- MIME-type validation on all file and image uploads
- Helmet security headers (CSP, HSTS, referrer policy) on every response
- Google OAuth 2.0 sign-in
- Proxy trust is configurable (`TRUST_PROXY`) so rate limits see the real client IP behind tunnels and load balancers without accepting spoofed headers

### Operations
- Full audit log: every CREATE, UPDATE, DELETE, IMPORT, LOGIN with user and timestamp, kept for 90 days
- Server-side log filtering and pagination by action type, keyword, and date range
- Structured JSON server logs for startup, shutdown, route, proxy, and process errors
- All activity scoped and isolated per store tenant
- Health endpoint (`GET /api/health`) for load balancers and uptime checks
- Online database backup: `npm run db:backup`

### Multi-Store
- One account, multiple store locations
- Switch stores from the header — no re-login required
- Complete data isolation: every record scoped to `store_id`

---

## Architecture

The codebase is fully decomposed into focused modules:

```
server.ts                   Runtime bootstrap: env, HTTP/HTTPS server, Vite (dev) or dist/ (prod)
src/server/
  app.ts                    Express app factory: middleware, static files, route mounting
  db.ts                     SQLite connection + transactional migrations + seed
  logger.ts                 Structured JSON application logging
  middleware.ts             Auth (JWT), rate limiters, role guards (requireOwner / requireOwnerOrTaker)
  helpers.ts                UPC lookup, image utilities, OTP/store-code generation
  cache.ts                  In-memory UPC and token-revocation cache
  storeDetails.ts           Store profile validation shared by signup, settings and admin
  uploads.ts                Removes uploaded files nothing points at any more
  routes/
    auth.ts                 Login, logout, Google OAuth, password change
    admin.ts                SuperAdmin — stores, users, per-store inventory, search, activity
    inventory.ts            Item CRUD, export, batch upload/confirm
    categories.ts           Category CRUD + status + bulk item delete
    sessions.ts             Scan session lifecycle, item polling, commit
    logs.ts                 Audit log query

src/
  pages/                    Thin composition layers (~150 lines each)
  hooks/                    All stateful logic (one concern per hook)
  components/               Focused UI components (one responsibility each)
  context/AuthContext.tsx   Global auth state
  lib/
    apiFetch.ts             Adds the active store to same-origin API calls
    imageUpload.ts          readFileAsDataUrl + MIME validation (shared)
    mobileScanScanner.ts    Phone camera scanning (native BarcodeDetector, ZXing fallback)
    utils.ts                cn() Tailwind class helper
```

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19, React Router v7, Tailwind CSS v4, Motion |
| Backend | Express, TypeScript, tsx |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (httpOnly cookies), bcryptjs, Google OAuth 2.0 |
| Scanning | @zxing/library (camera), HID keyboard-wedge (hardware) |
| Import/Export | exceljs, papaparse, pdfkit, multer |
| Security | helmet, express-rate-limit |
| CI | GitHub Actions — type-check, ESLint, unit tests with coverage, Playwright e2e and build; SonarCloud and CodeRabbit on pull requests |

---

## Roles

| Role | Dashboard | Scan | Item CRUD | Import | Logs | Store Settings | SuperAdmin |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **SuperAdmin** | — | — | Edit any store's items | — | Cross-store activity log | Any store | Full access |
| **Owner** | Full | Full | Full | Full | Full | Full | — |
| **Taker** | View | Scan | Add / Edit / Delete | — | — | View only | — |

Category management (add, edit, delete, activate/deactivate) is owner-only.

---

## Quick Start

**Prerequisites:** Node.js 20+

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum

# 3. Start the development server
npm run dev
```

App runs at `https://localhost:3000`. A self-signed SSL certificate is generated automatically on first run.

---

## Mobile Scanning

Camera access requires HTTPS with a valid certificate. For phone testing across any network:

```bash
npm run dev:scan   # starts dev server + Cloudflare tunnel together
```

The Scan page auto-detects the tunnel URL and updates the QR code automatically. No configuration needed.

> Requires `cloudflared` — [Download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

---

## Environment Variables

| Variable | Required | Description |
| :--- | :---: | :--- |
| `JWT_SECRET` | **Yes** | Random 32-byte hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL (default: `https://localhost:3000/api/auth/google/callback`) |
| `UPCITEMDB_API_KEY` | No | Upgrades UPCitemDB from the trial endpoint (100 req/day) to the paid /v1 endpoint |
| `GO_UPC_API_KEY` | No | Enables the preferred paid Go-UPC lookup provider |
| `NODE_ENV` | No | Set to `production` to enable production hardening |
| `PORT` | No | Port to listen on (default `3000`) |
| `PUBLIC_BASE_URL` | In production | Public HTTPS origin phones open from the scan QR code |
| `TRUST_PROXY` | No | Which proxies may set `X-Forwarded-For`; defaults to loopback and private networks |
| `DATABASE_PATH` | No | SQLite file location (default `opticapture.db` in the project root) |
| `UPLOADS_DIR` | No | Where uploaded images are stored (default `./uploads`) |
| `ALLOW_DEMO_SEED` | No | Set to `true` on a local machine to create the demo accounts below. Never in production |
| `TUNNEL_HOST` | No | Cloudflare tunnel hostname — tightens Vite HMR `allowedHosts` in dev |
| `DISABLE_HMR` | No | Set to `true` to disable Vite HMR when the tunnel doesn't support WebSocket upgrades |

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Dev server — HTTPS on localhost:3000 |
| `npm run dev:scan` | Dev server + Cloudflare tunnel for mobile scanning |
| `npm run tunnel` | Tunnel only |
| `npm run build` | Production frontend build |
| `npm start` | Run the server without the dev tooling (production) |
| `npm run db:backup` | Online SQLite backup; keeps the latest 14 |
| `npm run lint` | TypeScript type check |
| `npm run lint:eslint` | ESLint |
| `npm run format` | Prettier format |
| `npm run test` | Vitest unit and API integration suite |
| `npm run test:coverage` | Vitest suite with V8 coverage |
| `npm run test:e2e` | Playwright browser tests |
| `npm run test:full` | TypeScript, ESLint, coverage, browser tests, and production build |

---

## Demo Accounts

Seeded only when `ALLOW_DEMO_SEED=true`. The demo store's code is generated when the database is first created, so read it from the database: `SELECT store_code FROM stores WHERE id = 1`. After signing in, owners can also see it under Store Settings.

| Username | Password | Role | Store Code |
| :--- | :--- | :---: | :---: |
| `admin` | `admin123` | Owner | generated |
| `taker` | `taker123` | Taker | generated |
| `superadmin` | `superadmin123` | SuperAdmin | — |

---

## Scaling Roadmap

OptiCapture is built to grow. Planned for v2:

| Feature | Notes |
| :--- | :--- |
| Email password reset | Self-service, no superadmin dependency |
| Google OAuth account linking | Merge existing accounts with Google sign-in |
| API versioning (`/api/v1/`) | Stable contracts for third-party integrations |
| Postgres migration | Replace the single-instance SQLite persistence layer for horizontal scaling |
| Webhook events | Inventory changes pushed to ERP / POS systems |
| Shared runtime state | Move UPC cache, OAuth pending state, and token revocation to Redis or persistent storage |
| Request schemas | Replace hand-written validation with shared schemas at API boundaries |
| White-label theming | Per-store brand colours and logo in the UI shell |
| Mobile app | React Native wrapper around the existing scan flow |

---

## License

Private. All rights reserved. © 2026 OptiCapture.
