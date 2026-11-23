# Phase 3 — Stage 1 audit and Stage 2 domain decisions

This file preserves the original Stage 1/2 audit and approved ADRs. References below to future stages describe that historical checkpoint. The Stage 8 status addendum at the end links the implemented behavior and current validation; it does not change these business decisions.

Reviewed on 22 November 2026 against HEAD `52524cef438dc4d58ec9411b6678efac7cbacfe4`.

## Execution boundary and baseline

The only pre-existing working-tree changes were the four renderer files listed below. Their diffs were reviewed before implementation. Stage 2 adds pure domain rules and contracts; the runtime Inventory integration continues using the existing WarehouseDirectory and SQLite adapter.

| Preserved file | Starting SHA-256 |
|---|---|
| src/renderer/app.tsx | C149B7955A2FD5C082CBBE75ADF74731582179B0C1B6D65215CC144B81C2A41D |
| src/renderer/inventory-page.tsx | 368E4ACD7E21EB29EE3AC58D2B8C15DF7418749206B34AE8B0C702F5E892BF76 |
| src/renderer/session.tsx | 3D903282456272745F103D3B1F5FD677B6864FAF4D98F8A3EB1F29E95BCBEC76 |
| src/renderer/styles.css | C89B9E9DFC77719DF3DE47F616BA0169E92B90BE6F896ABCCF7E41C487A70603 |

Baseline full Jest execution passed 30 tests across 8 suites. TypeScript and the architecture check passed for 72 modules. The first sandboxed Jest attempt failed resolving the Electron runtime path; the authorized outside-sandbox execution passed. All database tests used the existing isolated fixtures.

## Current-state inconsistencies and later-stage prerequisites

- PRD section 5.2 still describes branch ownership as an open question. The approved decision retains mandatory ownership; reconcile the PRD during the documentation stage.
- Current branch, warehouse and location tables lack Phase 3 metadata, status and hierarchy fields. No production behavior is claimed for the new domain rules before application integration.
- The existing directory uses positional INSERT statements. Adding columns will invalidate them. Stage 3 must coordinate migration compatibility with explicit-column adapter writes and backfilled legacy creation before exposing v7 to the application.
- The v6 verifier compares exact SQLite definitions, including the three tables being extended. Connection startup and recovery separately hardcode supported version 6. Stage 3 must introduce version-aware verification and supported-version handling together.
- Existing startup creates a snapshot before some upgrades, but does not perform a complete restorable-media verification gate before applying v7. The additional mandatory backup decision below remains a Stage 3 requirement.
- Inventory currently validates places largely through foreign keys and locks. Phase 3 operational eligibility checks require the later public-policy adapter and application service stages.
- Current count locks are exact-location locks. A hierarchy must not silently broaden them.
- Distribution of earlier schema-v6 customer builds remains unknown. A valid internal migration fixture does not establish customer-upgrade compatibility.

## ADR P3-001 — Ownership and identity

Every warehouse belongs to one branch. A central warehouse can use an explicitly created administrative branch. Locations retain immutable warehouse identity; hierarchy changes can never transfer a place to another warehouse. Inventory retains stock-changing transactions, balances, history, counts, posting receipts and reconciliation.

Domain entities are readonly Branch, Warehouse and StorageLocation definitions with stable IDs, codes, active/inactive status, timestamps and optimistic versions. Location type describes zone/shelf/bin/other without fixing level order. A stockable node may have children. Codes are uppercase ASCII after normalization, with company-wide branch/warehouse uniqueness and warehouse-local location uniqueness. Existing name uniqueness remains a persistence requirement, with repository lookups defined for the correct scope.

## ADR P3-002 — Hierarchy and exact counts

Hierarchy traversal is iterative and has no business depth cap. Reject missing or wrong-warehouse parents, self/descendant cycles and invalid ancestry. The default is a protected stockable root.

The domain countLocationIds rule returns only the selected active stockable location ID. It never adds children, even if the selected node is their stockable parent. Domain tests exercise both parent and child selection. Later Inventory integration must test the actual count snapshot, lock and posted variance for independent parent/child balances. The future UI must explicitly say that counting covers the selected location only and excludes its sublocations. UI implementation is outside this checkpoint.

Reparenting is allowed with stock and history within the same warehouse. It changes only parentId, updatedAt and version. The original definition and all external data remain outside the pure transformation. Check locks across the moved subtree and the old/new ancestor paths. Reject inactive destination ancestry. An inactive node may be reorganized beneath active ancestors without activating it.

The Stage 2 regression verifies unchanged identity, warehouse and all non-edit fields plus immutable input data. Persistence-level regression tests must compare balances, posted documents and movements byte-for-byte when the repository/application path is introduced in Stages 4/5. Stage 2 does not create a fake persistence implementation to claim that later guarantee.

