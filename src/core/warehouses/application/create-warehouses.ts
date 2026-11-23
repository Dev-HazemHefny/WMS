import { createBranchUseCases } from "./branches";
import { createWarehouseUseCases } from "./warehouses";
import { createLocationUseCases } from "./locations";
import { createWarehouseContext } from "./context";
import type { WarehouseDependencies } from "./ports";

export function createWarehouseServices(deps: WarehouseDependencies) {
  const context = createWarehouseContext(deps);
  return { ...createBranchUseCases(context), ...createWarehouseUseCases(context), ...createLocationUseCases(context) };
}
export type WarehouseServices = ReturnType<typeof createWarehouseServices>;
