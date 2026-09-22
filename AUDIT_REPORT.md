# OptiCapture Audit and Remediation Report

**Audit baseline:** August 31, 2026

**Remediation verified:** September 22, 2026

**Scope:** Application source, server routes, database migrations, browser flows, tests, build output, dead code, and dependency usage

## Current outcome

The audited issues have been remediated and the current tree passes the complete automated quality gate. The production database was not modified during verification.

| Check | Baseline | Current result |
| --- | ---: | ---: |
| TypeScript | Pass | Pass |
| ESLint | Pass | Pass, zero warnings |
| Unit/integration tests | 172 tests in 12 files | 189 tests in 13 files |
| Statement coverage | About 70% | 70.17% |
| Server-route statement coverage | Not recorded | 87.75% |
| Browser tests | 6 | 7 |
| Production build | Pass | Pass |
| Scanner fallback chunk | 408.23 KB / 107.46 KB gzip | 69.87 KB / 17.77 KB gzip |
| Production dependency audit | 0 known vulnerabilities | 0 known vulnerabilities; one unused dependency removed |

## Completed remediation

### Session and scan reliability

- Enforced expiry and store-suspension checks consistently across session read, scan, update, delete, and commit paths.
- Applied OTP failure accounting and lockout consistently so read endpoints cannot be used as a free guessing oracle.
- Added cursor-based session polling with stable timestamp and ID ordering.
- Restored draft-session polling so a mobile client moves into the active state without requiring a reload.
- Corrected manual scan submission, failed-submission field retention, tag persistence, draft deletion, and scanner start/stop races.
- Added browser coverage for camera permission denial. The test proves the camera is attempted once, does not enter a retry loop, and retries only after the user selects **Try Again**.
- Added scanner-runtime coverage for native startup, fallback startup, frame decoding, and resource cleanup.

### Inventory, categories, import, and export

- Added stricter inventory field validation and category/store ownership validation.
- Corrected update behavior so nullable fields can be intentionally cleared.
- Corrected import/export mappings and external synchronization metadata for round trips.
- Isolated category reads and writes by store.
- Removed the legacy unpaginated inventory response. `GET /api/inventory` now always returns `{ items, total, page, limit }`, defaults to page 1 and 50 items, and caps requests at 500 items.
- Updated all production consumers and tests to use the single paginated contract.

### API and authentication hardening

- Corrected Go-UPC integration behavior and product lookup caching.
- Added malformed JSON handling with a stable 400 response.
- Added image-proxy timeout, streaming size enforcement, and rate limiting.
- Corrected OAuth token refresh handling.
- Added safer error handling for batch and route operations while retaining generic client-facing 500 responses.

### Database integrity

- Added transactional migration handling where SQLite permits it.
- Restored the `users.store_id -> stores.id` foreign key omitted by the earlier users-table rebuild.
- Removed a redundant index and added query indexes for logs, inventory, users, categories, and sessions.
- Verified migration 17 against a WAL-consistent backup of the persistent database. The source was migration 16.

Migration verification results:

| Check | Result |
| --- | --- |
| SQLite integrity check | `ok` |
| Foreign-key violations | 0 |
| Users store foreign key | Present |
| Stores | 3 before / 3 after |
| Users | 5 before / 5 after |
| User-store links | 5 before / 5 after |
| Categories | 30 before / 30 after |
| Inventory items | 2,986 before / 2,986 after |
| Scan sessions | 20 before / 20 after |
| Session items | 24 before / 24 after |

The disposable database and its migrated copy were removed after validation. The persistent database remains at migration 16 until the application next starts normally.

### Observability and audit logs

- Replaced unstructured server error output with JSON records containing ISO timestamp, severity, scope, message, safe error details, and relevant request identifiers.
- Converted startup, shutdown, proxy, route, and process-level events to the shared logger.
- Added audit log pagination and filtering while preserving store isolation.
- Removed barcode debug output from the browser.

### Frontend behavior and accessibility

- Corrected stale UI state after inventory, category, import, and scan operations.
- Improved drag-and-drop import behavior and error reporting.
- Added missing labels, pressed states, live regions, and button descriptions to mobile scan controls.
- Kept manual scan values after a failed request so the user can correct and retry.

### Performance and dead-code cleanup

- Replaced ZXing's broad browser-package import with a small fallback camera loop using deep imports for the six supported retail barcode formats.
- Reduced the lazy scanner dependency chunk by 338.36 KB raw and 89.69 KB gzip, approximately 83% in both cases.
- Removed the unused `@zxing/browser` production dependency and updated the lockfile and technology documentation.
- Removed compatibility code for the legacy flat inventory response.

### Documentation and configuration alignment

- Documented the optional `GO_UPC_API_KEY` and moved Go-UPC from roadmap status to the current lookup pipeline.
- Updated the README, architecture, technical reference, operating procedure, and integration plan for the paginated API contracts, structured logger, scanner fallback, migration 17, current verification commands, and remaining work.
- Repaired malformed Markdown fences in the integration plan so topology, URL, and data-flow examples render correctly.
- Corrected stale statements about the scanner package, active-session expiry, log authorization, inventory pagination, and completed test coverage.

## Verification evidence

The final checks were run from a clean process after the last source change:

```text
npm run lint
  PASS — TypeScript compilation

npm run lint:eslint
  PASS — zero warnings

npm run test:coverage
  PASS — 13 files, 189 tests
  Statements 70.17%, branches 69.94%, functions 73.84%, lines 71.60%
  Server routes: 87.75% statements, 89.81% lines

npx playwright test --workers=1
  PASS — 7 Chromium tests

npm run build
  PASS — 2,531 modules transformed
  Scanner dependency chunk: 69.87 KB, 17.77 KB gzip

git diff --check
  PASS

npm audit --omit=dev --audit-level=low
  PASS — 0 known production dependency vulnerabilities
```

A concurrent test attempt exceeded the memory available to Node and esbuild on this Windows environment. The same TypeScript, Vitest, Playwright, and build checks all passed when run serially. This was an execution-resource limit, not an application assertion failure.

## Remaining improvement opportunities

These items are useful follow-up work rather than identified release blockers:

1. **Broader hook integration coverage.** The scanner runtime library is at 96.46% statement coverage, but `useMobileScan` and `useScanSession` remain around 26% and 21%. Add component-level tests for extended network outages, reconnection, idle timeout, and draft-to-active polling.
2. **Load and concurrency testing.** Add repeatable tests for thousand-row imports, long scan sessions, and concurrent devices updating the same UPC.
3. **Production log transport.** The server now emits structured JSON, but deployments should route stdout/stderr into a retained log service and add correlation IDs at the reverse proxy or application boundary.
4. **Real-device scanner validation.** Verify the native `BarcodeDetector` and ZXing fallback on the supported iOS and Android browser/device matrix, including dim lighting and damaged labels.
5. **Operational migration rollout.** Back up the production database before the first deployment that applies migration 17, then confirm the same integrity and foreign-key checks in the deployment runbook.
6. **Request schema consolidation.** Replace route-local validation helpers with shared schemas and a consistent API error envelope.
7. **Horizontal-scaling readiness.** Move SQLite/local uploads and in-memory OAuth, token-revocation, and UPC cache state to shared services before adding application replicas.

## Release assessment

The current code is ready for staged release based on the automated results above. The highest-value next step is real-device scanning validation because camera behavior and barcode recognition quality depend on browser and hardware combinations that automated desktop tests cannot fully reproduce.
