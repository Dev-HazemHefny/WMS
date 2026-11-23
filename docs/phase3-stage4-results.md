# Phase 3 Stage 4 — Application services and repositories

Validated on 22 November 2026. Stage 4 is complete for review before Stage 5.

## Source and preservation

The base commit is `52524cef438dc4d58ec9411b6678efac7cbacfe4`. The reviewed implementation includes uncommitted Stage 2/3 work and the four existing renderer edits. Baseline validation confirmed 61 passing tests across 10 suites, TypeScript checks, and an architecture check covering 77 modules.

The final source/configuration manifest covers 109 files with SHA-256 fingerprint `96e663f533a525ef8a8fae2bea0344f02542ed9c8e54d23c707f41d7ce06f9b5`. Per-file hashes are saved in [phase3-stage4-source.json](../out/phase3-stage4-source.json). Documentation is outside that source fingerprint.

Final renderer hashes match the Stage 1 preservation record. Migration 6's architecture-v2.ts hash remains `A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD`; migration 7's phase3.ts hash remains `9367E2B86DE6CF816A4E8E7B03C2B708046DFE988A10E3A2946EC218DCC5EE68`. No schema, runtime Inventory posting, IPC handler, or renderer change was made during Stage 4.

## Application services

The framework-independent factory createWarehouseServices composes the following synchronous use cases from repository, usage, authorization, clock, ID, transaction and audit ports.

| Definition | Use cases |
|---|---|
| Branch | createBranch, updateBranch, setBranchStatus, listBranches, getBranchDetails, listBranchWarehouses |
| Warehouse | createWarehouse, updateWarehouse, reassignWarehouse, setWarehouseStatus, listWarehouses, getWarehouseDetails |
| Location | createLocation, updateLocation, reparentLocation, setLocationStatus, getLocationDetails, listLocations, getLocationTree, getLocationPath, listStockableLocations |

Metadata uses the existing domain normalization and limits. Code/name uniqueness uses scoped repository lookups before writes; SQLite remains the final guard. Definition codes are normalized uppercase. Names follow the existing exact-match uniqueness constraints. New definitions start active. Updates require expectedVersion, increment the version and update timestamp, and preserve IDs and creation timestamps.

Branch deactivation checks child warehouses, and branch reactivation does not cascade. Warehouse creation persists one protected default in its transaction. Warehouse status changes update its default atomically. Deactivation checks stock, pending work, count locks and active non-default locations. Reassignment requires an inactive unused warehouse and an active destination branch, and movement history permanently blocks reassignment.

Location creation validates the owning branch, warehouse, active ancestor chain and parent ownership. Lifecycle services use explicit subtree usage checks. Removing stockability checks the location's own stock/history/pending work; count locks across affected hierarchy paths are also enforced. Reparenting checks the moved subtree and old/new ancestor paths, and writes only location definition fields. The regression compares all Inventory document, movement, balance, count and receipt rows exactly around a stocked-location move. Descriptive changes to locations and owning warehouse/branch are rejected during affected counts.

GetLocationTree returns one level of children for a parent, matching the approved lazy explorer design and avoiding deeply nested IPC objects. GetLocationPath builds an iterative root-first path. ListStockableLocations supports one warehouse or all active warehouses, returns typed resolved definitions, and excludes non-stockable and effectively inactive nodes. Inactive definitions remain available through authorized management/detail queries. No hard-delete use case exists.

## Repositories and Inventory usage adapter

SqliteBranchRepository, SqliteWarehouseRepository and SqliteLocationRepository implement the Stage 2 ports on v7. They map storage column names into typed domain entities, convert location flags into booleans, bind SQL values, scope uniqueness correctly and use conditional id/version updates. Branch and warehouse list queries provide deterministic pagination, status filtering, literal code/name search and branch filtering. Location lists and tree queries are typed and ordered.

Existing WarehouseDirectory remains a separate compatibility adapter. Its original methods and response shapes are preserved. New typed repositories provide capabilities absent from that minimal adapter; no new generic record API is exposed by the application services.

The new createSqliteLocationUsage adapter lives in Inventory infrastructure and imports only the public Warehouse policy contract. It performs read-only queries against balances, movements, count_locks and documents. JSON line inspection includes both source and destination and both draft/review states. An empty-line count is detected through its lock. Scopes are passed as a JSON array rather than expanding one SQL parameter per location; the caller explicitly supplies subtree IDs. Tests compare state and SQLite total_changes before/after policy queries.

## Transactions, authentication and audit

The SQLite factory createSqliteWarehouses requires an injected WarehouseAccess and LocationUsagePolicy. Trusted wiring supplies currentActor through the existing Identity session and authorize function. Use-case inputs contain no actor ID. Every mutation resolves and authorizes the current session inside a SQLite immediate transaction, evaluates usage through the injected same-connection adapter, saves version-conditional updates, and records successful actor/action/target audit before commit. Failed validation, authorization, conditional update, entity write or audit insertion rolls back the whole operation.

