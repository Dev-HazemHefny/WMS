import type Database from "better-sqlite3";
import type { LocationUsagePolicy } from "../../warehouses/public";

/** Inventory-owned, read-only adapter. Scope expansion belongs to the caller. */
export function createSqliteLocationUsage(db: Database.Database): LocationUsagePolicy {
  const inspect = db.prepare(`
    WITH scope(id) AS (SELECT value FROM json_each(?))
    SELECT
      EXISTS(SELECT 1 FROM balances WHERE location IN scope AND qty>0) positive_stock,
      EXISTS(SELECT 1 FROM movements WHERE location IN scope) movements,
      EXISTS(SELECT 1 FROM documents d,json_each(d.lines) line
        WHERE d.state IN ('draft','review') AND
          (json_extract(line.value,'$.location') IN scope OR json_extract(line.value,'$.destination') IN scope)) pending,
      EXISTS(SELECT 1 FROM count_locks WHERE location IN scope) locks
  `);
  const locks = db.prepare("SELECT location FROM count_locks WHERE location IN (SELECT value FROM json_each(?))");
  return {
    inspect(ids) {
      const row = inspect.get(JSON.stringify(ids)) as { positive_stock: number; movements: number; pending: number; locks: number };
      return { hasPositiveStock: Boolean(row.positive_stock), hasMovements: Boolean(row.movements), hasPendingDocuments: Boolean(row.pending), hasCountLocks: Boolean(row.locks) };
    },
    lockedLocationIds(ids) {
      return new Set((locks.all(JSON.stringify(ids)) as { location: string }[]).map(row => row.location));
    },
  };
}
