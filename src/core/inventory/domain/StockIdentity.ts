import type { StorageLocation, Warehouse } from "../../warehouses/public";
import { InventoryDomainError } from "./InventoryDomainError";

function isIdentifier(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.trim() === id;
}

/** Inventory's composite key is the Catalog stock-item ID and the exact location ID. */
export class StockIdentity {
  private constructor(
    readonly itemId: string,
    readonly locationId: string,
    readonly warehouseId: string,
  ) {
    Object.freeze(this);
  }

  /** The caller resolves item ownership through Catalog and the place through Warehouse. */
  static create(
    itemId: string,
    location: Pick<StorageLocation, "id" | "warehouseId">,
    warehouse: Pick<Warehouse, "id">,
  ): StockIdentity {
    if (
      !isIdentifier(itemId) ||
      (!itemId.startsWith("p:") && !itemId.startsWith("v:")) ||
      !isIdentifier(itemId.slice(2)) ||
      !isIdentifier(location?.id) ||
      !isIdentifier(location.warehouseId) ||
      !isIdentifier(warehouse?.id)
    ) {
      throw new InventoryDomainError("INVALID_STOCK_IDENTITY");
    }
    if (location.warehouseId !== warehouse.id) {
      throw new InventoryDomainError("LOCATION_WAREHOUSE_MISMATCH");
    }
    return new StockIdentity(itemId, location.id, location.warehouseId);
  }

  equals(other: StockIdentity): boolean {
    return this.itemId === other.itemId && this.locationId === other.locationId;
  }
}
