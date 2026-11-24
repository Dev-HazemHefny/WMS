# Phase 4 Stage 7 release-readiness validation

Validation date: 23 November 2026 (Africa/Cairo). Tests ran against the current working tree based on `b8ed3743e7e6f02b3bdef86e068813154e311e27`, which includes the uncommitted Phase 4 Stages 1–6 implementation.

**Stage 7 engineering validation passed. Customer production release remains No-Go pending installed-Windows acceptance.**

| Gate | Result |
| --- | --- |
| Independent baseline | 381 Jest tests across 25 suites, 78 production UI checks, fresh and restart desktop smoke |
| Final Jest run | 382 tests across 26 suites with the opt-in performance fixture enabled |
| Final production UI smoke | 89 checks. The 1,100 × 700 outer-window history capture shows the Arabic RTL layout, long document IDs and keyboard focus. The consistency capture shows the full 64-bit quantity string and discrepancy notice. |
| Architecture and TypeScript | 128 modules passed the import check. Both TypeScript configurations passed. |
| Production bundle | Electron Main, preload and renderer built successfully. |
| Windows x64 NSIS | Generated and verified the installer payload. The packaged bundle passed fresh and restart smoke under Electron with a disposable profile. |

## Inventory and regression coverage

| Area | Evidence |
| --- | --- |
| Inventory reports | The production Electron bundle exercised the real React routes, typed preload, Main IPC, query use cases and SQLite for all six reads. The UI smoke covered positive stock, persisted zero versus missing balance, signed deltas, 50-row history pages, and both matching and deliberately inconsistent ledger results. |
| Stock identity and precision | Domain, SQLite, application and IPC tests cover invalid references, exact locations and warehouse scope, inactive definitions, distinct simple products and variants, signed bigint thousandths, the JavaScript safe-integer boundary, SQLite maximum, arithmetic and aggregation overflow, decimal-string DTOs, whole-unit rules and historical fractional stock. |
| Posting and integrity | File-backed and in-memory tests cover receipt, issue, transfer, count and reversal, overdraft rejection, duplicate and orphan constraints, immutable ledger rows, and rollback of balances, movements, receipt and posting metadata after an injected failure. Production UI smoke exercised the existing Stock Operations workflow. |
| Authorization and IPC | Inventory IPC tests use real Identity and SQLite behind an Electron registration shim. They exercise trusted windows and main frames, URL checks, absent and switched sessions, live grants, forged actor rejection, registration cleanup and sanitized errors. Preload contract tests verify the named bridge. The source-build desktop smoke uses the actual Electron bridge and exercises switching and logout. |
| Renderer state | Chromium component tests with a controlled bridge exercise labels and filters, loading, retry, empty and denied states, and delayed responses after filter and session changes. Desktop smoke exercises live HashRouter transitions and existing Catalog, Warehouse and Stock Operations screens. |
| Migration and backup | Schema tests cover fresh v8 creation, populated v7-to-v8 upgrade with unchanged balances, ledger, location and Catalog references, exact schema version, late-failure rollback and integrity/foreign-key checks. The existing verified-backup requirement applies to upgrades crossing v7. The v7-to-v8 migration adds the balance location index. Existing v6 fixtures exercise backup verification, unsuccessful backup and migration rollback. All databases and backups were disposable. |

### History semantics

History reads sort by descending movement ID and use an exclusive decimal-string cursor. The API accepts at most 200 rows and the UI requests 50. The desktop smoke posts a new movement after loading the first page. The next page still starts below the original cursor and returns the remaining older rows. Previous re-queries the first page and includes the new movement. Changing the location resets the cursor. Pages are independent reads. A traversal that revisits a newer page can see shifted page boundaries because the UI has no snapshot across requests.

## Performance

The standalone benchmark ran on Windows 10 build 19045 x64, Intel Core i7-4600U (4 logical CPUs), 7.91 GiB RAM, Electron 35.7.5 and its embedded Node 22.16.0. It used a warmed in-memory v8 database with SQLite statistics and integrity checks. The dataset contained 3,000 items, 2,406 locations across six warehouses, 30,000 balances and 174,995 movements. One item/location pair had 25,000 movements. Results below are median and maximum from 15 calls per query, with five calls for legacy full reconciliation.

