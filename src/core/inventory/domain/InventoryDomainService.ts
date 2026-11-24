import { Quantity } from "@shared/catalog/quantity";
import { InventoryDomainError } from "./InventoryDomainError";
import type { StockBalance } from "./StockBalance";

/** Totals balances for one stock item across the supplied locations, in its base unit. */
export function summarizeStock(
  balances: readonly StockBalance[],
): { onHand: Quantity; available: Quantity } {
  const itemId = balances[0]?.identity.itemId;
  const locations = new Set<string>();
  let onHand = Quantity.fromScaled(0n);
  for (const { identity, quantity } of balances) {
    if (identity.itemId !== itemId || locations.has(identity.locationId)) {
      throw new InventoryDomainError("INCONSISTENT_STOCK_TOTAL");
    }
    locations.add(identity.locationId);
    onHand = onHand.add(quantity);
  }
  return { onHand, available: onHand };
}
