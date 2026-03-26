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

## Features

### Inventory
- Category grid with custom icons and stock counters
- Per-item tracking: name, UPC, quantity, price, tax, tags, image
- Inline edit and delete with two-step confirmation
- Global search across all inventory
- Pagination (50 / 100 / 200 items per page)
- Export to PDF or CSV

### Barcode Scanning
- **Mobile camera** — QR code links any phone to the desktop session in seconds
- **USB / Bluetooth scanner** — plug-and-play HID keyboard-wedge, no drivers or pairing required
- **Product auto-lookup** — UPC resolves to name, brand, and image via Open Food Facts + UPCitemDB
- OTP-secured scan sessions with 2-hour expiry and attempt lockout

### Bulk Import
- Drag-and-drop Excel (.xlsx / .xls), CSV, or JSON
- Auto-detects column headers — no rigid template required
- Multi-sheet Excel: each sheet maps to a category automatically

### Access Control
- Three roles: **SuperAdmin**, **Owner**, **Taker**
- Owners manage store settings, inventory, categories, and team
- Takers scan and view — read-only on settings, no destructive actions
- SuperAdmin manages all stores and users across the platform

### Security
- JWT authentication via httpOnly cookies (8-hour expiry)
- Login lockout after 5 failed attempts (15-minute cooldown)
- Rate limiting on all API routes (300 req / 15 min)
- MIME-type validation on all file uploads
- Helmet security headers on every response
- Google OAuth 2.0 sign-in

### Operations
- Full audit log: every CREATE, UPDATE, DELETE, IMPORT, LOGIN with user and timestamp
- Filter logs by action type, keyword, and date range
- All activity scoped and isolated per store tenant

### Multi-Store
- One account, multiple store locations
- Switch stores from the header — no re-login required
- Complete data isolation: every record scoped to `store_id`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router v7, Tailwind CSS v4, Motion |
| Backend | Express, TypeScript, tsx |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (httpOnly cookies), bcryptjs, Google OAuth 2.0 |
| Scanning | @zxing/browser (camera), HID keyboard-wedge (hardware) |
| Import | xlsx, papaparse |
| Security | helmet, express-rate-limit |
| CI | GitHub Actions — type-check + build on every push |

---

## Roles

| Role | Dashboard | Scan | Import | Logs | Store Settings | SuperAdmin |
|---|---|---|---|---|---|---|
| **SuperAdmin** | — | — | — | — | — | Full access |
| **Owner** | Full | Full | Full | Full | Full | — |
| **Taker** | View | Scan only | — | View | View only | — |

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
| `UPCITEMDB_API_KEY` | No | UPCitemDB key for extended product lookup |
| `NODE_ENV` | No | Set to `production` to disable demo accounts and enable production hardening |

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

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Owner |
| `taker` | `taker123` | Taker |
| `superadmin` | `superadmin123` | SuperAdmin |

---

## Scaling Roadmap

OptiCapture is built to grow. Planned for v2:

| Feature | Notes |
|---|---|
| Email password reset | Self-service, no superadmin dependency |
| Google OAuth account linking | Merge existing accounts with Google sign-in |
| API versioning (`/api/v1/`) | Stable contracts for third-party integrations |
| Postgres migration | Drop-in swap via a single DB adapter — all queries already parameterised |
| Webhook events | Inventory changes pushed to ERP / POS systems |
| Full test suite | Vitest unit + Playwright end-to-end |
| White-label theming | Per-store brand colours and logo in the UI shell |
| Mobile app | React Native wrapper around the existing scan flow |

---

## License

Private. All rights reserved. © 2026 OptiCapture.
