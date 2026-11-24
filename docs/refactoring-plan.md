# WMS refactoring plan

## Baseline and scope

The current working tree is based on `b8ed3743e7e6f02b3bdef86e068813154e311e27` and includes uncommitted Phase 4 and Stage 7 work. This audit made no repository edits. The plan is ready to save as `docs/refactoring-plan.md` when file edits are permitted.

| Verification rerun | Result |
| --- | --- |
| Jest with `WMS_INVENTORY_BENCHMARK=1` | 382 passed across 26 suites |
| Renderer and Electron TypeScript checks | Both passed |
| Architecture check | Passed across 128 modules |
| Electron production build | Main, preload and renderer built successfully |
| Production desktop smoke | Fresh startup and restart passed |
| Production Electron UI smoke | 89 checks passed, including all six Inventory reports |
| `git diff --check` | Passed |
| Lint and installer | No lint script is configured. The existing unsigned installer was outside this rerun. Installed upgrade and uninstall/reinstall data retention remain unverified. |

Preserve the current schema, existing uncommitted work, single SQLite writer, `userData` storage, verified v7 upgrade safeguards, fixed preload API, six Inventory read channels, and bounded legacy stock command bridge. Preserve exact bigint quantities, missing versus stored-zero balances, current cursor semantics, inactive-location reporting, Warehouse posting eligibility, and the posting transaction that commits the ledger, balances, document state, audit and command receipt together. Phase 5, new business features, installer configuration changes, and customer deployment are outside this plan.

Batches 1–3 correct demonstrated failure paths. Their changes to failed-operation behavior are intentional. Batches 4–7 preserve business behavior. The audit findings below are supported by source inspection. Reproduction tests belong at the start of each corrective batch.

## Prioritized findings

| ID | Severity and change risk | Evidence and impact |
| --- | --- | --- |
| F1 | **P0 · High** | `src/core/catalog/application/products/context.ts` (`saveImage`) and `src/core/catalog/application/brands.ts` (`storeImage`) remove the previous file before the database update succeeds. `FileImageStorage.save` overwrites identical filenames. `electron/main/ipc/catalog-handlers.ts` also writes audit after the use case, inside the outer SQLite transaction. A constraint or audit failure can roll SQLite back to an image reference whose file is missing or whose bytes have changed. A subsequent backup can fail on the missing reference. |
| F2 | **P1 · Medium** | `src/core/identity/application/identity.ts` (`addOperator`) and `electron/main/ipc/recovery-handlers.ts` compare actor IDs after an async wait. Signing out and back in as the same actor satisfies that comparison. Initial administrator setup checks whether the login is still current only after inserting the account. A stale login or privileged action can therefore write after its session or window was invalidated. |
| F3 | **P1 · High** | `electron/main/main.ts` calls `confirmStartup` immediately after creating the window. `createWindow` discards the promise from `loadFile` or `loadURL`. A failed renderer load can occur after the restore marker has already been cleared, bypassing the startup rollback path. |
| F4 | **P1 · Medium** | `src/core/identity/application/identity.ts` imports `better-sqlite3`, executes SQL and invokes platform cryptography. `scripts/check-boundaries.cjs` skips external library imports before enforcing core-layer rules. This is a concrete exception to the independent Application Core. |
| F5 | **P2 · Medium** | `electron/main/ipc/index.ts` returns only the six Inventory query disposers. Other handlers registered earlier survive a partial registration failure or explicit disposal. `electron/main/ipc/handle.ts` also duplicates error mapping with `src/core/shared/ipc/handle.ts`, whose only caller is an infrastructure test. The production handler erases the schema output type and casts it back before execution. |
| F6 | **P2 · Low** | `src/core/warehouses/application/location-policy.ts` calls `locations.listByWarehouse` in `resolveLocation`, then calls it again for `assertLocationUsable` and `countLocationIds`. This loads the same warehouse definitions twice per eligibility check. Posting invokes those checks for line locations and transfer destinations. |
| F7 | **P2 · Low** | `src/renderer/inventory-page.tsx` builds each location option by calling `inventoryLocationLabel`, which scans the eligible array. Building a full selector is quadratic in the number of eligible locations. Other render paths repeat linear item and location lookups. |

**Architecture assessment.** The renderer uses the preload contract, and Main retains trusted-window, main-frame and URL checks before dispatch. Inventory queries enforce the live `read` grant in the SQLite composition and use the existing connection. Catalog and Warehouse expose public contracts consumed by Inventory. The checker found no cycles in the 128 modules it examined. Legacy stock posting still combines orchestration and SQL in `sqlite-inventory.ts`. Its immediate transaction and idempotency behavior warrant a separate design effort before any extraction.

