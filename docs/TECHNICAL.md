# OptiCapture Technical Reference

Last updated: 2026-10-13

For engineering collaborators. Covers the current application structure, data model, API surface, scan lifecycle, security posture, and known trade-offs.

## 1. Project Overview

OptiCapture is a retail inventory management system for small to mid-size stores. Its core workflow is mobile-assisted barcode scanning: an authenticated desktop user starts a scan session, staff join from a phone QR link, and scan results appear in the desktop review feed without requiring a mobile app install.

Key capabilities:

- Multi-store, multi-role user model: owner, taker, superadmin.
- Store-code credential login plus optional Google OAuth.
- Per-tab active-store selection for multi-store users.
- OTP-gated mobile scan sessions.
- Phone camera scanning with native `BarcodeDetector` first and ZXing fallback.
- Hardware scanner support through keyboard-wedge input.
- Draft scan sessions with labels, resume, clear, delete, and commit workflows.
- Batch inventory import via XLSX, CSV, or JSON.
- Inventory export to XLSX, CSV, JSON, and PDF.
- External mapping fields for future integration and reconciliation.
- Store-scoped audit logs.
- Superadmin oversight of every store's inventory: per-store item views and edits, search across stores, recently added items, and an activity log.
- Superadmin store management: status, details, user access, and password resets.

## 2. Runtime Structure

```text
server.ts
  - loads dotenv
  - validates JWT_SECRET
  - imports src/server/db.ts for migrations/seeds
  - creates the Express app with createApp()
  - creates the HTTP or HTTPS server
  - attaches Vite middleware in development (Vite is not loaded in production)
  - serves dist/ in production
  - listens on PORT (default 3000)

src/server/app.ts
  - exports createApp()
  - configures trust proxy (TRUST_PROXY), Helmet, JSON parsing, cookies
  - exposes /api/health before the rate limiter
  - rate-limits API requests before body parsing and validates JSON object bodies
  - serves /uploads and /icons
  - exposes /api/drive-image/:fileId and /api/server-info
  - mounts API routers
  - answers unknown /api paths with a JSON 404
  - registers the JSON error handler
```

Tests import `createApp()` directly, so API coverage can run without a live port, HTTPS certificate, or Vite dev server.

## 3. Tech Stack

| Layer | Library | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 20 in CI | ESM project, executed with `tsx` (`npm run dev`, `npm start`) |
| Backend | Express | 4.21 | App factory plus route modules |
| Database | better-sqlite3 | 12.4 | Synchronous SQLite driver, WAL mode |
| Auth | jsonwebtoken | 9.0 | HS256, httpOnly cookie |
| Passwords | bcryptjs | 3.0 | Hashing for credential accounts |
| Security | helmet | 8.1 | CSP, HSTS, frame guards |
| Rate limiting | express-rate-limit | 8.3 | Auth, API, and per-session/device scan tiers |
| OAuth | google-auth-library | 10.6 | Google OAuth ID token verification |
| File upload | multer | 2.1 | In-memory import buffer |
| Excel | exceljs | 4.4 | XLSX parse/export |
| CSV | papaparse | 5.5 | CSV parse/export |
| PDF | pdfkit | 0.18 | PDF inventory export |
| Frontend | React + TypeScript | 19 + 5.8 | SPA with route-level lazy loading |
| Router | react-router-dom | 7.13 | Browser routes and redirects |
| Build | Vite | 6.2 | Dev middleware and production build |
| Styling | Tailwind CSS | 4.1 | Via `@tailwindcss/vite` |
| Animation | Motion | 12.23 | `motion/react` |
| Icons | lucide-react | 0.546 | UI icon set |
| Scanning | @zxing/library | 0.21 | Lazy-loaded camera fallback when `BarcodeDetector` is unavailable |
| Tests | Vitest + Supertest + Playwright | 4.1 / 7.2 / 1.62 | Unit, integration, and e2e coverage |

## 4. Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Environment values (see `.env.example`):

