# Phase 3 Stage 7 — React Warehouse Management UI results

Validated on 22 November 2026. Stage 7 is complete for review. Stage 8 has not started.

## Source and baseline

The base Git commit is `52524cef438dc4d58ec9411b6678efac7cbacfe4`. The tested source is an **uncommitted working tree**, including previous Phase 3 changes and the existing teal Renderer enhancements. The commit alone does not identify the implementation.

The final source/configuration fingerprint is `4419521bf7b8c0230cbb0a7a81b559ce0301fe19ed333d5a6c1788d57a15d578`, over 129 files. [The source manifest](../out/phase3-stage7-source.json) records each file's SHA-256. Its fingerprint is SHA-256 of JSON-serialized, path-sorted `{path,sha256}` entries for tracked/untracked `.ts`, `.tsx`, `.cjs`, `.json`, `.html` and `.css` files; Markdown and ignored build output are excluded. Evidence links under `out/` refer to local ignored artifacts.

Before editing, reviewed the PRD, Architecture V2, approved Phase 3 decisions, Stage 6 results, typed IPC/preload/capabilities contracts, current routing, Catalog screens, UI primitives/patterns, Inventory and session code, styling, and existing Renderer diffs. No architectural conflict or essential missing IPC capability was found.

Baseline rerun: **222 tests passed across 14 suites**, matching Stage 6. TypeScript, architecture boundaries/cycles and the production build also passed before changes. Existing Renderer improvements were preserved rather than replaced.

## Implemented screens and routes

| Route | Screen and behavior |
|---|---|
| `/branches` | Server-paginated search by name/code, status filter, create/edit, versioned status confirmations, metadata/details dialog, associated warehouses and navigation. |
| `/warehouses` | Server-paginated search, branch/status filters, create under an existing active branch, details/management and location links. |
| `/warehouses/:id` | Owning branch, code, name, description, address, status, protected default location, versioned edit/status and authorized branch reassignment. |
| `/warehouses/:id/locations` | Lazy location hierarchy, search/reveal, selection/details, breadcrumbs, root/child creation, metadata/type/stockability editing, reparenting and status changes. |

The two new sidebar entries preserve the existing icon-based teal design and have active navigation states on nested routes. All twelve existing Dashboard, Inventory and Catalog routes remain registered and were exercised in Electron, including product create/edit/details routes. No navigation framework or state library was added.

Branch forms support code, Arabic name, description, address, phone and contact name. Status changes use a separate confirmation and the existing fine-grained permission, rather than being smuggled into descriptive edits. Warehouse forms require one active owning branch on creation; reassignment displays the current owner and explains lifecycle/history restrictions. The default location is displayed separately with its protection and count semantics.

## Location explorer and parent selection

The explorer requests roots initially, then uses the existing one-level `locations.tree` query only when expanding a node. Search uses paginated `locations.list`; revealing a result obtains its root-first path and loads only the necessary ancestor levels. Unrelated descendants remain unloaded.

Visible rows are flattened iteratively, avoiding recursive React nesting and call-stack growth with depth. Visual indentation is bounded for narrow screens while `aria-level` and breadcrumbs retain the real depth. Buttons support mouse activation, arrow-key expansion/collapse and movement, Home/End and Enter selection. Each location displays its type, status, stockable/organizational meaning and protected-default marker where applicable.

The parent picker offers a paginated, searchable set of named paths within the same warehouse, plus a clear root choice. It resolves candidate ancestry to disable self/descendant choices and effectively inactive parents. It exposes no raw ID input. Backend validation remains authoritative for cycles, wrong ownership, locks, inactive ancestry and stale versions.

Reparenting explains that it changes organizational placement only, preserving location/warehouse identity, quantity and movement history. Default reparenting, direct default status changes and protected stockability changes are disabled; there are no hard-delete controls.

Every displayed stockable tree node, selected stockable detail, stockable form, default-location detail and Inventory count flow communicates:

> الجرد لهذا الموقع فقط ولا يشمل المواقع الفرعية. لكل موقع رصيد مستقل.

No child-balance aggregation was introduced.

## Reused contracts and component structure

All management calls use the existing `window.warehouse.warehouses` groups and Stage 6 DTOs/schemas. Creation, updates, reads, status changes, branch reassignment, hierarchy/path queries, stockable selection and reparenting reuse their named methods. Every versioned mutation passes its captured `expectedVersion`. No IPC channel, authentication mechanism, repository, application service, business rule or migration was added or changed.

New components/helpers:

- `src/renderer/session-context.ts` — context for the existing Session owner's current capabilities and refresh function.
- `src/renderer/warehouses/branch-pages.tsx` — Branch list, forms, lifecycle confirmation and details.
- `src/renderer/warehouses/warehouse-pages.tsx` — Warehouse list, editor and details/actions.
- `src/renderer/warehouses/location-explorer.tsx` — lazy hierarchy and Location operation dialogs.
- `src/renderer/warehouses/parent-picker.tsx` — bounded same-warehouse parent selection.
- `src/renderer/warehouses/shared.tsx` — cancellable resource loading, mutation feedback, access guard, schema validation, definition fields and active-branch selection.
- `src/renderer/warehouses/model.ts` — iterative visible rows, display/error helpers and exact-count wording.
- `src/renderer/warehouses/inventory-locations.ts` — eligible and historical location labels.
- `src/renderer/warehouses/model.test.ts` — focused Jest checks.
- `scripts/smoke-warehouse-ui.cjs` — actual React DOM/Electron/SQLite integration scenario.
- `docs/phase3-stage7-results.md` — this report.

Existing files modified in this stage:

- `src/renderer/app.tsx` — additive routes, sidebar entries and icons.
- `src/renderer/session.tsx` — refresh capabilities through the existing login/logout flow and provide context.
- `src/renderer/inventory-page.tsx` — typed eligible locations, historical paths, draft preservation, count guidance and dedicated management links.
- `src/renderer/styles.css` — additive RTL management/explorer styles and scrollable sidebar.
- `src/renderer/ui/patterns.tsx` — shared Dialog accessibility: labelled modal, initial/restored focus, focus containment and Escape dismissal.
- `scripts/run-desktop-qa.cjs` — optional Warehouse UI scenario and explicit generated-profile cleanup guard; existing fresh/restart behavior retained.

No dependency, lockfile, package version, backend or shared IPC contract changed. Earlier uncommitted files remain in the working tree and were not reset or committed.

## Inventory integration

New operations use `locations.stockable()` and show Warehouse name plus the full current location path. Organizational and effectively inactive locations are excluded from new choices; transfers clearly label source/destination and prevent same-location additions in the UI. Backend checks remain mandatory.

Draft lines retain their original location IDs and quantities. Opening a draft selects its actual first-line source/destination, or its locked count location, without silently replacing unavailable locations. Unavailable selections remain visibly selected in disabled options; their current historical definitions are resolved through `locations.get` for names and paths. An unresolved reference has an explicit unavailable fallback. Historical result rows and draft lines use the same full-path labels.

Count editing keeps the exact locked location fixed. New-line controls reject unavailable selections, while existing draft contents remain visible and editable subject to Main's authoritative checks. Rejected editing/posting shows actionable Arabic feedback; authorized cancellation remains available. Receipt, issue, transfer, count review/post, reversal, reconciliation, history, balances, rebuild and recovery controls are retained. The old raw-ID setup form was replaced by links only after dedicated Branch, Warehouse and Location forms covered its functionality.

The posting engine, exact decimal-string quantities, integer-thousandths storage, document/movement semantics and count locking were not edited.

## Session, permissions and error UX

