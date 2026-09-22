# OptiCapture Architecture

Last updated: 2026-09-22

This document reflects the current codebase after the server/app split, lazy route loading, multi-store active-store selection, and the mobile-scan extraction.

## System Overview

OptiCapture is a full-stack TypeScript inventory platform built around a React SPA, an Express API, and a SQLite database. The browser UI and API are served from the same origin in both development and production, which keeps cookies, camera scanning, QR/mobile flows, and API calls simple.

```text
Desktop Browser / Mobile Browser
            |
            v
React 19 SPA (Vite)
  |- lazy-loaded page routes
  |- AuthContext + active-store fetch interceptor
  |- feature components and workflow hooks
            |
            v
Express app factory (src/server/app.ts)
  |- security headers, body parsers, cookies, rate limits
  |- auth, admin, category, inventory, session, and log routes
  |- static assets: /icons, /uploads
  |- Google Drive image proxy
            |
            v
Runtime bootstrap (server.ts)
  |- dotenv and required-secret guard
  |- database startup side effects
  |- HTTP/HTTPS server
  |- /api/server-info
  |- Vite middleware in development or dist/ in production
            |
            +--> SQLite (better-sqlite3, WAL mode)
            +--> local uploads directory
            +--> Go-UPC / Open Food Facts / UPCitemDB
            +--> Google OAuth
```

## Runtime Topology

- `npm run dev` runs `node generate-certs.js && tsx server.ts`.
- `server.ts` is the runtime entry point. It loads env vars, validates `JWT_SECRET`, imports the database module so migrations run, creates the Express app, attaches Vite or static serving, and starts the Node server.
- `src/server/app.ts` exports `createApp()`. Tests import this factory directly with `supertest`, so route and middleware coverage does not require opening a port or starting Vite.
- Development uses Vite in middleware mode on the same HTTP or HTTPS server instance as Express. Vite HMR uses the same Node server for WebSocket upgrades.
- Production serves the prebuilt SPA from `dist/` and keeps the same API routes.
- The app listens on port `3000`.
- If `dev-key.pem` and `dev-cert.pem` exist, local development runs over HTTPS so camera scanning works on mobile devices. `generate-certs.js` prepares those runtime files.
- `/api/server-info` is mounted in `server.ts` because it needs the resolved protocol, port, LAN IP, and optional tunnel URL.

## Repository Layout

```text
OptiCapture/
|- server.ts
|- generate-certs.js
|- start-tunnel.js
|- public/
|  \- icons/
|- docs/
|  |- ARCHITECTURE.md
|  |- DEMO_SCRIPT.md
|  |- Initial Integration Plan.md
|  \- TECHNICAL.md
|- tests/
|- src/
|  |- main.tsx
|  |- App.tsx
|  |- context/
|  |  \- AuthContext.tsx
|  |- lib/
|  |  |- apiFetch.ts
|  |  |- constants.ts
|  |  |- imageUpload.ts
|  |  |- mobileScanScanner.ts
|  |  |- utils.ts
|  |  \- zxingStoreScanner.ts
|  |- pages/
|  |  |- Dashboard.tsx
|  |  |- Import.tsx
|  |  |- Login.tsx
|  |  |- Logs.tsx
|  |  |- MobileScan.tsx
|  |  |- Scan.tsx
|  |  |- Signup.tsx
|  |  |- StorePicker.tsx
|  |  |- StoreSettings.tsx
|  |  \- SuperAdmin.tsx
|  |- components/
|  |  |- dashboard/
|  |  |- import/
|  |  |- logs/
|  |  |- mobile-scan/
|  |  |- scan/
|  |  |- signup/
|  |  |- store-settings/
|  |  |- superadmin/
|  |  \- Layout.tsx
|  |- hooks/
|  |  |- useActiveSessions.ts
|  |  |- useAdminStores.ts
|  |  |- useCategoryManagement.ts
|  |  |- useCommitModal.ts
|  |  |- useDashboardStats.ts
|  |  |- useDraftManagement.ts
|  |  |- useEditItem.ts
|  |  |- useGlobalSearch.ts
|  |  |- useHardwareScanner.ts
|  |  |- useImportWorkflow.ts
|  |  |- useItemManagement.ts
|  |  |- useLogsPage.ts
|  |  |- useMobileScan.ts
|  |  |- useScanSession.ts
|  |  |- useServerInfo.ts
|  |  |- useSignupFlow.ts
|  |  |- useStoreSettings.ts
|  |  |- useStoreUsers.ts
|  |  \- useToast.ts
|  \- server/
|     |- app.ts
|     |- cache.ts
|     |- db.ts
|     |- helpers.ts
|     |- logger.ts
|     |- middleware.ts
|     |- types.ts
|     \- routes/
|        |- admin.ts
|        |- auth.ts
|        |- categories.ts
|        |- inventory.ts
|        |- logs.ts
|        \- sessions.ts
```