```text
JWT_SECRET=<required>
NODE_ENV=<development|production|test>
PORT=<optional, default 3000>
PUBLIC_BASE_URL=<public HTTPS origin phones open from the QR code; required in production>
TRUST_PROXY=<optional; which proxies may set X-Forwarded-For>
DATABASE_PATH=<optional; default opticapture.db at the repo root>
UPLOADS_DIR=<optional; default ./uploads>
BACKUP_DIR=<optional; used by npm run db:backup>
BACKUP_KEEP=<optional; how many backups db:backup keeps, default 14>
GOOGLE_CLIENT_ID=<optional>
GOOGLE_CLIENT_SECRET=<optional>
GOOGLE_REDIRECT_URI=<optional>
UPCITEMDB_API_KEY=<optional>
GO_UPC_API_KEY=<optional paid provider>
ALLOW_DEMO_SEED=<true for local demo seed only>
TUNNEL_HOST=<optional local tunnel host>
DISABLE_HMR=<optional>
```

Useful commands:

```bash
npm run lint
npm run lint:eslint
npm run test
npm run test:coverage
npm run test:e2e
npm run build
npm run test:full
npm start          # production: tsx server.ts
npm run db:backup  # online SQLite backup
```

`npm run dev:scan` runs the dev server and tunnel helper together for phone scanning outside localhost.

## 5. Frontend Architecture

`src/main.tsx` installs `installApiFetchInterceptor()` before mounting React. The interceptor adds `X-Store-Id` to same-origin `/api/` calls when the current tab has selected an active store.

`src/App.tsx` owns:

- lazy route imports
- route-level suspense fallbacks
- top-level error boundary
- authenticated route gating
- superadmin route gating
- multi-store selection route gating
- forced password-reset redirects

Current routes:

| Path | Page | Notes |
|---|---|---|
| `/login` | `Login.tsx` | Credential and OAuth entry |
| `/signup` | `Signup.tsx` | Store/owner registration and OAuth pending signup |
| `/choose-store` | `StorePicker.tsx` | Per-tab active-store selection |
| `/mobile-scan/:sessionId` | `MobileScan.tsx` | OTP-based phone scanner; no login |
| `/` | `Dashboard.tsx` | Main inventory dashboard |
| `/scan` | `Scan.tsx` | Desktop scan session workspace |
| `/import` | `Import.tsx` | Batch import wizard (owner) |
| `/logs` | `Logs.tsx` | Audit log view (owner) |
| `/settings` | `StoreSettings.tsx` | Store profile and password change |
| `/admin` | `AdminDashboard.tsx` | Superadmin: all stores, needs attention, recent changes |
| `/admin/recent` | `AdminRecentItems.tsx` | Superadmin: items added in the last 1, 7 or 30 days |
| `/admin/search` | `AdminItemSearch.tsx` | Superadmin: item search across stores |
| `/admin/activity` | `AdminActivity.tsx` | Superadmin: store events and captures, with mark-as-seen |
| `/admin/stores` | `SuperAdmin.tsx` | Superadmin: store settings, users, password resets |
| `/admin/stores/:id` | `AdminStoreInventory.tsx` | Superadmin: one store's inventory |
| `/admin/stores/:id/items` and `/items/:itemId` | `AdminItemDetail.tsx` | Superadmin: item view and edit |

Superadmins are redirected to `/admin` from the store pages; other roles are redirected away from `/admin`. Navigation lives in a collapsible left sidebar in both the store portal (`components/Layout.tsx`) and the Super Admin shell (`components/superadmin/AdminLayout.tsx`).

Feature folders:

- `components/dashboard/`
- `components/import/`
- `components/logs/`
- `components/mobile-scan/`
- `components/scan/`
- `components/signup/`
- `components/store-settings/`
- `components/superadmin/`

Stateful hooks:

- dashboard: `useDashboardStats`, `useActiveSessions`, `useCategoryManagement`, `useItemManagement`
- scan: `useScanSession`, `useHardwareScanner`, `useDraftManagement`, `useCommitModal`, `useEditItem`, `useServerInfo`, `useToast`
- mobile scan: `useMobileScan`
- settings/import/logs/signup: `useStoreSettings`, `useImportWorkflow`, `useLogsPage`, `useSignupFlow`
- superadmin: `useAdminStores`, `useStoreUsers`, `useAdminStoreList`, `useAdminStoreInventory`, `useAdminItemDetail`, `useAdminItemList` (shared by `useAdminRecentItems`, `useAdminItemSearch` and the activity log), `useAdminActivity`

