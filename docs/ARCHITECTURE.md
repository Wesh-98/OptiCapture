# OptiCapture Architecture

Last updated: 2026-10-13

This document reflects the current codebase after the server/app split, lazy route loading, multi-store active-store selection, the mobile-scan extraction, and the Super Admin inventory pages.

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
  |- Vite middleware in development or dist/ in production
            |
            +--> SQLite (better-sqlite3, WAL mode)
            +--> local uploads directory
            +--> Go-UPC / Open Food Facts / UPCitemDB
            +--> Google OAuth
```

## Runtime Topology

- `npm run dev` runs `node generate-certs.js && tsx server.ts`. `npm start` runs `tsx server.ts` for production.
- `server.ts` is the runtime entry point. It loads env vars, validates `JWT_SECRET`, imports the database module so migrations run, creates the Express app, attaches Vite or static serving, and starts the Node server.
- `src/server/app.ts` exports `createApp()`. Tests import this factory directly with `supertest`, so route and middleware coverage does not require opening a port or starting Vite.
- Development uses Vite in middleware mode on the same HTTP or HTTPS server instance as Express. Vite HMR uses the same Node server for WebSocket upgrades.
- Production serves the prebuilt SPA from `dist/` and keeps the same API routes. Vite is loaded only in development.
- The app listens on `PORT`, defaulting to `3000`.
- If `dev-key.pem` and `dev-cert.pem` exist, local development runs over HTTPS so camera scanning works on mobile devices. `generate-certs.js` prepares those runtime files.
- `/api/server-info` is registered in `src/server/app.ts`, ahead of the JSON 404 for unknown API paths. It returns `PUBLIC_BASE_URL` when that is set and otherwise the tunnel or LAN address; `server.ts` records the resolved protocol on the app for it.
- `/api/health` answers before the rate limiter so a load balancer can poll it.

## Repository Layout

```text
OptiCapture/
|- server.ts
|- generate-certs.js
|- start-tunnel.js
|- scripts/
|  |- backup-db.mjs
|  |- export-db-schema.mjs
|  \- export-erd.mjs
|- public/
|  \- icons/
|- docs/
|  |- ARCHITECTURE.md
|  |- TECHNICAL.md
|  |- Demo.MD
|  |- DATABASE_SCHEMA.md
|  |- DATABASE_RELATIONSHIPS_CURRENT.md
|  |- database-schema.sql
|  \- opticapture-erd.svg, opticapture-erd-quick.svg
|- e2e/
|- tests/
|- src/
|  |- main.tsx
|  |- App.tsx
|  |- context/
|  |  |- AuthContext.tsx
|  |  \- ToastContext.tsx
|  |- lib/
|  |  |- apiFetch.ts
|  |  |- constants.ts
|  |  |- emailFormat.ts
|  |  |- imageUpload.ts
|  |  |- mobileScanScanner.ts
|  |  |- utils.ts
|  |  \- zxingStoreScanner.ts
|  |- pages/
|  |  |- Dashboard.tsx, Scan.tsx, Import.tsx, Logs.tsx, StoreSettings.tsx
|  |  |- Login.tsx, Signup.tsx, StorePicker.tsx, MobileScan.tsx
|  |  |- AdminDashboard.tsx, AdminStoreInventory.tsx, AdminItemDetail.tsx
|  |  |- AdminRecentItems.tsx, AdminItemSearch.tsx, AdminActivity.tsx
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
|  |- hooks/            one concern per hook; see TECHNICAL.md section 5
|  \- server/
|     |- app.ts
|     |- cache.ts
|     |- db.ts
|     |- helpers.ts
|     |- logger.ts
|     |- middleware.ts
|     |- storeDetails.ts
|     |- types.ts
|     |- uploads.ts
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
- `/mobile-scan/:sessionId`
- `/`
- `/scan`
- `/import`
- `/logs`
- `/settings`
- `/admin` (all stores)
- `/admin/recent`
- `/admin/search`
- `/admin/activity`
- `/admin/stores` (store settings)
- `/admin/stores/:id` (one store's inventory)
- `/admin/stores/:id/items` and `/admin/stores/:id/items/:itemId`

### Route patterns

The app uses feature-oriented route composition rather than large all-in-one page files.

1. Thin page wrappers
   Routes delegate immediately to feature screens.
   Examples: `Import.tsx`, `Logs.tsx`, `Signup.tsx`, `StoreSettings.tsx`, `MobileScan.tsx`

2. Page orchestrators
   Routes still own high-level composition while hooks and components carry most state and UI.
   Examples: `Dashboard.tsx`, `Scan.tsx`, `SuperAdmin.tsx`, `AdminDashboard.tsx`, `AdminItemDetail.tsx`

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
- `superadmin/` holds the Super Admin shell (`AdminLayout`: collapsible sidebar plus a top bar with the store switcher), the shared cross-store list page (`ItemListPage`) and its tables, the item edit form, the activity table, and the store table and modals for editing stores, deleting stores, resetting passwords, and managing store users.

### Scanning on the client

- Desktop scan state is split across hooks such as `useScanSession`, `useHardwareScanner`, `useDraftManagement`, `useCommitModal`, `useActiveSessions`, and `useServerInfo`.
- Phone-side scan state lives in `useMobileScan`.
- `src/lib/mobileScanScanner.ts` prefers the native `BarcodeDetector` API when available and falls back to the ZXing-based scanner.
- `src/lib/zxingStoreScanner.ts` implements the small lazy ZXing camera fallback directly from `@zxing/library`, avoiding the larger browser package.
- Mobile clients identify themselves with a locally generated `scan_device_id`, sent on scan and sync requests as `X-Device-Id`.
- `readScanOtp()` in `src/lib/mobileScanScanner.ts` takes the OTP from the link, keeps it in `sessionStorage` for the tab, and the screen then removes it from the address bar.

### Super Admin on the client

The Super Admin pages oversee inventory across stores; store settings and user access stay on `/admin/stores`.

- `AdminDashboard` lists every store with its counts, a "Needs attention" card, and a "Recent changes" card.
- `AdminStoreInventory` and `AdminItemDetail` show one store's items. The store and category are in the URL, so the sidebar, breadcrumbs and shared links agree.
- Item edits open a before-and-after review; nothing is written until it is confirmed.
- `AdminRecentItems`, `AdminItemSearch` and `AdminActivity` share `ItemListPage` and the `useAdminItemList` hook: one page of rows across every store or the one in `?store=`.
- Back navigation is a breadcrumb up one level, not browser history.

## Backend Architecture

### Runtime bootstrap

`server.ts` is responsible for process-level and server-level concerns:

- loading environment variables
- failing fast when `JWT_SECRET` is missing
- importing `src/server/db.ts` so migrations, indexes, seeds, and audit pruning run before routes are registered
- creating the Express app through `createApp()`
- selecting HTTP or HTTPS based on local certificate files
- attaching Vite middleware in development (imported only then)
- serving `dist/index.html` in production
- logging process-level unhandled errors
- emitting structured JSON startup, shutdown, warning, and error records
- graceful shutdown on `SIGTERM` and `SIGINT`

### App factory

`src/server/app.ts` owns the reusable Express application:

- `trust proxy` from `TRUST_PROXY`, defaulting to loopback and private-network proxies
- `/api/health`, registered ahead of the rate limiter
- Helmet security headers with stricter production CSP
- API limiting before body parsing, JSON body parsing, and object-body validation, including a larger limit for `batch-confirm`
- cookie parsing
- `/uploads` static serving with dotfiles denied and forced download disposition
- `/icons` static serving from `public/icons`
- `/api/drive-image/:fileId` Google Drive image proxy with file ID validation, an 8-second timeout, MIME allowlist, and streaming 5 MB response cap
- API rate limiting on `/api`
- route mounting
- `/api/server-info`
- a JSON 404 for unknown `/api` paths
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
| `src/server/storeDetails.ts` | Validation and normalization of store profile fields shared by signup, store settings and admin edits |
| `src/server/uploads.ts` | Finds upload files no row points at any more and removes them |

### Route modules

| Route module | Main responsibilities |
|---|---|
| `auth.ts` | Login/logout, Google OAuth, OAuth pending signup, registration, current user, store list, store switching, store settings, password changes |
| `admin.ts` | Superadmin store list/update/delete, store-user access management, store suspension, user creation/removal, password reset; per-store inventory views and item edits, cross-store recent items and search, the activity feed and its seen marker |
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
- migration 19 adds the `inventory.last_verified_*` columns written when a scan session is committed.
- migrations 20 to 26 add the 24-hour scan window (`scan_sessions.scan_window_started_at`), `inventory.brand`, `inventory.source`, and the per-superadmin activity marker (`users.activity_seen_log_id`), and clean up older Drive image links and reserved category names.
- timestamps are stored as UTC text `YYYY-MM-DD HH:MM:SS`, the form `CURRENT_TIMESTAMP` and `datetime('now')` produce; `session_items` keeps milliseconds for its sync cursor. Server code writes them with `toSqliteUtc()` and reads them with `parseSqliteUtc()`; the client parses them with `parseServerDate()`/`parseServerTimestamp()` so they are never read as local time. Exported files use ISO 8601 UTC with `Z`. Migration 18 converted earlier ISO values.
- audit logs older than 90 days are pruned at startup and then daily, along with scan sessions that were never used.

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
- `users`: username/password, role, default store, OAuth fields, email, login lockout fields, `token_version`, `must_reset_password`, `activity_seen_log_id`
- `inventory`: item name/description, brand, quantity/unit, category, status, pricing/tax, image, UPC, item number, tags, `source`, `last_verified_*`, external mapping fields
- `scan_sessions`: session ID, OTP, user/store, status, label, OTP attempts, expiry, scan window start
- `session_items`: UPC, quantity, lookup metadata, product fields, source, `device_id`, recent scan IDs, timestamps

### Tenant model

Operational data is store-scoped:

- `categories.store_id`
- `inventory.store_id`
- `logs.store_id`
- `scan_sessions.store_id`
- `user_stores.store_id`

Users can belong to multiple stores through `user_stores`. The login cookie identifies the account, while the active store is resolved per request:

- superadmin requests run without a store-scoped user context; admin routes name the store in the URL
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
- `requireOwner` allows owners to manage categories, exports, and batch imports.
- `requireOwnerOrTaker` allows owners and takers to add, edit, and delete individual inventory items.
- Superadmin-only behavior is enforced inside admin routes with a local `requireSuperadmin` guard. A superadmin can view any store's inventory and edit its items; each edit is logged to that store, and suspended stores are read-only.
- Users with temporary reset passwords are forced to `/settings` and can only access the small set of auth endpoints needed to complete the reset.

### Additional controls

- auth rate limit: 20 requests per 15 minutes per IP
- general API limit: 2000 requests per 15 minutes per IP
- scan endpoint limits per minute: 150 per device, 600 per session, 1200 per IP (phones in one store share an IP)
- failed logins trigger a 15-minute lockout after 5 bad attempts
- logout revokes the current token in memory
- password changes increment `token_version` so old tokens stop working
- scan OTP attempts are tracked on the session and lock it after 5 wrong tries

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
3. `useServerInfo` supplies the base of the mobile URL: `PUBLIC_BASE_URL` when configured, otherwise the tunnel URL or the LAN address.
4. The QR code points the phone to `/mobile-scan/:sessionId#otp=...`. The OTP sits after `#`, so it is never sent to the server with the URL; the page stores it for the tab and removes it from the address bar.
5. `MobileScanScreen` and `useMobileScan` load session items through `GET /api/session/:id/items`, sending the OTP and device ID as the `X-Scan-Otp` and `X-Device-Id` headers.
6. The phone submits scans to `POST /api/session/:id/scan` with the OTP in the body, `X-Device-Id`, and a `scan_id` so a retried request is not counted twice.
7. Hardware scanners use keyboard-wedge input on desktop and submit through the same session workflow, with a `scan_id` and the same network retry as the phone.
8. The server checks existing inventory first, then falls back to cached/external UPC lookup providers.
9. The desktop page polls `GET /api/session/:id` using the stable `since_updated_at` plus `since_id` cursor for incremental refresh.
10. The session can be saved as a draft, resumed, cleared, deleted, edited, or committed. Commit adds new items with their scanned quantity and an assigned category, and records existing catalog items as seen on the shelf (`last_verified_at`, `last_verified_by`, `last_verified_session_id`) without changing their details or stock. Existing items are read-only in the scan workspace. The session completes once no staged items remain.

### External product lookup

UPC lookup lives in `src/server/helpers.ts` and currently uses:

- Open Food Facts
- UPCitemDB
- Go-UPC when `GO_UPC_API_KEY` is configured; a successful Go-UPC result is preferred

Results are cached in memory for 7 days in `upcCache` to avoid repeated external lookups for the same barcode. A lookup that found nothing because a provider failed, timed out or rate-limited is cached for 5 minutes only, so the barcode is looked up again once the provider recovers.

### Batch import

The import flow is split into a dedicated feature module:

- screen: `src/components/import/ImportScreen.tsx`
- workflow hook: `src/hooks/useImportWorkflow.ts`
- request and normalization layer: `src/components/import/importApi.ts`

Current behavior:

1. The client uploads a file to `POST /api/inventory/batch-upload`.
2. The server parses XLSX, CSV, or JSON input.
3. For Excel files, the server detects the header row within the first 100 worksheet rows (known column names and text labels count, row width does not) and skips hidden worksheets, then returns normalized sheet payloads with the header-row number, worksheet used-column count, headers, preview rows, full rows, each row's file line, and row counts. CSV and JSON header names are trimmed so they match what the mapping screen shows.
4. The client auto-detects column mappings from the header vocabulary in `src/shared/importHeaders.ts` (shared with the server's header detection), presents the workbook filename and every worksheet name, count, and detected column, shows raw and mapped five-row previews, suggests editable categories from meaningful worksheet names, and validates every sheet for a supported identifier or header-count mismatch.
5. Destination fields are one-to-one. Mapping choices can be copied to matching headers on other sheets without replacing mappings for differently named columns.
6. Confirming the import sends mapped sheet data to `POST /api/inventory/batch-confirm`.
7. The server validates the mappings, then commits the rows in chunks. Each row's identifiers must all point at the same item (or none); a row that disagrees with the catalog is held back and listed on the result screen, where the owner chooses per row whether the item takes the file's identifiers; a row that repeats an item already in the file is reported with its sheet and row. Valid rows insert or update items, fill in identifiers the item lacks, create the categories they use, and the import writes audit log details. A mapped row category takes precedence over the user-reviewed worksheet category fallback.

### Image handling

Manual uploads:

- client validation lives in `src/lib/imageUpload.ts`
- server validation and persistence live in `saveBase64Image()` in `src/server/helpers.ts`
- supported formats are JPG, PNG, GIF, and WEBP
- unsupported formats return `400`

Imported image URLs:

- inventory import reads image values from sheet rows
- `normalizeImageUrl()` converts supported Google Drive sharing links into `/api/drive-image/:fileId`
- other `http(s)://` links are stored as-is; supported base64 images are persisted through the normal image helper
- any other value (an `/api/...` path, a `//host` link, another scheme) is left off the item and reported for that row; the same rule refuses it with `400` on manual add, edit and staged-scan edits

Drive proxy:

- `src/server/app.ts` exposes `/api/drive-image/:fileId`
- file IDs are restricted to alphanumeric, underscore, and hyphen characters
- the server fetches image bytes server-side and returns only image content
- response bodies are capped at 5 MB
- private Drive files still need to be publicly accessible to render successfully

### Audit logs

- activity logs are stored in the `logs` table
- reads are exposed through `GET /api/logs` with server-side action, keyword, date, and page filters
- owners can view their current store's isolated audit trail; takers cannot
- the superadmin activity feed (`GET /api/admin/activity`) reads the same table across stores, limited to store events and scan captures, and never shows raw log text
- each superadmin has a marker (`users.activity_seen_log_id`); entries above it show as new until "Mark all as seen". Nothing is deleted
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
- CI (GitHub Actions): TypeScript and ESLint, unit tests with coverage, Playwright e2e, and the production build, plus SonarCloud analysis and CodeRabbit review on pull requests
- development runtime: single Node process with Express + Vite middleware
- production runtime: `npm start`; Express serves the built SPA and API from the same process
- database backup: `npm run db:backup` takes an online backup and keeps the latest 14
- static files:
  - `/icons` -> `public/icons`
  - `/uploads` -> `UPLOADS_DIR`, defaulting to repo-root `uploads/`

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
- SuperAdmin (store settings) and the Super Admin inventory pages

Still mostly route-local:

- Login

The clearest next frontend extraction candidate is `Login.tsx`. The highest-value reliability work is real-device scanner validation: the scan hooks are tested mounted, but the camera path only runs on a phone. On the backend, the biggest future boundary is replacing single-instance state and local persistence if the app moves to multiple server instances.

## Scaling Notes

| Concern | Current state | Likely next step |
|---|---|---|
| Database | SQLite file with WAL | move to Postgres or another server DB for multi-instance scaling |
| Live session updates | polling with a timestamp-and-ID cursor | move to SSE or WebSockets |
| File storage | local disk | move uploads to object storage |
| OAuth state and token revocation | in-memory maps | move to Redis or persistent shared storage |
| UPC lookup cache | in-memory map with 7-day TTL | move to shared cache if running multiple instances |
| Drive image proxy | anonymous/public access only | add authenticated Google API access if private Drive files must render |
