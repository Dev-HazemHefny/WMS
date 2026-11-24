# WMS refactoring progress

## Batch 1 — Preserve Catalog media when a database write fails

**Status: passed Batch 1 engineering acceptance.** The implementation addresses finding F1 in [the refactoring plan](refactoring-plan.md). Validation ran on 23 November 2026 (Africa/Cairo) against disposable SQLite databases, media directories, backups and Electron profiles.

### Root cause and reproduction

Product and brand updates previously wrote replacements to entity-based paths and removed prior files before SQLite committed. A same-format replacement could overwrite the bytes in place. A different-format replacement, explicit removal, or deletion could unlink the file that the database still needed if the write rolled back. The IPC handler inserted audit after the Catalog operation, so an audit failure could trigger any of these outcomes. Failed audited creates could leave newly written files behind.

Before the production fix, all 11 new expectations failed. Nine cases confirmed overwritten bytes, missing media, or an orphaned create after the original database rows rolled back. The other two confirmed that successful same-format replacements still reused their original paths. The fixtures included a real stock-history base-unit constraint and a test-only SQLite trigger that rejected the IPC audit insert.

### Implementation and guarantees

- Catalog IPC mutations use the existing Catalog unit of work for both the use case and audit insert on the same connection. Direct image mutations use that same unit of work. A successful savepoint passes its callbacks to the enclosing scope. A failed savepoint cleans up only its own staged files. Old-file cleanup runs after the outer commit succeeds. If the outer rollback outcome is uncertain, it retains the files.
- New images use fresh UUID filenames and an exclusive open. The storage adapter writes and flushes the file before SQLite can commit its path, and attempts to remove a partially written new file if staging fails. Rollback removes staged replacements and keeps the original media. Post-commit cleanup checks both product and brand rows before removing a path, including shared legacy paths and differences in ASCII case.
- Product and brand image policy still uses the existing format and size validation. Omitted images preserve the reference, and explicit removal clears it. Cleanup failures preserve the primary database error or the success of an already committed write.

### Verification

| Check | Result |
| --- | --- |
| Catalog media suite before the fix | 11 expected failures |
| Final Catalog media suite | 17 passed, including a failure at SQLite COMMIT, nested savepoints, shared-file retention, partial-write cleanup, collision refusal, and cleanup failure after commit or rollback |
| Focused Catalog, audit, transaction, recovery and phase acceptance suites | 44 passed across 6 suites |
| Final full Jest suite with the existing opt-in benchmark enabled | 399 passed across 27 suites |
| Both TypeScript configurations and architecture check | Passed. Architecture check covered 129 modules. |
| Production Electron build | Passed |
| Production desktop smoke | Fresh startup and restart passed. The graphical desktop smoke passed all 89 checks. |
| `git diff --check` | Passed |

The recovery regressions reopened the exact original image bytes from a staged, verified snapshot after failed writes and confirmed that failed audited operations created zero audit rows. Successful audited replacements, removals and deletions retained one audit row per action. [Full Jest results](../out/refactoring-batch1-jest.json)

### Batch 1 files

| Status | Path |
| --- | --- |
| Modified | `electron/main/ipc/catalog-handlers.ts` |
| Modified | `src/core/catalog/application/brands.ts` |
| Modified | `src/core/catalog/application/ports.ts` |
| Modified | `src/core/catalog/application/products/context.ts` |
| Modified | `src/core/catalog/application/products/crud.ts` |
| Modified | `src/core/catalog/infrastructure/create-sqlite-catalog.ts` |
| Modified | `src/core/catalog/infrastructure/file-image-storage.ts` |
| Created | `src/core/catalog/application/catalog-media.ts` |
| Created | `electron/main/ipc/catalog-media.test.ts` |
| Created | `docs/refactoring-progress.md` |

### Remaining risks and acceptance scope

