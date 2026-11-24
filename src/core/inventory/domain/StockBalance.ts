import { Quantity } from "@shared/catalog/quantity";
import type { Product } from "@shared/catalog/types";
import { InventoryDomainError } from "./InventoryDomainError";
import { StockIdentity } from "./StockIdentity";

type QuantityPolicy = Readonly<Pick<Product, "allowDecimalQuantity">>;

/** On-hand quantity for one stock item at one location, expressed in its Catalog base unit. */
export class StockBalance {
  private constructor(
    readonly identity: StockIdentity,
    readonly quantity: Quantity,
    policy?: QuantityPolicy,
  ) {
    if (!(identity instanceof StockIdentity) || !(quantity instanceof Quantity)) {
      throw new InventoryDomainError("INVALID_STOCK_BALANCE");
    }
    if (quantity.isNegative()) throw new InventoryDomainError("NEGATIVE_STOCK");
    if (policy !== undefined) {
      if (typeof policy?.allowDecimalQuantity !== "boolean") {
        throw new InventoryDomainError("INVALID_STOCK_BALANCE");
      }
      quantity.assertDecimalAllowed(policy.allowDecimalQuantity);
    }
    Object.freeze(this);
  }

  static create(identity: StockIdentity, quantity: Quantity, policy?: QuantityPolicy): StockBalance {
    return new StockBalance(identity, quantity, policy);
  }

  /** Calculates the next balance for a base-unit delta supplied by the posting workflow. */
  applyDelta(delta: Quantity, policy: QuantityPolicy): StockBalance {
    if (!(delta instanceof Quantity) || typeof policy?.allowDecimalQuantity !== "boolean") {
      throw new InventoryDomainError("INVALID_STOCK_BALANCE");
    }
    const next = this.quantity.add(delta);
    if (next.isNegative()) throw new InventoryDomainError("INSUFFICIENT_STOCK");
    delta.assertDecimalAllowed(policy.allowDecimalQuantity);
    // Catalog can switch to whole quantities while a historical fractional balance still exists.
    return new StockBalance(this.identity, next);
  }
}
