# Phase 3 Stage 3 — SQLite v7 results

Validated on 22 November 2026 against base commit `52524cef438dc4d58ec9411b6678efac7cbacfe4` plus the existing Stage 2 and renderer working-tree changes. Stage 3 is ready for Stage 4 review. This result covers schema preparation and backward-compatible legacy writes; application services and operational eligibility integration belong to later stages.

## Implemented migration

Migration 7 extends branches, warehouses and locations in place. Inventory tables and migration 6 remain unchanged.

- Branches gain code, description, address, phone, contact_name, status, created_at, updated_at and version.
- Warehouses gain code, description, address, status, created_at, updated_at and version. Mandatory branch ownership is preserved.
- Locations gain parent_id, code, location_type, is_stockable, is_default, status, created_at, updated_at and version. Their existing id, warehouse and name columns are preserved.
- Existing records become active, version 1. Existing locations become stockable roots of type other. Timestamps represent migration time; original creation times were never stored and are not reconstructed.
- Codes are generated deterministically in ID order as BR-000001 and WH-000001, with LOC-000001 numbering independently within each warehouse. Existing default IDs are selected by the established unique Arabic name افتراضي. A missing default is added with a new ID and code LOC-DEFAULT. Backfill does not rewrite existing location IDs.
- Unique indexes enforce company-wide branch/warehouse codes and warehouse-local location codes. A partial index limits each warehouse to one default. Additional indexes support branch/status, warehouse/status and parent queries.
- Checks and triggers enforce code syntax, statuses, booleans, positive integer versions, required timestamps, parent existence and warehouse membership, cycles, immutable location ownership and protected stockable default roots. Default deletion and clearing its default flag are rejected.
- As specified by the approved plan, the admin role gains warehouse.status, warehouse.reparent and warehouse.reassign. Dedicated endpoints and UI for them remain later-stage work.

Each v7 transformation and its migration record run in one transaction. Validation before commit requires clean database integrity/FKs and exactly one stockable default root per warehouse. Reopening v7 verifies rather than reruns the backfill.

## Verified backup gate

Startup validates the existing schema and integrity before requesting an upgrade backup. Existing databases crossing into v7 require a configured beforeUpgrade policy; the application and staged restore supply the real verified snapshot policy. Fresh empty databases use the normal migration sequence without a historical snapshot.

The policy creates a uniquely named WAL-consistent VACUUM INTO snapshot with all referenced Catalog media and checksums. It restores a disposable verification copy, compares copied database/media hashes, reopens it read-only, and validates schema, integrity and foreign keys. No migrations run on this verification copy. Only successful verification allows the live upgrade to begin. Prior backups remain intact. Missing media, corrupt checksums and backup destination failure all abort before v7 changes.

Restore uses the same validated copy path, then upgrades its separate staged dataset through the same backup gate. The original backup and active dataset remain untouched by staged upgrade. Existing active-directory switching and rollback functions were preserved.

## Version compatibility and supported writes

CURRENT_SCHEMA_VERSION is the central supported-version value used by the runner, startup and recovery. Verification compares required SQLite definitions with the actual applied version, including contiguous migration history and schema metadata. Valid v6 upgrades; incompatible v6 is rejected before backup/mutation; valid v7 reopens; missing v7 protections and future schemas are rejected. Unknown nonempty unversioned databases are rejected.

The legacy WarehouseDirectory retains its public signatures and response shapes. Its inserts now specify columns and generate valid metadata when v7 fields exist. Warehouse/default creation is atomic, including when invoked outside an Inventory transaction. It still works against v6 test fixtures. These are schema compatibility changes, with no new Warehouse application services or Inventory posting redesign.

## Validation evidence

| Check | Result |
|---|---|
| Pre-change full Jest baseline | 49 passed across 9 suites |
| Pre-change TypeScript and architecture checks | Passed, 76 modules |
| Final full Jest suite | 61 passed across 10 suites, 0 failed |
| New v7 migration suite | 12 passed |
| Final TypeScript checks | Passed, renderer and Node configurations |
| Final architecture/cycle check | Passed, 77 modules |
| Production main, preload and renderer build | Passed |
| Disposable fixture integrity | integrity_check exactly ok; foreign_key_check empty |

Machine-readable results are saved locally at [phase3-v7-jest.json](../out/phase3-v7-jest.json). This ignored build artifact should be archived with the reviewed candidate.

Commands executed were npm.cmd test, npm.cmd test -- --runTestsByPath electron/main/database/phase3.test.ts, npm.cmd test -- --ci --json --outputFile=out/phase3-v7-jest.json, npm.cmd run typecheck, npm.cmd run build and git diff --check. Electron-backed tests and the build used authorized outside-sandbox execution where required. All fixtures were in memory or newly created temporary directories. No customer or development application database was opened.

The new suite covers populated v6 WAL upgrade with exact stock quantities above JavaScript's safe-integer range, deterministic backfill, a missing historical default, unchanged IDs and Inventory rows, media-complete backup, repeated startup, required backup policy, missing media, corrupted backup media, failed backup destination, late migration failure, rollback, staged restoration, incompatible v6/v7, hierarchy/metadata constraints, historical FK violations, reparenting and exact-location counts, legacy warehouse creation/default rollback and fresh installation. The existing full regression suite also covers v5-to-current startup, future-schema rejection, posting/transfer rollback, idempotency and recovery.

The reparent regression cancels its pre-existing count before the SQL-only structure change, then compares all Inventory tables exactly. It separately starts a count at the stocked parent and demonstrates independent child receipts, unchanged parent expected quantity and exact reconciliation. Application-level restrictions on hierarchy edits during counts remain a Stage 4/5 integration responsibility.

## Files changed in Stage 3

- Added electron/main/database/phase3.ts and phase3.test.ts.
- Updated electron/main/database/migrations.ts, index.ts and release-validation.test.ts.
- Updated electron/main/recovery.ts.
- Updated src/core/warehouses/infrastructure/sqlite-directory.ts.
- Updated src/core/inventory/infrastructure/inventory.integration.test.ts to exercise the actual verified upgrade backup policy for its older fixture.
- Added this results document. Existing Stage 2 source and documentation are preserved.

The four renderer file hashes still match the Stage 1 record. architecture-v2.ts retains SHA-256 A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD. The actual migration-6 SQL remains the same.

## Remaining risks and review gate

- Earlier customer distribution of schema-v6 builds is still unknown. Exact-definition verification rejects incompatible layouts safely; conversion of a different distributed layout requires its real fixture and an approved follow-up migration.
- Status/stockability operational validation and inventory-aware lifecycle restrictions require Stage 4/5 service integration. Structural DB constraints do not replace those policies.
- Exactly-one default is verified after migration, on startup/restore and during the supported atomic warehouse creation path. Arbitrary SQL that inserts a warehouse without a default is outside that path and fails subsequent database validation.
- Failed verification can leave an incomplete uniquely named backup or staged directory for diagnosis. It cannot activate that directory or overwrite a valid backup.
- Installed-Windows release acceptance, package provenance and final installer testing remain separate release gates.

Stop after Stage 3. No new IPC, renderer management UI, application service registration, commit, push or publication is included in this checkpoint.