## Frontend Architecture

### App shell and routing

- `src/main.tsx` installs the API fetch interceptor before mounting React, then renders `App` under `StrictMode`.
- `src/App.tsx` owns route wiring, lazy imports, route-level suspense fallbacks, protected-route behavior, admin-only routing, store-selection routing, and the top-level error boundary.
- `src/context/AuthContext.tsx` owns session hydration, store access list loading, login/logout, store switching, leaving the current store, and user refresh.
- `src/lib/apiFetch.ts` wraps same-origin `/api/` fetches so the current tab's active store is sent as `X-Store-Id` when selected.

Current client routes:

- `/login`
- `/signup`
- `/choose-store`
- `/admin`
- `/mobile-scan/:sessionId`
- `/`
- `/scan`
- `/import`
- `/logs`
- `/settings`

### Route patterns

The app uses feature-oriented route composition rather than large all-in-one page files.

1. Thin page wrappers
   Routes delegate immediately to feature screens.
   Examples: `Import.tsx`, `Logs.tsx`, `Signup.tsx`, `StoreSettings.tsx`, `MobileScan.tsx`

2. Page orchestrators
   Routes still own high-level composition while hooks and components carry most state and UI.
   Examples: `Dashboard.tsx`, `Scan.tsx`, `SuperAdmin.tsx`

3. Route-local implementation
   `Login.tsx` remains the main route with the most page-local behavior.

### Feature modules

- `dashboard/` holds category grids, inventory tables, item modals, export UI, stats, active sessions, and toolbar components.
- `scan/` holds the desktop scan workspace: scanner panel, live feed, commit modal, item edit modal, and toast container.
- `mobile-scan/` holds the phone-side scanner screen, camera panel, manual-entry form, mode toggle, connection banner, draft/completed state, item list, and toast UI.
- `import/` holds the upload, mapping, result, API, and workflow UI for bulk imports.
- `logs/` holds the log filter form, table, API helper, and screen composition.
- `signup/` holds the signup API, brand panel, form card, success card, and screen composition.
- `store-settings/` holds store profile, store code, password, API, and screen composition.
- `superadmin/` holds store table and admin modals for editing stores, deleting stores, resetting passwords, and managing store users.

### Scanning on the client

- Desktop scan state is split across hooks such as `useScanSession`, `useHardwareScanner`, `useDraftManagement`, `useCommitModal`, `useActiveSessions`, and `useServerInfo`.
- Phone-side scan state lives in `useMobileScan`.
- `src/lib/mobileScanScanner.ts` prefers the native `BarcodeDetector` API when available and falls back to the ZXing-based scanner.
- `src/lib/zxingStoreScanner.ts` implements the small lazy ZXing camera fallback directly from `@zxing/library`, avoiding the larger browser package.
- Mobile clients identify themselves with a locally generated `scan_device_id`, sent on scan requests as `X-Device-Id`.

## Backend Architecture

### Runtime bootstrap

`server.ts` is responsible for process-level and server-level concerns:

