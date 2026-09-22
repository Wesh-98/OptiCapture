# OptiCapture Initial Integration Plan

Last updated: 2026-09-22

## Purpose

This document defines the initial technical path for using OptiCapture inside an existing inventory platform without replacing that platform on day one.

The existing platform already has working domains, inventory workflows, and SSO/login. OptiCapture adds the scanning, count-session, audit, and inventory-capture layer. The first phase should prove the workflow with the least disruption to the live system, and integrated access should inherit the existing platform's SSO rather than introduce a parallel user login.

## Recommended Initial Model

OptiCapture should be hosted as a separate service and accessed from inside the existing platform.

```text
Existing inventory platform
  - owns official products, stores, users, roles, and live inventory records
  - treats each store as the owning business/inventory entity
  - keeps current domains and user-facing portal
  - authenticates users through the current SSO/login system
  - launches users into OptiCapture through inherited SSO context or signed session handoff

OptiCapture
  - owns scan sessions, mobile scanning, count drafts, committed counts, and scan audit logs
  - imports catalog data using the existing platform's Excel format
  - exports count results back in a format the existing platform can accept
```

The main rule for the initial phase:

```text
The existing platform remains the source of truth.
OptiCapture produces trusted scan/count results that can be reviewed and applied.
```

## Current OptiCapture Baseline

The current application already has several integration-ready pieces in place:

- store-scoped inventory, categories, logs, scan sessions, and user access
- per-tab active-store selection with server validation through `X-Store-Id`
- mobile scan sessions protected by session ID and OTP
- mobile device tracking through `device_id`
- batch import support for XLSX, CSV, and JSON
- import/export mapping fields for external system identifiers
- inventory export to XLSX, CSV, JSON, and PDF
- session audit trail through staged `session_items` and store logs

The remaining integration work is not basic inventory capture. It is the handoff layer between the existing platform and OptiCapture, plus reviewed application of count results back into the existing platform.

## Hosting And Domain Shape

### Phase 1 Hosting

Use a stable HTTPS domain for the integrated OptiCapture service. The preferred initial production shape is to put mobile scanning under the same main app origin:

```text
https://app.opticapture.com/mobile-scan/:sessionId?otp=<otp>
```

This mirrors the current local development model:

```text
https://localhost:3000/mobile-scan/:sessionId?otp=<otp>
```

Using the main app domain keeps the first integration simpler:

- the desktop app, mobile scan page, and API share one origin
- OAuth callback URLs stay straightforward
- HTTPS camera requirements are satisfied
- scan QR codes use a stable URL instead of a random tunnel URL
- no cross-subdomain CORS or cookie policy is needed for the first rollout
- deployment, rollback, logs, and data storage can still remain independent behind the same public origin

Recommended initial public URLs:

```text
App:          https://app.opticapture.com
Mobile scan:  https://app.opticapture.com/mobile-scan/:sessionId?otp=<otp>
API:          https://app.opticapture.com/api/...
OAuth:        https://app.opticapture.com/api/auth/<provider>/callback
```

The mobile scan URL should be generated from explicit deployment configuration in production, not from a temporary tunnel hostname.

### Future Hosting Option

After the initial flow is stable, the scan experience can be split onto a dedicated scan subdomain if the business wants a cleaner QR or launch URL:

```text
https://scan.opticapture.com/mobile-scan/:sessionId?otp=<otp>
```

or routed under the existing inventory platform:

```text
https://current-platform-domain.com/scan
https://current-platform-domain.com/inventory-scan
```

These can be done through a reverse proxy, load balancer rule, application gateway, or a named Cloudflare Tunnel. The separate-service boundary can remain even when the URL looks fully embedded.

### Multi-Scan Domain Behavior

The domain does not need to be unique per scanner. Concurrent scanning is isolated by scan session and OTP:

```text
https://app.opticapture.com/mobile-scan/session-a?otp=...
https://app.opticapture.com/mobile-scan/session-b?otp=...
```

Multiple users can run separate sessions under the same domain. Multiple phones can also contribute to the same session when they open the same QR link. In that shared-session case, OptiCapture records scans against the same `session_id`, increments duplicate UPC quantities, and can track the contributing mobile client through `device_id`.

For the initial pilot, the expected concurrency target should be explicit. A practical first target is:

```text
3-5 simultaneous mobile scanners per store/session
```

Before broader rollout, tune mobile scan rate limits and load-test shared-store WiFi scenarios, because several phones on the same store network may appear as one public IP.

## Data Flow

### Catalog Import

The existing platform exports inventory using its current Excel format. OptiCapture imports that file through the current mapping workflow.

```text
Existing platform Excel export
        |
        v
OptiCapture import/mapping
        |
        v
OptiCapture local catalog for scanning
```

Imported fields should include:

- external item ID
- item name
- UPC or barcode
- SKU, if available
- category
- quantity
- unit
- status
- sale price
- tax percent
- image or image URL, if available

The most important field is the stable external item ID. UPC is useful for scanning, but it should not be the only merge key unless the existing platform guarantees UPC uniqueness.

### Scan And Count

OptiCapture handles the scanning workflow:

```text
Existing platform admin or authorized inventory user starts a count session
Staff scan items by mobile camera or hardware scanner
OptiCapture records quantity, timestamp, user/session context, and item mapping
Existing platform admin reviews the count session
Existing platform admin commits or exports the count session
```

### Count Result Export

After commit, OptiCapture exports a result file for the existing platform.

Recommended result fields:

- external item ID
- UPC
- SKU
- item name
- previous quantity
- counted quantity
- delta
- store/location ID
- scan session ID
- counted by
- committed by
- committed timestamp
- export timestamp

```text
OptiCapture committed session
        |
        v
Count result Excel export
        |
        v
Existing platform import/apply workflow
```

## External Mapping Requirements

OptiCapture should preserve the existing platform identifiers alongside local records.

Recommended mapping fields:

```text
external_system
external_store_id
external_category_id
external_item_id
external_sku
last_imported_at
last_exported_at
sync_status
```

This allows OptiCapture to say:

```text
OptiCapture item 42 maps to existing platform item ABC-123.
```

That mapping is required before any automated or semi-automated update back to the existing platform.

Current status: these fields exist on inventory records and are included in the import/export pipeline. The next step is to define which existing-platform columns map to each field and to verify a real sample export/import round trip.

## Inherited SSO And Session Handoff

The integrated version should inherit the existing platform's SSO/login. OptiCapture should not become a second primary identity system for users who enter through the existing inventory platform.

The existing platform remains responsible for primary authentication. OptiCapture consumes a trusted launch/session context that identifies the user, role, store scope, and allowed inventory actions.

OptiCapture may still keep a limited local login path for development, emergency support, or standalone deployments, but that path should not be the standard integrated user flow.

### Initial SSO Pattern

The existing platform adds a button such as:

```text
Start Inventory Scan
```

When clicked, the platform creates a short-lived signed launch token or equivalent SSO handoff and redirects the user to OptiCapture:

```text
https://scan.example.com/launch?token=<signed-token>
```

The token should include:

- user ID from the existing platform
- user display name or username
- user role
- store/location ID
- store/location name
- permissions for scanning, committing, or viewing
- token issue time
- token expiry time
- nonce or token ID for replay protection

OptiCapture validates the token and creates or resumes a local session for that user and store.

Current status: this endpoint does not exist yet. The app currently supports local credential login, optional Google OAuth, account-scoped cookies, and active store selection. The SSO launch endpoint should reuse the same store resolution rules rather than introduce a second tenant-scoping model.

### SSO Security Requirements

- Tokens must be short-lived.
- Tokens must be signed by the existing platform.
- OptiCapture must validate signature, expiry, issuer, audience, and store scope.
- Tokens should not carry secrets or sensitive inventory data.
- Role mapping must be explicit.
- Store/location scope must be enforced on every OptiCapture request.
- Logout behavior should be defined for both systems.
- Integrated users should not be asked for a separate OptiCapture password.
- Local OptiCapture credentials, if retained, should be limited to bootstrap, support, or non-integrated deployments.
- Session refresh behavior should follow the existing platform's SSO lifetime and re-authentication rules.

### Role And Store Ownership Mapping

The existing platform's role model should drive the integrated OptiCapture role model. In this integration, "owner" should not be treated primarily as an individual user role. The store is the owning inventory entity, and platform users receive permissions inside that store context.

Recommended mapping:

```text
Existing platform store/location    -> OptiCapture store/tenant
Existing platform admin             -> OptiCapture inventory admin permissions
Existing platform inventory staff   -> OptiCapture scanner/taker permissions
Existing platform superadmin        -> OptiCapture multi-store overview permissions
```

The current OptiCapture internal labels may still use `owner`, `taker`, and `superadmin`, but the integration language should be:

- `inventory admin` for users who oversee the inventory portal for a store
- `scanner` or `inventory staff` for users who scan/count inventory
- `superadmin` for users who oversee stores across the platform
- `store` as the owning inventory context

For the initial phase, only the permissions needed for scanning, count review, and export should be enabled.

### Permission Expectations

Recommended initial permissions:

| Existing platform role | Store scope | Initial OptiCapture permissions |
|------------------------|-------------|---------------------------------|
| Superadmin | Multiple or all stores | View store-level inventory status, launch into store contexts, audit integration activity |
| Admin | Assigned store or stores | Import catalog, start scan sessions, review counts, commit/export count results |
| Inventory staff | Assigned store or session | Scan items, update draft quantities, submit scan results |