An interruption before commit can leave a staged file with no database reference. An interruption after commit and before cleanup, or a locked file during cleanup, can leave a superseded file. Automatic orphan cleanup is deferred. SQLite and the filesystem have separate durability boundaries, including directory metadata and storage-device behavior during power loss. The regression suite covered injected write and cleanup failures. It did not simulate power loss or forcibly terminate the Electron process during the commit window. Installed-Windows acceptance remains a separate release gate.

All planned Batch 1 engineering checks passed. No later batch was started. The existing working-tree changes were preserved, and no commit or push was made.

## Batch 2 — Revalidate the exact session after asynchronous work

**Status: passed Batch 2 engineering acceptance.** Validation ran on 23 November 2026 (Africa/Cairo) against isolated SQLite databases, recovery directories and Electron profiles. Batch 1 remained intact.

### Root cause and reproduction

User creation and recovery previously compared actor IDs after password hashing or a directory dialog. The original and replacement sessions could have the same actor ID, so a stale operation could create an account, export a backup, or activate a restore. First-admin setup checked whether the attempt was current only after inserting the administrator. Recovery also mapped a switch to a different actor to `INTERNAL_ERROR`.

The two new suites ran before the fix with 7 failures and 13 passes. Two setup cases left unwanted operator and role rows. The two same-actor user creation cases completed successfully when they should have been rejected. Stale backup and restore each returned success after same-actor reauthentication. Switching to another actor returned the wrong error code. Existing logout, permission revocation, cancellation and uninterrupted workflow cases provided passing controls.

### Implementation and acceptance

- A unique in-memory symbol identifies each login attempt. A newer attempt, logout, or the existing destroyed-window callback invalidates it. Completed attempts remove only their own token. First-admin setup checks its attempt immediately before the existing transaction, which still checks whether the operator table is empty.
- Each successful login installs a fresh authenticated session object. A Main-only guard captures that object and the actor. User creation, backup and restore revalidate it after their asynchronous step and recheck the live permission before side effects. A missing session returns `AUTH_REQUIRED`, a replacement session returns `SESSION_CHANGED`, and a revoked grant returns `FORBIDDEN`. An invalidated login attempt returns `SESSION_CHANGED`. Cancelled directory dialogs still return `null` without effects.
- The regressions compare operators, role membership and audit rows before and after rejected actions. Recovery IPC tests also compare the disposable recovery directory and active dataset, and assert that rejected or cancelled operations never reach the filesystem setup or application relaunch. Positive controls verify the persisted password format, authorized user creation, backup manifest, restore staging, activation and audit.

### Verification

| Check | Result |
| --- | --- |
| Batch 1 baseline from the prior verified run | 399 passed across 27 suites |
| New Identity and Recovery IPC suites before the fix | 7 reproduced failures and 13 passing controls |
| Final focused Identity, Recovery, IPC trust, Phase 3 acceptance and Catalog media suites | 45 passed across 6 suites, including all 20 new tests |
| Final full Jest suite with the opt-in benchmark enabled | 419 passed across 29 suites |
| Renderer and Electron TypeScript checks | Both passed |
| Architecture check | Passed across 129 modules |
| Production build | Passed |
| Production desktop smoke | Fresh startup and restart passed. The graphical smoke passed all 89 checks, including user switching and revoked permissions. |
| `git diff --check` | Passed |

[Full Batch 2 Jest results](../out/refactoring-batch2-jest.json)

### Batch 2 files

| Status | Path |
| --- | --- |
| Modified | `src/core/identity/application/identity.ts` |
| Modified | `electron/main/ipc/recovery-handlers.ts` |
| Created | `src/core/identity/application/identity.test.ts` |
| Created | `electron/main/ipc/recovery-handlers.test.ts` |
| Updated | `docs/refactoring-progress.md` |

### Remaining limitations

