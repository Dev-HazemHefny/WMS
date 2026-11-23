import type { Branch, DefinitionStatus } from "../domain/entities";
import type { DefinitionQuery } from "../domain/repositories";
import { assertBranchDeactivation, assertExpectedVersion } from "../domain/rules";
import { available, branchFields, validateQuery, validateStatus, type BranchInput, type WarehouseContext } from "./context";

export function createBranchUseCases(ctx: WarehouseContext) {
  const { deps } = ctx;
  function unique(branch: Branch, currentId?: string) {
    available(deps.branches.findByCode(branch.code), currentId, "DUPLICATE_CODE");
    available(deps.branches.findByName(branch.name), currentId, "DUPLICATE_NAME");
  }
  function unlocked(id: string) {
    const ids = deps.warehouses.listByBranch(id).flatMap(w => ctx.warehouseLocations(w.id).map(l => l.id));
    ctx.assertUnlocked(ids);
  }
  return {
    createBranch(input: BranchInput): Branch {
      return ctx.mutate("warehouse", "warehouse.branch.create", () => {
        const value: Branch = { ...ctx.newDefinition(), ...branchFields(input) };
        unique(value);
        deps.branches.insert(value);
        return value;
      });
    },
    updateBranch(id: string, input: BranchInput, expectedVersion: number): Branch {
      return ctx.mutate("warehouse", "warehouse.branch.update", () => {
        const current = ctx.branch(id);
        assertExpectedVersion(current, expectedVersion);
        unlocked(id);
        const value = { ...ctx.edited(current), ...branchFields(input) };
        unique(value, id);
        return ctx.saved(value, deps.branches.update(value, expectedVersion));
      });
    },
    setBranchStatus(id: string, status: DefinitionStatus, expectedVersion: number): Branch {
      return ctx.mutate("warehouse.status", "warehouse.branch.status", () => {
        validateStatus(status);
        const current = ctx.branch(id);
        assertExpectedVersion(current, expectedVersion);
        unlocked(id);
        if (status === "inactive") assertBranchDeactivation(deps.warehouses.listByBranch(id));
        const value = { ...ctx.edited(current), status };
        return ctx.saved(value, deps.branches.update(value, expectedVersion));
      });
    },
    listBranches(query: DefinitionQuery) { return ctx.read(() => deps.branches.list(validateQuery(query))); },
    getBranchDetails(id: string) { return ctx.read(() => ({ branch: ctx.branch(id), warehouses: deps.warehouses.listByBranch(id) })); },
    listBranchWarehouses(id: string) { return ctx.read(() => { ctx.branch(id); return deps.warehouses.listByBranch(id); }); },
  };
}
