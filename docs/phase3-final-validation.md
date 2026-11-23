# Phase 3 — Final stabilization and development acceptance

Validated on **23 November 2026**. Stage 8 is complete for the source identified below.

**Development decision: Go — Phase 3 can close from a development perspective.**

**Customer production release: No-Go — installer and installed-Windows acceptance remain incomplete.** These are separate decisions; no Phase 4 work, commit, tag, push, publication or installation was performed.

## 1. Source revision and working-tree identity

- Base Git SHA: `52524cef438dc4d58ec9411b6678efac7cbacfe4`.
- The implementation remains an **uncommitted working tree** containing previously approved Phase 3 work and preserved Renderer enhancements. The base commit alone is not the validated source.
- Starting source fingerprint: `4419521bf7b8c0230cbb0a7a81b559ce0301fe19ed333d5a6c1788d57a15d578`, 129 source/configuration files, matching Stage 7.
- Final source fingerprint: `04a6225e9248c8005492509d6760f1a721853e0efde7913573e91595d47d4f30`, 130 source/configuration files.
- Package version is still `0.1.0`; package/lock root name, version, dependency and development-dependency declarations match. No release-candidate version or installer was generated.

[Starting evidence](../out/phase3-stage8-before.json) records the starting hashes, documentation and Git status. [Final evidence](../out/phase3-stage8-source.json) records per-file hashes, Stage 8 changes, documentation hashes and preservation checks. Source fingerprints are SHA-256 of JSON-serialized, path-sorted `{path,sha256}` entries for tracked/untracked `.ts`, `.tsx`, `.cjs`, `.json`, `.html` and `.css` files. Markdown is recorded separately and excluded from the source fingerprint. `out/` artifacts are local, ignored evidence and should be archived with the reviewed candidate.

The working tree includes earlier uncommitted database/recovery, Inventory, Warehouse, IPC/preload and Renderer changes. Those were inspected and preserved; this report attributes only the Stage 8 changes listed below. All **88 pre-existing backend/shared-contract files** and **six historical validation reports** match their starting hashes. The sole production-code correction in Stage 8 is the small Location Explorer Tab-order fix.

## 2. Work performed and baseline

Reviewed the PRD, README, Architecture V2, approved ADRs and Stage 3–7 reports; Warehouse domain/application/repository/public contracts; Inventory policy/usage integration; v6/v7 and migration verification; recovery; Identity/RBAC; trusted IPC/DTOs/preload; React Warehouse, session and Inventory flows; existing unit/integration and desktop checks.

Reran the baseline against this checkout: **232 tests across 15 suites**, **71 Electron UI assertions**, TypeScript, boundary/cycle checks, production build, and fresh/restart smoke all passed. Historical results were not used as substitutes for these runs.

Added six file-backed acceptance tests using actual IPC registration, trusted dispatch, Identity, Catalog, Warehouse and Inventory composition. Strengthened desktop restart evidence to compare nested hierarchy IDs, paths, ownership, stockability and activity across separate Electron processes. Added UI checks for the confirmed keyboard regression, exact three-decimal balance display and minimum-window dialog fit. Evidence-prefix support keeps Stage 8 screenshots/check lists separate from historical Stage 7 artifacts.

## 3. End-to-end scenarios executed

The six new Jest cases live in [phase3-acceptance.test.ts](../electron/main/ipc/phase3-acceptance.test.ts). They exercise real handlers/services against newly allocated file-backed v7 SQLite databases. Electron DOM checks additionally exercise actual React, contextBridge and Main against disposable application profiles.