## Implementation batches

### 1. Preserve Catalog media when a database write fails

**Objective.** Correct F1 across direct Catalog calls and production IPC, including failures during audit and commit.

**Files.** `src/core/catalog/application/ports.ts`, `src/core/catalog/application/brands.ts`, `src/core/catalog/application/products/context.ts`, `src/core/catalog/application/products/crud.ts`, `src/core/catalog/infrastructure/create-sqlite-catalog.ts`, `src/core/catalog/infrastructure/file-image-storage.ts`, `electron/main/ipc/catalog-handlers.ts`, and new `electron/main/ipc/catalog-media.test.ts`.

- Extend the Catalog unit of work with commit and rollback callbacks. Use one outer Catalog transaction for the IPC use case and its existing audit insert. Direct image mutations use the same unit of work. When a nested savepoint succeeds, its callbacks remain pending until the outer commit. When it fails, roll back only the effects registered by that savepoint. Execute filesystem cleanup after the corresponding SQLite outcome and preserve the original error if cleanup fails.
- Write replacements under fresh UUID-based filenames in the existing `products` and `brands` folders, using exclusive file creation. Clean up partially written new files on write failure. Retain the old file through commit. On rollback remove only the new file. On commit retire the old file for replacement, explicit removal or successful entity deletion. Preserve existing filename compatibility, data URL validation, and omitted-image behavior.
- **Risk.** An inner commit or early file deletion could repeat the original data-loss path. Cleanup interrupted by a process exit may leave an unreferenced file. Automatic orphan cleanup is deferred.
- **Tests and acceptance.** Exercise product and brand replacements of the same and different formats, explicit image removal, and deletion. Inject a product base-unit constraint failure and a late IPC audit failure with real SQLite and disposable media. The original row, path and bytes must survive, the failed mutation must produce no audit row, and the referenced media must still be restorable from a verified snapshot. Success must reopen the new image, produce one audit row through IPC, and retire the old file. Run Catalog, recovery, phase acceptance, and production desktop checks.

### 2. Revalidate the exact session after asynchronous work

**Objective.** Correct F2 while preserving existing roles, grants, password format, window trust and Renderer contracts.

**Files.** `src/core/identity/application/identity.ts`, `electron/main/ipc/recovery-handlers.ts`, new `src/core/identity/application/identity.test.ts`, and new `electron/main/ipc/recovery-handlers.test.ts`.

- Use a unique in-memory token for each login attempt and a unique identity for each authenticated session. Logout and window destruction delete both. A late completion must fail even if the window ID or actor ID is reused. Check the setup attempt immediately before the synchronous first-admin transaction, retaining the existing empty-database check inside that transaction.
- Add a Main-only Identity method that captures the current session and returns a guard for revalidation. Use it after password hashing in `addOperator` and after the directory dialog in backup and restore. Keep the live permission recheck. Preserve `AUTH_REQUIRED` for a missing session and use the existing `SESSION_CHANGED` error for a superseded session. Keep dialog cancellation side-effect-free.
- **Risk.** A stale attempt must never clear a newer attempt or session. Tokens stay within Main/Core and never appear in a DTO or log.
- **Tests and acceptance.** Use deferred asynchronous completions to exercise setup invalidated before insert, older login superseded by newer login, window teardown, same-actor reauthentication during user creation or recovery, and revoked permissions. Rejected operations must produce zero operator, audit, snapshot and activation changes. Successful operations retain existing results. Run Identity, IPC authorization, and desktop switching/logout checks.

### 3. Keep restore rollback available until the initial renderer load succeeds

**Objective.** Correct F3 at the Main startup boundary.

**Files.** `electron/main/main.ts` and new `electron/main/main.test.ts`.

- Await the initial trusted renderer load before calling `confirmStartup`. Route an initial load rejection through the existing unregister, database close and restore rollback sequence. During bootstrap, prevent `window-all-closed` from quitting ahead of rollback. Handle later macOS `activate` load failures separately from initial restore confirmation.
- **Architecture and risk.** The checkpoint is Electron’s successful renderer load. Existing `ready-to-show`, trusted URL and redirect validation, `userData` and atomic dataset pointer behavior remain in place. Closing a failed window must run sender and session cleanup.
- **Tests and acceptance.** Mock the Electron lifecycle with a deferred load promise. Verify that a successful load confirms once, a failed staged startup retains the marker through rollback and requests one relaunch, and an ordinary failed startup follows the existing error path. Exercise a window closing during failed startup and a later activation failure. Run disposable recovery tests and real fresh/restart desktop smoke. Installed restore acceptance remains a separate gate.

### 4. Move Identity storage and cryptography behind application ports

**Objective.** Correct F4 after the session changes have regression coverage.

