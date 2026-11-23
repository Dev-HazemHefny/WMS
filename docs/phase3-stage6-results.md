# Phase 3 Stage 6 — Typed Warehouse IPC and RBAC results

Validated on 22 November 2026. Stage 6 is complete for review. Stage 7 has not started.

## Source identity and pre-implementation audit

Base commit: `52524cef438dc4d58ec9411b6678efac7cbacfe4`. This is an uncommitted working tree containing earlier Phase 3 work and four existing Renderer modifications. The commit alone does not identify the tested implementation.

The validated source/configuration fingerprint is `f7d85c051f919771c454a4e3b93f97f471f4522297e403c7878a28f0bb988af5`, covering 119 files. [Source evidence](../out/phase3-stage6-source.json) records each path and SHA-256. The fingerprint is SHA-256 of the JSON serialization of the sorted `{path,sha256}` entries, with Git paths using forward slashes. It includes tracked and untracked source/configuration files ending in `.ts`, `.tsx`, `.cjs`, `.json`, `.html` or `.css`; Markdown reports and ignored build output are excluded. Evidence under `out/` is local and ignored by Git.

Reviewed PRD.md, Architecture V2, the approved Phase 3 domain decisions, Stage 3–5 reports, Warehouse public/application/factory contracts, Inventory composition, Identity, existing dispatch/error handlers, preload and Renderer API typing. The PRD's older open branch question is resolved by the approved ADR: each warehouse belongs to one branch. No new architectural exception was needed.

The baseline was rerun before implementation: **103 tests passed across 12 suites**, matching the reported baseline. Architecture boundaries and cycles passed. Existing modifications were retained.

## Implementation summary

Added dedicated Warehouse methods under `window.warehouse.warehouses`, using the existing trusted `bind`, Zod validation, `IpcResult` error envelope and context-isolated preload. Main composes the existing Warehouse services with the same database connection and Inventory-owned usage adapter as Inventory.

Every protected operation resolves the current Main-side actor through Identity at invocation time. Warehouse application services remain responsible for permission checks, business rules, immediate write transactions and audit. Handlers contain no SQL, separate transaction or duplicated lifecycle logic. DTO adapters explicitly select approved response fields, including nested definitions and paths.

## Channels and public API

Each operation below is an explicit channel; no generic Warehouse dispatcher is exposed.

| Preload group | Channel prefix | Methods |
|---|---|---|
| `warehouses.branches` | `warehouses:branches:` | `create`, `update`, `list`, `get`, `listWarehouses`, `setStatus` |
| `warehouses.warehouses` | `warehouses:warehouses:` | `create`, `update`, `list`, `get`, `reassign`, `setStatus` |
| `warehouses.locations` | `warehouses:locations:` | `create`, `update`, `list`, `get`, `tree`, `path`, `stockable`, `reparent`, `setStatus` |
| `identity.getCapabilities()` | — | `identity:capabilities` |

There are **21 Warehouse channels and one capabilities channel**. Names in the first column are relative to `window.warehouse`. `setStatus` implements activation/deactivation using the existing service contract. `locations.update` supports stockability; no unsupported standalone stockability operation was invented.

`get` returns Branch details with warehouses, Warehouse details with branch/default location, or a resolved Location with its branch, warehouse, root-first path and effective activity. `tree` follows the approved service's lazy semantics: direct children of the supplied parent, or roots when no parent is supplied. It does not recursively materialize the entire hierarchy. List responses contain `items`, `total`, `page` and `pageSize`. Stockable results contain only currently eligible stockable locations, with optional warehouse scope.

## Shared contracts, validation and errors

`src/shared/warehouses/types.ts` defines serializable response DTOs and the grouped API. Request types derive from the corresponding Zod schemas. Shared contracts import no core, repository, Electron or Node implementation.

All new object schemas are strict. They validate trimmed nonempty IDs (160 characters maximum), ASCII codes (32), Arabic-capable names (120), description (2000), address (500), phone (40), contact name (120), allowed statuses/types, boolean stockability, nullable parent IDs and required positive safe-integer `expectedVersion` values. Lists default to page 1 and size 25, cap size at 100, and bound search text at 200. Domain validation remains authoritative, including safe pagination offsets, reference existence and hierarchy/lifecycle rules.

Sender trust is now checked before parsing payloads on bound channels: registered window, trusted URL and exact main frame are all required. Revoked windows, subframes, missing frames and untrusted origins return `UNTRUSTED_SENDER`. Invalid inputs never construct Warehouse services. Client actor, role and permission claims are not accepted.

Existing error conventions are retained. Domain errors, authentication failures, `FORBIDDEN` and `VALIDATION_ERROR` use the existing `IpcResult` envelope; the preload unwraps it using `ClientError`. Unexpected exceptions return the existing generic `INTERNAL_ERROR`, without SQL, database paths or stacks. Tests verify exact not-found, duplicate, version conflict, cycle, parent mismatch, default protection and stock-exists codes through IPC. Existing service/integration suites retain pending-work, active-count, inactivity and stockability safeguards.