- loading environment variables
- failing fast when `JWT_SECRET` is missing
- importing `src/server/db.ts` so migrations, indexes, seeds, and audit pruning run before routes are registered
- creating the Express app through `createApp()`
- exposing `/api/server-info`
- selecting HTTP or HTTPS based on local certificate files
- attaching Vite middleware in development
- serving `dist/index.html` in production
- logging process-level unhandled errors
- emitting structured JSON startup, shutdown, warning, and error records
- graceful shutdown on `SIGTERM` and `SIGINT`

### App factory

`src/server/app.ts` owns the reusable Express application:

- `trust proxy: 1`
- Helmet security headers with stricter production CSP
- API limiting before body parsing, JSON body parsing, and object-body validation, including a larger limit for `batch-confirm`
- cookie parsing
- `/uploads` static serving with dotfiles denied and forced download disposition
- `/icons` static serving from `public/icons`
- `/api/drive-image/:fileId` Google Drive image proxy with file ID validation, an 8-second timeout, MIME allowlist, and streaming 5 MB response cap
- API rate limiting on `/api`
- route mounting
- global JSON error handler

### Shared server modules

| File | Responsibility |
|---|---|
| `src/server/app.ts` | Express app factory, middleware, static assets, Drive proxy, route mounting, error handler |
| `src/server/db.ts` | SQLite connection, schema creation, numbered migrations, indexes, seed data, audit pruning |
| `src/server/middleware.ts` | JWT auth, active-store resolution, rate limiters, Google OAuth client, role guards |
| `src/server/helpers.ts` | UPC lookup, image persistence, image URL normalization, store code generation, OTP generation, tunnel/LAN helpers |
| `src/server/logger.ts` | Structured JSON application and process logging |
| `src/server/cache.ts` | In-memory UPC cache, pending OAuth registrations, revoked token tracking |
| `src/server/types.ts` | Shared request, auth, lookup, and session-status types |

### Route modules

| Route module | Main responsibilities |
|---|---|
| `auth.ts` | Login/logout, Google OAuth, OAuth pending signup, registration, current user, store list, store switching, store settings, password changes |
| `admin.ts` | Superadmin store list/update/delete, store-user access management, store suspension, user creation/removal, password reset |
| `categories.ts` | Dashboard stats, category list/create/update/delete, category activation, category-scoped bulk item delete |
| `inventory.ts` | Inventory list/search/detail, item CRUD, export, batch upload parsing, batch import confirmation |
| `sessions.ts` | Scan session lifecycle, active sessions, draft/completed status, mobile item polling, OTP scan ingestion, item edits/deletes, commit flow |
| `logs.ts` | Filtered audit log retrieval |

## Data Model and Multi-Tenancy

### Database

The app uses `better-sqlite3`. By default the database file is `opticapture.db` at the repo root; tests override this with `DATABASE_PATH=:memory:`.

Current database characteristics:

- WAL mode is enabled for better concurrent read/write behavior.
- `busy_timeout` is set to reduce transient `SQLITE_BUSY` failures during active scanning.
- foreign keys are enabled on the connection.
- startup applies schema creation and numbered migrations inside `src/server/db.ts`; migrations are transactional where SQLite permits it.
- migration 17 restores the `users.store_id -> stores.id` foreign key and verifies the rebuilt table.
- audit logs older than 90 days are pruned at startup and then daily.

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

Important current columns include:

- `stores`: profile fields, logo, status, city/state/address fields, generated `store_code`
- `users`: username/password, role, default store, OAuth fields, email, login lockout fields, `token_version`, `must_reset_password`
- `inventory`: item name/description, quantity/unit, category, status, pricing/tax, image, UPC, item number, tags, external mapping fields
- `scan_sessions`: session ID, OTP, user/store, status, label, OTP attempts, expiry
- `session_items`: UPC, quantity, lookup metadata, product fields, source, `device_id`, timestamps

### Tenant model

Operational data is store-scoped:

- `categories.store_id`
- `inventory.store_id`
- `logs.store_id`
- `scan_sessions.store_id`
- `user_stores.store_id`

