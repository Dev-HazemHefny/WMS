import type { StockLine } from "../../shared/ipc/stock";

export interface StockItemDirectory {
  /** Resolves a simple product or variant even when it is inactive. */
  findStockItem(itemId: string): { baseUnitId: string } | null;
}

export interface StockCatalog {
  resolveStockItem(
    line: StockLine,
    allowZero: boolean,
  ): { base: bigint; snapshot: string };
  resolveBarcode(code: string): { item: string; packaging: string | null };
}