## RBAC and session capabilities

| Operation | Required permission |
|---|---|
| All Branch/Warehouse/Location queries | `read` |
| Creation, descriptive updates and supported stockability updates | `warehouse` |
| Activation/deactivation | `warehouse.status` |
| Location reparenting | `warehouse.reparent` |
| Warehouse branch reassignment | `warehouse.reassign` |

Migration v7 already grants the three fine-grained permissions to admin. Existing admin `read`/`warehouse` grants are reused. There is **no permission-data migration dependency** and neither migration v6 nor v7 was edited. Lower-privilege grants were not changed. Specialist/editor roles in tests are disposable fixtures, not application role additions.

`identity.getCapabilities()` takes no input and returns only `{authenticated, permissions}`. It queries the current window session and the distinct union of its roles on every call, filtering to the five Warehouse UI permissions above. It exposes no role claims, actor IDs, password hashes or unrestricted permission list. A trusted signed-out window receives `{authenticated:false,permissions:[]}`. A login attempt clears prior session authority immediately; logout and account switching therefore cannot retain admin capabilities. Another window does not inherit a session. Permission changes in the same session are reflected by the next query.

This is a read-only query, not an authorization source for Main. Future screens must refresh it after authentication transitions and continue handling server-side denial. Capabilities are queried, not pushed through a new event framework.

## Existing services and legacy compatibility

The dedicated endpoints reuse create/update/list/details/status use cases for Branches, Warehouses and Locations, plus existing reassignment, hierarchy, path, stockable-list and reparent services. Their current actor callback uses Identity; writes and their single audit event remain in the existing service transaction.

The Inventory gateway and legacy `inventory:execute` Branch/Warehouse/Location commands remain in place. They use the same canonical services, approved generated codes, response shapes, default-location creation and eligibility rules. IPC integration verifies legacy creation adds exactly one audit record, reads consistently through the dedicated endpoint, and rejects a child under an inactive warehouse. Existing Inventory integration also verifies legacy authorization. Catalog and Inventory preload channels are unchanged.

An IPC receipt followed by reparenting preserves movement rows and exact balances, and reconciliation remains empty. Existing Stage 4/5 tests continue checking posted documents/history preservation, frozen counts, exact-location parent/child counting, rollback, retries and reversals. No Inventory posting code or Warehouse domain rule was changed in Stage 6.

## Stage 6 files

Created:

- `src/shared/warehouses/schemas.ts`
- `src/shared/warehouses/types.ts`
- `src/shared/identity/types.ts`
- `electron/main/ipc/warehouse-dtos.ts`
- `electron/main/ipc/warehouse-handlers.ts`
- `electron/main/ipc/warehouse-handlers.test.ts`
- `electron/preload/warehouse-api.test.ts`
- `docs/phase3-stage6-results.md`

Modified:

- `src/shared/ipc/channels.ts` — named channels.
- `src/shared/ipc/contracts.ts` — grouped API and capabilities method.
- `src/core/identity/application/identity.ts` — session-derived capability query.
- `electron/main/ipc/dispatch.ts` — trust verification before payload parsing.
- `electron/main/ipc/index.ts` — service composition and shared usage adapter.
- `electron/preload/index.ts` — explicit bridge methods.
- `scripts/smoke-desktop.cjs` — dedicated API, capability-switching and restart checks.

Other modified/untracked files in Git status belong to the pre-existing work. They were not reset, committed or absorbed into an unrelated refactor. No Renderer file was edited.

## Tests added and execution results

Added **119 tests** in two suites:

- **94 Main IPC integration tests:** all 21 registrations, signed-out rejection for every Warehouse channel, every clerk mutation denied with unchanged database state, strict unknown-field rejection before service construction, input bounds/enums, mandatory versions, sender/origin/frame/revocation checks, per-window sessions, switching/logout, role union, all query permissions, isolated fine-grained grants, live permission refresh, successful endpoint workflows, safe errors, DTO field filtering, legacy audit compatibility and Inventory preservation/reconciliation.
- **25 preload tests:** namespace/method allowlist, all 21 named channel forwards and result unwrapping, fresh capabilities, `ClientError` propagation, and unchanged legacy Catalog/Inventory calls.

| Check | Final result |
|---|---|
| Full Jest suite | **222 passed, 14 suites; 0 failed, skipped or pending** |
| Focused Main IPC rerun | 94 passed |
| TypeScript, renderer and Node configurations | Passed |
| Architecture boundary/cycle checks | Passed, 93 modules |
| Production main/preload/renderer build | Passed |
| Real Electron source-build smoke | Fresh profile and second-process restart passed |
| SQLite | Existing migration/schema checks and new IPC teardown checks passed; integrity exactly `ok`, FK check empty |
| Inventory | Existing precision, rollback, frozen-count, idempotency and reconciliation tests passed |
| `git diff --check` | Passed |
| Protected Renderer and v6/v7 SHA-256 | All six unchanged |

