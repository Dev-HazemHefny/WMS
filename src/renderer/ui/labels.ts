import type { ProductType, UnitDimension } from "../../shared/catalog/types";

const UNIT_DIMENSION_LABELS: Record<UnitDimension, string> = {
  count: "عدد",
  mass: "وزن",
  volume: "حجم",
  length: "طول",
  area: "مساحة",
  other: "أخرى"
};

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  simple: "صنف عادي",
  with_variants: "صنف بمتغيرات"
};

export function unitDimensionLabel(dimension: UnitDimension): string {
  return UNIT_DIMENSION_LABELS[dimension];
}

export function productTypeLabel(productType: ProductType): string {
  return PRODUCT_TYPE_LABELS[productType];
}