| Read | Median (ms) | Maximum (ms) |
| --- | ---: | ---: |
| Exact balance, including reference resolution | 3.13 | 4.04 |
| Item balances, 10 rows | 0.43 | 0.81 |
| Location balances, repository lookup | 0.18 | 0.32 |
| Warehouse report, 5,000 balances | 40.48 | 50.33 |
| Item-wide history, first 50 rows | 16.64 | 36.49 |
| Item/location history, first 50 rows | 3.77 | 5.00 |
| Exact-pair reconciliation, 25,000 movements | 72.28 | 121.06 |
| Legacy full reconciliation | 526.81 | 712.24 |

The primary balance key serves item lookups. The `balances_location` index serves both location lookups and warehouse location sets. Location and warehouse queries use a temporary sort for output order. The movement index serves location-scoped history in ID order and limits reconciliation to the selected item/location. Item-wide history uses the item prefix of the same index and a temporary sort. The page result is bounded to 50 rows in the UI, while item-wide sort work grows with the matching ledger. Whole-ledger reconciliation streams the ledger and retains totals by pair.

The stock report queries use bulk balance reads without per-row reference round trips. Exact location resolution currently loads the warehouse definitions to resolve ancestry. Opening the Inventory workspace loads Catalog entries and warehouse location pages up front, with sequential location paging by warehouse. Large warehouse responses produce all matching rows in the Renderer. These paths and the synchronous Main process reconciliation account for the main scaling risks. One small-fixture desktop navigation from the overview to 50 rendered history rows took 74 ms through the second animation frame. Full-size warehouse rendering, file-backed benchmark latency and peak memory were outside the measured workload. Observed Jest-process RSS went from 154 to 207 MiB and heap use from 41 to 85 MiB over the standalone run. These are process snapshots, including the test runner and database, and depend on garbage collection. The timings are diagnostic observations. The project has no approved reference-PC threshold.

## Windows candidate

- [Windows x64 NSIS installer](../release/phase4-stage7/Warehouse%20WMS%20Setup%200.1.0.exe), 99,472,435 bytes, unsigned. SHA-256 `b58083e4e7ded6d12029fb23ad1291a85ecb53412acad92927ee09a879ad6f65`.
- The installer embeds the tested ASAR and unpacked `better_sqlite3.node`. Both files extracted from NSIS match the hashes in the unpacked candidate. Main, preload, renderer HTML, JS and CSS in the ASAR match the production build byte for byte.
- The fresh and restart harness loaded the candidate ASAR and its SQLite module with Electron 35.7.5. It exercised posting, retry, persisted stock, login, logout and warehouse hierarchy. Main resolves the active database from Electron `userData`, which the harness redirected to a disposable directory outside the package.
- Installed-Windows testing remains open. Fresh installation, a previous supported installer upgrade with disposable customer-like data, recovery from the installed app, and data retention across uninstall/reinstall require a representative Windows account or VM. The generated package retains version `0.1.0`. Distribution provenance for older customer binaries remains unverified.

Local evidence includes the [Jest results](../out/phase4-stage7-jest.json), [desktop check list](../out/phase4-stage7-ui-checks.json), [history screenshot](../out/phase4-stage7-inventory-history-1100.png) and [consistency screenshot](../out/phase4-stage7-inventory-consistency.png).

## Repeat the checks

```powershell
npm.cmd run typecheck
& { $env:WMS_INVENTORY_BENCHMARK='1'; npm.cmd test -- --ci --json --outputFile=out/phase4-stage7-jest.json }
npm.cmd run build
npm.cmd run test:desktop
$env:WMS_QA_EVIDENCE_PREFIX='phase4-stage7'
npm.cmd run test:desktop -- --warehouses-ui
$env:WMS_INVENTORY_BENCHMARK='1'
npm.cmd test -- --runTestsByPath src/core/inventory/infrastructure/inventory-performance.test.ts
node_modules\.bin\electron-builder.cmd --win nsis --x64 --config.directories.output=release/phase4-stage7
git diff --check
```

Stage 7 extends `scripts/smoke-warehouse-ui.cjs` on top of its existing Stage 6 edits, adds the opt-in `inventory-performance.test.ts`, and adds this report. Generated build, QA and installer artifacts are ignored by Git. The supplied brief ends mid-sentence in the packaging checklist. The check was interpreted as preserving existing customer data, with installed-upgrade verification tracked as a release gate.
