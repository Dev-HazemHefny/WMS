import type { Branch, DefinitionStatus, LocationUsage, StorageLocation, Warehouse } from "./entities";

export interface DefinitionQuery {
  readonly search?: string;
  readonly status?: DefinitionStatus;
  readonly page: number;
  readonly pageSize: number;
}

export interface DefinitionPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Repository writes and policy reads must share the caller's transaction. */
export interface BranchRepository {
  findById(id: string): Branch | null;
  findByCode(code: string): Branch | null;
  findByName(name: string): Branch | null;
  list(query: DefinitionQuery): DefinitionPage<Branch>;
  insert(branch: Branch): void;
  update(branch: Branch, expectedVersion: number): boolean;
}

export interface WarehouseRepository {
  findById(id: string): Warehouse | null;
  findByCode(code: string): Warehouse | null;
  findByName(branchId: string, name: string): Warehouse | null;
  list(query: DefinitionQuery & { readonly branchId?: string }): DefinitionPage<Warehouse>;
  listByBranch(branchId: string): readonly Warehouse[];
  insert(warehouse: Warehouse): void;
  update(warehouse: Warehouse, expectedVersion: number): boolean;
}

export interface LocationRepository {
  findById(id: string): StorageLocation | null;
  findByCode(warehouseId: string, code: string): StorageLocation | null;
  findByName(warehouseId: string, name: string): StorageLocation | null;
  findDefault(warehouseId: string): StorageLocation | null;
  listByWarehouse(warehouseId: string): readonly StorageLocation[];
  listChildren(warehouseId: string, parentId: string | null): readonly StorageLocation[];
  insert(location: StorageLocation): void;
  update(location: StorageLocation, expectedVersion: number): boolean;
}

/** Implemented by Inventory infrastructure and injected at the Composition Root.
 * Summaries include source AND destination draft/review references and empty counts.
 * inspect aggregates exactly the requested IDs. Callers explicitly expand subtrees.
 */
export interface LocationUsagePolicy {
  inspect(locationIds: readonly string[]): LocationUsage;
  lockedLocationIds(locationIds: readonly string[]): ReadonlySet<string>;
}
