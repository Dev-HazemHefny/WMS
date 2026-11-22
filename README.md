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
```

## Data location
The SQLite database is stored in Electron's `app.getPath("userData")` directory, not inside the installation directory.

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

On first launch create a local administrator with a password of at least 12 characters. The Inventory screen supports branch and location setup, draft posting, counts, full reversals, balance reconciliation and directory-based backup/restore. Successful restore restarts the application. The original dataset is retained. Keep backups on access-controlled storage.

See [Architecture V2](docs/architecture-v2.md) for ownership and precision rules. Run `npm run typecheck`, `npm test`, and `npm run build` to validate a checkout.
