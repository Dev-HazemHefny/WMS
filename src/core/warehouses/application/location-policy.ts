import type { BranchRepository, LocationRepository, WarehouseRepository } from "../domain/repositories";
import type { ResolvedLocation } from "../domain/entities";
import type { WarehouseLocationPolicy } from "../public";
import { assertLocationUsable, countLocationIds, locationPath } from "../domain/rules";
import { fail } from "./context";

/** Internal validation port. Authorization belongs to the invoking use case. */
export function createWarehouseLocationPolicy(repositories: {
  branches: BranchRepository; warehouses: WarehouseRepository; locations: LocationRepository;
}): WarehouseLocationPolicy {
  const { branches, warehouses, locations } = repositories;
  function resolveLocation(id: string): ResolvedLocation {
    const location = locations.findById(id) ?? fail("LOCATION_NOT_FOUND", "الموقع غير موجود");
    const warehouse = warehouses.findById(location.warehouseId) ?? fail("WAREHOUSE_NOT_FOUND", "المخزن غير موجود");
    const branch = branches.findById(warehouse.branchId) ?? fail("BRANCH_NOT_FOUND", "الفرع غير موجود");
    const path = locationPath(id, locations.listByWarehouse(warehouse.id));
    return {
      location, warehouse, branch,
      path: path.map(({id,code,name}) => ({id,code,name})),
      effectiveActive: branch.status === "active" && warehouse.status === "active" && path.every(row => row.status === "active"),
    };
  }
  return {
    resolveLocation,
    assertLocationUsable(id) {
      const resolved = resolveLocation(id);
      assertLocationUsable(resolved.location,resolved.warehouse,resolved.branch,locations.listByWarehouse(resolved.warehouse.id));
    },
    countLocationIds(id) {
      const resolved = resolveLocation(id);
      return countLocationIds(resolved.location,resolved.warehouse,resolved.branch,locations.listByWarehouse(resolved.warehouse.id));
    },
    listStockableLocations(warehouseId) {
      const scope = warehouseId === undefined ? [] : [warehouses.findById(warehouseId) ?? fail("WAREHOUSE_NOT_FOUND", "المخزن غير موجود")];
      if (warehouseId === undefined) {
        let page=1, total:number;
        do {
          const result=warehouses.list({page,pageSize:100,status:"active"});
          scope.push(...result.items);total=result.total;page++;
        } while(scope.length < total);
      }
      return scope.flatMap(warehouse => locations.listByWarehouse(warehouse.id))
        .filter(location => location.isStockable).map(location => resolveLocation(location.id))
        .filter(location => location.effectiveActive);
    },
  };
}
