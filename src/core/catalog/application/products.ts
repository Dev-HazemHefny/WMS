import { ConversionFactor } from "../../../shared/catalog/conversion";
import type {
  AddBarcodeInput,
  AddPackagingInput,
  Barcode,
  BarcodeLabel,
  BarcodeMatch,
  BarcodeView,
  CreateVariantInput,
  IdPayload,
  PackagingListItem,
  PackagingListQuery,
  PackagingUnit,
  Page,
  PageQuery,
  Product,
  ProductDetails,
  ProductInput,
  ProductListItem,
  ProductListQuery,
  ProductLookup,
  UpdatePackagingInput,
  UpdateVariantInput,
  VariantListItem,
  VariantListQuery,
  VariantView
} from "../../../shared/catalog/types";
import { DomainError } from "../domain/errors";
import {
  assertBarcodeOwner,
  assertCanChangeProductType,
  assertCanDeleteReferenced,
  assertCompatibleUnitDimensions,
  assertFactorPolicy,
  assertNotBaseUnit,
  assertPackagingOwner,
  assertVariantsAllowed,
  assertVariantsPresent
} from "../domain/product-rules";
import type {
  BarcodeRepository,
  BrandRepository,
  CategoryRepository,
  PackagingRepository,
  ProductRepository,
  StoredVariant,
  UnitRepository,
  VariantRepository
} from "../domain/repositories";
import { assertValidImageDataUrl, parseAttributes, parseBarcode, parseOptionalText, parseRequiredText, parseSku } from "../domain/values";
import type { Clock, IdGenerator, ImageStorage, UnitOfWork } from "./ports";

