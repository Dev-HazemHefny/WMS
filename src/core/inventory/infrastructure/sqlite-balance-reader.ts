import type Database from "better-sqlite3";
import { CatalogValidationError } from "@shared/catalog/errors";
import { AppError } from "../../shared/errors/app-error";
import type { WarehouseLocationPolicy } from "../../warehouses/public";
import { InventoryDomainError, Quantity, StockBalance, StockIdentity } from "../domain";
import type { InventoryBalanceReader } from "../domain/repositories";

interface BalanceRow {
  item: string;
  location: string;
  qty: unknown;
  catalogItemId: string | null;
  locationWarehouseId: string | null;
  warehouseId: string | null;
}

// Keep orphan rows visible to the mapper so corruption cannot look like a missing balance.
const selectBalances = `
  SELECT b.item, b.location, b.qty, s.id AS catalogItemId,
    l.warehouse AS locationWarehouseId, w.id AS warehouseId
  FROM balances b
  LEFT JOIN stock_items s ON s.id = b.item
  LEFT JOIN locations l ON l.id = b.location
  LEFT JOIN warehouses w ON w.id = l.warehouse`;

function mapBalance(row: BalanceRow): StockBalance {
  const invalid = (cause: unknown) => new AppError(
    "بيانات رصيد المخزون المخزّنة غير صالحة",
    "INVALID_BALANCE_RECORD",
    new Error(`Invalid balance record for item ${row.item} at location ${row.location}`, { cause }),
  );
  if (row.catalogItemId === null || row.locationWarehouseId === null || row.warehouseId === null) {
    throw invalid(new Error("Balance references a missing Catalog or Warehouse definition"));
  }
  if (typeof row.qty !== "bigint") {
    throw invalid(new Error("Expected an SQLite INTEGER quantity"));
  }
  try {
    const identity = StockIdentity.create(row.item,
      { id: row.location, warehouseId: row.locationWarehouseId }, { id: row.warehouseId });
    return StockBalance.create(identity, Quantity.fromScaled(row.qty));
  } catch (error) {
    if (error instanceof InventoryDomainError || error instanceof CatalogValidationError) {
      throw invalid(error);
    }
    throw error;
  }
}

/** Uses the caller's connection, including any active transaction. */
export function createSqliteBalanceReader(
  db: Database.Database,
  warehouses: Pick<WarehouseLocationPolicy, "listInventoryLocationIds">,
): InventoryBalanceReader {
  function read<T>(query: () => T): T {
    try {
      return query();
    } catch (error) {
      // The native driver can return an error from another JavaScript realm.
      if (typeof error === "object" && error !== null && "code" in error &&
        typeof error.code === "string" && error.code.startsWith("SQLITE_")) {
        throw new AppError("تعذّرت قراءة أرصدة المخزون", "BALANCE_READ_FAILED", error);
      }
      throw error;
    }
  }

  function list(filter: string, scope: string): StockBalance[] {
    return db.prepare<[string], BalanceRow>(`${selectBalances} ${filter} ORDER BY b.item, b.location`)
      .safeIntegers().all(scope).map(mapBalance);
  }

  return {
    findByIdentity(identity) {
      return read(() => {
        const row = db.prepare<[string, string], BalanceRow>(`${selectBalances} WHERE b.item = ? AND b.location = ?`)
          .safeIntegers().get(identity.itemId, identity.locationId);
        return row === undefined ? null : mapBalance(row);
      });
    },
    findByStockItem(itemId) {
      return read(() => list("WHERE b.item = ?", itemId));
    },
    findByLocation(locationId) {
      return read(() => list("WHERE b.location = ?", locationId));
    },
    findByWarehouse(warehouseId) {
      return read(() => {
        const ids = warehouses.listInventoryLocationIds(warehouseId);
        return list("WHERE b.location IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
      });
    },
  };
}