Invalidation prevents pending work from persisting after an asynchronous boundary. An already-running scrypt calculation can still finish, and a synchronous operation that has passed revalidation runs to completion. The deterministic destruction test exercises the trust and session cleanup functions that Main calls, and uses real recovery code with mocked Electron dialogs and relaunch. The installed-Windows recovery and startup rollback gates remain separate.

All Batch 2 acceptance scenarios passed. Work stopped after Batch 2, with the existing working-tree changes preserved.

## Batch 3 — Keep restore rollback available until the initial Renderer load succeeds

**Status: passed Batch 3 engineering acceptance.** Validation ran on 23 November 2026 (Africa/Cairo) using disposable SQLite databases and Electron profiles. The Batch 1 Catalog media and Batch 2 session regressions passed.

### Root cause and reproduction

Main discarded the initial `loadFile()` or `loadURL()` promise and called `confirmStartup()` as soon as it created the window. That could remove `restore-pending` while the Renderer was still loading. A later rejection never reached the startup catch block. On Windows, closing the last window during bootstrap could also start quitting before recovery.

Eight deferred-load cases failed against the original Main code. Both entry points confirmed early, a last-window close called quit while the load was pending, an explicit shutdown reached cleanup before the load settled, and a later activation rejection never reached an error handler. The fixtures used the real snapshot, staging, activation, and rollback functions with a temporary SQLite profile.

### Implementation and acceptance

- Main awaits the initial load and checks the current URL against the existing trusted URL rule before calling `confirmStartup()` once. The navigation and redirect guards still enforce that same rule.
- A failed window is destroyed, which revokes sender trust and ends its Identity session. Main suppresses last-window quit and defers `will-quit` during bootstrap. The startup failure path runs the existing IPC disposer and closes the managed SQLite connection once before calling `rollbackRestore()`. A successful rollback restores the previous dataset and requests one relaunch. An ordinary startup failure uses the existing error dialog and quit path.
- Later activation handles load errors at the window level. A failed macOS window releases its sender and session state, and the next activation can reuse the active database and IPC registrations. Activation never enters startup confirmation or restore rollback.
- Acceptance requires successful confirmation after trusted loading, preservation of the restore marker through failed startup until rollback, orderly teardown before relaunch, independent activation, and passing engineering checks.

### Verification

| Check | Result |
| --- | --- |
| Startup lifecycle suite before the fix | 8 expected failures |
| Final startup lifecycle suite | 9 passed, including a resolved load with an untrusted final URL |
| Focused Main, recovery, restore, IPC cleanup, Identity, Catalog media and Phase 3 acceptance | 68 passed across 9 suites |
| Full Jest suite with the Inventory benchmark enabled | 428 passed across 30 suites |
| Renderer and Electron TypeScript checks | Both passed |
| Architecture check | Passed across 129 modules |
| Electron production build | Main, preload and Renderer built successfully |
| Desktop fresh start and restart | Both passed |
| Production Electron UI smoke | All 89 checks passed |
| `git diff --check` | Passed |
| Installed-Windows restore and relaunch acceptance | Not Run |

### Batch 3 files

| Status | Path |
| --- | --- |
| Modified | `electron/main/main.ts` |
| Created | `electron/main/main.test.ts` |
| Updated | `docs/refactoring-progress.md` |

### Remaining limitations

The existing IPC disposer removes the six Inventory query handlers. Other production registrations live until process exit, and the failed window loses access to all channels when its sender trust is revoked. Complete registration ownership remains scheduled separately in the approved plan.

The startup checkpoint is Electron's completed load of the trusted page. The failure tests use mocked Electron lifecycle events with real recovery operations on disposable data. The production smoke tests ran on Windows against the built application. Installed-Windows fault recovery and forced process termination remain outside this engineering evidence.

## Batch 4 — Move Identity storage and cryptography behind application ports

**Status — PASS.** Engineering validation ran on 23 November 2026 (Africa/Cairo) with disposable SQLite databases and Electron profiles. The Batch 1 media, Batch 2 session and Batch 3 startup recovery regressions passed.

