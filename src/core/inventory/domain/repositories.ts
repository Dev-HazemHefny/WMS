import type { StockBalance } from "./StockBalance";
import type { StockIdentity } from "./StockIdentity";

export interface InventoryBalanceReader {
  findByIdentity(identity: StockIdentity): StockBalance | null;
  /** Orders by location ID. */
  findByStockItem(itemId: string): readonly StockBalance[];
  findByLocation(locationId: string): readonly StockBalance[];
  /** Validates the warehouse through Warehouse policy. Includes inactive stockable locations and orders by item and location ID. */
  findByWarehouse(warehouseId: string): readonly StockBalance[];
}
