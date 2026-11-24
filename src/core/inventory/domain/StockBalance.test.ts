import { Quantity } from "@shared/catalog/quantity";
import { InventoryDomainError } from "./InventoryDomainError";
import { StockBalance } from "./StockBalance";
import { StockIdentity } from "./StockIdentity";

const warehouse = { id: "warehouse" };
const identity = StockIdentity.create("v:variant", { id: "bin", warehouseId: warehouse.id }, warehouse);
const fractional = { allowDecimalQuantity: true };
const whole = { allowDecimalQuantity: false };

describe("StockBalance", () => {
  it.each(["0", "12.125"])("creates an on-hand balance of %s in the base unit", (input) => {
    const quantity = Quantity.fromDecimal(input);
    const balance = StockBalance.create(identity, quantity, fractional);
    expect(balance.identity).toBe(identity);
    expect(balance.quantity).toBe(quantity);
  });

  it("rejects a negative opening balance", () => {
    const create = () => StockBalance.create(identity, Quantity.fromDecimal("-0.001"));
    expect(create).toThrow(InventoryDomainError);
    expect(create).toThrow(expect.objectContaining({ code: "NEGATIVE_STOCK" }));
  });

  it("rejects invalid balance state", () => {
    const invalid = { ...identity } as StockIdentity;
    expect(() => StockBalance.create(invalid, Quantity.fromDecimal("0"))).toThrow(
      expect.objectContaining({ code: "INVALID_STOCK_BALANCE" }),
    );
  });

  it.each([["-0.001", "0"], ["-3.251", "3.25"]])(
    "rejects a delta of %s against an insufficient balance (%s)",
    (delta, opening) => {
      const balance = StockBalance.create(identity, Quantity.fromDecimal(opening));
      expect(() => balance.applyDelta(Quantity.fromDecimal(delta), fractional)).toThrow(
        expect.objectContaining({ code: "INSUFFICIENT_STOCK" }),
      );
      expect(balance.quantity.compare(Quantity.fromDecimal(opening))).toBe(0);
    },
  );

  it("retains identity and exact precision through successive deltas", () => {
    const initial = StockBalance.create(identity, Quantity.fromDecimal("0"));
    const increased = initial.applyDelta(Quantity.fromDecimal("10.500"), fractional);
    const decreased = increased.applyDelta(Quantity.fromDecimal("-3.250"), fractional);
    const empty = decreased.applyDelta(Quantity.fromDecimal("-7.250"), fractional);
    expect(initial.quantity.isZero()).toBe(true);
    expect(increased.quantity.toDecimalString()).toBe("10.500");
    expect(decreased.quantity.toDecimalString()).toBe("7.250");
    expect(decreased.identity).toBe(identity);
    expect(empty.quantity.isZero()).toBe(true);
  });

  it("accepts a zero delta on zero stock", () => {
    const balance = StockBalance.create(identity, Quantity.fromDecimal("0"), whole);
    expect(balance.applyDelta(Quantity.fromDecimal("0"), whole).quantity.isZero()).toBe(true);
  });

  it("uses the supplied Catalog policy for opening quantities and deltas", () => {
    expect(() => StockBalance.create(identity, Quantity.fromDecimal("0.001"), whole)).toThrow(
      expect.objectContaining({ code: "DECIMAL_NOT_ALLOWED" }),
    );
    const balance = StockBalance.create(identity, Quantity.fromDecimal("2.000"), whole);
    expect(balance.applyDelta(Quantity.fromDecimal("-1.000"), whole).quantity.toDecimalString()).toBe("1.000");
    expect(() => balance.applyDelta(Quantity.fromDecimal("-0.125"), whole)).toThrow(
      expect.objectContaining({ code: "DECIMAL_NOT_ALLOWED" }),
    );
  });

  it("preserves historical fractional stock after the Catalog switches to whole deltas", () => {
    const balance = StockBalance.create(identity, Quantity.fromDecimal("1.125"));
    expect(balance.applyDelta(Quantity.fromDecimal("-1"), whole).quantity.toDecimalString()).toBe("0.125");
  });

  it("rejects overflow and preserves the original balance", () => {
    const max = Quantity.fromScaled(9223372036854775807n);
    const balance = StockBalance.create(identity, max);
    expect(() => balance.applyDelta(Quantity.fromScaled(1n), fractional)).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
    expect(balance.quantity).toBe(max);
  });

  it("protects all exposed balance state at runtime", () => {
    const balance = StockBalance.create(identity, Quantity.fromDecimal("1"));
    expect(Reflect.set(balance, "quantity", Quantity.fromDecimal("-1"))).toBe(false);
    expect(Reflect.set(balance, "identity", {})).toBe(false);
    expect(Reflect.set(balance.quantity, "minor", -1n)).toBe(false);
    expect(Reflect.set(balance.identity, "locationId", "other")).toBe(false);
    expect(balance.quantity.toDecimalString()).toBe("1.000");
    expect(balance.identity.locationId).toBe("bin");
  });
});
