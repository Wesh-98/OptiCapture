# OptiCapture Architecture

Last updated: 2026-04-06

This document reflects the current codebase, including the recent move away from large page files for Import, Logs, Signup, and Store Settings.

## System Overview

OptiCapture is a full-stack TypeScript inventory platform built around a React SPA, an Express API, and a SQLite database. In development, the frontend and backend share the same Node.js server process so API routes, Vite middleware, HMR, QR/mobile scanning, and optional tunnel access all work from the same origin.

```text
Desktop Browser / Mobile Browser
            |
            v
React 19 SPA (Vite)
            |
            v
Express server (server.ts)
  |- auth, admin, category, inventory, session, log routes
  |- static assets: /icons, /uploads
  |- Google Drive image proxy
  |- Vite middleware in development
            |
            +--> SQLite (better-sqlite3, WAL mode)
            +--> local uploads directory
            +--> Open Food Facts / UPCitemDB
            +--> Google OAuth
```

## Runtime Topology

- `npm run dev` runs `node generate-certs.js && tsx server.ts`.
- `server.ts` is the runtime entry point for both the API and the SPA shell.
- Development uses Vite in middleware mode on the same HTTP or HTTPS server instance as Express.
- Production serves the prebuilt SPA from `dist/` and keeps the same API routes.
- The app listens on port `3000`.
- If `dev-key.pem` and `dev-cert.pem` exist, local development runs over HTTPS so camera scanning works on mobile devices.

## Repository Layout

```text
OptiCapture/
|- server.ts
|- opticapture.db
|- uploads/
|- public/
|  \- icons/
|- docs/
|  \- ARCHITECTURE.md
\- src/
   |- main.tsx
   |- App.tsx
   |- context/
   |  \- AuthContext.tsx
   |- lib/
   |  |- constants.ts
   |  |- imageUpload.ts
   |  \- utils.ts
   |- pages/
   |  |- Dashboard.tsx
   |  |- Import.tsx
   |  |- Login.tsx
   |  |- Logs.tsx
   |  |- MobileScan.tsx
   |  |- Scan.tsx
   |  |- Signup.tsx
   |  |- StoreSettings.tsx
   |  \- SuperAdmin.tsx
   |- components/
   |  |- dashboard/
   |  |- import/
   |  |- logs/
   |  |- scan/
   |  |- signup/
   |  |- store-settings/
   |  |- superadmin/
   |  \- Layout.tsx
   |- hooks/
   |  |- useImportWorkflow.ts
   |  |- useLogsPage.ts
   |  |- useScanSession.ts
   |  |- useServerInfo.ts
   |  |- useSignupFlow.ts
   |  |- useStoreSettings.ts
   |  \- other feature hooks
   \- server/
      |- cache.ts
      |- db.ts
      |- helpers.ts
      |- middleware.ts
      |- types.ts
      \- routes/
         |- admin.ts
         |- auth.ts
         |- categories.ts
         |- inventory.ts
         |- logs.ts
         \- sessions.ts
```

## Frontend Architecture

### App shell and routing

- `src/main.tsx` mounts the React app.
- `src/App.tsx` defines route wiring, error boundaries, protected routes, and admin-only routes.
- `src/context/AuthContext.tsx` owns:
  - initial `/api/auth/me` session check
  - store access list from `/api/auth/my-stores`
  - login/logout
  - store switching through `/api/auth/switch-store`

Current client routes:

- `/login`
- `/signup`
- `/admin`
- `/mobile-scan/:sessionId`
- `/`
- `/scan`
- `/import`
- `/logs`
- `/settings`

### Current route patterns

The codebase is no longer strictly "one page file contains everything." It now uses three route styles:

1. Thin page wrappers
   Routes delegate immediately to feature screens.
   Examples: `Import.tsx`, `Logs.tsx`, `Signup.tsx`, `StoreSettings.tsx`

2. Page orchestrators
   Route files still own composition, but most logic and UI live in hooks and feature components.
   Examples: `Dashboard.tsx`, `Scan.tsx`, `SuperAdmin.tsx`

3. Route-local implementations
   The route still contains most of its own behavior.
   Examples: `Login.tsx`, `MobileScan.tsx`

### Feature folders

Recent refactors moved several workflows into feature folders with a screen + hook + API split:

- `src/components/import/` + `src/hooks/useImportWorkflow.ts`
- `src/components/logs/` + `src/hooks/useLogsPage.ts`
- `src/components/signup/` + `src/hooks/useSignupFlow.ts`
- `src/components/store-settings/` + `src/hooks/useStoreSettings.ts`

This pattern keeps route files small and pushes data-fetching, normalization, and step-state logic closer to the feature itself.

### Existing frontend domains