### Root cause and implementation

Identity Application used the SQLite driver type, executed SQL, managed transactions and called Node cryptography directly. The architecture checker skipped unresolved and external imports before it could enforce platform independence and allowed same-module imports into Infrastructure.

- Identity Application now takes an `OperatorStore`, a `Credentials` port and an ID generator function. It still owns login, session guards, authorization, role deduplication and capability filtering. Superseded attempts are checked before credential comparison or administrator setup. `addOperator` still revalidates the exact session and live `manage-users` grant after hashing.
- The SQLite adapter reuses the managed connection and existing transaction API. It checks the empty operator table inside the first-admin transaction. Additional operators, all role assignments and the `add-user` audit row commit together. Existing lookups, ordered permission reads, constraints and audit semantics carry over.
- The Node adapter preserves the `s1` digest, the original scrypt parameters and password input, and the dummy derivation for a missing operator. It defers comparison until the application has checked the login attempt. Electron Main composes one service on the managed connection and IPC depends on the type-only Identity public contract.
- The checker rejects Node built-ins, Electron, SQLite drivers and resolved Infrastructure imports from Application and Domain before skipping external packages. Isolated fixtures cover the new rules, Infrastructure-to-Application dependencies, shared and public types, private cross-module imports and cycles.

### Verification

| Check | Result |
| --- | --- |
| Current baseline with the opt-in Inventory benchmark | 428 passed across 30 Jest suites. Both TypeScript configurations and the architecture check passed across 129 modules. |
| SQLite characterization before extraction | 6 passed on the original implementation. |
| Architecture fixtures before updating the checker | 10 expected failures for prohibited imports and 3 passing controls. |
| Identity Application in plain Node | 14 passed with deterministic ports, including five new cases. |
| SQLite Identity integration | 7 passed. Covered reopened legacy credentials and unchanged digest bytes, case-insensitive usernames, exact passwords, permission order and union, role persistence, audit, setup contention and SQLite rollback. |
| Architecture checker fixtures | 13 passed. Ten prohibited imports were rejected. Allowed Infrastructure, shared and public paths passed, and private cross-module imports and cycles were rejected. |
| Focused Identity, architecture, IPC, recovery, Catalog, Inventory and Warehouse suites | 294 passed across 16 suites. Included an added Preload contract test and expanded Main composition and IPC authorization assertions. |
| Final full Jest suite with the opt-in Inventory benchmark | 454 passed across 32 suites, an increase of 26 cases. |
| Renderer and Electron TypeScript configurations | Both passed. |
| Production architecture check | Passed across 134 modules. |
| Electron production build | Main, Preload and Renderer passed. |
| Production desktop smoke | Fresh start and restart passed, including persisted credentials, role switching and logout. |
| Production graphical UI smoke | All 89 checks passed. |
| `git diff --check` | Passed. |
| Lint | The repository has no configured lint script. |

The SQLite tests injected failures on the first administrator's role, an additional operator's later role, and the audit row after insert. Every failing write left the preceding database state intact. The compatibility fixture retained the original malformed-digest error for a current login and returned `SESSION_CHANGED` first for an invalidated attempt. IPC tests covered Catalog and Warehouse mutations, Inventory queries and commands, and the existing recovery session checks.

### Batch 4 files