| Scenario | Execution and evidence | Outcome |
|---|---|---|
| A — Organization | Create branch/warehouse/default through IPC; create stockable Zone, organizational Shelf and stockable Bin; verify paths and one-level tree; change status; reopen and reauthenticate; compare business state and IDs. Separate desktop restart compares a persisted Zone/Shelf/Bin path and identities. | Passed |
| B — Catalog to Inventory | Create product, base unit and stock identity through Catalog IPC; receive `10.125`, issue `1.125`; assert exact thousandths; reject overdraw without any business-state change. UI separately renders an exact `1.125` balance. | Passed |
| C — Transfers | Internal transfer followed by cross-warehouse transfer; assert both exact signed movement legs and all balances. Inject failure on the destination leg after source work; assert complete rollback of documents, movements, balances, receipts and audit; remove fault and post successfully. Existing reversal/rollback regressions also pass. | Passed |
| D — Counts | Receive parent `2.125` and child `5.500`; count parent; assert expected snapshot is only `2125`, child receipts remain independent, parent lock blocks posting and affected reparenting; review/post actual `1.125`; assert parent `1125`, child `6000`, exact variance and lock release. Actual UI count start/edit/review/post also passes. | Passed |
| E — Restrictions/history | Reject stocked/pending deactivation, wrong-warehouse parent, cycles, unsupported default move and inactive new operations, each without business effects. Reparent a stocked Bin within its warehouse and compare all Inventory/history tables exactly. Drain/deactivate it, restart, retry its original receipt and compare unchanged state. Existing suites cover inactive branch/warehouse/ancestors, stockability, stale versions and count scopes. | Passed |
| F — Authentication | Through IPC, admin creates restricted clerk+supervisor user; switch, verify effective Warehouse capabilities, deny management/reparent/forged actor payload with zero business effects; logout and reject reads. Electron UI also verifies stale capabilities are rejected by Main, refreshed controls and admin-to-clerk switching. | Passed |
| Recovery | Create verified media-complete snapshot of organization and stock; change live stock; corrupt referenced backup media and reject staging without changing active directory/business state; restore media, stage/activate/reopen, reauthenticate and verify original IDs, hierarchy, media bytes, receipt retry and stock. | Passed for source-level recovery; installed recovery acceptance pending |

## 4. Automated regression results

| Gate | Baseline | Final |
|---|---|---|
| Full Jest | 232 passed / 15 suites | **238 passed / 16 suites; zero failed, skipped or pending** |
| Focused new acceptance suite | Not present | 6 passed |
| Electron UI | 71 assertions passed | **74 assertions passed** |
| TypeScript, Renderer and Node configurations | Passed | Passed |
| Architecture boundary/cycle checks | Passed | Passed, 101 modules |
| Production Main/preload/Renderer build | Passed | Passed |
| Fresh-profile source-build startup | Passed | Passed |
| Separate-process restart | Passed | Passed, including exact nested hierarchy persistence and posting retry |
| SQLite/FKs/reconciliation | Passed | Passed on valid disposable fixtures; invalid fixtures rejected as expected |
| `git diff --check` | Passed | Passed |
| Protected v6/v7 hashes | Recorded | Unchanged |

Critical suites in the final run: 94 Warehouse IPC tests, 25 preload tests, 24 Warehouse service tests, 19 Warehouse domain tests, 18 Warehouse/Inventory integration tests, 12 v7 migration tests, 7 Architecture V2 release-validation tests, 6 new cohesive acceptance tests and 10 Renderer model/accessibility tests. The full result includes the remaining Catalog, Inventory, recovery, dispatch, DI and attributes suites.

Commands executed from the repository root:

```powershell
# Current baseline, before stabilization
npm.cmd test -- --json --outputFile=out/phase3-stage8-baseline-jest.json
npm.cmd run typecheck
npm.cmd run build
$env:WMS_QA_EVIDENCE_PREFIX='phase3-stage8-baseline'
node scripts/run-desktop-qa.cjs --warehouses-ui
npm.cmd run test:desktop

# Focused acceptance and final checks
npm.cmd test -- --runTestsByPath electron/main/ipc/phase3-acceptance.test.ts
npm.cmd run typecheck
npm.cmd run build
npm.cmd test -- --json --outputFile=out/phase3-stage8-jest.json
$env:WMS_QA_EVIDENCE_PREFIX='phase3-stage8'
node scripts/run-desktop-qa.cjs --warehouses-ui
npm.cmd run test:desktop
git -c core.autocrlf=false diff --check
Get-FileHash -Algorithm SHA256 electron/main/database/architecture-v2.ts,electron/main/database/phase3.ts
```

Typecheck includes architecture/cycle checks. The temporary Git option only suppresses line-conversion noise; no repository configuration or whitespace rule changed. Tests/build ran with the permissions needed by Electron/native SQLite. No new test library or dependency was installed.

