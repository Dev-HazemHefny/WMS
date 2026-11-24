import { ConversionFactor } from "../../../../shared/catalog/conversion";
import type {
  Barcode,
  Brand,
  Category,
  PackagingUnit,
  Product,
  ProductDetails,
  Unit,
  VariantView
} from "../../../../shared/catalog/types";
import { DomainError } from "../../domain/errors";
import {
  assertBarcodeOwner,
  assertCompatibleUnitDimensions,
  assertFactorPolicy,
  assertNotBaseUnit,
  assertPackagingOwner
} from "../../domain/product-rules";
import type {
  BarcodeRepository,
  BrandRepository,
  CategoryRepository,
  PackagingRepository,
  ProductRepository,
  StoredVariant,
  UnitRepository,
  VariantRepository
} from "../../domain/repositories";
import { parseBarcode } from "../../domain/values";
import type { Clock, IdGenerator, ImageStorage, UnitOfWork } from "../ports";

export interface ProductDependencies {
  categories: CategoryRepository;
  units: UnitRepository;
  brands: BrandRepository;
  products: ProductRepository;
  variants: VariantRepository;
  packaging: PackagingRepository;
  barcodes: BarcodeRepository;
  images: ImageStorage;
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
}

export interface ProductContext {
  deps: ProductDependencies;
  requireProduct(id: string): Product;
  requireVariant(id: string): StoredVariant;
  requireActiveCategory(id: string): Category;
  requireActiveUnit(id: string): Unit;
  requireActiveBrand(id: string | null | undefined): Brand | null;
  reserveSku(sku: string, ownerId?: string): void;
  toVariantView(variant: StoredVariant): VariantView;
  details(id: string): ProductDetails;
  insertPackaging(
    ownerType: "product" | "variant",
    ownerId: string,
    unitId: string,
    factorText: string,
    product: Product,
    baseUnitId: string
  ): PackagingUnit;
  insertBarcode(
    code: string,
    product: Product,
    variantId: string | null,
    packagingUnitId: string | null
  ): Barcode;
}

/**
 * Builds the shared catalog helpers used by every product sub-service.
 *
 * Keeping these lookups and validation rules in one place means the
 * product, variant, packaging and barcode services stay focused on a single
 * responsibility and cannot drift apart.
 */