| Status | Path |
| --- | --- |
| Created | `src/core/identity/application/ports.ts` |
| Created | `src/core/identity/infrastructure/create-sqlite-identity.ts` |
| Created | `src/core/identity/infrastructure/node-credentials.ts` |
| Created | `src/core/identity/infrastructure/sqlite-operators.ts` |
| Created | `src/core/identity/infrastructure/sqlite-identity.integration.test.ts` |
| Created | `src/core/identity/public.ts` |
| Created | `src/core/shared/architecture/check-boundaries.test.ts` |
| Modified | `src/core/identity/application/identity.ts` |
| Modified | `src/core/identity/application/identity.test.ts` |
| Modified | `scripts/check-boundaries.cjs` |
| Modified | `electron/main/main.ts` |
| Modified | `electron/main/main.test.ts` |
| Modified | `electron/main/ipc/index.ts` |
| Modified | `electron/main/ipc/identity-handlers.ts` |
| Modified | `electron/main/ipc/catalog-handlers.ts` |
| Modified | `electron/main/ipc/recovery-handlers.ts` |
| Modified | `electron/main/ipc/catalog-media.test.ts` |
| Modified | `electron/main/ipc/inventory-handlers.test.ts` |
| Modified | `electron/main/ipc/phase3-acceptance.test.ts` |
| Modified | `electron/main/ipc/recovery-handlers.test.ts` |
| Modified | `electron/main/ipc/warehouse-handlers.test.ts` |
| Modified | `electron/main/database/inventory-schema.test.ts` |
| Modified | `electron/main/database/phase3.test.ts` |
| Modified | `electron/main/database/release-validation.test.ts` |
| Modified | `electron/preload/warehouse-api.test.ts` |
| Modified | `src/core/inventory/infrastructure/inventory-performance.test.ts` |
| Modified | `src/core/inventory/infrastructure/inventory.integration.test.ts` |
| Modified | `src/core/inventory/infrastructure/sqlite-balance-reader.integration.test.ts` |
| Modified | `src/core/inventory/infrastructure/warehouse-integration.test.ts` |
| Modified | `src/core/warehouses/infrastructure/services.integration.test.ts` |
| Modified | `docs/architecture-v2.md` |
| Updated | `docs/refactoring-progress.md` |

### Remaining limitations

The existing operator schema stores ID, name and digest. Outstanding IPC registration ownership belongs to the separately scheduled Batch 5. Installed-Windows restore and relaunch acceptance remains a separate release gate. The working tree retains the prior changes and Batch 1–3 records.

## Batch 5 — Give Electron Main one complete IPC handler lifecycle

**Status — PASS.** The focused baseline passed 340 tests in 22 suites with the opt-in Inventory benchmark skipped. The final run passed the Batch 1 Catalog media transaction, Batch 2 exact-session revalidation, Batch 3 startup restore rollback, and Batch 4 Identity ports and adapters regressions.

### Root causes and before-fix results

- The application coordinator returned the disposer for six Inventory queries. The other 79 handlers survived ordinary startup failure and application disposal. A collision at `recovery:restore` leaked the handlers registered before it and blocked clean re-registration. A captured dispatcher callback still executed with a trusted sender after disposal.
- The Main validation wrapper cast `safeParse` output to an executor type inferred independently of the schema. The runtime already applied transforms. The TypeScript reproduction inferred `unknown` for a number-producing schema and accepted a callback expecting the raw string.
- The Core IPC mapper had one consumer, the SQLite balance-reader integration test. Main used its own mapper in production.

### Implementation and regressions

- Each handler group returns an idempotent disposer through the existing dispatcher. A registration scope records cleanup after Electron accepts a bind. On failure the group unwinds its successful binds in reverse order, and the application scope then unwinds completed groups. The colliding handler and unrelated handlers survive. Cleanup attempts every recorded action and reports failures with the original registration error when both fail.
- Main owns all 85 channels across Warehouse, Identity, Catalog, Inventory queries, Recovery, system info, and the bounded stock command. After window teardown revokes trust and ends the session, Main disposes IPC before closing SQLite. Failed startup retains Batch 3's trusted-renderer confirmation and rollback ordering. The `quit` path also handles Electron's immediate exit during restore. Disposal disables captured callbacks, revokes pending Identity work through the existing session guards, and cancels pending Recovery dialog results.
- The validation wrapper carries Zod's raw and parsed types separately and passes `safeParse` data directly to the executor. Regression tests use a string-to-number transform, check compile-time executor types and trust-before-parsing, and verify sanitization when a transform throws. Inventory pagination retains its custom error code.
- Main remains the sole public error mapper. Core integration tests assert the typed errors and original SQLite causes, and Main IPC tests assert the sanitized public messages. Existing trust checks, redirect restrictions, exact-session checks, live grants, fixed Preload methods, and wire payloads were preserved.
- Added regressions for standalone group rollback and disposal, late application collisions, clean re-registration, repeated disposal, stale callbacks, pending Identity and Recovery work, failed restore rollback, and normal and immediate shutdown. The tests use isolated SQLite databases and disposable profiles.

