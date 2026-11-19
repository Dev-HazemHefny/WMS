# Warehouse WMS

Offline Windows desktop Warehouse Management System.

## Stack
- Electron + React + Vite + TypeScript
- SQLite via better-sqlite3
- Redux Toolkit, React Router, Tailwind CSS
- Zod contracts/validation (to be added at use-case boundaries)
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
