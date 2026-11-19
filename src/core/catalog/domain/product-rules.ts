import { ConversionFactor } from "../../../shared/catalog/conversion";
import type { ProductType, UnitDimension } from "../../../shared/catalog/types";
import { DomainError } from "./errors";

export function assertCanDeleteReferenced(count: number, message: string): void {
  if (count > 0) throw new DomainError("IN_USE", message);
}

export function assertVariantsAllowed(product: { productType: ProductType; status: "active" | "inactive" }): void {
  if (product.productType !== "with_variants") {
    throw new DomainError("VARIANTS_NOT_ALLOWED", "لا يمكن إضافة متغيرات لصنف عادي");
  }
  if (product.status !== "active") {
    throw new DomainError("PRODUCT_INACTIVE", "لا يمكن إضافة متغير إلى صنف غير نشط");
  }
}

export function assertVariantsPresent(productType: ProductType, variantCount: number): void {
  if (productType === "with_variants" && variantCount === 0) {
    throw new DomainError("VARIANTS_REQUIRED", "يجب إضافة متغير واحد على الأقل لهذا النوع من الأصناف");
  }
}

export function assertPackagingOwner(productType: ProductType, ownerType: "product" | "variant"): void {
  if (productType === "simple" && ownerType === "variant") {
    throw new DomainError("PACKAGING_OWNER", "الصنف العادي لا يمتلك متغيرات لتعريف التعبئة عليها");
  }
  if (productType === "with_variants" && ownerType === "product") {
    throw new DomainError("PACKAGING_OWNER", "وحدات تعبئة المنتج ذي المتغيرات تُعرَّف على كل متغير");
  }
}

export function assertBarcodeOwner(productType: ProductType, ownerType: "product" | "variant"): void {
  if (productType === "simple" && ownerType === "variant") {
    throw new DomainError("BARCODE_OWNER", "لا يمكن ربط باركود بمتغير لصنف عادي");
  }
  if (productType === "with_variants" && ownerType === "product") {
    throw new DomainError("BARCODE_OWNER", "باركود المنتج ذي المتغيرات يجب ربطه بالمتغير");
  }
}

export function assertNotBaseUnit(baseUnitId: string, packagingUnitId: string): void {
  if (baseUnitId === packagingUnitId) {
    throw new DomainError("PACKAGING_BASE_UNIT", "لا يمكن إضافة الوحدة الأساسية كوحدة تعبئة إضافية");
  }
}

export function assertCompatibleUnitDimensions(baseDimension: UnitDimension, packagingDimension: UnitDimension): void {
  // "other" is a catch-all label, not a specific measurable dimension. Two units
  // marked "other" are not necessarily compatible (equality does not imply the
  // same dimension), and a legacy unit defaulted to "other" has an unknown
  // dimension. Reject it in both cases so no conversion factor is ever derived
  // from an unverifiable dimension. This does not assume the unit is
  // unclassified — it only states that "other" is not convertible.
  if (baseDimension === "other" || packagingDimension === "other") {
    throw new DomainError(
      "UNIT_DIMENSION_NOT_CONVERTIBLE",
      "لا يمكن إنشاء تحويل مع وحدة قياس من نوع «أخرى». استخدم وحدات بأبعاد محددة (عدد، وزن، حجم، طول، مساحة)."
    );
  }
  if (baseDimension !== packagingDimension) {
    throw new DomainError("UNIT_DIMENSION_MISMATCH", "يجب أن تكون وحدة التعبئة من نفس نوع وحدة القياس الأساسية");
  }
}

export function assertFactorPolicy(allowDecimalQuantity: boolean, factor: ConversionFactor): void {
  if (!allowDecimalQuantity && !factor.isWhole()) {
    throw new DomainError("FRACTIONAL_FACTOR", "عامل التحويل يجب أن يكون عددًا صحيحًا لأن الصنف لا يسمح بالكميات العشرية");
  }
}

export function assertCanChangeProductType(
  nextType: ProductType,
  current: { productType: ProductType; variantCount: number; productPackagingCount: number; productBarcodeCount: number }
): void {
  if (nextType === current.productType) return;
  if (nextType === "simple" && current.variantCount > 0) {
    throw new DomainError("PRODUCT_TYPE_LOCKED", "لا يمكن تحويل المنتج إلى صنف عادي لوجود متغيرات مرتبطة به");
  }
  if (nextType === "with_variants" && (current.productPackagingCount > 0 || current.productBarcodeCount > 0)) {
    throw new DomainError(
      "PRODUCT_TYPE_LOCKED",
      "احذف وحدات التعبئة والباركود المرتبطة بالصنف نفسه قبل تحويله إلى منتج بمتغيرات"
    );
  }
}
