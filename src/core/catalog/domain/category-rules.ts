import type { Category } from "../../../shared/catalog/types";
import { DomainError } from "./errors";

export function assertValidParent(
  categoryId: string | null,
  parentId: string | null,
  categories: Pick<Category, "id" | "parentId">[]
): void {
  if (!parentId) return;
  if (categoryId && parentId === categoryId) {
    throw new DomainError("CATEGORY_CYCLE", "لا يمكن أن يكون التصنيف أبًا لنفسه");
  }

  const byId = new Map(categories.map((category) => [category.id, category.parentId]));
  const seen = new Set<string>();
  let current: string | null = parentId;

  while (current) {
    if (categoryId && current === categoryId) {
      throw new DomainError("CATEGORY_CYCLE", "لا يمكن إنشاء علاقة دائرية بين التصنيفات");
    }
    if (seen.has(current)) {
      throw new DomainError("CATEGORY_CYCLE", "لا يمكن إنشاء علاقة دائرية بين التصنيفات");
    }
    if (!byId.has(current)) {
      throw new DomainError("CATEGORY_NOT_FOUND", "التصنيف الأب غير موجود");
    }
    seen.add(current);
    if (seen.size > 30) {
      throw new DomainError("CATEGORY_DEPTH", "تجاوز التصنيف الحد المسموح لمستويات التفرع");
    }
    current = byId.get(current) ?? null;
  }
}

export function assertCanDeleteCategory(productCount: number, childCount: number): void {
  if (productCount > 0 || childCount > 0) {
    throw new DomainError(
      "CATEGORY_IN_USE",
      "لا يمكن حذف التصنيف لوجود أصناف أو تصنيفات فرعية مرتبطة به. يمكنك تعطيله بدلًا من ذلك."
    );
  }
}
