import type { BranchRepository, LocationRepository, WarehouseRepository } from "../domain/repositories";
import type { Branch, ResolvedLocation, StorageLocation, Warehouse } from "../domain/entities";
import type { WarehouseLocationPolicy } from "../public";
import { assertLocationUsable, countLocationIds, createLocationPathResolver, locationPath } from "../domain/rules";
import { fail } from "./context";

/** Internal validation port. Authorization belongs to the invoking use case. */
export function createWarehouseLocationPolicy(repositories: {
  branches: BranchRepository; warehouses: WarehouseRepository; locations: LocationRepository;
}): WarehouseLocationPolicy {
  const { branches, warehouses, locations } = repositories;
  function requireWarehouse(id: string): Warehouse {
    return warehouses.findById(id) ?? fail("WAREHOUSE_NOT_FOUND", "المخزن غير موجود");
  }
  function branchOf(warehouse: Warehouse): Branch {
    return branches.findById(warehouse.branchId) ?? fail("BRANCH_NOT_FOUND", "الفرع غير موجود");
  }
  function resolve(location: StorageLocation, warehouse: Warehouse, branch: Branch, path: StorageLocation[]): ResolvedLocation {
    return {
      location, warehouse, branch,
      path: path.map(({id,code,name}) => ({id,code,name})),
      effectiveActive: branch.status === "active" && warehouse.status === "active" && path.every(row => row.status === "active"),
    };
  }
  function resolveLocationContext(id: string) {
    const location = locations.findById(id) ?? fail("LOCATION_NOT_FOUND", "الموقع غير موجود");
    const warehouse = requireWarehouse(location.warehouseId);
    const branch = branchOf(warehouse);
    const definitions = locations.listByWarehouse(warehouse.id);
    // Validate stored ancestry before applying operational eligibility rules.
    const path = locationPath(id, definitions);
    return { location, warehouse, branch, definitions, path };
  }
  return {
    resolveLocation(id) {
      const { location, warehouse, branch, path } = resolveLocationContext(id);
      return resolve(location, warehouse, branch, path);
    },
    listInventoryLocationIds(warehouseId) {
      const warehouse = requireWarehouse(warehouseId);
      return locations.listByWarehouse(warehouse.id).filter(location => location.isStockable).map(location => location.id);
    },
    assertLocationUsable(id) {
      const { location, warehouse, branch, definitions } = resolveLocationContext(id);
      assertLocationUsable(location, warehouse, branch, definitions);
    },
    countLocationIds(id) {
      const { location, warehouse, branch, definitions } = resolveLocationContext(id);
      return countLocationIds(location, warehouse, branch, definitions);
    },
    listStockableLocations(warehouseId) {
      const scope = warehouseId === undefined ? [] : [requireWarehouse(warehouseId)];
      if (warehouseId === undefined) {
        let page=1, total:number;
        do {
          const result=warehouses.list({page,pageSize:100,status:"active"});
          scope.push(...result.items);total=result.total;page++;
        } while(scope.length < total);
      }
      return scope.flatMap(warehouse => {
        const definitions = locations.listByWarehouse(warehouse.id);
        const stockable = definitions.filter(location => location.isStockable);
        if (stockable.length === 0) return [];
        const branch = branchOf(warehouse);
        const pathTo = createLocationPathResolver(definitions);
        return stockable.map(location => resolve(location, warehouse, branch, pathTo(location.id)))
          .filter(location => location.effectiveActive);
      });
    },
  };
}
