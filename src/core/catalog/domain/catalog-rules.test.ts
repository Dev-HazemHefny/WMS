import { assertCanDeleteCategory, assertValidParent } from "./category-rules";
import {
  assertCanChangeProductType,
  assertCompatibleUnitDimensions,
  assertFactorPolicy,
  assertVariantsAllowed,
  assertVariantsPresent
} from "./product-rules";
import { DomainError } from "./errors";
import { ConversionFactor } from "../../../shared/catalog/conversion";

describe("category rules", () => {
  const categories = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" }
  ];

  it("allows a valid parent and rejects self or descendant cycles", () => {
    expect(() => assertValidParent("grandchild", "root", categories)).not.toThrow();
    expect(() => assertValidParent("root", "root", categories)).toThrow(DomainError);
    expect(() => assertValidParent("root", "grandchild", categories)).toThrow(DomainError);
  });

  it("prevents deleting categories with products or child categories", () => {
    expect(() => assertCanDeleteCategory(0, 0)).not.toThrow();
    expect(() => assertCanDeleteCategory(1, 0)).toThrow(DomainError);
    expect(() => assertCanDeleteCategory(0, 1)).toThrow(DomainError);
  });
});

describe("product rules", () => {
  it("allows variants only for active products configured with variants", () => {
    expect(() => assertVariantsAllowed({ productType: "with_variants", status: "active" })).not.toThrow();
    expect(() => assertVariantsAllowed({ productType: "simple", status: "active" })).toThrow(DomainError);
    expect(() => assertVariantsAllowed({ productType: "with_variants", status: "inactive" })).toThrow(DomainError);
  });

  it("requires variants when creating a product configured to have variants", () => {
    expect(() => assertVariantsPresent("simple", 0)).not.toThrow();
    expect(() => assertVariantsPresent("with_variants", 1)).not.toThrow();
    expect(() => assertVariantsPresent("with_variants", 0)).toThrow(DomainError);
  });

  it("locks product type changes that would invalidate existing dependents", () => {
    expect(() =>
      assertCanChangeProductType("simple", {
        productType: "with_variants",
        variantCount: 1,
        productPackagingCount: 0,
        productBarcodeCount: 0
      })
    ).toThrow(DomainError);
    expect(() =>
      assertCanChangeProductType("with_variants", {
        productType: "simple",
        variantCount: 0,
        productPackagingCount: 0,
        productBarcodeCount: 0
      })
    ).not.toThrow();
  });

  it("requires whole conversion factors when decimal quantities are disabled", () => {
    expect(() => assertFactorPolicy(false, ConversionFactor.of(6, 1))).not.toThrow();
    expect(() => assertFactorPolicy(false, ConversionFactor.of(3, 2))).toThrow(DomainError);
  });

  it("rejects packaging conversions across different unit dimensions", () => {
    expect(() => assertCompatibleUnitDimensions("count", "count")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("mass", "length")).toThrow(DomainError);
  });

  it("rejects conversions involving the catch-all 'other' dimension", () => {
    // H-01: two units marked "other" must NOT be treated as compatible, because
    // equality of the catch-all label does not imply the same real dimension.
    expect(() => assertCompatibleUnitDimensions("other", "other")).toThrow(DomainError);
    expect(() => assertCompatibleUnitDimensions("other", "count")).toThrow(DomainError);
    expect(() => assertCompatibleUnitDimensions("count", "other")).toThrow(DomainError);
    expect(() => assertCompatibleUnitDimensions("other", "mass")).toThrow(DomainError);
  });

  it("does not allow 'other' to bypass the mismatch rule", () => {
    // Every real dimension is still only compatible with itself.
    expect(() => assertCompatibleUnitDimensions("count", "count")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("mass", "mass")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("volume", "volume")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("length", "length")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("area", "area")).not.toThrow();
    expect(() => assertCompatibleUnitDimensions("count", "mass")).toThrow(DomainError);
  });
});