interface ProductDeps {
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

export function createProductUseCases(deps: ProductDeps) {
  const requireProduct = (id: string): Product => {
    const product = deps.products.findById(id);
    if (!product) throw new DomainError("PRODUCT_NOT_FOUND", "الصنف غير موجود");
    return product;
  };

  const requireActiveCategory = (id: string) => {
    const category = deps.categories.findById(id);
    if (!category) throw new DomainError("CATEGORY_NOT_FOUND", "التصنيف غير موجود");
    if (category.status !== "active") throw new DomainError("CATEGORY_INACTIVE", "لا يمكن استخدام تصنيف غير نشط");
    return category;
  };

  const requireActiveUnit = (id: string) => {
    const unit = deps.units.findById(id);
    if (!unit) throw new DomainError("UNIT_NOT_FOUND", "وحدة القياس غير موجودة");
    if (unit.status !== "active") throw new DomainError("UNIT_INACTIVE", "لا يمكن استخدام وحدة قياس غير نشطة");
    return unit;
  };

  const requireActiveBrand = (id: string | null | undefined) => {
    if (!id) return null;
    const brand = deps.brands.findById(id);
    if (!brand) throw new DomainError("BRAND_NOT_FOUND", "العلامة التجارية غير موجودة");
    if (brand.status !== "active") throw new DomainError("BRAND_INACTIVE", "لا يمكن استخدام علامة تجارية غير نشطة");
    return brand;
  };

  const reserveSku = (sku: string, ownerId?: string) => {
    const owner = deps.products.skuOwner(sku);
    if (owner && owner.ownerId !== ownerId) throw new DomainError("DUPLICATE_SKU", `كود الصنف مستخدم بالفعل: ${sku}`);
  };

  const saveImage = (dataUrl: string | null | undefined, id: string, previous: string | null): string | null => {
    if (dataUrl === undefined) return previous;
    if (!dataUrl) {
      if (previous) deps.images.remove(previous);
      return null;
    }
    const extension = assertValidImageDataUrl(dataUrl);
    const imagePath = deps.images.save({ dataUrl, folder: "products", fileName: `${id}.${extension}` });
    if (previous && previous !== imagePath) deps.images.remove(previous);
    return imagePath;
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

  const insertPackaging = (ownerType: "product" | "variant", ownerId: string, unitId: string, factorText: string, product: Product, baseUnitId: string) => {
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
  ) => {
    const normalized = parseBarcode(code);
    if (deps.barcodes.findByCode(normalized)) throw new DomainError("DUPLICATE_BARCODE", `الباركود مستخدم بالفعل: ${normalized}`);
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
    listProducts(query: ProductListQuery): Page<ProductListItem> {
      return deps.products.list(query);
    },
    lookupProducts(): ProductLookup[] {
      return deps.products.lookup();
    },
    getProduct(id: string): ProductDetails {
      return details(id);
    },
    createProduct(input: ProductInput): ProductDetails {
      const name = parseRequiredText(input.name, "اسم الصنف");
      const sku = parseSku(input.sku);
      const description = parseOptionalText(input.description);
      requireActiveCategory(input.categoryId);
      requireActiveUnit(input.baseUnitId);
      requireActiveBrand(input.brandId);
      const variants = input.variants ?? [];
      const packaging = input.packaging ?? [];
      const barcodes = input.barcodes ?? [];
      assertVariantsPresent(input.productType, variants.length);
      if (input.productType === "simple" && variants.length > 0) {
        throw new DomainError("VARIANTS_NOT_ALLOWED", "لا يمكن إضافة متغيرات لصنف عادي");
      }
      if (input.productType === "with_variants" && (packaging.length > 0 || barcodes.length > 0)) {
        throw new DomainError("PACKAGING_OWNER", "وحدات التعبئة والباركود للمنتج ذي المتغيرات تُعرَّف على المتغير");
      }
      const preparedVariants = variants.map((variant) => ({
        ...variant,
        sku: parseSku(variant.sku),
        name: parseRequiredText(variant.name, "اسم المتغير"),
        attributes: parseAttributes(variant.attributes)
      }));
      const skuSet = new Set<string>();
      for (const candidate of [sku, ...preparedVariants.map((variant) => variant.sku)]) {
        const key = candidate.toLocaleLowerCase();
        if (skuSet.has(key)) throw new DomainError("DUPLICATE_SKU", `كود الصنف مكرر: ${candidate}`);
        skuSet.add(key);
        reserveSku(candidate);
      }
      const signatures = new Set<string>();
      for (const variant of preparedVariants) {
        if (signatures.has(variant.attributes.signature)) {
          throw new DomainError("DUPLICATE_VARIANT", "لا يمكن تكرار نفس مجموعة خصائص المتغير لنفس المنتج");
        }
        signatures.add(variant.attributes.signature);
      }
      const id = deps.ids.next();
      let imagePath: string | null = null;
      try {
        imagePath = saveImage(input.imageDataUrl, id, null);
        deps.uow.run(() => {
          const now = deps.clock.nowIso();
          const product: Product = {
            id,
            name,
            sku,
            categoryId: input.categoryId,
            baseUnitId: input.baseUnitId,
            description,
            imagePath,
            brandId: input.brandId ?? null,
            productType: input.productType,
            allowDecimalQuantity: input.allowDecimalQuantity,
            status: "active",
            createdAt: now,
            updatedAt: now
          };
          deps.products.insert(product);
          const packagingByUnit = new Map<string, string>();
          for (const item of packaging) {
            const created = insertPackaging("product", id, item.unitId, item.conversionFactor, product, product.baseUnitId);
            packagingByUnit.set(item.unitId, created.id);
          }
          for (const item of barcodes) {
            insertBarcode(item.code, product, null, linkedPackaging(item.packagingUnitId, packagingByUnit));
          }
          for (const variant of preparedVariants) {
            const baseUnitId = variant.baseUnitId ?? product.baseUnitId;
            requireActiveUnit(baseUnitId);
            const variantId = deps.ids.next();
            const stored: StoredVariant = {
              id: variantId,
              productId: id,
              sku: variant.sku,
              name: variant.name,
              baseUnitId,
              attributesSignature: variant.attributes.signature,
              status: "active",
              createdAt: now,
              updatedAt: now,
              attributes: variant.attributes.items.map((item) => ({ id: deps.ids.next(), ...item }))
            };
            deps.variants.insert(stored);
            const variantPackaging = new Map<string, string>();
            for (const item of variant.packaging ?? []) {
              const created = insertPackaging("variant", variantId, item.unitId, item.conversionFactor, product, baseUnitId);
              variantPackaging.set(item.unitId, created.id);
            }
            for (const item of variant.barcodes ?? []) {
              insertBarcode(item.code, product, variantId, linkedPackaging(item.packagingUnitId, variantPackaging));
            }
          }
        });
      } catch (error) {
        if (imagePath) deps.images.remove(imagePath);
        throw error;
      }
      return details(id);
    },
    updateProduct(id: string, input: ProductInput): ProductDetails {
      const current = requireProduct(id);
      const name = parseRequiredText(input.name, "اسم الصنف");
      const sku = parseSku(input.sku);
      const description = parseOptionalText(input.description);
      if ((input.variants ?? []).length > 0) {
        throw new DomainError(
          "VARIANTS_NOT_ALLOWED_HERE",
          "استخدم شاشة إدارة المتغيرات لإضافة أو تعديل المتغيرات لهذه الصنف."
        );
      }
      if ((input.packaging ?? []).length > 0 || (input.barcodes ?? []).length > 0) {
        throw new DomainError(
          "NESTED_UPDATE_NOT_ALLOWED",
          "استخدم شاشات وحدات التعبئة والباركود لإضافتها أو تعديلها لهذه الصنف."
        );
      }
      if (input.categoryId !== current.categoryId) requireActiveCategory(input.categoryId);
      else if (!deps.categories.findById(input.categoryId)) throw new DomainError("CATEGORY_NOT_FOUND", "التصنيف غير موجود");
      if (input.baseUnitId !== current.baseUnitId) {
        requireActiveUnit(input.baseUnitId);
        if (deps.packaging.listForOwner("product", id).length > 0) {
          throw new DomainError("BASE_UNIT_LOCKED", "لا يمكن تغيير الوحدة الأساسية بعد تعريف وحدات التعبئة");
        }
      }
      const brandId = input.brandId ?? null;
      if (brandId !== current.brandId) requireActiveBrand(brandId);
      reserveSku(sku, id);
      const dependents = deps.products.countDependents(id);
      assertCanChangeProductType(input.productType, {
        productType: current.productType,
        variantCount: dependents.variants,
        productPackagingCount: dependents.packaging,
        productBarcodeCount: dependents.barcodes
      });
      if (!input.allowDecimalQuantity && deps.packaging.hasFractionalForProduct(id)) {
        throw new DomainError("FRACTIONAL_FACTOR", "لا يمكن منع الكميات العشرية لوجود عوامل تحويل كسرية");
      }
      const imagePath = saveImage(input.imageDataUrl, id, current.imagePath);
      const product: Product = {
        ...current,
        name,
        sku,
        categoryId: input.categoryId,
        baseUnitId: input.baseUnitId,
        description,
        imagePath,
        brandId,
        productType: input.productType,
        allowDecimalQuantity: input.allowDecimalQuantity,
        updatedAt: deps.clock.nowIso()
      };
      try {
        deps.products.update(product);
      } catch (error) {
        if (imagePath && imagePath !== current.imagePath) deps.images.remove(imagePath);
        throw error;
      }
      return details(id);
    },
    activateProduct(id: string): Product {
      const current = requireProduct(id);
      if (current.status === "active") return current;
      const product = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.products.update(product);
      return product;
    },
    deactivateProduct(id: string): Product {
      const current = requireProduct(id);
      if (current.status === "inactive") return current;
      const product = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.products.update(product);
      return product;
    },
    deleteProduct(id: string): void {
      const current = requireProduct(id);
      const dependents = deps.products.countDependents(id);
      assertCanDeleteReferenced(
        dependents.variants + dependents.barcodes + dependents.packaging,
        "لا يمكن حذف الصنف لوجود متغيرات أو باركود أو وحدات تعبئة مرتبطة به. يمكنك تعطيله بدلًا من ذلك."
      );
      deps.products.delete(id);
      if (current.imagePath) deps.images.remove(current.imagePath);
    },
    listVariants(query: VariantListQuery): Page<VariantListItem> {
      return deps.variants.list(query);
    },
    getVariant(id: string): VariantView {
      const variant = deps.variants.findById(id);
      if (!variant) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
      return toVariantView(variant);
    },
    createVariant(input: CreateVariantInput): VariantView {
      const product = requireProduct(input.productId);
      assertVariantsAllowed(product);
      const name = parseRequiredText(input.name, "اسم المتغير");
      const sku = parseSku(input.sku);
      const parsed = parseAttributes(input.attributes);
      reserveSku(sku);
      if (deps.variants.findBySignature(product.id, parsed.signature)) {
        throw new DomainError("DUPLICATE_VARIANT", "لا يمكن تكرار نفس مجموعة خصائص المتغير لنفس المنتج");
      }
      const baseUnitId = input.baseUnitId ?? product.baseUnitId;
      requireActiveUnit(baseUnitId);
      const now = deps.clock.nowIso();
      const variant: StoredVariant = {
        id: deps.ids.next(),
        productId: product.id,
        sku,
        name,
        baseUnitId,
        attributesSignature: parsed.signature,
        status: "active",
        createdAt: now,
        updatedAt: now,
        attributes: parsed.items.map((item) => ({ id: deps.ids.next(), ...item }))
      };
      deps.uow.run(() => deps.variants.insert(variant));
      return toVariantView(variant);
    },
    updateVariant(input: UpdateVariantInput): VariantView {
      const current = deps.variants.findById(input.id);
      if (!current) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
      const product = requireProduct(current.productId);
      if (product.productType !== "with_variants") {
        throw new DomainError("VARIANTS_NOT_ALLOWED", "لا يمكن تعديل متغيرات لصنف عادي");
      }
      const name = parseRequiredText(input.name, "اسم المتغير");
      const sku = parseSku(input.sku);
      const parsed = parseAttributes(input.attributes);
      reserveSku(sku, current.id);
      const signatureOwner = deps.variants.findBySignature(product.id, parsed.signature);
      if (signatureOwner && signatureOwner !== current.id) {
        throw new DomainError("DUPLICATE_VARIANT", "لا يمكن تكرار نفس مجموعة خصائص المتغير لنفس المنتج");
      }
      if (input.baseUnitId !== current.baseUnitId) {
        requireActiveUnit(input.baseUnitId);
        if (deps.packaging.listForOwner("variant", current.id).length > 0) {
          throw new DomainError("BASE_UNIT_LOCKED", "لا يمكن تغيير وحدة المتغير بعد تعريف وحدات التعبئة");
        }
      }
      const variant: StoredVariant = {
        ...current,
        name,
        sku,
        baseUnitId: input.baseUnitId,
        attributesSignature: parsed.signature,
        updatedAt: deps.clock.nowIso(),
        attributes: parsed.items.map((item) => ({ id: deps.ids.next(), ...item }))
      };
      deps.uow.run(() => deps.variants.update(variant));
      return toVariantView(variant);
    },
    activateVariant({ id }: IdPayload): VariantView {
      const current = deps.variants.findById(id);
      if (!current) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
      const product = requireProduct(current.productId);
      if (product.status !== "active") throw new DomainError("PRODUCT_INACTIVE", "لا يمكن تفعيل متغير لصنف غير نشط");
      if (current.status !== "active") {
        current.status = "active";
        current.updatedAt = deps.clock.nowIso();
        deps.variants.update(current);
      }
      return toVariantView(current);
    },
    deactivateVariant({ id }: IdPayload): VariantView {
      const current = deps.variants.findById(id);
      if (!current) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
      if (current.status !== "inactive") {
        current.status = "inactive";
        current.updatedAt = deps.clock.nowIso();
        deps.variants.update(current);
      }
      return toVariantView(current);
    },
    deleteVariant({ id }: IdPayload): void {
      const current = deps.variants.findById(id);
      if (!current) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
      const dependents = deps.variants.countDependents(id);
      assertCanDeleteReferenced(
        dependents.barcodes + dependents.packaging,
        "لا يمكن حذف المتغير لوجود باركود أو وحدات تعبئة مرتبطة به. يمكنك تعطيله بدلًا من ذلك."
      );
      deps.variants.delete(id);
    },
    listPackaging(query: PackagingListQuery): Page<PackagingListItem> {
      return deps.packaging.list(query);
    },
    addPackaging(input: AddPackagingInput): PackagingUnit {
      const ownerProduct = input.ownerType === "product"
        ? requireProduct(input.ownerId)
        : requireProduct(requireVariant(input.ownerId).productId);
      const baseUnitId = input.ownerType === "product" ? ownerProduct.baseUnitId : requireVariant(input.ownerId).baseUnitId;
      return insertPackaging(input.ownerType, input.ownerId, input.unitId, input.conversionFactor, ownerProduct, baseUnitId);
    },
    updatePackaging(input: UpdatePackagingInput): PackagingUnit {
      const current = deps.packaging.findById(input.id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      const product = current.ownerType === "product"
        ? requireProduct(current.ownerId)
        : requireProduct(requireVariant(current.ownerId).productId);
      const baseUnitId = current.ownerType === "product" ? product.baseUnitId : requireVariant(current.ownerId).baseUnitId;
      const packagingUnit = requireActiveUnit(input.unitId);
      const baseUnit = requireActiveUnit(baseUnitId);
      assertCompatibleUnitDimensions(baseUnit.dimension, packagingUnit.dimension);
      assertNotBaseUnit(baseUnitId, input.unitId);
      const duplicate = deps.packaging.findByOwnerAndUnit(current.ownerType, current.ownerId, input.unitId);
      if (duplicate && duplicate.id !== current.id) throw new DomainError("DUPLICATE_PACKAGING", "وحدة التعبئة هذه مضافة بالفعل");
      const factor = ConversionFactor.parse(input.conversionFactor);
      assertFactorPolicy(product.allowDecimalQuantity, factor);
      const updated: PackagingUnit = {
        ...current,
        unitId: input.unitId,
        numerator: factor.numerator,
        denominator: factor.denominator,
        updatedAt: deps.clock.nowIso()
      };
      deps.packaging.update(updated);
      return updated;
    },
    activatePackaging({ id }: IdPayload): PackagingUnit {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      if (current.status === "active") return current;
      const unit = deps.units.findById(current.unitId);
      if (!unit || unit.status !== "active") throw new DomainError("UNIT_INACTIVE", "لا يمكن تفعيل تعبئة تستخدم وحدة قياس غير نشطة");
      const updated = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.packaging.update(updated);
      return updated;
    },
    deactivatePackaging({ id }: IdPayload): PackagingUnit {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      if (current.status === "inactive") return current;
      const updated = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.packaging.update(updated);
      return updated;
    },
    deletePackaging({ id }: IdPayload): void {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      assertCanDeleteReferenced(deps.packaging.countBarcodeLinks(id), "لا يمكن حذف وحدة التعبئة لارتباطها بباركود. يمكنك تعطيلها بدلًا من ذلك.");
      deps.packaging.delete(id);
    },
    listBarcodes(query: PageQuery): Page<BarcodeView> {
      return deps.barcodes.list(query);
    },
    addBarcode(input: AddBarcodeInput): Barcode {
      const productId = input.productId ?? null;
      const variantId = input.variantId ?? null;
      if ((productId ? 1 : 0) + (variantId ? 1 : 0) !== 1) {
        throw new DomainError("BARCODE_TARGET", "يجب ربط الباركود بصنف أو متغير واحد");
      }
      const product = variantId ? requireProduct(requireVariant(variantId).productId) : requireProduct(productId!);
      if (variantId && requireVariant(variantId).productId !== product.id) {
        throw new DomainError("VARIANT_MISMATCH", "المتغير لا يتبع هذا الصنف");
      }
      return insertBarcode(input.code, product, variantId, input.packagingUnitId ?? null);
    },
    deleteBarcode({ id }: IdPayload): void {
      if (!deps.barcodes.findById(id)) throw new DomainError("BARCODE_NOT_FOUND", "الباركود غير موجود");
      deps.barcodes.delete(id);
    },
    findProductByBarcode(code: string): BarcodeMatch {
      const normalized = parseBarcode(code);
      const barcode = deps.barcodes.findViewByCode(normalized);
      if (!barcode) throw new DomainError("BARCODE_NOT_FOUND", "لا يوجد صنف بهذا الباركود");
      const productId = barcode.productId ?? deps.variants.findById(barcode.variantId ?? "")?.productId;
      if (!productId) throw new DomainError("PRODUCT_NOT_FOUND", "الصنف غير موجود");
      return { barcode, product: details(productId) };
    },
    prepareBarcodeLabel(code: string): BarcodeLabel {
      const match = this.findProductByBarcode(code);
      const variant = match.barcode.variantId
        ? match.product.variants.find((item) => item.id === match.barcode.variantId) ?? null
        : null;
      return {
        code: match.barcode.code,
        productName: match.product.product.name,
        sku: variant?.sku ?? match.product.product.sku,
        variantName: variant?.name ?? null,
        attributeSummary: variant ? variant.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join("، ") : null,
        unitLabel: match.barcode.packagingLabel ?? `${match.product.baseUnitName} (${match.product.baseUnitSymbol})`
      };
    },
    readImage(relativePath: string): string | null {
      if (!/^(products|brands)\/[a-zA-Z0-9.-]+$/.test(relativePath)) {
        throw new DomainError("INVALID_PATH", "مسار الصورة غير صالح");
      }
      return deps.images.read(relativePath);
    }
  };

  function requireVariant(id: string): StoredVariant {
    const variant = deps.variants.findById(id);
    if (!variant) throw new DomainError("VARIANT_NOT_FOUND", "المتغير غير موجود");
    return variant;
  }
}

function linkedPackaging(unitId: string | null | undefined, created: Map<string, string>): string | null {
  if (!unitId) return null;
  const packagingId = created.get(unitId);
  if (!packagingId) throw new DomainError("PACKAGING_MISMATCH", "الباركود يشير إلى وحدة تعبئة غير مضافة في نفس العملية");
  return packagingId;
}