## 6. Database Schema

The database module uses `DATABASE_PATH` when provided and otherwise writes to `opticapture.db` at the repo root. Tests use `:memory:`.

Connection settings:

- `journal_mode = WAL`
- `busy_timeout = 5000`
- `foreign_keys = ON`

Core tables:

| Table | Purpose |
|---|---|
| `stores` | Tenant/store profile, status, and store code |
| `users` | Account credentials, OAuth fields, lockout/reset state, default store |
| `user_stores` | Many-to-many user access and per-store role |
| `categories` | Store-scoped item categories |
| `inventory` | Store-scoped inventory records |
| `scan_sessions` | Desktop/mobile count sessions |
| `session_items` | Staged scan records and lookup metadata |
| `logs` | Store-scoped audit records |
| `schema_migrations` | Applied migration versions |

Important current columns:

- `stores`: `name`, `street`, `city`, `zipcode`, `state`, `address`, `phone`, `email`, `logo`, `status`, `store_code`.
- `users`: `username`, `password`, `role`, `store_id`, `store_name`, `email`, `oauth_provider`, `oauth_id`, `failed_login_attempts`, `locked_until`, `token_version`, `must_reset_password`, `activity_seen_log_id`.
- `inventory`: item fields (including `brand`) plus `source` (`manual`, `import` or `scan`), `last_verified_at`, `last_verified_by`, `last_verified_session_id`, `external_system`, `external_store_id`, `external_category_id`, `external_item_id`, `external_sku`, `last_imported_at`, `last_exported_at`, `sync_status`.
- `scan_sessions`: `session_id`, `otp`, `user_id`, `store_id`, `status`, `label`, `expires_at`, `otp_attempts`, `scan_window_started_at`.
- `session_items`: `upc`, `quantity`, `lookup_status`, `product_name`, `brand`, `image`, `source`, `exists_in_inventory`, `sale_price`, `unit`, `tag_names`, `device_id`, `recent_scan_ids`, `updated_at`.

Useful indexes include:

- `idx_session_items_session_upc`
- `idx_session_items_session_at`
- `idx_session_items_session_updated`
- `idx_inventory_upc_store`
- `idx_inventory_number_store`
- `idx_inventory_external_item_store`
- `idx_inventory_store_created`
- `idx_inventory_created`
- `idx_inventory_trimmed_upc`
- `idx_scan_sessions_store_status`
- `idx_scan_sessions_user_store`
- `idx_logs_store_ts`

Migrations are defined in `src/server/db.ts` with `runMigration(version, fn)` and are designed to be idempotent. The current code has migrations 1 through 26. The full DDL is in [database-schema.sql](database-schema.sql), generated from the migrations.

## 7. Authentication And Authorization

Credential login:

- Owner/taker login uses store code, username, and password.
- Superadmin login uses username and password without a store code.
- Usernames are unique inside a store context, not globally.

Cookie session:

- JWT algorithm: `HS256`
- issuer: `opticapture`
- audience: `opticapture-app`
- cookie name: `token`
- cookie is `httpOnly`
- secure cookie is enabled on HTTPS
- cookie sameSite is `strict` on HTTPS and `lax` on plain HTTP development
- token lifetime is 8 hours

Request enforcement:

- revoked tokens are rejected
- token version mismatch invalidates the session
- users with `must_reset_password` are restricted until they update their password
- superadmin requests bypass store resolution; admin routes take the store from the URL
- single-store users auto-resolve to their active store
- multi-store users must send a valid `X-Store-Id`
- suspended stores are rejected

Role guards:

| Guard | Allows |
|---|---|
| `authenticateToken` | Any valid account and resolved store when required |
| `requireOwner` | owner |
| `requireOwnerOrTaker` | owner, taker |
| `requireSuperadmin` | superadmin |

