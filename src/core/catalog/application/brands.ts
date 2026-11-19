import type { Brand, BrandInput, Page, PageQuery } from "../../../shared/catalog/types";
import { DomainError } from "../domain/errors";
import type { BrandRepository } from "../domain/repositories";
import { assertCanDeleteReferenced } from "../domain/product-rules";
import { assertValidImageDataUrl, parseCode, parseOptionalText, parseRequiredText } from "../domain/values";
import type { Clock, IdGenerator, ImageStorage } from "./ports";

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

export type BrandUseCases = ReturnType<typeof createBrandUseCases>;