### Verification

| Check | Result |
| --- | --- |
| Focused Jest | 391 passed in 23 suites on the final code, counted from the final Jest report for the focused selection with the benchmark excluded. The separate focused run before the final two dispatcher cases passed 389. |
| Full Jest with `WMS_INVENTORY_BENCHMARK=1` | 471 passed in 32 suites, up from the previous 454. [Jest report](../out/refactoring-batch5-jest.json) |
| TypeScript and architecture | Both `tsconfig.json` and `tsconfig.node.json` passed. The architecture checker passed for 133 modules. |
| Production Electron build | Main, Preload, and Renderer built successfully. |
| Desktop smoke | Fresh start and restart passed. A production immediate-exit probe confirmed cleanup of all 85 owned channels and preservation of one unrelated handler. |
| Production graphical smoke | All 89 checks passed. The first run used an unsupported evidence prefix. The successful run used a supported prefix in a separate output directory to preserve existing evidence. [Graphical smoke checks](../out/refactoring-batch5-ui-run/out/phase4-stage7-ui-checks.json) |
| Whitespace and lint | `git diff --check` passed. The repository has no lint script or ESLint configuration. |

### Batch 5 files

| Change | Path |
| --- | --- |
| Modified | `electron/main/main.ts` |
| Modified | `electron/main/main.test.ts` |
| Modified | `electron/main/ipc/catalog-handlers.ts` |
| Modified | `electron/main/ipc/dispatch.ts` |
| Modified | `electron/main/ipc/dispatch.test.ts` |
| Modified | `electron/main/ipc/handle.ts` |
| Modified | `electron/main/ipc/identity-handlers.ts` |
| Modified | `electron/main/ipc/index.ts` |
| Modified | `electron/main/ipc/inventory-handlers.ts` |
| Modified | `electron/main/ipc/inventory-handlers.test.ts` |
| Modified | `electron/main/ipc/recovery-handlers.ts` |
| Modified | `electron/main/ipc/warehouse-handlers.ts` |
| Modified | `src/core/inventory/infrastructure/sqlite-balance-reader.integration.test.ts` |
| Removed | `src/core/shared/ipc/handle.ts` |
| Updated | `docs/refactoring-progress.md` |

### Remaining limitations

Electron removes invoke handlers by channel name. Handler ownership assumes that components respect that channel allocation. Cleanup failures are reported, and a callback whose removal fails is disabled, but the occupied channel can still block re-registration. Installed-Windows restore and relaunch acceptance remains a separate release gate.


## Batch 6 — Reuse Warehouse definitions within each eligibility check

**Status — PASS.** Validation ran on 24 November 2026 (Africa/Cairo). The applicable policy calls and the measured receipt post each execute one warehouse-definition SELECT. The full regression suite, production build, and Windows desktop smoke checks passed.

### Root cause and implementation

`assertLocationUsable` and `countLocationIds` called `resolveLocation`, which loaded the warehouse definitions to resolve stored ancestry. Each method then loaded the same rows again for the Warehouse Domain rules. Before the fix, 25 of the 46 new policy tests reproduced duplicate reads. The other 21 passed. All path, result, and error assertions reached in the baseline passed. The benchmark independently observed two definition reads for eligibility, count eligibility, and a one-line receipt post.

