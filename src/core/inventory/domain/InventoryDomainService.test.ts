import { Quantity } from "@shared/catalog/quantity";
import { summarizeStock } from "./InventoryDomainService";
import { StockBalance } from "./StockBalance";
import { StockIdentity } from "./StockIdentity";

function balance(item: string, location: string, warehouse: string, quantity: string) {
  const identity = StockIdentity.create(item, { id: location, warehouseId: warehouse }, { id: warehouse });
  return StockBalance.create(identity, Quantity.fromDecimal(quantity));
}

describe("summarizeStock", () => {
  it("sums one stock item across locations and warehouses with exact precision", () => {
    const totals = summarizeStock([
      balance("v:1", "bin-a", "first", "1.111"),
      balance("v:1", "bin-b", "first", "2.222"),
      balance("v:1", "bin-c", "second", "0.001"),
    ]);
    expect(totals.onHand.toDecimalString()).toBe("3.334");
    expect(totals.available.compare(totals.onHand)).toBe(0);
  });

  it("reports zero on-hand and available stock for an empty list", () => {
    const totals = summarizeStock([]);
    expect(totals.onHand.isZero()).toBe(true);
    expect(totals.available.isZero()).toBe(true);
  });

  it("rejects balances for different stock items", () => {
    const items = [balance("p:1", "bin-a", "first", "1"), balance("v:1", "bin-b", "first", "2")];
    expect(() => summarizeStock(items)).toThrow(
      expect.objectContaining({ code: "INCONSISTENT_STOCK_TOTAL" }),
    );
  });

  it("rejects duplicate locations for the same stock item", () => {
    const items = [balance("v:1", "bin-a", "first", "1"), balance("v:1", "bin-a", "first", "2")];
    expect(() => summarizeStock(items)).toThrow(
      expect.objectContaining({ code: "INCONSISTENT_STOCK_TOTAL" }),
    );
  });

  it("rejects an unrepresentable total", () => {
    const items = [
      balance("v:1", "bin-a", "first", "9223372036854775.807"),
      balance("v:1", "bin-b", "first", "0.001"),
    ];
    expect(() => summarizeStock(items)).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
  });
});
