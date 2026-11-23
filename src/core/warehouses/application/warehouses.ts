import type { DefinitionStatus, StorageLocation, Warehouse } from "../domain/entities";
import type { DefinitionQuery } from "../domain/repositories";
import { assertExpectedVersion, assertWarehouseDeactivation, assertWarehouseReassignment } from "../domain/rules";
import { available, fail, validateQuery, validateStatus, warehouseFields, type WarehouseInput, type WarehouseContext } from "./context";

export function createWarehouseUseCases(ctx: WarehouseContext) {
  const { deps } = ctx;
  function unique(value: Warehouse, currentId?: string) {
    available(deps.warehouses.findByCode(value.code), currentId, "DUPLICATE_CODE");
    available(deps.warehouses.findByName(value.branchId, value.name), currentId, "DUPLICATE_NAME");
  }
  function activeBranch(id: string) {
    if (ctx.branch(id).status !== "active") fail("BRANCH_INACTIVE", "الفرع غير نشط");
  }
  return {
    createWarehouse(input: WarehouseInput & { branchId: string }): Warehouse {
      return ctx.mutate("warehouse", "warehouse.create", () => {
        activeBranch(input.branchId);
        const value: Warehouse = { ...ctx.newDefinition(), ...warehouseFields(input), branchId: input.branchId };
        unique(value);
        deps.warehouses.insert(value);
        const defaultLocation: StorageLocation = {
          ...ctx.newDefinition(), warehouseId: value.id, parentId: null,
          code: "DEFAULT", name: "افتراضي", locationType: "other", isStockable: true, isDefault: true,
        };
        deps.locations.insert(defaultLocation);
        return value;
      });
    },
    updateWarehouse(id: string, input: WarehouseInput, expectedVersion: number): Warehouse {
      return ctx.mutate("warehouse", "warehouse.update", () => {
        const current = ctx.warehouse(id);
        assertExpectedVersion(current, expectedVersion);
        ctx.assertUnlocked(ctx.warehouseLocations(id).map(l => l.id));
        const value = { ...ctx.edited(current), ...warehouseFields(input) };
        unique(value, id);
        return ctx.saved(value, deps.warehouses.update(value, expectedVersion));
      });
    },
    setWarehouseStatus(id: string, status: DefinitionStatus, expectedVersion: number): Warehouse {
      return ctx.mutate("warehouse.status", "warehouse.status", () => {
        validateStatus(status);
        const current = ctx.warehouse(id);
        assertExpectedVersion(current, expectedVersion);
        const locations = ctx.warehouseLocations(id);
        const ids = locations.map(l => l.id);
        if (status === "inactive") assertWarehouseDeactivation(locations, deps.usage.inspect(ids));
        else { activeBranch(current.branchId); ctx.assertUnlocked(ids); }
        const defaultLocation = deps.locations.findDefault(id) ?? fail("DEFAULT_LOCATION_MISSING", "الموقع الافتراضي غير موجود");
        ctx.saved(defaultLocation, deps.locations.update({ ...ctx.edited(defaultLocation), status }, defaultLocation.version));
        const value = { ...ctx.edited(current), status };
        return ctx.saved(value, deps.warehouses.update(value, expectedVersion));
      });
    },
    reassignWarehouse(id: string, branchId: string, expectedVersion: number): Warehouse {
      return ctx.mutate("warehouse.reassign", "warehouse.reassign", () => {
        const current = ctx.warehouse(id);
        assertExpectedVersion(current, expectedVersion);
        const branch = ctx.branch(branchId);
        assertWarehouseReassignment(current, branch, deps.usage.inspect(ctx.warehouseLocations(id).map(l => l.id)));
        const value = { ...ctx.edited(current), branchId };
        unique(value, id);
        return ctx.saved(value, deps.warehouses.update(value, expectedVersion));
      });
    },
    listWarehouses(query: DefinitionQuery & { branchId?: string }) {
      return ctx.read(() => { if (query.branchId) ctx.branch(query.branchId); return deps.warehouses.list({ ...validateQuery(query), branchId: query.branchId }); });
    },
    getWarehouseDetails(id: string) {
      return ctx.read(() => {
        const warehouse = ctx.warehouse(id);
        return { warehouse, branch: ctx.branch(warehouse.branchId), defaultLocation: deps.locations.findDefault(id) ?? fail("DEFAULT_LOCATION_MISSING", "الموقع الافتراضي غير موجود") };
      });
    },
  };
}