A shared policy helper now looks up the location, warehouse and branch in the original order. It reads warehouse definitions once and resolves the stored path before eligibility validation. Posting eligibility and counting pass the same rows to the existing Domain rules, including candidate ancestry, ownership, active status, and stockability checks. Public resolution still returns the root-first path and effective activity. The definitions live within one invocation on the caller's existing repository connection and transaction.

The new policy suite covers valid nested paths, exact counts at a stockable parent, inactive locations and ancestors, organizational locations, missing definitions, warehouse and branch mismatches, cycles, error precedence, transfer and receipt eligibility, and reloading definitions on the next call. It verifies that historical reporting includes inactive stockable locations while the operational list excludes them. Existing integration tests cover source and destination checks at posting, exact-location counting, historical balance and movement visibility, and transactional rollback.

### Performance

Both runs used the same generated schema-v8 in-memory SQLite fixture on Windows with Electron 35.7.5 and Node 22.16.0. The fixture contained 3,000 stock items, 2,406 locations across six warehouses, 30,000 balances, and 174,995 movements. Each operation had one warm-up and a separate call to count definition reads. Receipt samples timed posting distinct, pre-created one-line drafts.

| Operation | Timed samples per run | Definition reads per call, before → after | Median ms, before → after |
| --- | ---: | ---: | ---: |
| Receipt location eligibility | 101 | 2 → 1 | 10.76 → 8.68 |
| Exact-location count eligibility | 101 | 2 → 1 | 10.32 → 8.30 |
| One-line receipt post | 31 | 2 → 1 | 9.48 → 8.24 |

These medians describe the synthetic workload. Individual samples varied, and the maximum rose for both policy checks in the comparison. Each operation still reads all definitions for its warehouse and runs both the stored-path and candidate ancestry checks. Multi-line posting continues to validate each line and transfer destination independently. The deterministic acceptance result is one definition read per applicable operation.

### Verification

| Check | Result |
| --- | --- |
| Pre-fix policy and benchmark | 25 expected read-count failures, 21 passing policy cases, and the benchmark passed with two reads per measured operation. |
| Post-fix policy and benchmark | 47 passed across two suites, including all 46 new policy cases. All three measured operations asserted one read. |
| Focused Warehouse and Inventory Jest | 176 passed across nine suites. Included Warehouse Domain and service integration, Inventory queries and infrastructure, posting, receiving, issuing, transfer, counting, and rollback coverage. |
| Full Jest with `WMS_INVENTORY_BENCHMARK=1` | 517 passed across 33 suites. The Batch 1–5 regressions passed. |
| TypeScript and architecture | Both `tsconfig.json` and `tsconfig.node.json` passed. The architecture checker passed for 133 modules. |
| Electron production build | Main, Preload and Renderer built successfully in an isolated output directory. |
| Desktop smoke | Fresh start and restart passed on the production build. The restart verified hierarchy persistence. |
| Production graphical smoke | All 89 checks passed, including Inventory reporting. [Graphical smoke checks](../out/refactoring-batch6-verification/out/phase4-stage7-ui-checks.json) |
| Whitespace | `git diff --check` passed. |
| Lint | Not Run. The repository has no lint script or ESLint configuration. |

### Batch 6 files

| Change | Path |
| --- | --- |
| Modified | `src/core/warehouses/application/location-policy.ts` |
| Added | `src/core/warehouses/application/location-policy.test.ts` |
| Modified | `src/core/inventory/infrastructure/inventory-performance.test.ts` |
| Appended | `docs/refactoring-progress.md` |

## Batch 7 — Index Stock Operations option and label data in the Renderer

**Status — PASS.** Validation ran on 24 November 2026 (Africa/Cairo).

### Root cause and implementation

Each eligible option called `inventoryLocationLabel`, which started an `Array.find` at the beginning of the eligible array. A selector of 2,400 unique locations ran 2,400 scans and 2,881,200 ID comparisons. Transfer prepared two selectors. Line and result rendering also searched the item and location arrays, and selection validation and historical lookup repeated eligible membership searches.