Read methods require read permission. Management uses warehouse, status operations use warehouse.status, reparenting uses warehouse.reparent and reassignment uses warehouse.reassign. These permissions already exist in v7 for admin. A fixture test grants management without the privileged actions and verifies the distinctions. No interim broad permission or database migration was needed.

Application errors reuse WarehouseDomainError/AppError. Expected missing, uniqueness, ownership, cycle, status, stock, history, pending-work, count, default-protection and concurrency failures have stable codes. A focused regression initially exposed foreign parents being reported as missing because the loaded hierarchy was warehouse-scoped. Explicit repository lookup now validates ownership first, returning PARENT_WAREHOUSE_MISMATCH with zero side effects. The test was retained unchanged.

## Legacy compatibility and scope

The authenticated legacy inventory:execute management path still resolves its actor and warehouse permission in Inventory and records its existing single audit event. Compatibility tests verify new legacy warehouses are visible to the typed services and retain their default location.

Routing legacy writes through the new services requires an actor-aware compatibility bridge and coordinated audit ownership at the host/Inventory integration boundary. This remains a Stage 5/6 task as allowed by the request. The Stage 4 factory is available for trusted composition and tested with the actual Identity and Inventory adapters, but is not registered as a new production endpoint. Existing legacy writes do not yet gain every new lifecycle rule; the later integration must close that gap without an authorization bypass or duplicate audit.

The read-only usage adapter does not validate Inventory postings. The new public service types are additive exports. The existing WarehouseLocationPolicy for future Inventory validation remains an integration contract. No Stage 5 posting eligibility checks, Stage 6 endpoints, or Stage 7 UI were introduced.

## Files added or modified in Stage 4

Added application files under src/core/warehouses/application:

- ports.ts defines trusted access, transaction, audit, clock/ID and repository dependencies.
- context.ts contains shared application orchestration and typed inputs.
- branches.ts, warehouses.ts and locations.ts implement the use cases.
- create-warehouses.ts composes the framework-independent service factory.

Added infrastructure and tests:

- src/core/warehouses/infrastructure/sqlite-repositories.ts
- src/core/warehouses/infrastructure/create-sqlite-warehouses.ts
- src/core/warehouses/infrastructure/services.integration.test.ts
- src/core/inventory/infrastructure/sqlite-location-usage.ts

Updated src/core/warehouses/public.ts with additive service/input/access type exports. Added this report. Earlier working-tree changes were preserved.

## Validation results

| Check | Result |
|---|---|
| Baseline full Jest suite | 61 tests, 10 suites, passed |
| Initial focused service suite | 21 passed, 1 failed; wrong-parent error contract corrected |
| Corrected focused suite | 22 passed |
| Final full Jest suite including two additional cases | 85 passed, 11 suites, 0 failed |
| TypeScript checks | Passed for renderer and Node configurations |
| Architecture import/cycle check | Passed, 86 modules |
| Production main/preload/renderer build | Passed |
| SQLite integrity/FK checks | integrity_check exactly ok; no FK violations; foreign keys enabled |
| git diff --check | Passed |

The new service suite has 24 tests. Coverage includes metadata, duplicates, status workflows, exact default creation, invalid branches, reassignment history, pagination/search, hierarchy reads and moves, inactive ancestors, subtree usage, empty counts, reviewed count documents, SQL read-only behavior, audit failure rollback, conditional-update rollback, repository versions, role/session changes and legacy compatibility. Every service test verifies schema v7 integrity and foreign keys on its disposable in-memory database. Existing migration and file-backed Inventory/recovery regressions also passed.

Executed commands:

```powershell
npm.cmd test
npm.cmd test -- --runTestsByPath src/core/warehouses/infrastructure/services.integration.test.ts
npm.cmd test -- --ci --json --outputFile=out/phase3-stage4-jest.json
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Machine-readable results are in [phase3-stage4-jest.json](../out/phase3-stage4-jest.json). The manifest and Jest JSON are local ignored build artifacts to archive with candidate evidence. Tests/build used authorized outside-sandbox execution where required. No customer or development dataset was accessed.

## Remaining risks and Stage 5 prerequisites

1. Wire WarehouseLocationPolicy into every stock-changing Inventory path in Stage 5, including reversal and count. Preserve committed retry lookup ordering, exact-location counting and the existing posting transaction.
2. Compose Warehouse services and the Inventory usage adapter on the same SQLite connection with the current trusted actor resolver. The factory requires that connection-sharing contract; it cannot infer the connection behind an arbitrary injected policy.
3. Design the legacy management bridge with explicit actor/audit ownership before changing production routing. Maintain current response shapes.
4. Add dedicated Warehouse IPC and shared serializable DTO/schema contracts in Stage 6, with real sender-validation tests and session capability presentation. Add UI later.
5. Large location sets are read as flat records for domain/path checks; measure reference-data performance before adding caching or another hierarchy representation.
6. Customer distribution of older v6 layouts and installed-Windows release validation remain external release questions recorded by Stage 3.

Stage 4 is ready for review. Stage 5 remains unstarted. There was no architectural departure; the allowed legacy bridge deferral is the explicit integration limitation.
