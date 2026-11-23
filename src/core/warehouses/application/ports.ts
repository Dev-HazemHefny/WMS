import type { BranchRepository, LocationRepository, LocationUsagePolicy, WarehouseRepository } from "../domain/repositories";

export type WarehousePermission = "read" | "warehouse" | "warehouse.status" | "warehouse.reparent" | "warehouse.reassign";

/** Supplied by trusted host wiring, never taken from a request payload. */
export interface WarehouseAccess {
  currentActor(): string;
  authorize(actor: string, permission: WarehousePermission): void;
}

export interface WarehouseDependencies {
  branches: BranchRepository;
  warehouses: WarehouseRepository;
  locations: LocationRepository;
  usage: LocationUsagePolicy;
  access: WarehouseAccess;
  transaction: { run<T>(work: () => T): T };
  audit: { record(actor: string, action: string, target: string): void };
  clock: { nowIso(): string };
  ids: { next(): string };
}