- `dashboard/` holds most inventory dashboard tables, modals, and summaries.
- `scan/` holds the live scan workspace, QR/mobile panel, feed panel, commit modal, and toast UI.
- `superadmin/` holds store management tables and modal flows.
- `lib/imageUpload.ts` centralizes accepted client-side upload formats for manual image uploads.

## Backend Architecture

### Bootstrap responsibilities

`server.ts` is now a bootstrap and wiring file, not the place where all business logic lives. It is responsible for:

- loading environment variables
- booting the database module
- creating the shared HTTP or HTTPS server
- mounting Helmet, JSON parsing, cookies, and rate limiting
- serving `/uploads` and `/icons`
- exposing `/api/server-info`
- exposing `/api/drive-image/:fileId`
- mounting route modules
- mounting Vite middleware in development
- serving `dist/index.html` in production for SPA routes

### Shared server modules

| File | Responsibility |
|---|---|
| `src/server/db.ts` | schema creation, migrations, seed data, indexes, audit log pruning, one-time data cleanup |
| `src/server/middleware.ts` | JWT auth, rate limiting, Google OAuth client, owner-role guard |
| `src/server/helpers.ts` | image persistence, image URL normalization, store code generation, OTP generation, UPC lookup helpers |
| `src/server/cache.ts` | in-memory UPC cache, pending OAuth registrations, revoked token tracking |
| `src/server/types.ts` | shared request and payload types, session status constants |

### Route modules

| Route module | Main responsibilities |
|---|---|
| `auth.ts` | login/logout, Google OAuth, registration, current user, store list, store switching, store settings, password changes |
| `admin.ts` | superadmin store management, store-user access management, store suspension, store deletion, password reset |
| `categories.ts` | dashboard stats and category CRUD |
| `inventory.ts` | inventory CRUD, export, batch upload parsing, batch import confirmation |
| `sessions.ts` | scan session lifecycle, polling, OTP-protected scan ingestion, drafts, commit flow |
| `logs.ts` | filtered audit log retrieval |

## Data Model and Multi-Tenancy

### Database

The app uses `better-sqlite3` against `opticapture.db` at the repo root.

Current database characteristics:

- WAL mode is enabled for better concurrent read/write behavior.
- `busy_timeout` is set to reduce transient `SQLITE_BUSY` failures during active scanning.
- startup applies schema creation and numbered migrations inside `src/server/db.ts`
- audit logs older than 90 days are pruned at startup and then daily

### Core tables

- `stores`
- `users`
- `user_stores`
- `categories`
- `inventory`
- `logs`
- `scan_sessions`
- `session_items`
- `schema_migrations`

### Tenant model

Operational data is store-scoped:

- `categories.store_id`
- `inventory.store_id`
- `logs.store_id`
- `scan_sessions.store_id`

Users can belong to multiple stores through `user_stores`, and their active store context is carried in the JWT. Changing stores does not require a new login; the server reissues the JWT with the selected store and role.

Special cases:

- store `id = 0` is the OptiCapture HQ context used by `superadmin`
- regular stores use generated 6-character `store_code` values for login

## Authentication and Authorization

### Session model

- JWTs are signed with `HS256`
- token lifetime is 8 hours
- the token is stored in an `httpOnly` cookie named `token`
- cookies use `secure: true` on HTTPS
- cookies use `sameSite: strict` on HTTPS and `lax` during plain HTTP development

### Enforcement

- `authenticateToken` verifies signature, issuer, audience, token revocation, token version, and store suspension
- `requireOwner` blocks write operations for non-owner store users
- superadmin-only behavior is enforced inside admin routes

### Additional controls

- auth rate limit: 20 requests per 15 minutes per IP
- general API limit: 2000 requests per 15 minutes per IP
- scan endpoint limit: 60 requests per minute per IP
- failed logins trigger a 15-minute lockout after 5 bad attempts
- logout revokes the current token in memory
- password changes increment `token_version` so old tokens stop working

### OAuth

Google OAuth is optional and wired through `google-auth-library`.

The current flow:

1. `/api/auth/google` starts OAuth and stores a short-lived CSRF nonce in a cookie.
2. `/api/auth/google/callback` validates state and looks up or links the user.
3. New OAuth signups are stored temporarily in the in-memory `pendingOAuth` cache.
4. The signup screen finishes registration through `/api/auth/register`.

## Key Workflows

### Store login and store switching

1. A user logs in with username, password, and store code.
2. Superadmin login omits the store code and resolves only superadmin accounts.
3. `AuthContext` loads `/api/auth/me` and `/api/auth/my-stores` on app startup.
4. Switching stores calls `/api/auth/switch-store`, clears any cached scan session from `sessionStorage`, and refreshes the active user context.

