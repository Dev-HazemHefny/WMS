# Phase 3 operating and acceptance guide

This describes the implemented local application. Development validation is recorded in [the final report](phase3-final-validation.md); installed-customer release acceptance is separate.

## First setup and organization

1. On first launch create an administrator with a password of at least 12 characters. Existing installations show login instead. Use **تبديل المستخدم** to end the current session before another operator signs in.
2. Open **الفروع** (`/branches`), create an active branch and enter its code, name and optional contact metadata. Codes use English letters, digits, `_` or `-`, up to 32 characters, and normalize to uppercase. Names can be Arabic, up to 120 characters. Search, status filtering and pagination are available.
3. Open **المخازن ومواقع التخزين** (`/warehouses`) and create a warehouse under an existing active branch. A central warehouse uses an explicitly created administrative branch; every warehouse has one owner. Creation adds exactly one protected stockable default root.
4. Open Warehouse details and **استكشاف مواقع التخزين**. Create zones, shelves, bins or other nodes as roots or children. These types are descriptive; they do not force a fixed hierarchy order. Zones/shelves default to organizational in the backend; bins/other default to stockable. Forms support an explicit stockable choice.

An organizational location cannot receive stock. A stockable node may have children, but every location ID has its own balance. Expand levels as needed; search can reveal a matching node and its ancestor path. Breadcrumbs show current placement. Mouse, Enter, arrows and Home/End support hierarchy navigation; dialogs contain focus and support Escape.

## Inventory workflow

Create Catalog products with their required base units and variants where applicable. Simple products and variants have stock identities; a virtual variant-parent product is not a stock item. Inventory quantities are decimal strings in base units and store as exact integer thousandths; products that disallow decimals still reject fractional entry. Unsupported precision is rejected rather than rounded.

For receipt or issue, choose an eligible stockable location, select the item, enter quantity, add lines, save a draft and post when authorized. Transfers label source and destination explicitly and support immediate internal/cross-warehouse movement; both legs commit together. Equal endpoints, insufficient stock, invalid eligibility and locks are rejected. Refresh locations/documents when current definitions changed elsewhere; no source/destination is silently replaced.

Counts freeze **only the selected location** and snapshot its expected items. A parent count excludes all child stock. Start the count, inspect details, edit actual quantities including explicit zero where needed, save, review and post. The locked count location cannot be changed by its editor. Children keep independent balances; structural/descriptive changes affecting the count scope remain blocked. Posting or cancellation releases the count lock.

Full reversal is a separate linked compensating document. Original posted documents and movements remain immutable; reversal requires eligibility and sufficient resulting stock. Authorized reactivation is required before new posting/reversal against an inactive location. Identical committed posting/reversal retries return the saved result after authorization, including after restart; conflicting reuse is rejected. Use **مطابقة السجل** to compare balances with the ledger. Rebuild is privileged, creates a backup and requires confirmation.

## Definition lifecycle and recovery from errors

| Action or error | Operator response |
|---|---|
| Branch deactivation | Deactivate all its warehouses first. Branch activation does not cascade. |
| Warehouse deactivation | Clear stock, finish/cancel pending documents and counts, and deactivate non-default active locations. Its default changes status atomically. |
| Location deactivation | Clear stock and pending/count work in its affected subtree and deactivate active descendants. Historical references remain available. |
| Remove stockability | Clear pending/count work and stock; historical movements also prevent this change. |
| Protected default | Use Warehouse status; the default cannot be reparented, deleted or made organizational. |
| Reparent | Use the named same-warehouse parent selector. It changes organization only; IDs, stock and history stay fixed. Cycles, wrong-warehouse/inactive parents and affected counts block the move. |
| Reassign owning branch | Use Warehouse details. It requires an inactive warehouse, active destination branch and no stock, movements, pending work or counts. |
| Version conflict | Use **إعادة تحميل البيانات الحالية**, then reopen the edit and review the latest data. The stale form is closed; it is not automatically retried. |
| Permission/session error | The application refreshes current capabilities. Switch/login as an appropriately authorized user; hidden controls are not a security bypass. |
| Unavailable draft location | Its original ID, name and current full path remain visible. Reactivate its hierarchy/owner or revise the draft where allowed. Posting does not redirect to a different location. |
| Insufficient stock/locked location | Inspect balances or finish/cancel the count; retry only after addressing the restriction. Failed operations leave business data unchanged. |