**Files.**

- `src/core/identity/application/identity.ts`, `src/core/identity/application/identity.test.ts`, new `src/core/identity/application/ports.ts`, new `src/core/identity/infrastructure/sqlite-operators.ts`, new `src/core/identity/infrastructure/create-sqlite-identity.ts`, and new `src/core/identity/public.ts`.
- `electron/main/main.ts`, `electron/main/ipc/index.ts`, `electron/main/ipc/identity-handlers.ts`, `electron/main/ipc/catalog-handlers.ts`, `electron/main/ipc/recovery-handlers.ts`, and `electron/main/ipc/recovery-handlers.test.ts`.
- Composition imports in `electron/main/database/inventory-schema.test.ts`, `electron/main/database/phase3.test.ts`, `electron/main/database/release-validation.test.ts`, `electron/main/ipc/inventory-handlers.test.ts`, `electron/main/ipc/phase3-acceptance.test.ts`, `electron/main/ipc/warehouse-handlers.test.ts`, `src/core/inventory/infrastructure/inventory-performance.test.ts`, `src/core/inventory/infrastructure/inventory.integration.test.ts`, `src/core/inventory/infrastructure/sqlite-balance-reader.integration.test.ts`, `src/core/inventory/infrastructure/warehouse-integration.test.ts`, and `src/core/warehouses/infrastructure/services.integration.test.ts`.
- `scripts/check-boundaries.cjs` and `docs/architecture-v2.md`.

- Keep session ownership, authorization decisions and permission shaping in Application. Inject operator lookup, first-admin creation, operator/roles/audit persistence, permission reads, credential operations and ID generation. Compose the existing SQL and Node crypto in infrastructure. Preserve the exact `s1` digest format, SQL ordering, first-admin transaction, and atomic operator/roles/audit write. Main composes the concrete adapter on its existing SQLite connection and uses the public Identity type.
- Extend the checker to reject same-module Infrastructure imports from Domain/Application and platform imports from those layers, including bare and `node:` Node built-ins. Run these checks before skipping external packages. Preserve existing cross-module and cycle checks.
- **Risk.** Changing digest bytes, role ordering or transaction placement could affect existing accounts. Move existing behavior, including setup contention handling, with compatibility tests running against real SQLite.
- **Tests and acceptance.** The Identity application tests run with deterministic ports and no SQLite. Existing file-backed accounts can log in, combined roles produce the same capabilities, and failed operator persistence rolls back roles and audit. Validate the checker against disposable invalid dependency fixtures. Run the full Jest suite, both TypeScript configurations, architecture check and desktop smoke.

### 5. Give Main one complete IPC handler lifecycle

**Objective.** Correct F5 while preserving public channels, request validation, permissions and error payloads.

**Files.** `electron/main/main.ts`, `electron/main/ipc/{dispatch,handle,index,catalog-handlers,identity-handlers,inventory-handlers,recovery-handlers,warehouse-handlers}.ts`, `electron/main/ipc/dispatch.test.ts`, `electron/main/ipc/inventory-handlers.test.ts`, `src/core/inventory/infrastructure/sqlite-balance-reader.integration.test.ts`, and `src/core/shared/ipc/handle.ts` for removal.

- Give each handler group a registration scope that records successful binds and returns an idempotent disposer. On a failure, dispose that group’s successful binds and propagate the error. Main composes all group disposers, including system and the legacy stock command, and disposes them on startup failure and quit. Leave externally registered handlers intact, including the channel that caused a registration collision.
- Type the production validation wrapper from the inferred schema output through dispatch. Retain transformed inputs, custom Inventory pagination errors and the existing sanitized response for unexpected failures. Keep the infrastructure test’s assertion on the typed error and internal cause. Keep public error assertions at the real Main IPC boundary and remove the duplicate test-only Core mapper.
- **Risk.** Registration order and ownership matter. Keep trust and frame validation ahead of schema parsing or execution. Preserve current authorization checks and all preload method names.
- **Tests and acceptance.** Exercise partial registration failure, double disposal, clean re-registration, preservation of unrelated handlers, and standalone Inventory group disposal. Add a transformed-schema case. Existing IPC tests must continue to reject untrusted senders, frames and forged inputs and must keep SQL, paths and stack traces out of public errors. Run IPC, preload, both type checks and fresh/restart desktop smoke.

### 6. Reuse Warehouse definitions within each eligibility check

**Objective.** Correct F6 with a single same-connection definitions read per location-policy call.

**Files.** `src/core/warehouses/application/location-policy.ts`, new `src/core/warehouses/application/location-policy.test.ts`, and `src/core/inventory/infrastructure/inventory-performance.test.ts`.