### Live scanning

`Scan.tsx` is the desktop orchestration page for live scanning and uses extracted hooks such as `useScanSession`, `useHardwareScanner`, `useDraftManagement`, `useCommitModal`, and `useServerInfo`.

The current scan flow is:

1. The desktop page creates or resumes a scan session through `/api/session/create`.
2. The server returns a `sessionId` and OTP.
3. `useServerInfo` builds a mobile URL using either the tunnel URL or the LAN address.
4. The QR code points the phone to `/mobile-scan/:sessionId?otp=...`.
5. `MobileScan.tsx` uses ZXing to read barcodes and posts to `/api/session/:id/scan`.
6. Hardware scanners use keyboard-wedge input and hit the same session scan endpoint.
7. The server checks existing inventory first, then falls back to external UPC lookup providers.
8. The desktop page polls `/api/session/:id` every 2 seconds, using `since_id` for incremental refresh.
9. The session can be saved as a draft, resumed later, cleared, deleted, or committed into inventory.

### External product lookup

UPC lookup lives in `src/server/helpers.ts` and currently uses:

- Open Food Facts
- UPCitemDB

Results are cached in memory for 7 days in `upcCache` to avoid repeated external lookups for the same barcode.

### Batch import

The import flow is now split into a dedicated feature module:

- screen: `src/components/import/ImportScreen.tsx`
- workflow hook: `src/hooks/useImportWorkflow.ts`
- request and normalization layer: `src/components/import/importApi.ts`

Current behavior:

1. The client uploads a file to `POST /api/inventory/batch-upload`.
2. The server parses:
   - XLSX with `exceljs`
   - CSV with `papaparse`
   - JSON with `JSON.parse`
3. The server returns normalized sheet payloads with headers, preview rows, full rows, and row counts.
4. The client auto-detects column mappings from header synonyms.
5. Confirming the import sends mapped sheet data to `POST /api/inventory/batch-confirm`.
6. The server runs a transaction that:
   - treats each sheet name as the default category
   - creates missing categories when needed
   - inserts new inventory rows
   - updates existing rows matched by UPC or item number
   - records skipped rows and audit log details

Recent reliability improvements in this area:

- the upload and confirm handlers on the client use outer error handling so failed post-fetch processing cannot leave the page stuck in a parsing or importing state
- the file input is always reset so same-file re-upload works after errors
- server-side cell normalization now handles Excel hyperlink-style values instead of allowing them to degrade into broken string output

### Image handling

There are now three distinct image paths in the system.

Manual uploads:

- client validation lives in `src/lib/imageUpload.ts`
- server validation and persistence live in `saveBase64Image()` in `src/server/helpers.ts`
- supported formats are JPG, PNG, GIF, and WEBP
- unsupported formats return `400` instead of failing silently

Imported image URLs:

- inventory import reads image values from sheet rows
- `normalizeImageUrl()` converts supported Google Drive sharing links into `/api/drive-image/:fileId`
- non-Drive URLs are stored as-is

Drive proxy:

- `server.ts` exposes `/api/drive-image/:fileId`
- the server fetches image bytes server-side and returns them directly
- this avoids browser-side cross-origin redirect issues from Google Drive
- private Drive files still need to be publicly accessible to render successfully

### Audit logs

- activity logs are stored in the `logs` table
- reads are exposed through `GET /api/logs`
- the logs page is now split into `LogsScreen`, `LogsFilters`, `LogsTable`, and `useLogsPage`
- old log entries are pruned automatically after 90 days

## Build and Deployment Model

- frontend build: `vite build`
- development runtime: single Node process with Express + Vite middleware
- production runtime: Express serves the built SPA and API from the same process
- static files:
  - `/icons` -> `public/icons`
  - `/uploads` -> repo-root `uploads/`

This architecture is optimized for a single deployed application instance.

## Current Architectural Direction

The current direction is toward feature-oriented modules instead of large page files.

Already migrated to the new pattern:

- Import
- Logs
- Signup
- Store Settings

Already fairly modular, but still page-orchestrated:

- Dashboard
- Scan
- SuperAdmin

Still mostly route-local:

- Login
- MobileScan

If future refactors continue, `Login.tsx` and `MobileScan.tsx` are the clearest next candidates for extraction.

## Scaling Notes

| Concern | Current state | Likely next step |
|---|---|---|
| Database | SQLite file with WAL | move to Postgres or another server DB for multi-instance scaling |
| Live session updates | polling every 2 seconds | move to SSE or WebSockets |
| File storage | local disk | move uploads to object storage |
| OAuth state and token revocation | in-memory maps | move to Redis or persistent shared storage |
| Drive image proxy | anonymous/public access only | add authenticated Google API access if private Drive files must render |
