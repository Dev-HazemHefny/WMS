# Pre-Phase 5 validation report

Validation date 24 November 2026, Africa/Cairo. Evidence comes from the working tree, which already contained ongoing Phase 4 and architecture changes.

## Open the demo

```powershell
npm.cmd run db:seed
npm.cmd run db:seed:open
```

| Role | User | Demo password |
| --- | --- | --- |
| Administrator | `demo-admin` | `demo-admin-local-2026` |
| Clerk | `demo-clerk` | `demo-clerk-local-2026` |
| Supervisor | `demo-supervisor` | `demo-supervisor-local-2026` |

The seeder creates a new SQLite database in a temporary workspace directory, validates it, closes the connection and publishes it under `.wms-dev/pre-phase-5/`. A manifest records the initial row counts. The seed command takes a fixed profile path and preserves existing data on repeat runs. The launcher directs Electron to that profile. The standard application uses its regular Electron data directory. The demo accounts and barcodes are for local development use.

Start with Central Warehouse → Storage Zone A → Shelf A-01. In the inventory overview, `DEMO-RICE` at Central Warehouse / Bin A-01-02 has **125.375 kg**. Its total across three warehouses is **176.000 kg**. At Central Warehouse / Bin A-01-04, `DEMO-PAPER` has a stored **0.000** and `DEMO-ENVELOPE` shows a missing balance. The Central Warehouse has separate balances for `DEMO-USB-C-1`, `DEMO-USB-C-2`, and `DEMO-USB-C-3`.

## 1. Implemented modules

| Status | Observed in the checkout |
| --- | --- |
| Implemented | Electron shell, typed preload and Main IPC, SQLite migrations and integrity checks, local authentication and account switching, role enforcement, and backup and staged restore. |
| Implemented | Catalog categories and nesting, brands, units with dimensions, optional brands and images, simple products and variant families, packaging, multiple barcodes and barcode lookup, list filtering and pagination, details and activation. |
| Implemented | Branch ownership, warehouse and storage definitions, default locations, lazy location tree, versioned edits, status and reparenting rules, and eligible warehouse reassignment. |
| Implemented | Inventory overview, exact balances, item and warehouse totals, availability, movement history with cursor pagination, and ledger consistency. The checkout already exposes ledger-backed receipts, issues, transfers, counts and reversals. The seed uses the existing receipt and issue workflow. |
| Partial | Identity exposes initial setup, login, switching, and account creation with built-in roles. The renderer has no operator directory, operator status editor or custom role editor. Barcode lookup and a printable text preview exist. Machine-readable bars and physical scanner/printer acceptance remain open. Audit events are written for supported mutations. There is no dedicated audit browser. |
| Missing or deferred | Supplier relationships, reservations, transfers in transit, valuation, central settings and module activation, and a standalone adjustment screen. These features received zero fixtures. |

## 2. Seeded data

| Record | Count | Examples |
| --- | ---: | --- |
| Categories | 13 | Four sectors, three-level nesting, one inactive category |
| Brands | 5 | Four active brands, one inactive brand, and products with optional brands omitted |
| Units | 10 | Count, mass, volume and length, with one inactive unit |
| Products | 44 | 40 simple products, four variant families, four inactive products |
| Variants | 12 | USB cable lengths, mouse colors, bolt sizes and glove sizes |
| Packaging | 95 | 71 product and 24 variant packages |
| Barcodes | 104 | Two per stock item, with one linked to packaging |
| Branches | 3 | Main, Alexandria and inactive former Giza |
| Warehouses | 4 | Central, Retail, Alexandria Distribution and inactive former Giza |
| Locations | 37 | Four protected default roots, 33 other locations including receiving areas, zones, shelves, bins and retired overflow bins |
| Operators | 3 | Administrator, clerk and supervisor |
| Inventory balances | 76 | High, low and zero balances, decimal quantities and distinct variant balances |
| Stock documents and movements | 4 documents, 77 movements | Three posted receipts and one posted issue used to reach zero |

The rice receipt converts 125,375 g to 125.375 kg through the Catalog packaging factor. Whole-unit and decimal values share the existing SQLite integer-thousandths representation. Each stocked location belongs to one warehouse. Product families contribute stock through variant identities.

## 3. Test results and integrity

