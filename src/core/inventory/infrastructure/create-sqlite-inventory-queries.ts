import type Database from "better-sqlite3";
import type { StockItemDirectory } from "../../catalog/public";
import { AppError } from "../../shared/errors/app-error";
import type { WarehouseAccess, WarehouseLocationPolicy } from "../../warehouses/public";
import { createInventoryQueries } from "../application/queries";
import { createSqliteBalanceReader } from "./sqlite-balance-reader";
import { createSqliteInventoryLedger } from "./sqlite-inventory-ledger";

/** Compose with the host's current session and its existing SQLite connection. */
export function createSqliteInventoryQueries(
  db: Database.Database,
  access: WarehouseAccess,
  catalog: StockItemDirectory,
  warehouses: Pick<WarehouseLocationPolicy, "resolveLocation" | "listInventoryLocationIds">,
) {
  return createInventoryQueries({
    catalog,
    warehouses,
    balances: createSqliteBalanceReader(db, warehouses),
    ledger: createSqliteInventoryLedger(db),
    read<T>(work: () => T): T {
      try {
        return db.transaction(() => {
          access.authorize(access.currentActor(), "read");
          return work();
        })();
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error &&
          typeof error.code === "string" && error.code.startsWith("SQLITE_")) {
          throw new AppError("تعذّرت قراءة بيانات المخزون", "INVENTORY_READ_FAILED", error);
        }
        throw error;
      }
    },
  });
}
