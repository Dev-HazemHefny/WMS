import type {
  Page,
  Product,
  ProductDetails,
  ProductInput,
  ProductListItem,
  ProductListQuery,
  ProductLookup
} from "../../../../shared/catalog/types";
import { DomainError } from "../../domain/errors";
import {
  assertCanChangeProductType,
  assertCanDeleteReferenced,
  assertVariantsPresent
} from "../../domain/product-rules";
import type { StoredVariant } from "../../domain/repositories";
import { parseAttributes, parseOptionalText, parseRequiredText, parseSku } from "../../domain/values";
import { replaceCatalogImage } from "../catalog-media";
import { linkedPackaging, type ProductContext } from "./context";

export function createProductCrudUseCases(ctx: ProductContext) {
  const {
    deps,
    requireProduct,
    requireActiveCategory,
    requireActiveUnit,
    requireActiveBrand,
    reserveSku,
    details,
    insertPackaging,
    insertBarcode
  } = ctx;

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
        throw new DomainError("PACKAGING_OWNER", "وحدات التعبئة والباركود للمنتج ذي المتغيرات تُعرَّف على المتغير");
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
      deps.uow.run(effects => {
        const imagePath = replaceCatalogImage(deps, effects, "products", input.imageDataUrl || null, null);
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
      deps.uow.run(effects => {
        const imageDataUrl = input.imageDataUrl === "" ? null : input.imageDataUrl;
        const imagePath = replaceCatalogImage(deps, effects, "products", imageDataUrl, current.imagePath);
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
        deps.products.update(product);
      });
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
      deps.uow.run(effects => {
        deps.products.delete(id);
        replaceCatalogImage(deps, effects, "products", null, current.imagePath);
      });
    }
  };
}

export type ProductCrudUseCases = ReturnType<typeof createProductCrudUseCases>;