Evidence: [baseline Jest](../out/phase3-stage8-baseline-jest.json), [baseline UI checks](../out/phase3-stage8-baseline-ui-checks.json), [final Jest](../out/phase3-stage8-jest.json), [final UI checks](../out/phase3-stage8-ui-checks.json), [UI log](../out/phase3-stage8-ui.log), [fresh/restart log](../out/phase3-stage8-desktop.log), [final source manifest](../out/phase3-stage8-source.json).

## 5. Electron UI, desktop and consistency review

The 74 assertions cover Branch create/edit/search/status/pagination/details, Warehouse create/search/status/edit/default/reassignment, hierarchy expand/collapse/search/deep reveal/breadcrumbs/parent selection, protected defaults, stockability/status edits, permissions and session switching, all existing routes, Inventory posting/count/reversal/history/reconciliation, unavailable draft preservation and Arabic count guidance.

The added keyboard regression selects a child, collapses its ancestor and proves a visible tree row remains reachable by Tab. Three-decimal display is verified against a real decimal-product balance. The runner checks no horizontal page overflow at normal width and the application's **1100×700 minimum window**, plus Location dialog fit at that minimum. The existing deep projection test covers 2,000 levels; Electron search/reveal exercises a 12-level chain. Neither is a production-volume performance benchmark.

Captured and visually inspected current [Branch list](../out/phase3-stage8-branches.png), [focused dialog](../out/phase3-stage8-dialog.png), [minimum-width explorer](../out/phase3-stage8-locations-1100.png) and [minimum-window Location dialog](../out/phase3-stage8-dialog-1100.png). Arabic RTL, teal styling, focus outlines, wrapping, protected/default markers and independent-count wording were retained. Long dialogs scroll within the viewport.

Current-location selectors resolve eligible stockable locations with warehouse names and full paths. New Warehouse creation and location changes refresh their owning resources; navigating to Inventory loads current locations, and its refresh action reloads selectors/documents. Reparenting refreshes tree/details/path data and makes no stock change. Account switching clears privileges and unmounts protected content. Posting refreshes documents, items and eligible locations. Restart reloads definitions from persisted data.

Unavailable draft locations retain their original IDs and show historical names/current paths; no automatic replacement occurs. Inactive history remains readable. Count editing fixes the exact locked location. The UI's deliberately adverse eligibility fixture is confined to a newly generated temporary database and verifies rejected editing/posting and unchanged draft identity.

Screen-reader review, exhaustive native keyboard/Arabic IME, additional DPI/text-scale combinations, installed-application operator acceptance and customer-volume responsiveness were **not executed**. Captured source-build screens and synthetic DOM keyboard events do not certify those manual gates.

## 6. SQLite and migration validation

The 12 v7 migration cases and other regression fixtures reran successfully. Coverage includes new database bootstrap; populated v6/WAL upgrade; valid reopen; future/incompatible schema rejection; deterministic ID-ordered code backfill; unchanged existing IDs, exact quantities and Inventory/history/count/media references; one protected default per warehouse; uniqueness and structural triggers; immutable location ownership; verified backup gate; failed backup destination/missing or corrupted media; late injected migration rollback; restored dataset reopen; and legacy default creation rollback.

Existing data becomes active, version 1, with stockable roots of type `other`; migration timestamps do not invent historical creation times. Branch/Warehouse codes are company-wide; Location codes are warehouse-local. Default creation/verification is enforced through supported atomic paths and startup/restore verification. Arbitrary unsupported SQL is not an application operation.

Valid file-backed acceptance fixtures assert foreign keys enabled, WAL, schema 7, `integrity_check = ok`, empty `foreign_key_check` and empty Inventory reconciliation after every case. Existing tests retain signed-64-bit integer checks and exact quantities above JavaScript's safe-integer range. Deliberately invalid schemas/media are expected rejection fixtures, not databases labelled healthy.

Migration SQL was not changed:

- `architecture-v2.ts` / v6: `A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD`.
- `phase3.ts` / v7: `9367E2B86DE6CF816A4E8E7B03C2B708046DFE988A10E3A2946EC218DCC5EE68`.

No schema defect requiring a forward migration was found. Existing customer v6 distribution remains unverified; internal fixtures cannot establish compatibility with an unidentified distributed build.

## 7. Architecture and security verification

