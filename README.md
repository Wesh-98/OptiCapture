# OptiCapture

**Mobile-first inventory management for modern retail stores.**

OptiCapture lets store staff scan barcodes from any phone, auto-fill product names and images from a live product database, and commit items to a live inventory dashboard — no dedicated hardware, no Excel, no manual data entry.

Built for convenience stores, grocery stores, and small retail — as a direct alternative to legacy tools like Petrosoft and manual spreadsheets.

---

## Features

- **Barcode scan via phone camera** — QR code links desktop session to any mobile device; scans sync in real time
- **Product auto-lookup** — UPC → product name, brand, and image via Open Food Facts + UPCitemDB
- **Inventory dashboard** — category grid, item search, edit, delete, stock counts
- **Bulk import wizard** — drag-and-drop Excel (.xlsx), CSV, or JSON; auto-detects column headers; multi-sheet support (each sheet = one category)
- **Activity audit log** — every CREATE, UPDATE, DELETE, IMPORT, LOGIN tracked with timestamp and user
- **Multi-store support** — one account can access multiple store locations; switch from the header
- **Store settings** — store name, address, logo, password change
- **Google OAuth** — sign up and sign in with Google
- **SuperAdmin panel** — manage all stores, activate/suspend, adjust plan tiers (`/admin`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router v7, Tailwind CSS v4, Motion |
| Backend | Express + TypeScript |
| Database | better-sqlite3 (SQLite) |
| Auth | JWT (httpOnly cookies), bcryptjs, Google OAuth |
| Barcode | @zxing/browser (camera), qrcode.react (QR linking) |
| Import | xlsx, papaparse |
| Security | helmet, express-rate-limit |

---

## Getting Started

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

The app runs at `https://localhost:3000` (self-signed cert generated automatically on first run).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes** | Random secret for signing JWTs. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (from Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL (default: `http://localhost:3000/api/auth/google/callback`) |
| `UPCITEMDB_API_KEY` | No | UPCitemDB API key for fallback product lookup (Open Food Facts is used first, free) |
| `NODE_ENV` | No | Set to `production` to disable demo seed accounts |

---

## Mobile Scanning

Camera access requires HTTPS. For local development on a phone:

1. Start the Cloudflare tunnel alongside the dev server:
   ```bash
   npm run dev:scan
   ```

2. The tunnel URL appears on the Scan page as a QR code — scan it with your phone to open the mobile scanner.

> The tunnel requires `cloudflared` to be installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server (HTTPS on localhost:3000) |
| `npm run dev:scan` | Dev server + Cloudflare tunnel for mobile scanning |
| `npm run tunnel` | Start tunnel only |
| `npm run build` | Build frontend for production |
| `npm run lint` | TypeScript type check |

---

## Demo Accounts (development only)

Seeded automatically when `NODE_ENV` is not `production`:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Owner (store 1) |
| `taker` | `taker123` | Taker (store 1) |
| `superadmin` | `superadmin123` | SuperAdmin |

---

## License

Private. All rights reserved.
