# Phase 3 Stage 5 — Inventory integration results

Validated on 22 November 2026. Stage 5 is complete for review before Stage 6.

## Source identity and baseline

The base commit is `52524cef438dc4d58ec9411b6678efac7cbacfe4`. The working tree includes the previously approved Stage 2–4 implementation and four renderer edits. Baseline execution confirmed the expected 85 tests across 11 suites, TypeScript checks, and the architecture check covering 86 modules. No baseline discrepancy was found.

The final source/configuration fingerprint is `1d54b8fde310e59150a862fdaf661a82f1f27f6a4a9228c5e3c5b234992173d2` over 112 files. The per-file evidence is [phase3-stage5-source.json](../out/phase3-stage5-source.json). The manifest excludes Markdown reports.

## Implementation and ownership

Inventory retains its existing immediate SQLite transaction, stock documents, quantity conversion, movement creation, balance maintenance, count locks, posting receipts, audit and reconciliation. Its Warehouse dependency is now a mandatory InventoryWarehouseGateway containing the approved WarehouseLocationPolicy. There is no optional unvalidated fallback.

The Warehouse application layer implements read-only location resolution using its existing repositories and domain rules. It checks location, warehouse and branch existence, warehouse ownership, stockability, the selected location and every ancestor, and owning warehouse/branch activity. The same rules apply to receipts, issues, transfers, counts and reversals; no inactive-location exception was introduced.

The composition root passes one SQLite connection to Inventory, the Warehouse gateway and the Inventory-owned location-usage adapter. Inventory imports only the public Warehouse contract. Warehouse code imports no Inventory internals. Authorization is performed by the invoking Inventory use case; internal policy reads do not require an unrelated read permission in addition to the operation permission.

## Operations integrated

| Operation | Integration behavior |
|---|---|
| Draft creation/edit | Validates every source and destination, transfer destination semantics and exact count-line scope before saving. No default-location redirection. |
| Receipt/issue posting | Revalidates current location eligibility inside the existing transaction, preserving StockItem, exact quantity and balance rules. |
| Immediate transfer | Validates both endpoints and rejects equal endpoints. Both movements and balance changes remain atomic for internal and cross-warehouse transfers. |
| Count start | Validates the selected stockable location before creating the lock and existing expected-stock snapshot. |
| Count review/post | Revalidates the locked location, including empty-line counts. Count lines must reference that exact location. Failed posting preserves review state, reviewed quantities and lock. |
| Count cancellation | Remains available to an authorized operator even when the place has become inactive; releases the existing lock. |
| Reversal | Validates original line locations and authoritative movement locations, including zero-variance count lines without movements. Reactivation is required before new compensating effects. Original records remain immutable and negative stock remains prohibited. |
| Historical queries/repair | Existing documents, movement history, reconciliation and ledger-based repair remain available independently of current location activity. |

Counting remains exact-location only. A stockable parent's snapshot excludes its descendants. Child receipts remain independent while the parent is counted. Transfers targeting the locked parent roll back any attempted child-side effect. No hierarchy operation changes location or warehouse IDs.

## Idempotency and atomicity

The existing committed receipt lookup remains ahead of current eligibility and optimistic-version checks for identical posting/reversal commands. Existing authorization remains required. A committed request therefore returns its original result after location reparenting, deactivation, warehouse metadata changes or application restart. Conflicting retries are still rejected.

New posting, review, edit and reversal checks execute within Inventory's existing write transaction. The integration test asserts the connection is already in a transaction when Warehouse validation runs. Existing late-write rollback and transfer tests continue passing. Rejected operations compare definitions, documents, movements, balances, locks, reviewed snapshots, receipts and audit before/after to prove zero partial writes.

## Location selection and typed results

WarehouseLocationPolicy.listStockableLocations returns typed ResolvedLocation values with stable location ID, owning warehouse and branch, current root-first path and effective activity. Only active stockable results are returned. resolveLocation remains able to resolve inactive places for historical display.

The existing Inventory places command keeps its scalar record contract and existing keys, filters out ineligible places, and adds a current path string. Existing React selection code remains unchanged. Dedicated serializable Warehouse IPC DTOs and management UI remain Stage 6/7 work.

## Legacy compatibility and audit bridge

Existing inventory:execute branch/warehouse/location creation commands now delegate through the Stage 4 Warehouse services. Generated codes and default metadata remain compatible. They enforce the existing warehouse permission, active branch/warehouse rules, uniqueness, protected default creation, applicable hierarchy/count safeguards and atomic audit.

The trusted actor comes from the existing host session and Inventory authorization path. It is not read from a request property. Warehouse services authorize that actor again within the shared transaction. Inventory returns the created ID immediately and does not emit its former duplicate management audit event. Successful management commands now use the canonical Warehouse service audit actions, exactly once.

