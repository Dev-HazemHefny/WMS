import type { Brand, BrandInput, Page, PageQuery, Unit, UnitInput } from "../../../shared/catalog/types";
import { DomainError } from "../domain/errors";
import type { BrandRepository, UnitRepository } from "../domain/repositories";
import { assertCanDeleteReferenced } from "../domain/product-rules";
import { assertValidImageDataUrl, parseCode, parseOptionalText, parseRequiredText, parseSymbol } from "../domain/values";
import type { Clock, IdGenerator, ImageStorage } from "./ports";

export function createUnitUseCases(deps: { units: UnitRepository; clock: Clock; ids: IdGenerator }) {
  const requireUnit = (id: string): Unit => {
    const unit = deps.units.findById(id);
    if (!unit) throw new DomainError("UNIT_NOT_FOUND", "وحدة القياس غير موجودة");
    return unit;
  };

  return {
    listUnits(query: PageQuery): Page<Unit> {
      return deps.units.list(query);
    },
    lookupUnits(): Unit[] {
      return deps.units.listAll();
    },
    createUnit(input: UnitInput): Unit {
      const name = parseRequiredText(input.name, "اسم الوحدة");
      const symbol = parseSymbol(input.symbol);
      const description = parseOptionalText(input.description);
      if (deps.units.findByName(name)) throw new DomainError("DUPLICATE_NAME", "اسم وحدة القياس مستخدم بالفعل");
      if (deps.units.findBySymbol(symbol)) throw new DomainError("DUPLICATE_SYMBOL", "رمز وحدة القياس مستخدم بالفعل");
      const now = deps.clock.nowIso();
      const unit: Unit = {
        id: deps.ids.next(),
        name,
        symbol,
        dimension: input.dimension,
        description,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      deps.units.insert(unit);
      return unit;
    },
    updateUnit(id: string, input: UnitInput): Unit {
      const current = requireUnit(id);
      const name = parseRequiredText(input.name, "اسم الوحدة");
      const symbol = parseSymbol(input.symbol);
      const description = parseOptionalText(input.description);
      const sameName = deps.units.findByName(name);
      if (sameName && sameName.id !== id) throw new DomainError("DUPLICATE_NAME", "اسم وحدة القياس مستخدم بالفعل");
      const sameSymbol = deps.units.findBySymbol(symbol);
      if (sameSymbol && sameSymbol.id !== id) throw new DomainError("DUPLICATE_SYMBOL", "رمز وحدة القياس مستخدم بالفعل");
      if (current.dimension !== input.dimension && deps.units.countUsage(id) > 0) {
        throw new DomainError("UNIT_DIMENSION_LOCKED", "لا يمكن تغيير نوع وحدة مرتبطة بأصناف أو وحدات تعبئة");
      }
      const unit = { ...current, name, symbol, dimension: input.dimension, description, updatedAt: deps.clock.nowIso() };
      deps.units.update(unit);
      return unit;
    },
    activateUnit(id: string): Unit {
      const current = requireUnit(id);
      if (current.status === "active") return current;
      const unit = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.units.update(unit);
      return unit;
    },
    deactivateUnit(id: string): Unit {
      const current = requireUnit(id);
      if (current.status === "inactive") return current;
      const unit = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.units.update(unit);
      return unit;
    },
    deleteUnit(id: string): void {
      requireUnit(id);
      assertCanDeleteReferenced(deps.units.countUsage(id), "لا يمكن حذف وحدة القياس لارتباطها بأصناف أو تعبئة. يمكنك تعطيلها بدلًا من ذلك.");
      deps.units.delete(id);
    }
  };
}

export function createBrandUseCases(deps: {
  brands: BrandRepository;
  images: ImageStorage;
  clock: Clock;
  ids: IdGenerator;
}) {
  const requireBrand = (id: string): Brand => {
    const brand = deps.brands.findById(id);
    if (!brand) throw new DomainError("BRAND_NOT_FOUND", "العلامة التجارية غير موجودة");
    return brand;
  };

  const storeImage = (dataUrl: string | null | undefined, id: string, previous: string | null): string | null => {
    if (dataUrl === undefined) return previous;
    if (dataUrl === null) {
      if (previous) deps.images.remove(previous);
      return null;
    }
    const extension = assertValidImageDataUrl(dataUrl);
    const imagePath = deps.images.save({ dataUrl, folder: "brands", fileName: `${id}.${extension}` });
    if (previous && previous !== imagePath) deps.images.remove(previous);
    return imagePath;
  };

  return {
    listBrands(query: PageQuery): Page<Brand> {
      return deps.brands.list(query);
    },
    lookupBrands(): Brand[] {
      return deps.brands.listAll();
    },
    createBrand(input: BrandInput): Brand {
      const name = parseRequiredText(input.name, "اسم العلامة التجارية");
      const code = parseCode(input.code, "كود العلامة التجارية");
      const description = parseOptionalText(input.description);
      if (deps.brands.findByCode(code)) throw new DomainError("DUPLICATE_CODE", "كود العلامة التجارية مستخدم بالفعل");
      const id = deps.ids.next();
      let imagePath: string | null = null;
      try {
        imagePath = storeImage(input.imageDataUrl, id, null);
        const now = deps.clock.nowIso();
        const brand: Brand = { id, name, code, description, imagePath, status: "active", createdAt: now, updatedAt: now };
        deps.brands.insert(brand);
        return brand;
      } catch (error) {
        if (imagePath) deps.images.remove(imagePath);
        throw error;
      }
    },
    updateBrand(id: string, input: BrandInput): Brand {
      const current = requireBrand(id);
      const name = parseRequiredText(input.name, "اسم العلامة التجارية");
      const code = parseCode(input.code, "كود العلامة التجارية");
      const description = parseOptionalText(input.description);
      const same = deps.brands.findByCode(code);
      if (same && same.id !== id) throw new DomainError("DUPLICATE_CODE", "كود العلامة التجارية مستخدم بالفعل");
      const imagePath = storeImage(input.imageDataUrl, id, current.imagePath);
      const brand = { ...current, name, code, description, imagePath, updatedAt: deps.clock.nowIso() };
      try {
        deps.brands.update(brand);
        return brand;
      } catch (error) {
        if (imagePath && imagePath !== current.imagePath) deps.images.remove(imagePath);
        throw error;
      }
    },
    activateBrand(id: string): Brand {
      const current = requireBrand(id);
      if (current.status === "active") return current;
      const brand = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.brands.update(brand);
      return brand;
    },
    deactivateBrand(id: string): Brand {
      const current = requireBrand(id);
      if (current.status === "inactive") return current;
      const brand = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.brands.update(brand);
      return brand;
    },
    deleteBrand(id: string): void {
      const current = requireBrand(id);
      assertCanDeleteReferenced(deps.brands.countProducts(id), "لا يمكن حذف العلامة التجارية لارتباطها بأصناف. يمكنك تعطيلها بدلًا من ذلك.");
      deps.brands.delete(id);
      if (current.imagePath) deps.images.remove(current.imagePath);
    }
  };
}
