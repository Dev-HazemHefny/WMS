import type {
  CreateVariantInput,
  IdPayload,
  Page,
  UpdateVariantInput,
  VariantListItem,
  VariantListQuery,
  VariantView
} from "../../../../shared/catalog/types";
import { DomainError } from "../../domain/errors";
import { assertVariantsAllowed, assertCanDeleteReferenced } from "../../domain/product-rules";
import type { StoredVariant } from "../../domain/repositories";
import { parseAttributes, parseRequiredText, parseSku } from "../../domain/values";
import type { ProductContext } from "./context";

export function createVariantUseCases(ctx: ProductContext) {
  const { deps, requireProduct, requireActiveUnit, requireVariant, reserveSku, toVariantView } = ctx;

  return {
    listVariants(query: VariantListQuery): Page<VariantListItem> {
      return deps.variants.list(query);
    },
    getVariant(id: string): VariantView {
      return toVariantView(requireVariant(id));
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
      const current = requireVariant(input.id);
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
      const current = requireVariant(id);
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
      const current = requireVariant(id);
      if (current.status !== "inactive") {
        current.status = "inactive";
        current.updatedAt = deps.clock.nowIso();
        deps.variants.update(current);
      }
      return toVariantView(current);
    },
    deleteVariant({ id }: IdPayload): void {
      const current = requireVariant(id);
      const dependents = deps.variants.countDependents(current.id);
      assertCanDeleteReferenced(
        dependents.barcodes + dependents.packaging,
        "لا يمكن حذف المتغير لوجود باركود أو وحدات تعبئة مرتبطة به. يمكنك تعطيله بدلًا من ذلك."
      );
      deps.variants.delete(current.id);
    }
  };
}

export type VariantUseCases = ReturnType<typeof createVariantUseCases>;