The first full expanded run reported **221 passed and 1 failed**. Its new specialist-reassignment fixture attempted to deactivate a warehouse with an active non-default location. The existing service correctly returned `ACTIVE_CHILDREN`. The fixture was corrected through the public status endpoint to deactivate the location first; the affected suite and then the full suite passed. No business rule or assertion was weakened. TypeScript also initially caught missing explicit Jest imports and a readonly parameter-table typing mismatch in the new tests; both were corrected. No unresolved test failure or confirmed inventory defect remains.

Machine-readable evidence: [final Jest results](../out/phase3-stage6-jest.json), [initial failed run](../out/phase3-stage6-initial-jest.json), [desktop log](../out/phase3-stage6-desktop.log), [source manifest](../out/phase3-stage6-source.json).

Commands executed from the repository root:

```powershell
# Baseline, before implementation
npm.cmd test
npm.cmd run check:architecture

# Focused validation and final regression
npm.cmd test -- --runTestsByPath electron/main/ipc/warehouse-handlers.test.ts electron/preload/warehouse-api.test.ts
npm.cmd test -- --runTestsByPath electron/main/ipc/warehouse-handlers.test.ts
npm.cmd test -- --json --outputFile=out/phase3-stage6-jest.json
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:desktop
git diff --check

Get-FileHash -Algorithm SHA256 src/renderer/app.tsx,src/renderer/inventory-page.tsx,src/renderer/session.tsx,src/renderer/styles.css,electron/main/database/architecture-v2.ts,electron/main/database/phase3.ts
```

Jest uses in-memory or disposable file-backed SQLite fixtures. Existing teardown checks cover foreign keys enabled, file-backed WAL, integrity and ledger reconciliation. Desktop automation uses the existing guarded temporary profile runner and deletes its generated profile; it does not open development/customer data or an existing installation.

The real Electron checks exercise first-admin setup, dedicated Branch/Warehouse/default creation, nested locations/path/tree/reparent, Catalog creation, legacy Inventory receipt/retry/reconciliation, admin-to-clerk switching, denied Warehouse creation, logout and restart persistence. These are automated bridge/startup checks, not manual screen or installer acceptance. The build generated local output only; no installer was created or installed.

## Protected-file verification

| File | SHA-256, unchanged from start |
|---|---|
| `src/renderer/app.tsx` | `C149B7955A2FD5C082CBBE75ADF74731582179B0C1B6D65215CC144B81C2A41D` |
| `src/renderer/inventory-page.tsx` | `368E4ACD7E21EB29EE3AC58D2B8C15DF7418749206B34AE8B0C702F5E892BF76` |
| `src/renderer/session.tsx` | `3D903282456272745F103D3B1F5FD677B6864FAF4D98F8A3EB1F29E95BCBEC76` |
| `src/renderer/styles.css` | `C89B9E9DFC77719DF3DE47F616BA0169E92B90BE6F896ABCCF7E41C487A70603` |
| `electron/main/database/architecture-v2.ts` | `A80C23557CC2DF9D2C7A1874C8954B9C2B0EE4F04DCAABCBA830778EB49D55CD` |
| `electron/main/database/phase3.ts` | `9367E2B86DE6CF816A4E8E7B03C2B708046DFE988A10E3A2946EC218DCC5EE68` |

## Remaining risks and review recommendation

- **P0:** No open Stage 6 blocker identified by the executed checks. Automated results do not establish complete production readiness.
- **P1, release qualification:** Windows installer/fresh-install, installed upgrade, uninstall/reinstall preservation and interactive acceptance remain incomplete. Earlier schema-v6 customer distribution is still unconfirmed; internal upgrade fixtures do not establish compatibility with a distributed build. Resolve release provenance and use a clean reviewed candidate before packaging. Installation or changes to an existing installation require separate approval.
- **P1, Stage 7 prerequisites:** Review this checkpoint, then implement the approved management screens against these typed APIs, refresh capabilities after authentication changes, handle optimistic conflicts/denials, use lazy hierarchy loading, and explicitly communicate that counts cover the selected location only, excluding children. No such screen was implemented or marked tested here.
- **P2:** Representative customer-scale hierarchy/query performance remains unmeasured. Existing deep domain traversal tests and small disposable IPC fixtures are not a production-volume benchmark.

No unapproved migration, permission bootstrap, role expansion or Architecture V2 redesign was required. The dispatch ordering correction applies consistently to existing bound channels; all previous suites remain passing.

**Recommendation: Go for Stage 6 review; no production-release readiness claim. Stop before Stage 7.** No commit, tag, push, publication or installation was performed.
