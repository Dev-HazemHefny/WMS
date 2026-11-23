import type { DefinitionStatus, ResolvedLocation, StorageLocation } from "../domain/entities";
import type { DefinitionQuery } from "../domain/repositories";
import {
  assertActiveLocation, assertDefaultLocation, assertExpectedVersion, assertLocationDeactivation,
  assertStockabilityChange, defaultStockable, locationPath, locationSubtree,
  reparentLocation as moveLocation, reparentLockScope,
} from "../domain/rules";
import { available, definitionFields, fail, validateLocationInput, validateQuery, validateStatus, type LocationInput, type WarehouseContext } from "./context";

export function createLocationUseCases(ctx: WarehouseContext) {
  const { deps } = ctx;
  function unique(value: StorageLocation, currentId?: string) {
    available(deps.locations.findByCode(value.warehouseId, value.code), currentId, "DUPLICATE_CODE");
    available(deps.locations.findByName(value.warehouseId, value.name), currentId, "DUPLICATE_NAME");
  }
  function scope(location: StorageLocation) {
    const warehouse = ctx.warehouse(location.warehouseId);
    return { warehouse, branch: ctx.branch(warehouse.branchId), locations: ctx.warehouseLocations(warehouse.id) };
  }
  function resolve(location: StorageLocation): ResolvedLocation {
    const { warehouse, branch, locations } = scope(location);
    const ancestry = locationPath(location.id, locations);
    return {
      location, warehouse, branch,
      path: ancestry.map(({ id, code, name }) => ({ id, code, name })),
      effectiveActive: warehouse.status === "active" && branch.status === "active" && ancestry.every(l => l.status === "active"),
    };
  }
  function unlocked(location: StorageLocation, locations: readonly StorageLocation[]) {
    ctx.assertUnlocked(reparentLockScope(location, location.parentId, locations));
  }
  function assertParentWarehouse(parentId: string | null, warehouseId: string) {
    if (parentId !== null && ctx.location(parentId).warehouseId !== warehouseId) {
      fail("PARENT_WAREHOUSE_MISMATCH", "الموقع الأب يجب أن يتبع نفس المخزن");
    }
  }
  return {
    createLocation(input: LocationInput & { warehouseId: string; parentId?: string | null }): StorageLocation {
      return ctx.mutate("warehouse", "warehouse.location.create", () => {
        validateLocationInput(input);
        const value: StorageLocation = {
          ...ctx.newDefinition(), ...definitionFields(input), warehouseId: input.warehouseId,
          parentId: input.parentId ?? null, locationType: input.locationType,
          isStockable: input.isStockable ?? defaultStockable(input.locationType), isDefault: false,
        };
        const { warehouse, branch, locations } = scope(value);
        assertParentWarehouse(value.parentId, value.warehouseId);
        assertActiveLocation(value, warehouse, branch, locations);
        ctx.assertUnlocked(locationPath(value.id, [...locations, value]).map(l => l.id));
        unique(value);
        deps.locations.insert(value);
        return value;
      });
    },
    updateLocation(id: string, input: LocationInput, expectedVersion: number): StorageLocation {
      return ctx.mutate("warehouse", "warehouse.location.update", () => {
        validateLocationInput(input);
        const current = ctx.location(id);
        assertExpectedVersion(current, expectedVersion);
        const { warehouse, branch, locations } = scope(current);
        unlocked(current, locations);
        const isStockable = input.isStockable ?? current.isStockable;
        assertStockabilityChange(current, isStockable, deps.usage.inspect([id]));
        if (isStockable !== current.isStockable) assertActiveLocation({ ...current, status: "active" }, warehouse, branch, locations);
        const value = { ...ctx.edited(current), ...definitionFields(input), locationType: input.locationType, isStockable };
        assertDefaultLocation(value);
        unique(value, id);
        return ctx.saved(value, deps.locations.update(value, expectedVersion));
      });
    },
    reparentLocation(id: string, parentId: string | null, expectedVersion: number): StorageLocation {
      return ctx.mutate("warehouse.reparent", "warehouse.location.reparent", () => {
        const current = ctx.location(id);
        assertExpectedVersion(current, expectedVersion);
        const { warehouse, branch, locations } = scope(current);
        assertParentWarehouse(parentId, current.warehouseId);
        const ids = reparentLockScope(current, parentId, locations);
        // edited validates that the next version remains safe for JavaScript/IPC.
        const metadata = ctx.edited(current);
        const value = moveLocation(current, parentId, warehouse, branch, locations, deps.usage.lockedLocationIds(ids), metadata.updatedAt);
        return ctx.saved(value, deps.locations.update(value, expectedVersion));
      });
    },
    setLocationStatus(id: string, status: DefinitionStatus, expectedVersion: number): StorageLocation {
      return ctx.mutate("warehouse.status", "warehouse.location.status", () => {
        validateStatus(status);
        const current = ctx.location(id);
        assertExpectedVersion(current, expectedVersion);
        if (current.isDefault) fail("DEFAULT_LOCATION_PROTECTED", "تُدار حالة الموقع الافتراضي مع المخزن");
        const { warehouse, branch, locations } = scope(current);
        unlocked(current, locations);
        const value = { ...ctx.edited(current), status };
        if (status === "inactive") {
          const ids = locationSubtree(id, locations).map(l => l.id);
          assertLocationDeactivation(current, locations, deps.usage.inspect(ids));
        } else assertActiveLocation(value, warehouse, branch, locations);
        return ctx.saved(value, deps.locations.update(value, expectedVersion));
      });
    },
    getLocationDetails(id: string) { return ctx.read(() => resolve(ctx.location(id))); },
    getLocationPath(id: string) { return ctx.read(() => resolve(ctx.location(id)).path); },
    listLocations(warehouseId: string, input: DefinitionQuery) {
      return ctx.read(() => {
        ctx.warehouse(warehouseId);
        const query = validateQuery(input);
        const search = query.search?.toLocaleLowerCase();
        const rows = ctx.warehouseLocations(warehouseId).filter(l => (!query.status || l.status === query.status) && (!search || l.code.toLocaleLowerCase().includes(search) || l.name.toLocaleLowerCase().includes(search)));
        return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize };
      });
    },
    /** Returns one level, keeping deep trees safe for future IPC serialization. */
    getLocationTree(warehouseId: string, parentId: string | null = null) {
      return ctx.read(() => {
        ctx.warehouse(warehouseId);
        if (parentId !== null && ctx.location(parentId).warehouseId !== warehouseId) fail("PARENT_WAREHOUSE_MISMATCH", "الموقع الأب يجب أن يتبع نفس المخزن");
        return deps.locations.listChildren(warehouseId, parentId);
      });
    },
    listStockableLocations(warehouseId?: string) {
      return ctx.read(() => {
        const warehouses = warehouseId === undefined ? [] : [ctx.warehouse(warehouseId)];
        if (warehouseId === undefined) {
          let page = 1;
          let total: number;
          do {
            const result = deps.warehouses.list({page,pageSize:100,status:"active"});
            warehouses.push(...result.items);
            total = result.total;
            page++;
          } while (warehouses.length < total);
        }
        return warehouses.flatMap(warehouse => ctx.warehouseLocations(warehouse.id))
          .filter(l => l.isStockable).map(resolve).filter(l => l.effectiveActive);
      });
    },
  };
}