Google OAuth flow:

1. `GET /api/auth/google` creates a state nonce and redirects to Google.
2. `GET /api/auth/google/callback` validates state and the ID token.
3. Existing users are found by OAuth ID.
4. Email auto-link is allowed only for verified email payloads and local accounts with no password.
5. Unknown OAuth users are stored briefly in `pendingOAuth`.
6. Signup can complete through `POST /api/auth/register`.

## 8. API Reference

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Credential login |
| GET | `/api/auth/google` | public | Begin Google OAuth |
| GET | `/api/auth/google/callback` | public | Google OAuth callback |
| GET | `/api/auth/google/pending` | public | Read pending OAuth signup context |
| POST | `/api/auth/register` | public | Register store and owner |
| POST | `/api/auth/logout` | cookie | Revoke current cookie and clear it |
| GET | `/api/auth/me` | cookie | Current account/store context |
| GET | `/api/auth/my-stores` | cookie | Accessible store list |
| POST | `/api/auth/switch-store` | cookie | Validate and select store context |
| GET | `/api/auth/store/settings` | cookie | Read store settings |
| PUT | `/api/auth/store/settings` | owner | Update store settings |
| PUT | `/api/auth/store/password` | cookie | Change own password |

### Inventory

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/inventory` | cookie | List/search inventory; always returns `{ items, total, page, limit }` (default 50, maximum 500) |
| GET | `/api/inventory/ids` | cookie | IDs of every item in one category, for select-all across pages |
| GET | `/api/inventory/export?format=xlsx|csv|json|pdf` | owner | Export inventory; data files mark rows exported, PDF does not |
| POST | `/api/inventory` | owner/taker | Create item |
| PUT | `/api/inventory/:id` | owner/taker | Update item |
| DELETE | `/api/inventory/:id` | owner/taker | Delete item |
| POST | `/api/inventory/batch-upload` | owner | Parse XLSX/CSV/JSON and return preview/mapping data |
| POST | `/api/inventory/batch-confirm` | owner | Apply mapped import in a transaction |

### Categories And Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard/stats` | cookie | Store totals |
| GET | `/api/categories` | cookie | Category list with item counts |
| POST | `/api/categories` | owner | Create category |
| PUT | `/api/categories/:id` | owner | Rename/update icon |
| PUT | `/api/categories/:id/status` | owner | Toggle active/inactive |
| DELETE | `/api/categories/:id/items` | owner | Delete all items in a category |
| DELETE | `/api/categories/:id` | owner | Delete category |

### Scan Sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/session/create` | cookie | Create or reuse an empty active session |
| GET | `/api/sessions/active` | cookie | List active/draft sessions for dashboard |
| PATCH | `/api/session/:id/status` | cookie | Save as draft or resume as active |
| DELETE | `/api/session/:id` | cookie | Delete non-completed session |
| GET | `/api/session/:id/meta` | cookie | Read session metadata |
| GET | `/api/session/:id/items` | OTP (`X-Scan-Otp` header) | Mobile session item list |
| GET | `/api/session/:id` | cookie | Desktop poll; supports `since_updated_at` and `since_id` |
| POST | `/api/session/:id/scan` | OTP (request body) | Add/increment scanned item; a repeated `scan_id` is ignored |
| PATCH | `/api/session/:id/items/:itemId` | cookie | Edit staged item |
| DELETE | `/api/session/:id/items` | cookie | Clear staged items |
| DELETE | `/api/session/:id/items/:itemId` | cookie | Delete staged item |
| POST | `/api/session/:id/commit` | owner | Add selected new items (`assignments`) and mark selected existing items as seen (`verifyIds`) |

