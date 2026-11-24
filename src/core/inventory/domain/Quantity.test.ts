import { CatalogValidationError } from "@shared/catalog/errors";
import { ConversionFactor } from "@shared/catalog/conversion";
import { Quantity } from "@shared/catalog/quantity";

describe("Quantity", () => {
  it.each([
    ["10", 10000n, "10.000"],
    ["10.5", 10500n, "10.500"],
    ["10.125", 10125n, "10.125"],
    ["0.001", 1n, "0.001"],
    ["-0.001", -1n, "-0.001"],
    ["0", 0n, "0.000"],
  ])("represents %s exactly", (decimal, scaled, formatted) => {
    const quantity = Quantity.fromDecimal(decimal);
    expect(quantity.minor).toBe(scaled);
    expect(quantity.toDecimalString()).toBe(formatted);
    expect(quantity.isZero()).toBe(scaled === 0n);
    expect(quantity.isNegative()).toBe(scaled < 0n);
  });

  it.each(["10.1234", "1.0000", "-0.0001"])("rejects unsupported precision in %s", (input) => {
    expect(() => Quantity.fromDecimal(input)).toThrow(
      expect.objectContaining({ code: "QUANTITY_PRECISION" }),
    );
  });

  it.each(["", "NaN", "Infinity", "1e3", "1.", "1 2", "1,25", "10\n", "--1"])(
    "rejects the invalid decimal string %j",
    (input) => {
      expect(() => Quantity.fromDecimal(input)).toThrow(
        expect.objectContaining({ code: "INVALID_QUANTITY" }),
      );
    },
  );

  it.each([NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    "rejects invalid scaled numbers (%s)",
    (value) => {
      expect(() => Quantity.fromScaled(value)).toThrow(CatalogValidationError);
    },
  );

  it("accepts safe scaled numbers and the full signed 64-bit bigint range", () => {
    expect(Quantity.fromScaled(Number.MAX_SAFE_INTEGER).minor).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Quantity.fromDecimal("9223372036854775.807").minor).toBe(9223372036854775807n);
    expect(Quantity.fromDecimal("-9223372036854775.808").minor).toBe(-9223372036854775808n);
    expect(() => Quantity.fromDecimal("9223372036854775.808")).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
    expect(() => Quantity.fromScaled(-9223372036854775809n)).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
  });

  it("adds and subtracts quantities without floating-point artifacts", () => {
    expect(Quantity.fromDecimal("0.1").add(Quantity.fromDecimal("0.2")).toDecimalString()).toBe("0.300");
    expect(Quantity.fromDecimal("10.500").subtract(Quantity.fromDecimal("3.250")).toDecimalString()).toBe("7.250");
    expect(Quantity.fromDecimal("0.1").subtract(Quantity.fromDecimal("0.2")).toDecimalString()).toBe("-0.100");
  });

  it("compares by logical value", () => {
    const quantity = Quantity.fromDecimal("0.1");
    expect(quantity.compare(Quantity.fromDecimal("0.100"))).toBe(0);
    expect(quantity.compare(Quantity.fromDecimal("1"))).toBe(-1);
    expect(quantity.compare(Quantity.fromDecimal("-0.2"))).toBe(1);
  });

  it("rejects arithmetic overflow in both directions", () => {
    const oneMinor = Quantity.fromScaled(1n);
    expect(() => Quantity.fromScaled(9223372036854775807n).add(oneMinor)).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
    expect(() => Quantity.fromScaled(-9223372036854775808n).subtract(oneMinor)).toThrow(
      expect.objectContaining({ code: "QUANTITY_OVERFLOW" }),
    );
  });

  it("protects the scaled value from mutation", () => {
    const quantity = Quantity.fromDecimal("1");
    expect(Reflect.set(quantity, "minor", -1n)).toBe(false);
    expect(quantity.minor).toBe(1000n);
  });

  it("preserves existing Catalog input normalization, formatting, and conversion", () => {
    expect(Quantity.parse(" 1 , 5 ", true).toBase(ConversionFactor.of(2, 1), false).format()).toBe("3");
    expect(Quantity.parse("0", false, true).format()).toBe("0");
    expect(() => Quantity.parse("-1", true)).toThrow(expect.objectContaining({ code: "INVALID_QUANTITY" }));
    expect(() => Quantity.parse("1.5", false)).toThrow(expect.objectContaining({ code: "DECIMAL_NOT_ALLOWED" }));
  });
});