The existing Session component owns one capability state. It refreshes the Stage 6 read-only capabilities after login and logout. Switching users clears privileges and unmounts protected content immediately, before waiting for logout. A generation guard prevents stale capability responses from restoring old state. No duplicate Redux/session store was introduced.

The existing permission matrix controls reads, create/edit, status, reparent and reassignment independently. Dialogs and sensitive controls disappear when their permissions disappear. Mutation errors for `FORBIDDEN`/`AUTH_REQUIRED` refresh capabilities, and their feedback remains outside dialogs so revoking a permission cannot silently hide the failure. Main remains the security boundary.

Forms reuse existing inputs, tables, filters, pagination, loading/empty states, notices, buttons and Dialog. HTML bounds and existing shared Zod schemas provide form feedback; business restrictions stay in Application Services. Lifecycle actions and reassignment require explicit confirmation.

Version conflicts disable resubmission and provide **إعادة تحميل البيانات الحالية** inside the dialog and in page feedback. Reload closes the stale form and fetches current data; it does not retry or overwrite automatically. Errors remain visible, unexpected English/internal details receive a safe Arabic fallback, and backend Arabic business messages are preserved. Known version/permission messages are recognized even when Electron serializes an Error without its custom `code` property. Focus states, modal focus trapping/restoration and keyboard dismissal use existing styling and components.

## Tests and verification

Added **10 Jest tests** for expanded/collapsed hierarchy projection, a 2,000-level chain and repeated-node safety, valid parent rules, eligible location filtering, current/historical paths, serialized version/permission errors, safe unexpected errors, exact-count wording, read gating and bounded form/modal markup.

Added an actual Electron UI scenario using the existing runner and no new testing library. Its **71 recorded assertions** cover:

- Initial admin setup, Arabic RTL shell and active sidebar navigation.
- Branch create/edit, code search, status filter/confirmation, pagination, associated warehouses and stale-version reload.
- Warehouse creation under an active branch, search/status filtering, metadata edit, details/default, lifecycle restriction feedback and successful reassignment.
- Lazy expand/collapse, keyboard hierarchy controls, deep search/reveal, breadcrumbs, validated parent selection, reparenting, root/child creation, metadata/stockability changes, status confirmations and protected defaults.
- Dialog focus containment/Escape and no horizontal page overflow at normal and minimum desktop widths.
- Inventory eligible selectors and paths, exclusion of organizational locations, receipt/issue/transfer posting, unavailable draft identity preservation, rejected editing/posting, historical paths, cancellation, count start/edit/review/post, successful reversal and exact reconciliation.
- All existing routes, stale UI permissions rejected by Main, refreshed capability controls, logout and admin-to-clerk switching.

| Verification | Final result |
|---|---|
| Baseline Jest | 222 passed, 14 suites |
| Final full Jest | **232 passed, 15 suites; 0 failed, skipped or pending** |
| Focused Renderer Jest | 10 passed |
| TypeScript | Passed for Renderer and Node configurations |
| Architecture boundaries/cycles | Passed, 101 modules |
| Production build | Passed for Main, preload and Renderer |
| Actual Electron Warehouse UI | **71 assertions passed** |
| Existing source-build desktop smoke | Fresh profile and second-process restart passed |
| SQLite integrity/FKs and Inventory reconciliation | Existing regression checks passed; adverse-state fixture integrity `ok`, FK check empty; UI ledger reconciliation empty |
| `git diff --check` | Passed |
| Backend/shared-contract comparison against Stage 6 | **88 files unchanged** |

There are no unresolved test failures. A review correction lifted Warehouse editor feedback into its owning page so success/permission failures persist after dialog removal and conflict reload does not report a false save. The final build, UI checks and full suite include this correction.

Commands executed:

