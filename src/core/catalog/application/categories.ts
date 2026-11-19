import type { Category, CategoryInput, CategoryTreeNode, Page, PageQuery } from "../../../shared/catalog/types";
import { assertCanDeleteCategory, assertValidParent } from "../domain/category-rules";
import { DomainError } from "../domain/errors";
import type { CategoryRepository } from "../domain/repositories";
import { parseCode, parseOptionalText, parseRequiredText } from "../domain/values";
import type { Clock, IdGenerator } from "./ports";

export function createCategoryUseCases(deps: {
  categories: CategoryRepository;
  clock: Clock;
  ids: IdGenerator;
}) {
  const requireCategory = (id: string): Category => {
    const category = deps.categories.findById(id);
    if (!category) throw new DomainError("CATEGORY_NOT_FOUND", "التصنيف غير موجود");
    return category;
  };

  const ensureCodeAvailable = (code: string, currentId?: string) => {
    const existing = deps.categories.findByCode(code);
    if (existing && existing.id !== currentId) throw new DomainError("DUPLICATE_CODE", "كود التصنيف مستخدم بالفعل");
  };

  return {
    listCategories(query: PageQuery): Page<Category> {
      return deps.categories.list(query);
    },
    lookupCategories(): Category[] {
      return deps.categories.listAll();
    },
    listCategoryTree(): CategoryTreeNode[] {
      const all = deps.categories.listAll();
      const byId = new Map<string, CategoryTreeNode>();
      const roots: CategoryTreeNode[] = [];
      for (const category of all) {
        byId.set(category.id, { ...category, children: [] });
      }
      for (const category of all) {
        const node = byId.get(category.id)!;
        if (category.parentId && byId.has(category.parentId)) {
          byId.get(category.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    },
    createCategory(input: CategoryInput): Category {
      const name = parseRequiredText(input.name, "اسم التصنيف");
      const code = parseCode(input.code, "كود التصنيف");
      const description = parseOptionalText(input.description);
      const parentId = input.parentId ?? null;
      assertValidParent(null, parentId, deps.categories.listAll());
      ensureCodeAvailable(code);
      const now = deps.clock.nowIso();
      const category: Category = {
        id: deps.ids.next(),
        name,
        code,
        description,
        parentId,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      deps.categories.insert(category);
      return category;
    },
    updateCategory(id: string, input: CategoryInput): Category {
      const current = requireCategory(id);
      const name = parseRequiredText(input.name, "اسم التصنيف");
      const code = parseCode(input.code, "كود التصنيف");
      const description = parseOptionalText(input.description);
      const parentId = input.parentId ?? null;
      assertValidParent(id, parentId, deps.categories.listAll());
      ensureCodeAvailable(code, id);
      const category: Category = { ...current, name, code, description, parentId, updatedAt: deps.clock.nowIso() };
      deps.categories.update(category);
      return category;
    },
    activateCategory(id: string): Category {
      const current = requireCategory(id);
      if (current.status === "active") return current;
      const category = { ...current, status: "active" as const, updatedAt: deps.clock.nowIso() };
      deps.categories.update(category);
      return category;
    },
    deactivateCategory(id: string): Category {
      const current = requireCategory(id);
      if (current.status === "inactive") return current;
      const category = { ...current, status: "inactive" as const, updatedAt: deps.clock.nowIso() };
      deps.categories.update(category);
      return category;
    },
    deleteCategory(id: string): void {
      requireCategory(id);
      assertCanDeleteCategory(deps.categories.countProducts(id), deps.categories.countChildren(id));
      deps.categories.delete(id);
    }
  };
}