The SSO launch token should include both role and store scope. OptiCapture should never infer store access from role alone.

Current status: OptiCapture currently enforces `owner`, `taker`, and `superadmin` internally. Integrated roles should map explicitly onto those permissions or onto a future renamed permission layer.

## Source Of Truth Rules

During the initial phase:

- The existing platform owns official inventory quantity.
- OptiCapture owns scan sessions and count evidence.
- OptiCapture should not silently overwrite live inventory.
- Any count result should be reviewable before the existing platform applies it.
- Failed or partial imports should not change official inventory.

Recommended initial application mode:

```text
Manual or reviewed Excel import into the existing platform.
```

Recommended later application mode:

```text
Staged API push or pending adjustment queue.
```

## Reconciliation

After a count result is imported into the existing platform, the two systems should be compared.

Minimum reconciliation checks:

- every exported external item ID exists in the existing platform
- counted quantity matches the applied quantity
- unmapped items are listed separately
- rejected rows are visible
- applied rows are tied back to the OptiCapture session ID

Useful statuses:

```text
Imported catalog
Scan in progress
Committed locally
Export generated
Applied externally
Partially applied
Failed
Needs review
```

## Initial Milestones

### Milestone 1: Excel Round Trip

Goal:

```text
Prove that real inventory can move from the existing platform into OptiCapture and back without manual cleanup.
```

Steps:

1. Export a small real inventory sample from the existing platform.
2. Import it into OptiCapture using the existing Excel mapping.
3. Confirm external IDs, UPCs, categories, quantities, and statuses.
4. Scan/count a subset of items.
5. Commit the scan session in OptiCapture.
6. Export count results from OptiCapture.
7. Import or test-apply the result in the existing platform.
8. Compare expected quantity changes against applied quantity changes.

Success criteria:

- no duplicate items
- no missing required external IDs
- no broken category mapping
- no quantity format mismatch
- no rejected rows in the existing platform import
- all count results trace back to an OptiCapture session

### Milestone 2: SSO Launch

Goal:

```text
Allow users to open OptiCapture from the existing platform using the inherited SSO/login session.
```

Steps:

1. Define the signed launch token payload.
2. Define role and store mapping.
3. Add a launch endpoint in OptiCapture.
4. Add a "Start Inventory Scan" button in the existing platform.
5. Validate session creation and store scoping.
6. Verify logout and expired-token behavior.

Success criteria:

- user lands in the correct OptiCapture store context
- user receives the correct role
- expired or invalid tokens are rejected
- users cannot switch to unauthorized stores
- audit logs identify the originating user

### Milestone 3: Operational Pilot

Goal:

```text
Run a controlled inventory count with real staff while the existing platform remains authoritative.
```

Steps:

1. Select one store/location or one inventory category.
2. Import current catalog snapshot.
3. Run a real scan/count session.
4. Export count results.
5. Apply results to the existing platform through the approved process.
6. Reconcile results.
7. Collect operator and admin feedback.

Success criteria:

- staff can complete the scan workflow without support intervention
- count results are accepted by the existing platform
- audit trail is sufficient for review
- any mismatches are explainable and recoverable

## Risks And Controls

| Risk | Control |
|------|---------|
| Wrong item updated | Require stable external item ID before export/apply |
| UPC duplicates | Use UPC for scanning, not as the only merge key |
| User opens wrong store | Validate store ID in SSO token and every API request |
| Stale catalog | Show import timestamp and require refresh before major counts |
| Failed external import | Keep OptiCapture export file and session audit for retry |
| Duplicate application | Include session ID/export ID and make imports idempotent where possible |
| Permission mismatch | Maintain explicit role mapping and test each role |
| Production disruption | Keep existing platform authoritative during initial phase |

## Recommended Build Order

1. Confirm external ID mapping against a real existing-platform Excel export.
2. Verify the existing external item/store/category/SKU fields cover the real export shape.
3. Add a count-result export shaped exactly like the existing platform's accepted import format.
4. Add session-level export history and status.
5. Add signed SSO launch endpoint.
6. Reuse the current active-store enforcement model for SSO-launched users.
7. Add store-scoped launch from the existing platform.
8. Run Excel round-trip pilot.
9. Add reconciliation reporting.
10. Consider API sync only after the Excel round trip is reliable.

## Initial Phase Summary

The first phase should avoid a high-risk system replacement. OptiCapture should operate as the scanning and count-session layer inside the existing platform experience, while the existing platform remains the official inventory system.

The cleanest starting point is:

```text
Separate OptiCapture service
+ existing platform SSO launch
+ Excel catalog import
+ OptiCapture scan sessions
+ Excel count result export
+ reviewed application back into the existing platform
```