### Logs

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/logs` | owner | Store-scoped audit log; supports action, keyword, date, page, and limit filters |

### Admin

Every admin route requires the superadmin role. The store is named in the URL, never taken from the session, and the internal HQ store (`id = 0`) is refused.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stores` | List stores with user, item, category, weekly-added and missing-UPC counts |
| GET | `/api/admin/stores/:id` | One store's summary |
| PUT | `/api/admin/stores/:id` | Edit store details |
| PUT | `/api/admin/stores/:id/status` | Activate or suspend store |
| DELETE | `/api/admin/stores/:id` | Delete a store and its data |
| GET | `/api/admin/stores/:id/inventory` | Paged item list for one store (same filters as `GET /api/inventory`) |
| GET | `/api/admin/stores/:id/categories` | Category list with item counts for one store |
| GET | `/api/admin/stores/:id/items/:itemId` | One item, plus the other stores that carry the same UPC |
| PUT | `/api/admin/stores/:id/items/:itemId` | Edit an item; logged to that store with before and after values; refused for suspended stores and when the item changed since it was opened |
| GET | `/api/admin/recent-items` | Items added in the last 1, 7 or 30 days (`days`), optionally one store (`store`), paged |
| GET | `/api/admin/search` | Find items by name, UPC, brand, category or tag (`q`), optionally one store, paged |
| GET | `/api/admin/activity` | Store events and captures. With `page`: 50 a page, filtered by `store` and `kind`. Without: the latest `limit` (default 5). Returns `unseen` and `newest` |
| POST | `/api/admin/activity/seen` | Mark every change up to `through` as seen for this superadmin |
| GET | `/api/admin/stores/:id/users` | List users with store access |
| POST | `/api/admin/stores/:id/users` | Grant existing user access or create store user |
| DELETE | `/api/admin/stores/:id/users/:userId` | Revoke non-primary store access |
| POST | `/api/admin/users/:userId/reset-password` | Generate one-time password and force reset |

### Utility

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | public | Liveness check; `503` when the database cannot be read. Not rate-limited |
| GET | `/api/server-info` | public | URL for the scan QR code: `PUBLIC_BASE_URL` when set, otherwise the tunnel or LAN address |
| GET | `/api/drive-image/:fileId` | public | Server-side Google Drive image proxy |

## 9. Scan Session Lifecycle

```text
Desktop owner/taker opens /scan
  -> POST /api/session/create
  <- { sessionId, otp }

Desktop renders QR:
  /mobile-scan/:sessionId#otp=<otp>

Phone opens QR link
  -> GET /api/session/:id/items   (headers: X-Scan-Otp, X-Device-Id)
  <- session status and visible items

Phone scans barcode
  -> POST /api/session/:id/scan
     body: { upc, otp, item_name?, scan_id }
     header: X-Device-Id
  <- staged item

Desktop polls:
  -> GET /api/session/:id?since_updated_at=<cursor>&since_id=<id>
  <- full or incremental item envelope

Owner reviews selected items
  -> POST /api/session/:id/commit
  <- inserted/verified/skipped counts and session status
```

Session behavior:

- Empty active sessions are reused for the same user and store.
- Phone scanning on a session expires 8 hours after creation, resume, or the latest scan, and never later than 24 hours after a signed-in user last started or resumed it.
- The OTP reaches the phone after `#` in the QR link and is sent to the API in a header or the request body, so it does not appear in any URL the server logs.
- An expired session that holds scans becomes a draft. Drafts stay listed until committed or deleted; resuming one starts a new scan window and clears the wrong-OTP counter.
- Completed sessions cannot be reactivated or deleted.
- Duplicate UPC scans increment quantity. A resent request carrying a `scan_id` already recorded is not counted twice.
- Barcodes that fail the GTIN check digit are staged as `invalid_barcode` and cannot be committed.
- Sessions that were never scanned into are removed a day after they expire; emptied completed sessions after 90 days.
- Device IDs are preserved when a staged item belongs to one device; mixed-device duplicates are treated as shared.

## 10. UPC Resolution Pipeline

Each scan follows this order:

1. Normalize UPC variants.
2. Check store inventory.
3. Check in-memory UPC cache.
4. Insert/update the staged session item quickly.
5. Fetch external UPC providers when needed.
6. Update session item metadata.
7. Cache the lookup result for future scans.

Current providers:

- Go-UPC when `GO_UPC_API_KEY` is configured; successful results have priority
- Open Food Facts
- UPCitemDB