| Area | Finding and evidence |
|---|---|
| Ownership/layers | Warehouse owns definitions and pure hierarchy/lifecycle rules. Application services use ports; SQLite repositories implement them. Inventory exclusively owns stock-changing transactions, documents, movements, balances, locks, receipts and reconciliation. |
| Dependency direction | Inventory imports the public Warehouse contract. Inventory's read-only usage adapter is injected at Main composition using the same connection. Domain imports no Electron/SQLite driver. Boundary and cycle checks pass. |
| Main/single writer | Main uses the application single-instance lock and singleton application connection, composes adapters, owns trusted windows and revokes sessions on destruction. Test-only fault/restore fixtures do not add production writers. |
| Transactions/audit | Existing immediate service/Inventory transactions own writes; authorization, version checks, usage and audit share the transaction. Late movement/default/audit failures roll back; legacy management delegates to canonical services and records one audit event. |
| IPC | 21 dedicated named Warehouse channels, strict bounded Zod requests, sender/main-frame/origin verification before parsing, Main-side current actor, explicit DTO projection and safe error mapping. Untrusted/revoked/forged/malformed requests are tested. |
| Preload/Renderer | Context isolation, sandbox and disabled Node integration are retained. The bridge exposes approved typed methods, no raw IPC/SQL/filesystem. The retained Inventory executor is a bounded command union, not arbitrary dispatch. |
| RBAC/session | Existing admin grants and multi-role union are reused. Read/edit/status/reparent/reassignment have separate permissions. Switching/logout and forbidden operations have zero unauthorized effects; capability UI is not a security boundary. |
| Historical invariants | Committed retries, immutable posted data, compensating reversals, same-warehouse reparent identity and ledger/balance consistency all remain passing. |

All existing backend/IPC/preload/shared-contract source stayed unchanged. No refactor, new channel, permission-data migration or new business rule was needed.

## 8. Defects and corrections

| Finding | Severity | Reproduction/root cause | Correction and final evidence |
|---|---|---|
| Collapsing the selected node's ancestor removes all visible tree Tab stops | **P1, fixed** | The previous `tabIndex` compared each visible row only to the selected ID, even when that ID became hidden. The new Electron assertion failed against the old build. | Choose the selected row only when it remains visible; otherwise use the first visible row as the tree's Tab stop. Two-line local correction, preserving selection/details and all stock behavior. Full UI and Jest checks pass. [Initial reproduction log](../out/phase3-stage8-initial-ui.log). |
| PRD ownership remains “open”; README directs users to retired setup; architectural/current-state documentation lags implementation | **P2, fixed** | Documentation contradicted the approved mandatory branch ownership and completed screens/upgrade policy. | Synchronize PRD, README and architecture; append a current-status ADR addendum; add an operating/release-acceptance guide. Historical checkpoint reports remain unchanged. |
| Initial new transfer-leg test assumed ordering by a shared line number | Test-fixture issue, fixed | Both transfer legs legitimately use the same line index; ordering only by it is unspecified. Initial focused run had 5 passes and 1 failure. | Order the assertion by signed delta, continuing to require the exact two source/destination legs and quantities. No application behavior/assertion invariant weakened. Focused six cases and full suite pass. |

No P0 defect was found. There is no unresolved development-blocking P0 or P1. Test failures were investigated rather than ignored.

## 9. Stage 8 files and documentation updates

Created:

- `electron/main/ipc/phase3-acceptance.test.ts` — six cohesive disposable IPC/database acceptance cases.
- `docs/phase3-operations.md` — setup, hierarchy/lifecycle, Inventory/count/error recovery, permissions, v7/backup/restore, limitations and installed-Windows acceptance steps.
- `docs/phase3-final-validation.md` — this report.

Modified:

- `src/renderer/warehouses/location-explorer.tsx` — visible-row keyboard Tab fallback only.
- `scripts/smoke-warehouse-ui.cjs` — regression/decimal/minimum-window checks and separate evidence prefixes.
- `scripts/smoke-desktop.cjs` — nested hierarchy checkpoint and second-process persistence assertions.
- `PRD.md` — approved ownership, completed Warehouse behavior, v7 backup gate and roadmap/current-state clarification.
- `README.md` — current management navigation, Inventory/count semantics, recovery and validation instructions.
- `docs/architecture-v2.md` — implemented Phase 3 ownership/contracts/lifecycle/security/upgrade composition.
- `docs/phase3-domain-decisions.md` — labelled Stage 8 status addendum; original audit/ADRs retained.