| Gate | Result |
| --- | --- |
| Jest | 525 passed across 34 suites, including the opt-in inventory benchmark and four seed tests. Zero failures or skipped Jest tests. [Jest results](../.wms-dev/pre-phase-5-final-jest.json) |
| Architecture and TypeScript | The import check passed for 133 modules and both TypeScript configurations passed. |
| Production bundle | Main, preload and renderer build completed. |
| SQLite integrity | Schema v8, foreign key enforcement enabled, `integrity_check` passed, zero foreign-key violations, and one stockable default root for every warehouse. |
| Catalog and hierarchy | The focused fixture tests check counts and status coverage, unique SKU/barcode totals, a three-level category chain, branch/warehouse/bin ownership and a fractional packaging factor. Existing suites exercise category cycles and incompatible conversions. |
| Stock rules | The seed's normal reconciliation API found zero discrepancies. The fixture tests independently compare aggregate movements with every stored balance and verify exact base quantities, nonnegative integer storage, active location scope, distinct variant balances, and the difference between zero and missing stock. Existing tests cover excess quantity precision, whole-unit rejection, inactive eligibility, overdrafts, count locks and transaction rollback. |
| Failed operations | The fixture tests check that a duplicate barcode rolls back the new product, SKU and packaging. The seeded React test submits a duplicate SKU and sees the validation message. Existing Warehouse tests cover invalid ancestry and cross-warehouse parents. |
| Repeat and preservation | A second `db:seed` invocation reported the existing profile. The SQLite file's SHA-256 was identical before and after. A fixture test also attempts to seed an existing SQLite directory and asserts byte-for-byte preservation. |
| Existing Electron desktop smoke | Fresh and restart phases passed. |
| Existing Electron renderer suite | 89 Warehouse, Inventory and route checks passed, including real preload and Main IPC. [Check list](../out/phase4-stage7-baseline-ui-checks.json) |
| Seeded Electron renderer suite | Fresh and restart phases passed. The demo launcher also opened the persistent workspace profile and read exactly 44 seeded products. |

## 4. UI verification

The Electron automation drove React DOM controls through the production renderer bundle, real preload, Main IPC, application services and a disposable seeded SQLite profile.

| Screen | Observed |
| --- | --- |
| Login and dashboard | Seeded administrator logged in from the React login screen. Existing desktop smoke exercised switching and logout. |
| Catalog | The seeded lists rendered. Products showed three pages, a variant filter, SKU search, an empty search result and seeded variant details. Barcode lookup showed the seeded rice label preview. The test created, edited, deactivated and reactivated a product through React forms and row actions. Its edited name and inactive state persisted across a full Electron restart. |
| Branches, warehouses and locations | Seeded branch and warehouse data rendered. The test opened Central Warehouse, read its owning branch, and expanded its zone and shelf to the bin. The existing renderer suite also exercised search, status, pagination, creation, editing, lifecycle errors, hierarchy controls and clerk permission changes. |
| Inventory | Seeded overview, exact balance, item total, warehouse view, movement history and consistency rendered. The test checked decimal precision, zero versus missing stock and restart persistence. Existing Electron QA covered stock operations already in the checkout, history pagination and discrepancy display. |

Manual UI acceptance remains open for image upload through the OS file picker, physical scanning and printing, and full CRUD walkthroughs on each individual Catalog reference screen. Catalog media and backup/restore have automated coverage. The demo uses product and brand records without images. A manual walkthrough with installed binaries remains open.

## 5. Issues and fixes

- The first seed attempt exposed a fixture unit symbol with a disallowed hyphen. The symbol was changed to `crate` and the fresh seed passed.
- The first seeded renderer run did not reach duplicate-SKU validation. Scoping field selection and the save button to the product form let the harness exercise the actual submission and confirm the expected validation message.
- The first focused fixture run searched for a bin using an incorrect hard-coded code. The test now identifies the bin by its displayed name and checks its parent relationships and warehouse ownership.
- The duplicate-barcode test initially passed an incomplete pagination request directly to the Catalog use case. It now supplies the required page fields and exercises rollback after packaging creation.
- The current barcode print preview renders human-readable label fields. Physical scanner and printer behavior remains unverified. Product decisions on scannable labels are tracked in [Architecture V2](architecture-v2.md).

## 6. Phase 5 readiness

**READY** to begin Phase 5 development. The demo starts from the existing schema, uses authorized stock posting, passes ledger reconciliation and survives a desktop restart. The verified Catalog and Warehouse definitions provide examples for stock operation development. Installed Windows acceptance and the other manual UI checks remain open as release gates.

To repeat the checks from the repository root, run the seed and build first, then run the Electron suites.

```powershell
npm.cmd run typecheck
npm.cmd run db:seed
npm.cmd run build
$env:WMS_INVENTORY_BENCHMARK = '1'
npm.cmd test -- --ci --json --outputFile=.wms-dev/pre-phase-5-final-jest.json
npm.cmd run test:desktop
npm.cmd run test:desktop -- --warehouses-ui
npm.cmd run test:desktop -- --seeded-ui
```