The old WarehouseDirectory signature and low-level adapter remain available for historical fixtures and existing private storage callers. Production composition no longer passes its permission-free mutation methods to Inventory. No public IPC mutation path is left on the old implementation. Dedicated Warehouse endpoints were not added.

## Files created or modified in Stage 5

Added:

- src/core/warehouses/application/location-policy.ts
- src/core/warehouses/infrastructure/create-inventory-gateway.ts
- src/core/inventory/infrastructure/warehouse-integration.test.ts
- docs/phase3-stage5-results.md

Modified:

- src/core/warehouses/public.ts — public gateway contract and current integration documentation.
- src/core/inventory/infrastructure/sqlite-inventory.ts — targeted validation calls and legacy delegation.
- electron/main/ipc/index.ts — same-connection factory composition on the existing channel.
- src/core/inventory/infrastructure/inventory.integration.test.ts
- src/core/warehouses/infrastructure/services.integration.test.ts
- electron/main/database/release-validation.test.ts
- electron/main/database/phase3.test.ts

Existing suites now inject the mandatory gateway. A Stage 4 pending-destination fixture now uses a real eligible source instead of a deliberately unresolved source, since draft creation validates it. Its destination-blocking assertion is retained. Migration tests seed historical v6 documents, exact quantities, count locks and snapshots directly because the current operational gateway targets v7. Migration preservation assertions remain intact. No migration SQL or Warehouse domain rule changed.

## Executed validation

| Check | Result |
|---|---|
| Baseline Jest suite | 85 passed, 11 suites |
| Existing suites after initial integration | 85 passed, 11 suites |
| Initial focused Stage 5 suite | 15 passed |
| Final full suite with additional edge cases | 103 passed, 12 suites; 0 failed or skipped |
| TypeScript checks | Passed, renderer and Node configurations |
| Architecture/cycle check | Passed, 88 modules |
| Production main/preload/renderer build | Passed |
| Source-build desktop smoke | Fresh launch and second-process restart passed |
| SQLite integrity | integrity_check exactly ok; foreign_key_check empty; foreign keys enabled |
| File-backed Inventory fixtures | WAL enabled and exact reconciliation after each test |
| git diff --check | Passed |

The new suite contains 18 file-backed tests. It covers inactive/non-stockable places, inactive ancestors/warehouse/branch, eligible paths, internal/cross-warehouse transfers, invalid endpoints, count-lock rollback, draft revalidation, optimistic edits, retries after restart, parent/child count independence, empty and populated reviewed-count failure states, reactivation before reversal, zero-variance reversals and the secured legacy bridge. Existing suites retain negative-stock reversal, audit rollback, immutable history, migration, backup and restore coverage.

Commands executed:

```powershell
npm.cmd test
npm.cmd test -- --runTestsByPath src/core/inventory/infrastructure/warehouse-integration.test.ts
npm.cmd test -- --ci --json --outputFile=out/phase3-stage5-jest.json
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:desktop
git diff --check
```

Machine-readable results are in [phase3-stage5-jest.json](../out/phase3-stage5-jest.json). Desktop output is in [phase3-stage5-desktop.log](../out/phase3-stage5-desktop.log). These are local ignored artifacts to archive with reviewed candidate evidence.

All new databases and desktop profiles were created in disposable temporary directories. Fixture-only SQL status changes deliberately simulate stale/imported data which the current Warehouse lifecycle services would normally reject. No customer or development dataset was accessed. Tests/build/desktop execution used authorized outside-sandbox access where required.

## Preservation and remaining gates

The four renderer SHA-256 values match the Stage 1 record. architecture-v2.ts remains `A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD`; phase3.ts remains `9367E2B86DE6CF816A4E8E7B03C2B708046DFE988A10E3A2946EC218DCC5EE68`. Stock identity, integer-thousandths storage, current immediate transaction semantics and schemas v6/v7 are preserved.

No known P0 integration blocker remains in the tested Stage 5 scope. Release-level provenance, possible older customer v6 layouts and installed-Windows acceptance remain unresolved release gates.

P1 follow-up includes reference-data performance measurements for large location trees, dedicated Warehouse IPC schemas and permission-capability presentation, and operator-facing hierarchy/count guidance. The source-build desktop smoke does not certify installer upgrade/uninstall behavior.

Stage 6 should expose the existing services and typed location results through dedicated trusted IPC handlers, preserve authorization and single-audit ownership, add endpoint-specific security tests and prepare later Arabic management screens. The legacy route is already protected; no special permission bypass is needed.

Stage 5 is ready for review. Stage 6 remains unstarted. The mandatory private Inventory factory dependency changed from a raw directory to the validated gateway to prevent accidental unvalidated composition; all repository callers were updated. Existing public command/request contracts and legacy directory signatures remain compatible. No approved architectural decision was overridden.
