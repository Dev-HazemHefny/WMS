export type DefinitionStatus = "active" | "inactive";
export type LocationType = "zone" | "shelf" | "bin" | "other";

export interface Definition {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: DefinitionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface Branch extends Definition {
  readonly description: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly contactName: string | null;
}

export interface Warehouse extends Definition {
  readonly branchId: string;
  readonly description: string | null;
  readonly address: string | null;
}

export interface StorageLocation extends Definition {
  readonly warehouseId: string;
  readonly parentId: string | null;
  readonly locationType: LocationType;
  readonly isStockable: boolean;
  readonly isDefault: boolean;
}

/** Aggregate supplied by the Inventory-owned adapter for the requested scope. */
export interface LocationUsage {
  readonly hasPositiveStock: boolean;
  readonly hasMovements: boolean;
  readonly hasPendingDocuments: boolean;
  readonly hasCountLocks: boolean;
}

export interface LocationPathEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ResolvedLocation {
  readonly location: StorageLocation;
  readonly warehouse: Warehouse;
  readonly branch: Branch;
  readonly path: readonly LocationPathEntry[];
  readonly effectiveActive: boolean;
}
