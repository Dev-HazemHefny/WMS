# Architecture V2 automated stabilization results

Validation date is 22 November 2026 in Africa/Cairo. This report covers source-build stabilization before release-candidate packaging.

## Source identity

- Base commit `eed04e01088a54fa2ed7f7a7f0c1749c06b7994f`.
- V2 remains an uncommitted working tree. The base SHA alone does not identify the tested source.
- SHA-256 fingerprint of the sorted path/hash manifest for 92 source and configuration files is `0fa6d3bc7ea408f4b2b541d158b71b7fdd57282013c3b3781d833d379e0d4c74`.
- The per-file manifest is [architecture-v2-source.json](../out/architecture-v2-source.json). The manifest excludes this report and other Markdown documentation.
- Node is 24.12.0, Electron is 35.7.5, and better-sqlite3 is 12.11.1.
- Package and lockfile versions agree at 0.1.0. Dependency declarations agree. Proposed candidate version is 0.2.0-rc.1, subject to review and a synchronized package/lockfile update.

## Executed checks

| Check | Outcome |
|---|---|
| Initial full suite | Passed, 22 tests |
| New regression suites before correction | One confirmed failure: startup accepted v6 without its movement update-protection trigger |
| Final full Jest suite | Passed, 8 suites and 30 tests, zero failures |
| TypeScript checks | Passed for renderer and Node configurations |
| Import-boundary and cycle check | Passed for 72 modules |
| Production bundle build | Passed for main, preload and renderer |
| Source-build Electron smoke | Final fresh launch and second-process restart passed; receipt, role switch, logout and retry verified |
| SQLite file-backed assertions | Foreign keys enabled, WAL active, integrity result exactly ok, no FK violations |
| Installer packaging | Deferred at the requested stabilization checkpoint |
| Installed-Windows operator testing | Incomplete |

Machine-readable Jest evidence is [architecture-v2-jest.json](../out/architecture-v2-jest.json). Desktop evidence is [architecture-v2-desktop.log](../out/architecture-v2-desktop.log). These files are local ignored build artifacts and must be archived with the candidate evidence before cleaning out/.

All new database tests use in-memory databases or uniquely created temporary directories. The desktop runner creates and removes its own temporary profile. Customer and development application profiles were not opened or modified.

## Confirmed defect and correction

Startup trusted the migration number without checking that required SQLite protections still existed. A database marked v6 but missing immutable_movement opened normally. The regression removed that trigger on a disposable database and reproduced the failure.

The migration runner now builds an in-memory reference from the existing migrations and compares required SQLite definitions before accepting an existing v6 database. It rejects incompatible layouts with the affected object name. Migration 6 SQL was preserved during this stabilization pass. This correction deliberately fails closed; recovery or conversion of an incompatible older build requires its actual schema and distribution history.

No customer distribution can be inferred from the local Git history. Local history contains two commits, no release tags, and no committed V2 migration. An earlier installer exists locally. Whether a customer received it remains unconfirmed.

## Coverage added and modified files

- `electron/main/database/release-validation.test.ts` adds file-backed v5 upgrade and StockItem backfill, barcode identity, exact quantities above JavaScript's safe integer range, retry after database reopen, stale draft edits, cross-warehouse transfer, late posting failure with whole-state rollback, successful/rejected reversal behavior, posted-record protection, count lock persistence/cancellation, role switching, forbidden writes, failed repair backup, future-schema rejection, integer/FK constraints, and restore/reopen of stock, operator and posting receipts.
- `electron/main/ipc/dispatch.test.ts` adds trusted window, main-frame, origin, input validation and window revocation checks. Rejected calls never reach the executor.
- `electron/main/recovery.test.ts` now uses PNG fixture bytes, checks the restored media and database, detects media/database corruption and proves the live fixture survives rejected restores.
- `electron/main/database/migrations.ts` contains the v6 compatibility correction.
- `scripts/smoke-desktop.cjs` checks switched-user denial and signed-out denial specifically, and supports a second-process persistence/retry check.
- `scripts/run-desktop-qa.cjs` runs fresh and restart phases against the same isolated profile, requires success markers and zero exit status, clears development renderer overrides and cleans its profile.
- `package.json` directs test:desktop through the new runner.

Existing suites retain precision, category cycle, package conversion, variant, barcode, count review/post, negative-stock reversal and ledger-rebuild coverage.

## Repeatable commands

Run from the repository root in the same supported environment.

```powershell
npm.cmd run typecheck
npm.cmd test -- --ci --json --outputFile=out/architecture-v2-jest.json
npm.cmd run build
npm.cmd run test:desktop
git diff --check
```

The Electron native test runner and GUI launch require filesystem/desktop access unavailable within this session's restricted sandbox. Authorized escalated executions passed. A sandbox path-resolution failure was recorded before the successful baseline rerun.

## Remaining release gates

**P0**

- Confirm earlier v6 customer distribution and obtain any affected schema fixtures. Internal v5-to-current testing passed. Customer binary upgrade compatibility remains unverified.
- Review the modified and untracked V2 source and approve a candidate commit. Archive this source manifest and logs. A clean candidate SHA does not yet exist.
- Build and hash a fresh installer from that candidate after the stabilization checkpoint. The existing installer predates these corrections.
- Verify fresh installation, prior-supported-binary upgrade, installed-app restore/relaunch, and uninstall/reinstall preservation in a disposable Windows account or VM. No installed-application behavior is certified by the source-build smoke.
- Exercise restore interruption at actual process boundaries and referenced product/brand images through the installed UI. The automated restore test validates library behavior and database reopen.

**P1**

- Expand the permission matrix to every Catalog/maintenance operation through real IPC. Current coverage includes adapter trust, application authorization, combined roles, switching and denied inventory writes.
- Test storage exhaustion and read-only destinations, count-review conversion changes, and multiple simultaneous posting requests at desktop entry points.
- Declare a reference dataset and PC for performance thresholds. The small-fixture smoke timing is diagnostic evidence.
- Review the exact SQLite-definition compatibility policy before supporting externally modified schemas.

**P2**

- Broader hardware benchmarking and cosmetic polish after required operator workflows pass.

## Manual Windows acceptance steps

Use a fresh disposable VM snapshot and record the installer hash and version before running it.

1. Install as a standard Windows user and launch offline from the installed shortcut. Expect first-admin setup once and successful login.
2. Create clerk and supervisor accounts. Switch from admin to clerk with an inventory screen open. Expect denied posting and unchanged quantities, then successful authorized posting after switching back.
3. Create a simple SKU, two variants, packages, barcodes, actual product/brand images and two warehouses. Receive 10, transfer 4 within warehouse A, transfer 3 to warehouse B, then issue 1 at B. Expect quantities 6, 1 and 2 and a total of 9.
4. Restart with an open draft and frozen count. Expect persisted draft content and lock. Review/post explicit count results, perform one successful reversal and reject a reversal with insufficient stock.
5. Back up, alter stock/media, restore through the installed UI and allow relaunch. Expect the backed-up accounts, quantities, history and exact image hashes, including after another restart.
6. Upgrade a synthetic dataset produced by the previous supported installer. Expect retained Catalog IDs, media, accounts where supported and clean migration/integrity results.
7. Close, uninstall and reinstall under the same disposable account. Expect data preservation for both an original and a restored active dataset.

Installation, upgrade and uninstall require explicit approval before execution. Record unexecuted steps as incomplete.

## Recommendation

Automated stabilization passes for the identified working tree. Release remains No-Go pending candidate provenance and installed-Windows acceptance. Packaging is the next execution stage after review of these results.