Users can belong to multiple stores through `user_stores`. The login cookie identifies the account, while the active store is resolved per request:

- superadmin requests run without a store-scoped user context
- single-store users are auto-resolved to their only active store
- multi-store users must choose a store
- browser tabs persist their selected store in `sessionStorage`
- same-origin API requests carry the selected store through `X-Store-Id`
- the server validates that requested store access exists and that the store is active

Special cases:

- store `id = 0` is the OptiCapture HQ context used by `superadmin`
- regular stores use generated 6-character `store_code` values for credential login

## Authentication and Authorization

### Session model

- JWTs are signed with `HS256`.
- JWTs include issuer `opticapture` and audience `opticapture-app`.
- token lifetime is 8 hours.
- the token is stored in an `httpOnly` cookie named `token`.
- cookies use `secure: true` on HTTPS.
- cookies use `sameSite: strict` on HTTPS and `lax` during plain HTTP development.
- `token_version` invalidates older cookies after password changes and superadmin resets.

### Enforcement

- `authenticateToken` verifies signature, issuer, audience, token revocation, token version, password-reset state, store access, and store suspension.
- `requireOwner` allows owners and superadmins to manage categories, exports, and batch imports.
- `requireOwnerOrTaker` allows owners, superadmins, and takers to add, edit, and delete individual inventory items.
- Superadmin-only behavior is enforced inside admin routes with a local `requireSuperadmin` guard.
- Users with temporary reset passwords are forced to `/settings` and can only access the small set of auth endpoints needed to complete the reset.

### Additional controls

- auth rate limit: 20 requests per 15 minutes per IP
- general API limit: 2000 requests per 15 minutes per IP
- scan endpoint limit: 60 requests per minute per IP
- failed logins trigger a 15-minute lockout after 5 bad attempts
- logout revokes the current token in memory
- password changes increment `token_version` so old tokens stop working
- scan OTP attempts are tracked on the session

### OAuth

Google OAuth is optional and wired through `google-auth-library`.

The current flow:

1. `/api/auth/google` starts OAuth and stores a short-lived CSRF nonce in a cookie.
2. `/api/auth/google/callback` validates state and looks up or links the user.
3. New OAuth signups are stored temporarily in the in-memory `pendingOAuth` cache.
4. `/api/auth/google/pending` lets the signup screen retrieve pending OAuth profile context.
5. The signup screen finishes registration through `/api/auth/register`.

## Key Workflows

### Store login and store switching

1. A user logs in with username, password, and store code. Superadmin login omits the store code.
2. The server issues the account cookie and returns user state.
3. `AuthContext` refreshes `/api/auth/me` and loads `/api/auth/my-stores`.
4. If a non-superadmin user has more than one active store and no active store header, the client routes to `/choose-store`.
5. `StorePicker` calls `/api/auth/switch-store`; the chosen store is persisted in tab-scoped `sessionStorage`.
6. Switching or leaving a store clears store-scoped scan session state from `sessionStorage`.

### Live scanning

The desktop scan flow is owned by `Scan.tsx` and the scan hooks/components.

1. The desktop page creates or resumes a scan session through `POST /api/session/create`.
2. The server returns a `sessionId` and OTP.
3. `useServerInfo` builds a mobile URL using either the tunnel URL or the LAN address.
4. The QR code points the phone to `/mobile-scan/:sessionId?otp=...`.
5. `MobileScanScreen` and `useMobileScan` load session items through `GET /api/session/:id/items?otp=...`.
6. The phone submits scans to `POST /api/session/:id/scan` with OTP and `X-Device-Id`.
7. Hardware scanners use keyboard-wedge input on desktop and submit through the same session workflow.
8. The server checks existing inventory first, then falls back to cached/external UPC lookup providers.
9. The desktop page polls `GET /api/session/:id` using the stable `since_updated_at` plus `since_id` cursor for incremental refresh.
10. The session can be saved as a draft, resumed, cleared, deleted, edited, or committed into inventory with category assignments.

### External product lookup

UPC lookup lives in `src/server/helpers.ts` and currently uses:

- Open Food Facts
- UPCitemDB
- Go-UPC when `GO_UPC_API_KEY` is configured; a successful Go-UPC result is preferred

Results are cached in memory for 7 days in `upcCache` to avoid repeated external lookups for the same barcode.

### Batch import

The import flow is split into a dedicated feature module:

- screen: `src/components/import/ImportScreen.tsx`
- workflow hook: `src/hooks/useImportWorkflow.ts`
- request and normalization layer: `src/components/import/importApi.ts`

Current behavior:

1. The client uploads a file to `POST /api/inventory/batch-upload`.
2. The server parses XLSX, CSV, or JSON input.
3. The server returns normalized sheet payloads with headers, preview rows, full rows, and row counts.
4. The client auto-detects column mappings from header synonyms.
5. Confirming the import sends mapped sheet data to `POST /api/inventory/batch-confirm`.
6. The server runs a transaction that creates missing categories, inserts new rows, updates existing rows, preserves external mapping fields, records skipped rows, and writes audit log details.

### Image handling

Manual uploads:

- client validation lives in `src/lib/imageUpload.ts`
- server validation and persistence live in `saveBase64Image()` in `src/server/helpers.ts`
- supported formats are JPG, PNG, GIF, and WEBP
- unsupported formats return `400`

Imported image URLs:

- inventory import reads image values from sheet rows
- `normalizeImageUrl()` converts supported Google Drive sharing links into `/api/drive-image/:fileId`
- non-Drive URLs are stored as-is; supported base64 images are persisted through the normal image helper

Drive proxy:

- `src/server/app.ts` exposes `/api/drive-image/:fileId`
- file IDs are restricted to alphanumeric, underscore, and hyphen characters
- the server fetches image bytes server-side and returns only image content
- response bodies are capped at 5 MB
- private Drive files still need to be publicly accessible to render successfully

### Audit logs

- activity logs are stored in the `logs` table
- reads are exposed through `GET /api/logs` with server-side action, keyword, date, and page filters
- both owners and takers can view their current store's isolated audit trail
- the logs page is split into `LogsScreen`, `LogsFilters`, `LogsTable`, `logsApi`, and `useLogsPage`
- old log entries are pruned automatically after 90 days

## Build, Test, And Deployment Model

- frontend build: `vite build`
- TypeScript check: `tsc --noEmit`
- ESLint check: `eslint src --max-warnings 0`
- unit/integration tests: `vitest run`
- coverage: `vitest run --coverage`
- e2e tests: `playwright test`
- full local check: `npm run test:full`
- development runtime: single Node process with Express + Vite middleware
- production runtime: Express serves the built SPA and API from the same process
- static files:
  - `/icons` -> `public/icons`
  - `/uploads` -> repo-root `uploads/`

This architecture is optimized for a single deployed application instance.

## Current Architectural Direction

The current direction is feature-oriented modules, small page wrappers, and testable server boundaries.

Already migrated to feature modules:

- Import
- Logs
- Signup
- Store Settings
- Mobile Scan

Mostly modular but still page-orchestrated:

- Dashboard
- Scan
- SuperAdmin

Still mostly route-local:

- Login

The clearest next frontend extraction candidate is `Login.tsx`. The highest-value reliability work is broader hook-level scan coverage and real-device scanner validation. On the backend, the biggest future boundary is replacing single-instance state and local persistence if the app moves to multiple server instances.

## Scaling Notes

| Concern | Current state | Likely next step |
|---|---|---|
| Database | SQLite file with WAL | move to Postgres or another server DB for multi-instance scaling |
| Live session updates | polling with a timestamp-and-ID cursor | move to SSE or WebSockets |
| File storage | local disk | move uploads to object storage |
| OAuth state and token revocation | in-memory maps | move to Redis or persistent shared storage |
| UPC lookup cache | in-memory map with 7-day TTL | move to shared cache if running multiple instances |
| Drive image proxy | anonymous/public access only | add authenticated Google API access if private Drive files must render |