export function createProductContext(deps: ProductDependencies): ProductContext {
  const requireProduct = (id: string): Product => {
    const product = deps.products.findById(id);
    if (!product) throw new DomainError("PRODUCT_NOT_FOUND", "الصنف غير موجود");
    return product;
  };

  const requireVariant = (id: string): StoredVariant => {
    const variant = deps.variants.findById(id);
    if (!variant) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
    return variant;
  };

  const requireActiveCategory = (id: string): Category => {
    const category = deps.categories.findById(id);
    if (!category) throw new DomainError("CATEGORY_NOT_FOUND", "التصنيف غير موجود");
    if (category.status !== "active") throw new DomainError("CATEGORY_INACTIVE", "لا يمكن استخدام تصنيف غير نشط");
    return category;
  };

  const requireActiveUnit = (id: string): Unit => {
    const unit = deps.units.findById(id);
    if (!unit) throw new DomainError("UNIT_NOT_FOUND", "وحدة القياس غير موجودة");
    if (unit.status !== "active") throw new DomainError("UNIT_INACTIVE", "لا يمكن استخدام وحدة قياس غير نشطة");
    return unit;
  };

  const requireActiveBrand = (id: string | null | undefined): Brand | null => {
    if (!id) return null;
    const brand = deps.brands.findById(id);
    if (!brand) throw new DomainError("BRAND_NOT_FOUND", "العلامة التجارية غير موجودة");
    if (brand.status !== "active") throw new DomainError("BRAND_INACTIVE", "لا يمكن استخدام علامة تجارية غير نشطة");
    return brand;
  };

  const reserveSku = (sku: string, ownerId?: string): void => {
    const owner = deps.products.skuOwner(sku);
    if (owner && owner.ownerId !== ownerId) throw new DomainError("DUPLICATE_SKU", `كود الصنف مستخدم بالفعل: ${sku}`);
  };

  const toVariantView = (variant: StoredVariant): VariantView => {
    const unit = deps.units.findById(variant.baseUnitId);
    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      name: variant.name,
      baseUnitId: variant.baseUnitId,
      baseUnitName: unit?.name ?? "",
      baseUnitSymbol: unit?.symbol ?? "",
      status: variant.status,
      attributes: variant.attributes,
      packaging: deps.packaging.listForOwner("variant", variant.id),
      barcodes: deps.barcodes.listForVariant(variant.id)
    };
  };

  const details = (id: string): ProductDetails => {
    const product = requireProduct(id);
    const category = deps.categories.findById(product.categoryId);
    const unit = deps.units.findById(product.baseUnitId);
    const brand = product.brandId ? deps.brands.findById(product.brandId) : null;
    return {
      product,
      categoryName: category?.name ?? "",
      brandName: brand?.name ?? null,
      baseUnitName: unit?.name ?? "",
      baseUnitSymbol: unit?.symbol ?? "",
      packaging: deps.packaging.listForOwner("product", product.id),
      variants: deps.variants.listByProduct(product.id).map(toVariantView),
      barcodes: deps.barcodes.listForProduct(product.id)
    };
  };

  const insertPackaging = (
    ownerType: "product" | "variant",
    ownerId: string,
    unitId: string,
    factorText: string,
    product: Product,
    baseUnitId: string
  ): PackagingUnit => {
    assertPackagingOwner(product.productType, ownerType);
    const packagingUnit = requireActiveUnit(unitId);
    const baseUnit = requireActiveUnit(baseUnitId);
    assertCompatibleUnitDimensions(baseUnit.dimension, packagingUnit.dimension);
    assertNotBaseUnit(baseUnitId, unitId);
    if (deps.packaging.findByOwnerAndUnit(ownerType, ownerId, unitId)) {
      throw new DomainError("DUPLICATE_PACKAGING", "وحدة التعبئة هذه مضافة بالفعل");
    }
    const factor = ConversionFactor.parse(factorText);
    assertFactorPolicy(product.allowDecimalQuantity, factor);
    const now = deps.clock.nowIso();
    const record: PackagingUnit = {
      id: deps.ids.next(),
      ownerType,
      ownerId,
      unitId,
      numerator: factor.numerator,
      denominator: factor.denominator,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    deps.packaging.insert(record);
    return record;
  };

  const insertBarcode = (
    code: string,
    product: Product,
    variantId: string | null,
    packagingUnitId: string | null
  ): Barcode => {
    const normalized = parseBarcode(code);
    if (deps.barcodes.findByCode(normalized)) {
      throw new DomainError("DUPLICATE_BARCODE", `الباركود مستخدم بالفعل: ${normalized}`);
    }
    const ownerType = variantId ? "variant" : "product";
    assertBarcodeOwner(product.productType, ownerType);
    let productPackagingUnitId: string | null = null;
    let variantPackagingUnitId: string | null = null;
    if (packagingUnitId) {
      const packaging = deps.packaging.findById(packagingUnitId);
      if (!packaging) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      if (ownerType === "product" && (packaging.ownerType !== "product" || packaging.ownerId !== product.id)) {
        throw new DomainError("PACKAGING_MISMATCH", "وحدة التعبئة لا تتبع هذا الصنف");
      }
      if (ownerType === "variant" && (packaging.ownerType !== "variant" || packaging.ownerId !== variantId)) {
        throw new DomainError("PACKAGING_MISMATCH", "وحدة التعبئة لا تتبع هذا المتغير");
      }
      if (ownerType === "product") productPackagingUnitId = packaging.id;
      else variantPackagingUnitId = packaging.id;
    }
    const barcode: Barcode = {
      id: deps.ids.next(),
      code: normalized,
      productId: variantId ? null : product.id,
      variantId,
      productPackagingUnitId,
      variantPackagingUnitId,
      createdAt: deps.clock.nowIso()
    };
    deps.barcodes.insert(barcode);
    return barcode;
  };

  return {
    deps,
    requireProduct,
    requireVariant,
    requireActiveCategory,
    requireActiveUnit,
    requireActiveBrand,
    reserveSku,
    toVariantView,
    details,
    insertPackaging,
    insertBarcode
  };
}

export function linkedPackaging(unitId: string | null | undefined, created: Map<string, string>): string | null {
  if (!unitId) return null;
  const packagingId = created.get(unitId);
  if (!packagingId) {
    throw new DomainError("PACKAGING_MISMATCH", "الباركود يشير إلى وحدة تعبئة غير مضافة في نفس العملية");
  }
  return packagingId;
}