Historical Stage 3–7 and Architecture V2 release-validation reports are byte-for-byte unchanged. No package, dependency, lockfile, existing backend implementation or migration changed. Evidence helper/JSON/logs/screenshots under `out/` are ignored local artifacts.

## 10. Phase 3 Definition of Done

| Criterion | Decision | Supporting evidence |
|---|---|---|
| Branch/Warehouse/Location management complete | Pass | Existing service/IPC suites, actual React workflows and acceptance A |
| Hierarchy/lifecycle rules and constraints | Pass | 19 domain, 24 service, 12 migration tests; acceptance A/E; UI parent/default/status checks |
| Migrations preserve IDs/history | Pass for supported internal fixtures | Populated v6 upgrade/rollback/reopen cases; no claim about an unknown distributed v6 layout |
| Historical identities remain stable | Pass | Stocked reparent table comparisons, restart/retry and restore cases |
| All new stock effects validate eligibility | Pass | 18 Inventory/Warehouse cases, actual IPC restrictions and unavailable-draft UI checks |
| Negative stock, atomic/idempotent posting | Pass | Overdraw, second-leg failure, restart retry and existing precision/rollback suites |
| Counts/reversals and exact reconciliation | Pass | Acceptance D, existing count/reversal suites and actual UI count/reversal/reconciliation |
| Trusted IPC and application authorization | Pass | 94 Warehouse IPC, 25 preload and dispatch/security checks, acceptance F |
| Session switching and canonical audit | Pass | Current-session, role-union, zero-effect denial, one-audit and audit-rollback cases |
| Required screens/routes and no raw-ID setup | Pass | Actual Electron management/Inventory flows; all existing routes retained |
| Permission/error/conflict presentation | Pass | Stale-version reload, denied-action capability refresh, unavailable drafts and lifecycle errors |
| Automated, architecture, build and desktop gates | Pass | 238/16 Jest, 74 UI checks, typecheck/boundaries, production build and fresh/restart logs |
| Documentation matches implemented Phase 3 | Pass | Updated product/architecture documents and operating guide; historical evidence preserved |
| No unresolved development-blocking P0/P1 | Pass | Confirmed P1 reproduced, fixed and regressed; no open blocker found within validated scope |

These criteria support **development completion of the tested Phase 3 checkout**, not certification of every deployment, accessibility configuration or customer dataset.

## 11. Remaining issues and production release gates

| Priority | Remaining work | Development/production effect |
|---|---|---|
| P0 | No unresolved development P0 identified | Does not certify an installer/customer release |
| P1 | Reproducible reviewed candidate installer, version/source/hash/build/signing evidence | Production gate incomplete; no installer built here |
| P1 | Clean Windows install and installed operator workflows | Not executed |
| P1 | Supported previous-installation upgrades; independently establish customer schema-v6 distribution/provenance | Compatibility unresolved; internal migration fixtures alone are insufficient |
| P1 | Installed backup/restore with referenced media, uninstall/reinstall preservation and existing-profile safety | Not executed; requires approved target and independent verified backup |
| P1 | Signing/distribution approvals where required | Not performed; no publication authorized |
| P2 | Representative customer-volume performance, broader DPI/text-scale, native keyboard/Arabic IME, screen-reader and operator review | Source-build checks cover only the stated environment; no broad accessibility/performance claim |

The [operating guide's installed-Windows checklist](phase3-operations.md#remaining-installed-windows-acceptance) provides exact steps and expected outcomes. Use a disposable VM or separately approved installation; never overwrite customer/development profiles. An existing Windows install/upgrade/uninstall must not be altered without approval.

## 12. Final decisions and next handoff

**Development Go:** all Stage 8 development gates passed on the identified source. Phase 3 organizational management, Inventory integration, security and UI can be formally closed from the development perspective, subject to review of this uncommitted work.

**Production No-Go:** there is no validated candidate installer or installed-Windows acceptance evidence, and earlier customer v6 provenance remains unknown. Development smoke results do not satisfy those gates.

Before any Phase 4 proposal, review this checkpoint and its source/evidence, preserve the approved Phase 3 boundaries and exact-location counting rules, and agree on the next scope separately. Prepare a clean reviewed candidate before release packaging and archive the evidence with it. No automatic transition to another phase, release publication or Git mutation was performed.
