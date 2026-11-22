# Architecture V2 decisions

| Decision | Rule | Verification |
|---|---|---|
| 001 Deployment | One company per local SQLite database. One active Electron writer. Each warehouse belongs to one branch and has a default location. Operators switch accounts on the same PC. | Application lock, warehouse constraints, session integration tests. |
| 002 Ownership | Catalog owns stock identities and conversion resolution. Inventory owns documents, movement history, counts and balances. Main composes adapters and gates renderer access. | Import check and application integration tests. |
| 003 Precision | Store thousandths in signed 64-bit SQLite integers. IPC quantities are decimal strings. Convert using exact rational factors and reject inexact or overflowing results. | Quantity boundary tests. |
| 004 Posting | An authorized versioned draft posts once. Document status, immutable movements, per-location balances, actor audit and command receipt share an immediate transaction. Full reversal is a separate document and cannot overdraw a location. | Retry, transfer fault injection and reversal tests. |
| 005 Counting | Starting a count freezes its location and snapshots expected stock. Enter actuals including zero, review, then post variances. Cancellation releases the lock. | Count lock, incomplete count and reconciliation tests. |
| 006 Recovery | Database snapshots include referenced Catalog media and checksums. Restore validates a staged dataset before an atomic active-directory switch. Failed startup can recover the previous dataset. | Disposable restore and corruption tests. |

Catalog virtual parent SKUs retain their existing registry entries. Inventory references only a simple product's stock item or a variant's stock item. A location ID uniquely identifies its warehouse. Historical movements preserve entered quantity, factor, and base unit. Ledger entries remain authoritative for reconciling balances.

Operational scope is quantity-only. Reservations, in-transit transfers and valuation are deferred. Supplier directory scope, scannable labels and performance targets require product acceptance. Production release requires installer and upgrade verification on a representative Windows machine.