The Renderer memoizes a first-match SKU map from the ordered Catalog rows. One pass over the ordered eligible locations builds the location label map and option data. It formats each unique label from its record and reuses the rendered eligible option list across source and destination selectors. A component-local historical map stores resolved labels and missing results. A successful refresh rebuilds the eligible and Catalog indexes and clears the historical map. Refresh generation and effect cleanup discard superseded responses, and account switching unmounts the page and clears its form and lookup state.

Location labels still prefer eligible definitions, then historical names and paths, then the Arabic fallback containing the original ID. Disabled selected options retain IDs from saved drafts. The eligible filter, option order, first-match handling of duplicates, Simple Product and Variant identity, and exact quantity display remain covered by regression tests.

### Performance

Both runs used the same 2,400 eligible locations on Windows 10 x64 (build 19045), Node.js 24.12.0, and an Intel Core i7-4600U. Each timed metric used 12 warm-ups and 41 samples. Option preparation includes eligibility filtering and labeled option data. Transfer rendering measures the actual React page with two populated selectors rendered to static markup from fresh inputs.

| Measurement | Before | After |
| --- | ---: | ---: |
| Eligible-array scans per option preparation | 2,400 | 0 |
| Eligible ID comparisons inside scans | 2,881,200 | 0 |
| Rows visited to build the eligible index | 0 | 2,400 |
| Location labels formatted per option preparation | 2,400 | 2,400 |
| Option preparation median / p95 | 26.41 / 41.35 ms | 2.58 / 10.80 ms |
| Transfer static render median / p95 | 111.33 / 141.28 ms | 35.10 / 46.86 ms |

The deterministic regression checks that option preparation reads each eligible ID once. Static-render timings measure React markup generation on the test host. Browser interaction and paint at 2,400 options remain unmeasured. [Before benchmark](../out/refactoring-batch7-verification/before.json) · [After benchmark](../out/refactoring-batch7-verification/after.json)

### Verification

| Check | Result |
| --- | --- |
| Focused Jest | 41 passed across four suites. Includes Warehouse and Inventory Renderer tests, posting integration, duplicate IDs, refresh, a late historical response during account switching, exact quantities, draft editing, and Stock Operations command flows. |
| Full Jest with `WMS_INVENTORY_BENCHMARK=1` | 521 passed across 33 suites. Batches 1–6 regressions passed. The opt-in benchmark confirmed one Warehouse definition read each for eligibility, count eligibility and receipt posting. [Jest results](../out/refactoring-batch7-verification/jest.json) |
| TypeScript and architecture | Both TypeScript configurations passed. The architecture checker passed for 133 modules. |
| Production build | Electron Main, Preload and Renderer built into a separate Batch 7 output directory. |
| Desktop smoke | Fresh startup and restart passed. The restart verified hierarchy persistence. [Desktop log](../out/refactoring-batch7-verification/desktop.log) |
| Production graphical smoke | All 89 checks passed, including receipt, issue, transfer, count, reversal, and the unavailable historical draft. [Graphical checks](../out/refactoring-batch7-verification/out/phase4-stage7-ui-checks.json) |
| Whitespace | `git diff --check` passed. Progress and browser test files also passed a trailing-whitespace check. |
| Lint | Not Run. The repository has no lint script or ESLint configuration. |

### Batch 7 files

- `src/renderer/inventory-page.tsx`
- `src/renderer/warehouses/inventory-locations.ts`
- `src/renderer/warehouses/model.test.ts`
- `src/renderer/inventory/inventory.browser.tsx`
- `src/renderer/inventory/inventory.test.ts`
- `docs/refactoring-progress.md`

### Remaining limitations

The native selectors still contain one option for each eligible row. Large-list GUI measurements and any subsequent rendering changes remain outside Batch 7. The installed Windows release gates and deferred ledger scaling work remain tracked in the refactoring plan.
