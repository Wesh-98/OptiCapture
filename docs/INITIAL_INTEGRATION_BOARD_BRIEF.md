# OptiCapture Initial Integration Board Brief

Last updated: 2026-08-20

## Executive Summary

OptiCapture can be introduced into the existing inventory platform as a focused scanning and inventory-counting layer without replacing the current system immediately.

The existing platform already has working domains, users, login/SSO, and live inventory operations. The recommended initial phase keeps that system in place and adds OptiCapture where it creates the most immediate value: barcode scanning, mobile count sessions, count review, and audit-backed inventory updates. Integrated OptiCapture access should inherit the existing platform's SSO rather than introduce a second user login.

This approach lowers risk, shortens rollout time, and gives the organization a practical path to either deeper integration or eventual replacement later.

## Recommended Direction

Use OptiCapture as an embedded inventory scanning module.

```text
Existing platform remains the official inventory system.
OptiCapture handles scanning, count sessions, and count-result exports.
Users enter OptiCapture from inside the existing platform using SSO/login context.
Stores remain the owning inventory entities.
```

This allows the business to improve inventory counting without interrupting the current production system.

## Why This Is The Best Starting Point

The current platform is already operational. Replacing it immediately would create unnecessary risk.

The safer first step is to add OptiCapture as a specialized scanning layer:

- faster inventory counts
- mobile barcode scanning
- better count-session tracking
- improved auditability
- less manual spreadsheet work
- minimal change to the existing production portal

The business gets practical value early while preserving the ability to expand later.

## User Experience

From the user's perspective, OptiCapture should feel like part of the existing system.

Example workflow:

```text
1. User logs into the existing platform.
2. User clicks "Start Inventory Scan."
3. The platform opens OptiCapture with the correct store and user context.
4. Staff scan/count inventory.
5. The count is reviewed and exported.
6. The existing platform applies the updated inventory result.
```

The user should not need to manage a separate store login during the final version of this phase. The existing platform's SSO/login should provide the user and store session context.

## Role And Store Model

The existing platform's roles should lead the integration model.

In this initial phase, stores are the owning inventory entities. Users receive permissions inside one or more store contexts.

Recommended role alignment:

| Existing platform role | Integration meaning |
|------------------------|---------------------|
| Superadmin | Oversees the whole store network and has a multi-store overview, similar to OptiCapture's current superadmin concept |
| Admin | Oversees the inventory portal for assigned store(s), including scan sessions, review, and exports |
| Inventory staff | Performs scanning/counting work inside assigned store/session context |

This means OptiCapture's current "owner" language should be translated carefully during integration. The store is the owner of inventory; the platform admin is the person responsible for operating the inventory portal.

## Hosting Approach

The recommended first hosting setup is a separate OptiCapture service under a dedicated scan domain:

```text
scan.company-domain.com
```

This can later become:

```text
company-domain.com/scan
```

The separate-service approach provides several advantages:

- faster initial launch
- cleaner rollback
- separate logs and monitoring
- lower risk to the existing platform
- independent deployment of scanning improvements

Even if users access it from inside the current platform, the technical boundary remains clean.

## Data Approach

The initial data bridge should use the existing platform's Excel format.

The current OptiCapture mapping already aligns with that Excel format, which means the first integration can be practical and low-risk:

```text
Existing platform Excel export
        |
        v
OptiCapture import
        |
        v
Scan/count inventory
        |
        v
OptiCapture Excel result export
        |
        v
Existing platform import/apply
```

This avoids immediate dependency on custom APIs while proving the core workflow with real inventory data.

## Source Of Truth

During the initial phase, the existing platform remains the source of truth.

That means:

- official inventory records stay in the current system
- OptiCapture creates count results
- count results are reviewed before application
- no silent overwrite of live inventory is required
- rollback remains straightforward

This gives the business control while testing the new scanning workflow.

## Role Of SSO/Login

The existing platform already has SSO/login, which should become the inherited access model for OptiCapture.

Instead of asking users to log into OptiCapture separately, the existing platform should launch OptiCapture with a secure session handoff.

The launch should pass:

- user identity
- user role
- store/location
- allowed permissions
- session expiry

This creates a smoother user experience and reduces training friction.

The launch should also prevent role confusion. A superadmin should receive broad oversight access, while an admin should land directly in the inventory context for the store or stores they manage.

Any local OptiCapture login should be treated as a limited fallback for development, support, or standalone operation, not the normal path for integrated users.

## Initial Rollout Phases

### Phase 1: Excel Round Trip

Prove that inventory can move from the existing platform into OptiCapture and back.

Outcome:

```text
Real data imports correctly, scanned counts export correctly, and the existing platform accepts the result.
```

### Phase 2: Inherited SSO Launch

Allow users to open OptiCapture from the existing platform using the current SSO/login session.

Outcome:

```text
The user starts scanning from inside the current system with the right store and role.
```

### Phase 3: Controlled Pilot

Run one store, location, or category through a real inventory count.

Outcome:

```text
Operational proof with real staff, real inventory, and measurable feedback.
```

### Phase 4: Broader Rollout

Expand to additional stores, departments, or inventory categories after the pilot is successful.

Outcome:

```text
OptiCapture becomes the standard scanning/counting workflow while the current platform remains authoritative.
```

## Success Measures

The initial phase should be considered successful when:

- inventory imports without manual cleanup
- staff can scan/count without major support
- count exports are accepted by the existing platform
- user/store context passes correctly through SSO
- quantity changes are traceable
- audit logs identify who counted and who committed
- any failed rows or mismatches are visible and recoverable

## Key Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Disrupting the live platform | Keep OptiCapture separately hosted during the first phase |
| Incorrect inventory updates | Use reviewed Excel result imports before direct automation |
| Wrong item matching | Preserve the existing platform's item IDs during import/export |
| User confusion | Launch OptiCapture directly from the existing platform using SSO |
| Store mix-ups | Pass and validate store/location context on every launch |
| Rollback difficulty | Keep the existing system authoritative and retain all export files |

## Strategic Value

This initial integration gives the business a practical way to modernize inventory operations without forcing a full platform replacement.

It also creates optional future paths:

- deeper API integration
- automated reconciliation
- reverse-proxy hosting under the existing domain
- full embedded inventory workspace
- eventual replacement of the old inventory portal, if later desired

## Board-Level Recommendation

Approve the initial integration phase as a controlled, low-risk pilot.

The recommended first version is:

```text
OptiCapture hosted separately
+ launched from the existing platform through SSO/login context
+ Excel import/export bridge
+ scanning and count-session workflow
+ reviewed application back into the current inventory system
```

This approach protects the current platform while proving whether OptiCapture should become a deeper part of the inventory operation.