The async pattern keeps the mobile scan response fast while the desktop feed receives richer product metadata on a later poll.

## 11. Batch Import Pipeline

Upload:

- accepts XLSX, CSV, and JSON
- uses `multer` memory storage
- limits files to 20 MB
- returns sheets, headers, preview rows, full rows, and row counts
- scans the first 100 Excel rows for the strongest table-header candidate, allowing title or metadata rows above the table
- returns the detected header-row number and worksheet used-column count so parsing mismatches cannot pass silently

Client mapping:

- auto-detects common headers
- shows the available destinations, current mappings, sample values, and a destination-labelled preview
- shows the workbook filename plus every worksheet name, row count, header row, worksheet column count, detected column names, and mapping readiness
- shows both an unmodified five-row source preview and a destination-labelled mapped preview
- requires every sheet to map at least one supported inventory identifier
- prevents duplicate destination mappings
- applies mappings to case-insensitive matching headers across sheets without adding nonexistent columns
- includes external mapping fields
- suggests categories from meaningful worksheet names and lets the user edit or clear each suggestion
- allows row-level category mapping for single- and multi-sheet files; mapped values take priority over the reviewed worksheet fallback

Confirm:

- uses a larger JSON body limit for mapped row payloads
- processes rows in a transaction
- rejects unknown, duplicate, or identifier-free mappings
- creates missing categories
- updates by external item ID, UPC, item number, or external SKU where possible
- preserves omitted values on updates and round-trips descriptions, categories, images, pricing, tax, tags, status, and external IDs
- inserts new rows when no existing match is found
- records skipped rows and import log details
- sets `last_imported_at` and `sync_status='imported'`

## 12. Export Pipeline

`GET /api/inventory/export` accepts `format=xlsx|csv|json|pdf`.

XLSX, CSV and JSON exports are data files that can be re-imported, so once the file is built the server stamps the store's inventory rows with:

- `last_exported_at`
- `sync_status='exported'`

A PDF export is a report and changes nothing.

Export columns include local inventory fields plus external mapping fields so exports can round-trip with an upstream platform.

## 13. Security Posture

Rate limits:

| Tier | Limit | Scope |
|---|---|---|
| Auth | 20 requests / 15 minutes per IP | Login, registration, OAuth start/pending |
| API | 2000 requests / 15 minutes per IP | All `/api/*` routes except the OTP scan endpoints and `/api/health` |
| Scan | per minute: 150 per device, 600 per session, 1200 per IP | OTP scan and phone sync endpoints |

Scan limits are keyed by session and device because every phone in a store shares one public IP.

Mitigations:

- httpOnly cookies keep JWTs out of JavaScript.
- JWT issuer/audience/algorithm are pinned.
- Token revocation and `token_version` invalidate sessions.
- Password reset state restricts access until the password is changed.
- Store access is checked through `user_stores`.
- All tenant data routes filter by `req.user.store_id`.
- OAuth state nonce protects the callback flow.
- Account lockout slows credential guessing.
- OTP attempts (5 per session) and scan rate limits reduce brute-force risk.
- The scan OTP is kept out of URLs, so it is not written to access logs or left in the phone's history.
- Client IPs come from `X-Forwarded-For` only when the request arrives through a trusted proxy (`TRUST_PROXY`).
- Prepared SQLite statements are used throughout the routes.
- File/image upload paths validate supported formats.
- Drive proxy validates file IDs and only returns image content.
- Drive proxy enforces an 8-second timeout, an image MIME allowlist, and a streaming 5 MB cap.
- Malformed JSON and non-object JSON API bodies receive stable 400 responses.
- Suspended stores and expired sessions are rejected throughout OTP scan paths.
- Uploaded files are served with dotfiles denied and download disposition.
- Uploaded image files are deleted once no item, store logo or staged scan points at them.
- Superadmin item edits are written to the target store's audit log with before and after values.

## 14. Performance Characteristics