## ADR P3-003 — Lifecycle safeguards

- Branch deactivation requires all child warehouses inactive. Branch activation does not cascade.
- Warehouse creation requires an active branch and atomic default creation. Warehouse deactivation requires no stock, pending work or counts and no active non-default locations; its default changes status in the same future application transaction. Activation requires an active branch and restores its default.
- Warehouse reassignment requires an inactive warehouse, active destination branch, no stock, no movements, no pending documents and no count locks.
- Location deactivation requires an empty, unlocked subtree without pending work or active descendants. Historical movement references remain valid. The default is controlled through warehouse lifecycle only.
- Removing stockability additionally requires no movements. Default stockability is protected.
- Operational eligibility requires the location, ancestors, warehouse and branch active. Reversals and evacuation require authorized reactivation. Identical committed retries continue to return their existing result.
- Descriptive changes and structural moves during an affected count must be blocked by the future application service. Versions protect against stale edits. No hard-delete repository contract is exposed.

## ADR P3-004 — Public contracts and transaction ownership

WarehouseDirectory remains source-compatible. New exported entities, the read-only WarehouseLocationPolicy and LocationUsagePolicy are additive contracts for later adapters, and are not registered in the current runtime.

Repository ports expose scoped lookups, list/read operations and version-conditional writes. false from update means optimistic conflict; application services must translate it and roll back. All service writes, Inventory usage reads and actor audit must share one immediate transaction and connection.

The injected usage policy is implemented by Inventory infrastructure and assembled at the Composition Root. It aggregates exactly the supplied location IDs; callers explicitly supply subtree IDs for lifecycle operations. Pending documents include source and destination references and count locks even when count document lines are empty. Warehouse code imports no Inventory internals or SQL driver. Inventory can consume only the public Warehouse contract.

## ADR P3-005 — Verified backup before v7

Before upgrading any existing database to v7, create a snapshot including every referenced media file and verify that it is restorable. Validate database integrity/FKs, manifest schema, database/media checksums and references. Restore a disposable verification copy without triggering the upgrade under test, reopen it, and verify the referenced media before allowing the live migration to begin. A failed verification aborts the upgrade with an actionable error and leaves existing data/schema intact.

Migration 7 is forward-only and preserves all existing IDs and Inventory references. Applied migration 6 must not be edited. Backup verification, migration execution, supported-version checks and later reopen/restore tests are mandatory Stage 3 review gates. No v7 migration has been created or executed in Stages 1/2.

## Stage 2 acceptance and next checkpoint

Focused tests cover validation, code uniqueness, stale versions, a 2,000-level hierarchy, effective activity, exact count selection, default protection, stocked reparenting, affected count-lock scopes and lifecycle usage blockers. The full existing suite must remain passing. Verify the four renderer hashes before handoff.

Final execution results for this checkpoint:

| Check | Result |
|---|---|
| Focused Warehouse domain suite | 19 passed, 0 failed |
| Full Jest suite | 49 passed across 9 suites, 0 failed |
| TypeScript, renderer and Node configurations | Passed |
| Architecture import/cycle check | Passed, 76 modules |
| git diff --check | Passed |
| Four renderer SHA-256 comparisons | All match the starting values above |

Commands executed were `npm.cmd test`, `npm.cmd test -- --runTestsByPath src/core/warehouses/domain/rules.test.ts`, `npm.cmd run typecheck`, and `git diff --check`. Existing isolated migration tests ran as part of the baseline/regression suite; they exercise the unchanged v1–v6 migrations. No v7 implementation or runtime wiring was added.

Stop before Stage 3 for review. Later milestones implement persistence, operational policy wiring, IPC/RBAC and Arabic screens against these contracts.

## Stage 8 implementation status — 23 November 2026

The original prerequisites above have now been implemented: schema v7 and version-aware validation; media-complete verified upgrade backups; actor-aware application services/repositories; Inventory eligibility and same-connection usage policies; dedicated typed IPC and session capabilities; and Arabic RTL management screens. The PRD's open ownership question is resolved explicitly: mandatory one-branch ownership, including an administrative branch for a central warehouse.

Counting remains exact-location only, including stockable parents. Reparenting retains IDs, warehouse identity, documents, movements and balances, checks count locks across the affected scope, and never transfers stock. Warehouse owns definitions; Inventory exclusively owns stock-changing operations. The approved lifecycle, permissions and protected-default rules remain unchanged. No hard-delete operation was introduced.

Current instructions are in [Phase 3 operations](phase3-operations.md); latest development and production decisions are in [final validation](phase3-final-validation.md). Stage 3–7 reports remain unchanged as historical evidence. Unknown customer distribution of schema-v6 builds is still a production-release question, and internal migration fixtures cannot resolve it.
