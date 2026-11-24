# Architecture V2 decisions

| Decision | Rule | Verification |
|---|---|---|
| 001 Deployment | One company per local SQLite database. One active Electron writer. Each warehouse belongs to one branch and has a default location. Operators switch accounts on the same PC. | Application lock, warehouse constraints, session integration tests. |
| 002 Ownership | Catalog owns stock identities and conversion resolution. Inventory owns documents, movement history, counts and balances. Main composes adapters and gates renderer access. | Import check and application integration tests. |
| 003 Precision | Store thousandths in signed 64-bit SQLite integers. IPC quantities are decimal strings. Convert using exact rational factors and reject inexact or overflowing results. | Quantity boundary tests. |
| 004 Posting | An authorized versioned draft posts once. Document status, immutable movements, per-location balances, actor audit and command receipt share an immediate transaction. Full reversal is a separate document and cannot overdraw a location. | Retry, transfer fault injection and reversal tests. |
| 005 Counting | Starting a count freezes its location and snapshots expected stock. Enter actuals including zero, review, then post variances. Cancellation releases the lock. | Count lock, incomplete count and reconciliation tests. |
| 006 Recovery | Database snapshots include referenced Catalog media and checksums. Restore validates a staged dataset before an atomic active-directory switch. Failed startup can recover the previous dataset. | Disposable restore and corruption tests. |
| P3-001 Definitions | Warehouse owns Branch, Warehouse and StorageLocation definitions. Every warehouse has one owning branch; a central warehouse uses an administrative branch. IDs/warehouse ownership remain stable. | Warehouse services, v7 constraints and acceptance tests. |
| P3-002 Hierarchy | Organizational nodes hold no stock. Stockable nodes may have children, with independent per-location balances and exact-location counts. Defaults are protected stockable roots. | Domain, Inventory integration and Electron UI checks. |
| P3-003 Lifecycle | Stock, pending work, counts, ancestry and history constrain definition changes. Same-warehouse reparenting changes only organization; reassignment requires an inactive unused warehouse. | Same-connection usage policy and transactional service regressions. |
| P3-004 Contracts | Public Warehouse ports preserve dependency direction and same-connection transaction ownership. Named IPC validates trusted DTOs; services resolve/authorize the current actor and own one audit event per mutation. | Boundary, IPC, RBAC, transaction and zero-side-effect rejection tests. |
| P3-005 Upgrades | Existing-database upgrades to v7 require a verified restorable snapshot including referenced media before schema changes. Applied v6/v7 SQL stays immutable. | Migration rollback, media corruption, restore and reopen tests. |

Catalog virtual parent SKUs retain their existing registry entries. Inventory references only a simple product's stock item or a variant's stock item. A location ID uniquely identifies its warehouse. Historical movements preserve entered quantity, factor, and base unit. Ledger entries remain authoritative for reconciling balances.

Operational scope is quantity-only. Reservations, in-transit transfers and valuation are deferred. Supplier directory scope, scannable labels and performance targets require product acceptance. Production release requires installer and upgrade verification on a representative Windows machine.

## Phase 3 composition and operations

Pure Warehouse domain rules depend on no Electron or SQL driver. Application services use repository, usage, access, clock/ID, audit and transaction ports. Infrastructure maps v7 SQLite definitions. Main composes Warehouse and Inventory on the one application connection; Inventory injects its read-only location-usage adapter through the public Warehouse contract. Inventory consumes only public Warehouse eligibility/management contracts, retaining exclusive ownership of documents, movements, balances, count locks, receipts, reconciliation and stock-changing transactions.

Warehouse mutations use their existing immediate transaction, current-session authorization, optimistic versions and audit before commit. Legacy Inventory management commands delegate to those services without a second audit event. Inventory eligibility checks run inside its existing transaction; an identical committed retry resolves its existing receipt before current eligibility/version checks, while still enforcing authorization.

The context-isolated preload exposes `window.warehouse.warehouses` groups and a read-only session-capability query. It exposes no SQLite, filesystem or raw IPC handle. The retained Inventory `execute` API is a bounded Zod command union, not arbitrary service or SQL dispatch. React uses named Warehouse methods, capability-aware controls, lazy tree queries and stable historical location IDs.

Warehouse reads require `read`; create/edit uses `warehouse`; status uses `warehouse.status`; reparent uses `warehouse.reparent`; branch reassignment uses `warehouse.reassign`. Admin's existing v7 grants are reused. Multiple roles contribute their union; UI capabilities never substitute for Main/Application authorization.

See the [approved Phase 3 ADRs](phase3-domain-decisions.md), [operating guide](phase3-operations.md) and [final validation](phase3-final-validation.md). Historical stage reports describe their original checkout and remain historical evidence. Installed-Windows acceptance and customer v6 distribution provenance remain separate production gates.

## Phase 4 Stage 4 inventory queries

Inventory queries use the Catalog stock-item ID and exact Warehouse location ID. Catalog resolves the base unit for existing stock items regardless of activation. The warehouse balance reader previously used the operational location list, which excluded inactive locations and descendants of inactive parents. Reporting now uses a Warehouse scope that includes inactive stockable definitions. Posting and counting still use the operational eligibility policy.

A missing balance returns `null` for on-hand and available quantities. A stored zero returns `"0.000"`. Item and warehouse totals use the signed 64-bit Quantity range and fail explicitly on overflow. History pages by descending movement ID, using a decimal string cursor to preserve the full SQLite integer range. Consistency verification streams movements for one stock item and location and compares against the stored balance in the same read transaction. It shares the ledger calculation used by the existing reconciliation and rebuild commands.

The SQLite query factory takes the host's existing connection and trusted session access. Each query requires the existing `read` permission. Later IPC and Renderer work can compose this factory with the current window session and named request handlers. Module activation can be enforced at the same execution boundary when Settings provides that policy.

## Identity composition

Main creates one Identity service on its managed SQLite connection. IPC uses the public `Identity` type and the service owns per-window login attempts and sessions. After asynchronous work, it checks the exact attempt or session and rechecks the relevant live grant before writing. Window destruction and logout end the session and cancel pending login attempts.

Identity Application uses ports for operator storage, credential operations and ID generation. The SQLite adapter checks for an empty operator table inside the first-admin transaction. It writes each additional operator, their role assignments and the audit record in one transaction. The Node adapter preserves `s1` scrypt digests and defers comparison until Application has checked the login attempt.

Core Domain and Application modules can import platform-independent types and approved public contracts. The architecture checker rejects imports into infrastructure and rejects Node built-ins, Electron and SQLite drivers before skipping external packages.
