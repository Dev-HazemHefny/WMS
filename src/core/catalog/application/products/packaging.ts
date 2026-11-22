import { ConversionFactor } from "../../../../shared/catalog/conversion";
import type {
  AddPackagingInput,
  IdPayload,
  PackagingListItem,
  PackagingListQuery,
  PackagingUnit,
  PackagingView,
  Page,
  UpdatePackagingInput
} from "../../../../shared/catalog/types";
import { DomainError } from "../../domain/errors";
import {
  assertCanDeleteReferenced,
  assertCompatibleUnitDimensions,
  assertFactorPolicy,
  assertNotBaseUnit
} from "../../domain/product-rules";
import type { ProductContext } from "./context";

export function createPackagingUseCases(ctx: ProductContext) {
  const { deps, requireProduct, requireVariant, requireActiveUnit, insertPackaging } = ctx;

  function view(pack: PackagingUnit): PackagingView {
    const unit = deps.units.findById(pack.unitId);
    if (!unit) throw new DomainError("UNIT_NOT_FOUND", "وحدة التعبئة غير موجودة");
    return {...pack, unitName:unit.name, unitSymbol:unit.symbol, factorLabel:ConversionFactor.of(pack.numerator,pack.denominator).format()};
  }

  const resolveOwner = (ownerType: "product" | "variant", ownerId: string) => {
    if (ownerType === "product") {
      const product = requireProduct(ownerId);
      return { product, baseUnitId: product.baseUnitId };
    }
    const variant = requireVariant(ownerId);
    return { product: requireProduct(variant.productId), baseUnitId: variant.baseUnitId };
  };

  return {
    listPackaging(query: PackagingListQuery): Page<PackagingListItem> {
      return deps.packaging.list(query);
    },
    addPackaging(input: AddPackagingInput): PackagingView {
      const owner = resolveOwner(input.ownerType, input.ownerId);
      return view(insertPackaging(
        input.ownerType,
        input.ownerId,
        input.unitId,
        input.conversionFactor,
        owner.product,
        owner.baseUnitId
      ));
    },
    updatePackaging(input: UpdatePackagingInput): PackagingView {
      const current = deps.packaging.findById(input.id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      const owner = resolveOwner(current.ownerType, current.ownerId);
      const packagingUnit = requireActiveUnit(input.unitId);
      const baseUnit = requireActiveUnit(owner.baseUnitId);
      assertCompatibleUnitDimensions(baseUnit.dimension, packagingUnit.dimension);
      assertNotBaseUnit(owner.baseUnitId, input.unitId);
      const duplicate = deps.packaging.findByOwnerAndUnit(current.ownerType, current.ownerId, input.unitId);
      if (duplicate && duplicate.id !== current.id) {
        throw new DomainError("DUPLICATE_PACKAGING", "وحدة التعبئة هذه مضافة بالفعل");
      }
      const factor = ConversionFactor.parse(input.conversionFactor);
      assertFactorPolicy(owner.product.allowDecimalQuantity, factor);
      const updated: PackagingUnit = {
        ...current,
        unitId: input.unitId,
        numerator: factor.numerator,
        denominator: factor.denominator,
        updatedAt: deps.clock.nowIso()
      };
      deps.packaging.update(updated);
      return view(updated);
    },
    activatePackaging({ id }: IdPayload): PackagingView {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      if (current.status === "active") return view(current);
      const unit = deps.units.findById(current.unitId);
      if (!unit || unit.status !== "active") {
        throw new DomainError("UNIT_INACTIVE", "لا يمكن تفعيل تعبئة تستخدم وحدة قياس غير نشطة");
      }
      const updated = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.packaging.update(updated);
      return view(updated);
    },
    deactivatePackaging({ id }: IdPayload): PackagingView {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      if (current.status === "inactive") return view(current);
      const updated = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.packaging.update(updated);
      return view(updated);
    },
    deletePackaging({ id }: IdPayload): void {
      const current = deps.packaging.findById(id);
      if (!current) throw new DomainError("PACKAGING_NOT_FOUND", "وحدة التعبئة غير موجودة");
      assertCanDeleteReferenced(
        deps.packaging.countBarcodeLinks(current.id),
        "لا يمكن حذف وحدة التعبئة لارتباطها بباركود. يمكنك تعطيلها بدلًا من ذلك."
      );
      deps.packaging.delete(current.id);
    }
  };
}

export type PackagingUseCases = ReturnType<typeof createPackagingUseCases>;
