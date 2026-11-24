# Warehouse WMS

Offline Windows desktop Warehouse Management System.

## Stack
- Electron + React + Vite + TypeScript
- SQLite via better-sqlite3
- Redux Toolkit, React Router, Tailwind CSS
- Zod validation at IPC boundaries
- Jest + ts-jest

## Requirements
- Node.js 20.19+ or 22.12+
- npm
- Windows is the target runtime; development can also run on supported platforms.

## Setup
```bash
npm install
npm run dev
```

## Quality checks
```bash
npm test
npm run typecheck
npm run build
node scripts/run-desktop-qa.cjs --warehouses-ui
npm run test:desktop
```

## Data location
The SQLite database is stored in Electron's `app.getPath("userData")` directory, not inside the installation directory.

## Pre-Phase 5 demo

Run `npm run db:seed` to create the workspace-local demo, then run `npm run db:seed:open` to open it in Electron. Sign in as `demo-admin` with `demo-admin-local-2026`. The demo lives in `.wms-dev/pre-phase-5/`, and rerunning the seed preserves edits made in the demo.

See the [Pre-Phase 5 validation report](docs/PRE_PHASE_5_VALIDATION_REPORT.md) for sample records, additional accounts, and verification commands.

## Product master data
The Phase 2 interface is Arabic and right-to-left. It includes SQLite-backed screens for products, categories, units, brands, variants, packaging units, and barcodes. Units carry a dimension (count, mass, volume, length, area, or other) so packaging conversions cannot cross incompatible dimensions. Existing units migrate as `other` to preserve their current relationships.

The test runner executes Jest with Electron's embedded Node runtime so the native `better-sqlite3` module uses the same ABI as the desktop app.

## Architecture boundaries
- `electron/main`: desktop host, database bootstrap and IPC adapters.
- `electron/preload`: narrow, typed bridge exposed to the renderer.
- `src/core`: framework-independent application core and shared domain utilities.
- `src/shared`: contracts shared across process boundaries.
- `src/renderer`: React presentation layer.

Renderer code must never import Electron, Node.js, or database modules. All persistence access must go through an application use case exposed by a narrowly-scoped IPC handler.

## Local operations

On first launch create a local administrator with a password of at least 12 characters. Use **الفروع** to manage branches and **المخازن ومواقع التخزين** to manage warehouses and their location hierarchy. Each warehouse belongs to one branch; a central warehouse uses an explicit administrative branch. Warehouse creation adds one protected, stockable default root.

The Inventory screen supports receipts, issues, immediate internal/cross-warehouse transfers, frozen counts, full reversals and ledger reconciliation. Operational selectors show only eligible stockable locations with warehouse names and full paths. A stockable parent's count covers its own location only, excluding children. Reparenting within a warehouse changes organization, never stock or historical IDs.

Warehouse actions use current-session permissions enforced in Main/Application. Status, reparenting and branch reassignment have separate permissions. Definitions with stock, pending documents or active counts have lifecycle safeguards; reactivate an ineligible historical location before a new operation or reversal. Existing committed posting retries remain idempotent.

Backup/restore remains available from Inventory. Successful restore validates a separate staged dataset, switches the active dataset and restarts the application; the original dataset is retained. Keep backups on access-controlled storage. Schema-v7 upgrades of existing databases require a verified, restorable backup including referenced Catalog media; backup verification failure aborts the upgrade.

See the [Phase 3 operating guide](docs/phase3-operations.md) for setup, lifecycle/error recovery, backups and release acceptance. The [final Phase 3 validation report](docs/phase3-final-validation.md) separates development completion from customer production release. Existing Windows installation/upgrade/uninstall acceptance and earlier schema-v6 customer distribution remain separate release gates.

See [Architecture V2](docs/architecture-v2.md) for ownership and precision rules. Run `npm run typecheck`, `npm test`, and `npm run build` to validate a checkout.