```powershell
# Baseline before implementation
npm.cmd test -- --json --outputFile=out/phase3-stage7-baseline-jest.json
npm.cmd run typecheck
npm.cmd run build

# Focused and final verification
npm.cmd test -- --runTestsByPath src/renderer/warehouses/model.test.ts
npm.cmd test -- --json --outputFile=out/phase3-stage7-jest.json
npm.cmd run typecheck
npm.cmd run build
node scripts/run-desktop-qa.cjs --warehouses-ui
npm.cmd run test:desktop
git -c core.autocrlf=false diff --check
Get-FileHash -Algorithm SHA256 electron/main/database/architecture-v2.ts,electron/main/database/phase3.ts
```

The typecheck script includes the architecture/cycle check. Temporary `core.autocrlf=false` suppresses conversion noise without changing whitespace rules or repository configuration.

Evidence: [baseline Jest](../out/phase3-stage7-baseline-jest.json), [final Jest](../out/phase3-stage7-jest.json), [UI assertion list](../out/phase3-stage7-ui-checks.json), [UI log](../out/phase3-stage7-ui.log), [fresh/restart log](../out/phase3-stage7-desktop.log), [source manifest](../out/phase3-stage7-source.json).

## Data safety and unchanged architecture

All database tests use in-memory/disposable databases. Desktop runs require a generated `warehouse-desktop-test-*` directory directly under the system temporary directory, and verify cleanup stays within that generated profile. No development/customer database or existing Windows installation was opened or replaced.

The unavailable-draft UI test deliberately injects one adverse eligibility change through a second SQLite connection **only in the runner's freshly generated database**, after creating the draft through IPC. Production lifecycle services correctly prohibit that change with pending work. The fixture tests defensive rendering/rejection if eligibility drifts; it does not weaken or bypass an application path. The runner verifies the exact fixture path/row, integrity and FKs, closes the fixture connection, then deletes the temporary profile. Renderer code has no SQL or filesystem access.

Comparison against the Stage 6 source manifest confirms every one of its 88 files under `src/core`, `src/shared` and `electron` is unchanged. Migration hashes remain:

- v6: `A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD`
- v7: `9367E2B86DE6CF816A4E8E7B03C2B708046DFE988A10E3A2946EC218DCC5EE68`

## Visual review and remaining checks

Captured and inspected [Branch list](../out/phase3-stage7-branches.png), [focused Branch dialog](../out/phase3-stage7-dialog.png), [Location explorer](../out/phase3-stage7-locations.png) and [minimum-width explorer](../out/phase3-stage7-locations-1100.png). The teal RTL shell, clear labels/focus, modal spacing, wrapping and responsive hierarchy layout were reviewed. Automated checks detected no horizontal page overflow at the tested window widths.

These are source-build Electron checks, not installed-application acceptance. Manual Windows installer/fresh-install/upgrade/uninstall-reinstall tests, screen-reader testing, exhaustive native keyboard/IME interaction, other DPI/text-scale combinations and operator acceptance were **not executed**. Large production-volume query responsiveness is not established by the small UI fixture or the 2,000-level pure projection test.

## Risks, Stage 8 prerequisites and recommendation

- **P0:** No open Stage 7 blocker identified by the executed checks. No missing essential IPC capability or migration dependency was found.
- **P1, release qualification:** Complete manual Windows/installed-build acceptance and establish a reviewed release candidate before claiming production readiness. Previous schema-v6 customer distribution remains unconfirmed; existing internal upgrade fixtures do not prove compatibility with any distributed build. Existing-installation changes require separate approval.
- **P1, Stage 8 review:** Review this UI checkpoint, rerun validation on the eventual candidate, and complete operator acceptance of confirmations, permission changes, exact-location counting and unavailable-draft recovery. Stage 8 has not been executed automatically.
- **P2:** Profile representative large branch/location datasets, verify additional DPI/accessibility configurations, and assess whether the existing unpaginated stockable-location contract needs future scaling work. No contract expansion was made here.

**Recommendation: Go for Stage 7 review; production release remains unqualified. Stop before Stage 8.** No commit, tag, push, publication, installer generation or installation was performed.
