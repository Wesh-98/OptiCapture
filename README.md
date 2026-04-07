# OptiCapture

**Modern inventory management built for speed, accuracy, and scale.**

OptiCapture replaces manual spreadsheets and legacy tools with a fast, multi-tenant SaaS platform. Store staff scan barcodes from any phone or USB/Bluetooth scanner, products are auto-filled from a live database, and inventory syncs instantly across the team — no dedicated hardware required.

---

## Overview

| | |
|---|---|
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
5. Scans can come from a phone camera or hardware scanner — the backend checks existing inventory and external UPC sources (Open Food Facts + UPCitemDB, queried in parallel) before saving results.
6. After scanning, the user selects items and commits them to the inventory database with a per-item or bulk category assignment.

### Stack in Plain English

- `React + React Router + Vite`: builds the web app and handles page navigation.
- `Tailwind CSS v4 + Motion`: styles the UI and adds interaction/animation polish.
- `Express + Node.js + TypeScript`: runs the API, server logic, auth flow, uploads, and scan-session workflows.
- `SQLite + better-sqlite3`: stores inventory, categories, users, stores, sessions, and logs.
- `JWT cookies + bcryptjs + Google OAuth`: handles login, secure sessions, password hashing, and optional Google sign-in.
- `ZXing + html5-qrcode`: powers mobile barcode scanning; hardware scanners work as keyboard (HID) input.
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
- **Product auto-lookup** — UPC queries Open Food Facts and UPCitemDB in parallel; best result wins
- OTP-secured scan sessions with 2-hour expiry and attempt lockout
- Draft sessions — pause scanning, name the draft, and resume later
- Per-item category assignment at commit time (individual or bulk)

### Bulk Import
- Drag-and-drop Excel (.xlsx / .xls), CSV, or JSON — max 20 MB
- Auto-detects column headers — no rigid template required
- Multi-sheet Excel: each sheet maps to a category automatically
- Full error reporting: skipped rows, failed rows, added vs. updated counts

### Access Control
- Three roles: **SuperAdmin**, **Owner**, **Taker**
- Owners manage store settings, inventory, categories, imports, exports, and team
- Takers can scan, and add / edit / delete individual inventory items — category management and bulk import remain owner-only
- SuperAdmin manages all stores and users across the platform

### Security
- JWT authentication via httpOnly cookies (8-hour expiry)
- Login lockout after 5 failed attempts (15-minute cooldown)
- Rate limiting on all API routes (2 000 req / 15 min general; 20 req / 15 min auth)
- MIME-type validation on all file and image uploads
- Helmet security headers (CSP, HSTS, referrer policy) on every response
- Google OAuth 2.0 sign-in
- `trust proxy: 1` configured for accurate rate-limiting behind tunnels and reverse proxies

### Operations
- Full audit log: every CREATE, UPDATE, DELETE, IMPORT, LOGIN with user and timestamp
- Filter logs by action type, keyword, and date range
- All activity scoped and isolated per store tenant

### Multi-Store
- One account, multiple store locations
- Switch stores from the header — no re-login required
- Complete data isolation: every record scoped to `store_id`

---

## Architecture

The codebase is fully decomposed into focused modules:

```
server.ts                   Express bootstrap, middleware, route mounting
src/server/
  db.ts                     SQLite connection + migrations + seed
  middleware.ts             Auth (JWT), rate limiters, role guards (requireOwner / requireOwnerOrTaker)
  helpers.ts                UPC lookup, image utilities, OTP/store-code generation
  cache.ts                  In-memory UPC and token-revocation cache
  routes/
    auth.ts                 Login, logout, Google OAuth, password change
    admin.ts                SuperAdmin — store and user management
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
    imageUpload.ts          readFileAsDataUrl + MIME validation (shared)
    utils.ts                cn() Tailwind class helper
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router v7, Tailwind CSS v4, Motion |
| Backend | Express, TypeScript, tsx |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (httpOnly cookies), bcryptjs, Google OAuth 2.0 |
| Scanning | @zxing/browser (camera), HID keyboard-wedge (hardware) |
| Import/Export | exceljs, papaparse, pdfkit, multer |
| Security | helmet, express-rate-limit |
| CI | GitHub Actions — type-check + build on every push |

---

## Roles

| Role | Dashboard | Scan | Item CRUD | Import | Logs | Store Settings | SuperAdmin |
|---|---|---|---|---|---|---|---|
| **SuperAdmin** | — | — | — | — | — | — | Full access |
| **Owner** | Full | Full | Full | Full | Full | Full | — |
| **Taker** | View | Scan | Add / Edit / Delete | — | View | View only | — |

Category management (add, edit, delete, activate/deactivate) is owner-only.

---

## Quick Start

**Prerequisites:** Node.js 18+

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
|---|---|---|
| `JWT_SECRET` | **Yes** | Random 32-byte hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL (default: `https://localhost:3000/api/auth/google/callback`) |
| `UPCITEMDB_API_KEY` | No | Upgrades UPCitemDB from the trial endpoint (100 req/day) to the paid /v1 endpoint |
| `NODE_ENV` | No | Set to `production` to disable demo accounts and enable production hardening |
| `TUNNEL_HOST` | No | Cloudflare tunnel hostname — tightens Vite HMR `allowedHosts` in dev |
| `DISABLE_HMR` | No | Set to `true` to disable Vite HMR when the tunnel doesn't support WebSocket upgrades |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server — HTTPS on localhost:3000 |
| `npm run dev:scan` | Dev server + Cloudflare tunnel for mobile scanning |
| `npm run tunnel` | Tunnel only |
| `npm run build` | Production frontend build |
| `npm run lint` | TypeScript type check |
| `npm run lint:eslint` | ESLint |
| `npm run format` | Prettier format |

---

## Demo Accounts

Seeded automatically when `NODE_ENV !== production`:

| Username | Password | Role | Store Code |
|---|---|---|---|
| `admin` | `Optimart1234` | Owner | EATEM6 |
| `taker` | `taker123` | Taker | EATEM6 |
| `superadmin` | `superadmin123` | SuperAdmin | — |

---

## Scaling Roadmap

OptiCapture is built to grow. Planned for v2:

| Feature | Notes |
|---|---|
| Email password reset | Self-service, no superadmin dependency |
| Google OAuth account linking | Merge existing accounts with Google sign-in |
| goupc API integration | Paid UPC lookup as a third parallel source alongside Open Food Facts and UPCitemDB |
| API versioning (`/api/v1/`) | Stable contracts for third-party integrations |
| Postgres migration | Drop-in swap via a single DB adapter — all queries already parameterised |
| Webhook events | Inventory changes pushed to ERP / POS systems |
| Full test suite | Vitest unit + Playwright end-to-end |
| White-label theming | Per-store brand colours and logo in the UI shell |
| Mobile app | React Native wrapper around the existing scan flow |

---

## License

Private. All rights reserved. © 2026 OptiCapture.