| Operation | Expected behavior |
|---|---|
| Scan POST | Fast local DB write; external lookup can complete afterward |
| Desktop polling | Incremental cursor support through `since_updated_at` and `since_id` |
| Mobile item refresh | OTP-scoped item list, optionally filtered by device |
| Inventory list | Always paginated; defaults to 50 rows and caps requests at 500 |
| Audit log | SQL-filtered and paginated before rows are returned |
| Batch import | Transactional row processing |
| Export | Generated on demand from store-scoped rows |

Current scale assumption: one application instance with SQLite WAL and local uploads. Moving to multiple instances requires shared storage for uploads, session/cache state, token revocation, and OAuth pending registrations.

## 15. Key Files To Review

| Priority | File | Why |
|---|---|---|
| 1 | `server.ts` | Runtime bootstrap, HTTPS, Vite, server-info |
| 2 | `src/server/app.ts` | Express middleware and route mounting |
| 3 | `src/server/db.ts` | Schema, migrations, indexes, seed behavior |
| 4 | `src/server/middleware.ts` | Auth, active-store resolution, role guards |
| 5 | `src/server/routes/sessions.ts` | Core scan session behavior |
| 6 | `src/server/routes/inventory.ts` | CRUD, import, export |
| 7 | `src/App.tsx` | Routes and guards |
| 8 | `src/context/AuthContext.tsx` | Auth and store switching state |
| 9 | `src/hooks/useScanSession.ts` | Desktop polling/session workflow |
| 10 | `src/hooks/useMobileScan.ts` | Phone scanner workflow |
| 11 | `src/lib/apiFetch.ts` | Active-store header injection |
| 12 | `src/lib/mobileScanScanner.ts` | Native/Zxing scan runtime |
| 13 | `src/server/routes/admin.ts` | Superadmin store management and inventory oversight |
| 14 | `src/components/superadmin/` | Super Admin shell, shared list page and tables |

## 16. Testing

| Layer | Where | What it covers |
|---|---|---|
| API integration | `tests/*.test.ts` | Routes and middleware through `createApp()` with Supertest, each file on its own in-memory SQLite database |
| Hooks and pages | `tests/*.test.tsx` | React hooks and Super Admin pages in jsdom with a stubbed `fetch`; each file opts in with `// @vitest-environment jsdom` |
| Browser | `e2e/app.e2e.ts` | Playwright against the Vite dev server with mocked API routes: login, phone scan, camera permission, category view, export |

As of 2026-10-13 the suite has 446 Vitest tests in 35 files and 6 Playwright tests. Coverage is measured over the server and the scan hooks: 87% of statements, with server routes between 84% and 97%. `npm run test:full` runs type-check, ESLint, coverage, browser tests and the build; CI runs the same steps on every pull request.

Not covered by automation: the phone camera on real devices, and load or concurrency behaviour.

## 17. Technical Debt And Roadmap

Current debt:

| Item | Impact | Likely path |
|---|---|---|
| No request schema library | Validation is hand-rolled in route handlers | Add Zod or similar at route boundaries |
| Local SQLite DB | Single-instance deployment assumption | Postgres or another server DB |
| Local uploads | Not suitable for horizontal scaling | Object storage |
| In-memory OAuth/token/UPC caches | Lost on restart and not shared across instances | Redis or persistent tables |
| Polling scan updates | Simple but chatty | SSE or WebSockets |
| Mixed API error shapes | Harder client integration | Standard response envelope |
| Camera path coverage | The phone and hardware scan hooks are tested mounted (sync, submit, retry, draft, keyboard-wedge input), but the camera start/stop path runs only on a real device | Validate on real devices; see the next row |
| Device-dependent camera behavior | Desktop automation cannot represent the full mobile matrix | Validate supported iOS/Android browsers and lighting conditions |

Near-term engineering priorities:

1. Keep `TECHNICAL.md` and `ARCHITECTURE.md` updated when route or schema boundaries move.
2. Add schema validation around auth, inventory, import, admin, and session payloads.
3. Add explicit integration tests for multi-store active-store headers.
4. Add load/concurrency tests for large imports and shared scan sessions.
5. Add reconciliation/export history for the integration workflow.
6. Prepare a deployment guide once the production host is chosen. `npm run db:backup` already takes an online backup and keeps the latest 14.
