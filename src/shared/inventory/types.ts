export interface StockItemRequest {
  itemId: string;
}

export interface StockBalanceRequest extends StockItemRequest {
  locationId: string;
}

export interface WarehouseStockRequest {
  warehouseId: string;
}

export interface InventoryHistoryRequest extends StockItemRequest {
  locationId?: string;
  beforeMovementId?: string;
  limit?: number;
}

export interface LocationStock extends StockBalanceRequest {
  warehouseId: string;
  onHand: string;
}

export interface StockBalanceResult extends StockBalanceRequest {
  warehouseId: string;
  baseUnitId: string;
  onHand: string | null;
}

export interface AvailableQuantityResult extends StockBalanceResult {
  available: string | null;
}

export interface StockItemStockResult extends StockItemRequest {
  baseUnitId: string;
  onHand: string;
  balances: LocationStock[];
}

export interface WarehouseStockResult extends WarehouseStockRequest {
  items: { itemId: string; onHand: string; balances: LocationStock[] }[];
}

export interface InventoryHistoryResult {
  movements: (StockBalanceRequest & { movementId: string; documentId: string; delta: string })[];
  nextBeforeMovementId: string | null;
}

export interface BalanceConsistencyResult extends StockBalanceRequest {
  warehouseId: string;
  baseUnitId: string;
  discrepancies: { onHand: string | null; ledger: string | null }[];
}
