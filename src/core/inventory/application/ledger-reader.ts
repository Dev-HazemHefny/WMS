import type { StockBalanceRequest, StockItemRequest } from "./query-contracts";

export interface MovementQuery extends StockItemRequest {
  locationId?: string;
  beforeMovementId?: bigint;
  limit: number;
}

export interface InventoryLedgerReader {
  listMovements(query: MovementQuery): readonly (StockBalanceRequest & {
    movementId: bigint;
    documentId: string;
    delta: bigint;
  })[];
  verifyBalance(identity: StockBalanceRequest): { onHand: bigint | null; ledger: bigint | null } | null;
}
