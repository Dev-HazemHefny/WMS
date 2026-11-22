import type { StockLine } from "../../shared/ipc/stock";
export interface StockCatalog {
  resolveStockItem(
    line: StockLine,
    allowZero: boolean,
  ): { base: bigint; snapshot: string };
  resolveBarcode(code: string): { item: string; packaging: string | null };
}