There is no hard-delete UI for Warehouse definitions. Do not use SQL to bypass a lifecycle restriction or move stock by editing balances.

## Permissions

| Capability | Permission |
|---|---|
| View Warehouse definitions | `read` |
| Create/edit and supported stockability changes | `warehouse` |
| Activate/deactivate | `warehouse.status` |
| Reparent within a warehouse | `warehouse.reparent` |
| Reassign warehouse branch | `warehouse.reassign` |

Admin has these grants. Existing clerk/supervisor roles retain their approved scopes; combining roles provides only their union. Inventory draft/post/count/reverse and recovery permissions remain independently enforced. UI capabilities are a Warehouse-focused permission subset; they are neither editable role claims nor an authorization source for Main.

## Data, backups, v7 and restoration

The application stores data under Electron's user-data directory, outside the installation directory. A successful restore can activate a `dataset-*` subdirectory through the `active-dataset` pointer; the root directory is not necessarily the current database after restoration. Keep the full profile and referenced media. Do not manually edit dataset pointers or replace a live SQLite file.

Use Inventory's backup/restore controls and choose a directory when prompted. Backups include the database, manifest, checksums and referenced Catalog images. Restore validates a new staged dataset before switching and restarting, retaining the previous dataset for recovery. Invalid checksums, incompatible schemas, invalid references or missing/damaged media prevent activation. Failed staging may leave a diagnostic directory; it does not make that directory active.

Before upgrading an existing supported database to v7, startup creates and verifies a restorable snapshot including referenced media, reopens a disposable verification copy and checks schema, SQLite integrity, FKs and checksums before changing the live schema. Failure aborts the upgrade and preserves the previous schema/data. A new empty database can bootstrap directly. Applied v6/v7 SQL must not be rewritten; a confirmed schema defect requires an approved forward-only correction.

Earlier customer v6 distribution remains unconfirmed. Obtain a real supported-version fixture and build provenance before promising installed upgrade compatibility. Keep the pre-upgrade backup independently available.

## Repeatable development checks

Run from the repository root after building the current checkout:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
$env:WMS_QA_EVIDENCE_PREFIX='phase3-stage8'
node scripts/run-desktop-qa.cjs --warehouses-ui
npm.cmd run test:desktop
git diff --check
```

Check each exit code; do not treat a failed/unfinished command as passed. The UI runner captures source-build screenshots and a check list under `out/`. Jest and desktop checks use disposable databases/profiles. They do not qualify an installed release or manipulate an existing Windows installation.

## Remaining installed-Windows acceptance

These steps require an approved candidate installer and a disposable VM or separately approved target installation. They remain manual until evidence is recorded.

1. Record candidate source commit/fingerprint, exact package/lock versions, installer version, hash, build environment and signing status. Build reproducibly from that reviewed candidate. Expect source and package metadata to agree.
2. Install on a clean supported Windows VM, launch, create the first admin, create organization/catalog and post stock. Expect correct RTL screens, protected default, paths, permissions and reconciled balances.
3. Switch to restricted users, try forbidden management/posting actions, then logout. Expect current permissions and zero unauthorized changes.
4. Close/relaunch Windows and the application. Expect organization IDs/hierarchy, media, stock, history and posting retry results to persist; login must be required again.
5. With a verified media-complete backup, upgrade each supported previous installed version using a disposable clone. Expect backup-before-v7, preserved IDs/history and exact reconciliation. Damaged backup verification must leave the old installation's data/schema intact. Unknown v6 build compatibility is incomplete until its fixture is validated.
6. Exercise installed backup/restore with referenced images; separately try missing/damaged media or an invalid schema. Expect valid recovery and rejected invalid activation, without overwriting the source backup or original retained dataset.
7. After approval and an independent verified backup, uninstall/reinstall in the VM. Expect user-data retention and correct active-dataset restoration/persistence. Do not perform this on an existing user installation without approval.
8. Verify native keyboard/Arabic IME, screen reader, DPI/text scaling and operator acceptance at supported sizes. Record actual observations, defects, logs and screenshots. Approve signing/distribution separately.

## Known limits and deferred scope

One company and one active local application writer are supported. Stock is quantity-only. Reservations, in-transit transfers, costing/accounting, purchasing/sales and multi-company functionality are outside this phase. No benchmark for customer-scale location catalogs is claimed; stockable lookup currently returns an unpaginated list and needs representative-volume acceptance. This guide does not authorize Phase 4 work or release publication.