- Resolve the location, warehouse, branch and one set of definitions together. Pass the same definitions to the existing Domain functions after resolving ancestry. Preserve validation order, returned paths, error codes, inactive reporting, and exact-location count scope. Keep the definitions local to the call.
- **Risk.** Skipping ancestry validation or using an active-only list would change existing eligibility errors and reporting behavior. Keep the existing Domain rules and same-transaction reads.
- **Tests and acceptance.** Assert one `listByWarehouse` call for both eligibility and count checks, including an inactive ancestor. Compare valid paths and known failure codes for missing, organizational and inactive locations. Run Warehouse services and stock posting/count/rollback integration suites. Measure before and after on the existing generated fixture and report both query count and elapsed time. The deterministic acceptance criterion is two definition reads reduced to one per call.

### 7. Index Stock Operations option and label data in the renderer

**Objective.** Correct F7 without changing requests, available actions or presentation.

**Files.** `src/renderer/inventory-page.tsx`, `src/renderer/warehouses/inventory-locations.ts`, and `src/renderer/warehouses/model.test.ts`.

- Keep the existing ordered arrays for rendering options. Build item and eligible-location lookup maps when those arrays change. Format eligible options directly from their rows. Use the maps for line/result labels, eligibility checks and missing historical IDs. Preserve eligible-first lookup, disabled historical selections, unknown-ID fallback, Arabic copy and exact quantity formatting.
- **Risk.** An unordered render or a lost historical fallback could misrepresent a previously saved draft. Keep option order and selected values unchanged.
- **Tests and acceptance.** Unit-check unchanged labels and ordering for eligible, inactive historical and unknown locations. Compare lookup work and elapsed time on a 2,400-location synthetic fixture on the same host. The algorithmic acceptance criterion is one pass to prepare options and indexes, with no per-option scan of the eligible array. Run the production UI smoke, including receipt, issue, transfer, count, reversal and the unavailable historical draft.

## Sequencing, performance and release gates

- **Order.** Run batches 1, 2 and 3 as separate corrective changes. Batch 4 depends on 2. Batch 5 follows 1–4 because it touches their Main composition and handler files. Batches 6 and 7 are independent and can be validated separately. Save the plan before starting implementation. Preserve and inspect pre-existing modified and untracked files. Keep each batch’s diff independently reviewable. Do not commit or push.
- **Performance evidence.** The rerun used Windows 10 x64, an i7‑4600U, Electron 35.7.5, and an in-memory schema-v8 fixture with 3,000 items, 2,406 locations, 30,000 balances and 174,995 movements. Median times were 3.06 ms for an exact balance, 38.99 ms for a 5,000-balance warehouse report, 14.36 ms for item-wide 50-row history, 3.25 ms for location-scoped history, 76.59 ms for exact-pair reconciliation, and 542.17 ms for legacy full reconciliation. Legacy reconciliation peaked at 2,094 ms in this run. The small desktop history fixture rendered 50 rows in 58 ms through the second animation frame. These are observations from the current host. There is no approved latency threshold.
- **Defer ledger and renderer scaling changes.** `movements_history(item,location,id)` serves exact-location history and limits exact reconciliation to the selected pair. Item-wide history uses the item prefix and a temporary sort. Exact reconciliation still scans every matching movement, and legacy reconciliation streams the whole ledger on Main. The balance primary key and `balances_location` serve current balance lookups. Defer a forward index migration, worker threads, additional connections, reconciliation caches and full-size table virtualization until controlled file-backed and renderer measurements justify a specific design. Preserve one read transaction and exact BigInt arithmetic, including for discrepancies outside the signed 64-bit balance range.
- **Defer broader cleanup.** Keep the legacy posting transaction and command DTO intact. Defer Catalog permission metadata changes, a general diagnostics redesign, shared React query hooks, directory loading redesign, and removal of the unwired Redux store and dependencies. The renderer entrypoint has no Redux provider and the store has no reducers. Treat Redux cleanup and ESLint as separate tooling decisions. Keep the native rebuild tooling used by `postinstall`, current package manager and lockfile.
- **Verification and handoff.** Run the listed focused regressions after each batch and stop on an unexplained failure. At the end repeat `npm.cmd run typecheck`, `npm.cmd test -- --ci` with the benchmark enabled, `npm.cmd run build`, `npm.cmd run test:desktop`, `npm.cmd run test:desktop -- --warehouses-ui`, and `git diff --check`. Record exact outcomes, paths changed, and before/after measurements. Engineering continuation is conditional on closing the corrective batches and passing the final checks. Customer release remains a separate decision requiring installed fresh-start, supported-version upgrade, recovery and uninstall/reinstall data-retention evidence on a disposable Windows account or VM.
