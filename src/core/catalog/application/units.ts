import type { Page, PageQuery, Unit, UnitInput } from "../../../shared/catalog/types";
import { DomainError } from "../domain/errors";
import type { UnitRepository } from "../domain/repositories";
import { assertCanDeleteReferenced } from "../domain/product-rules";
import { parseOptionalText, parseRequiredText, parseSymbol } from "../domain/values";
import type { Clock, IdGenerator } from "./ports";

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

export type UnitUseCases = ReturnType<typeof createUnitUseCases>;
