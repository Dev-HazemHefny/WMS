export interface WarehouseDirectory {
 branch(id:string,name:string):void;
 warehouse(id:string,branch:string,name:string):void;
 location(id:string,warehouse:string,name:string):void;
 directory():Record<string,string>[];
 places():Record<string,string>[];
}

// WarehouseDirectory preserves low-level legacy callers and historical fixtures.
// Runtime Inventory integration uses the mandatory validated gateway below.
export type {
  Branch, Warehouse, StorageLocation, DefinitionStatus, LocationType,
  LocationUsage, LocationPathEntry, ResolvedLocation,
} from "./domain/entities";
export type { LocationUsagePolicy } from "./domain/repositories";
export type { WarehouseServices } from "./application/create-warehouses";
export type { BranchInput, WarehouseInput, LocationInput } from "./application/context";
export type { WarehouseAccess, WarehousePermission } from "./application/ports";

export type LocationOperation = "receipt" | "issue" | "transfer" | "count" | "reversal";

/** Read-only Inventory port; every read joins the invoking write transaction. */
export interface WarehouseLocationPolicy {
  resolveLocation(id: string): import("./domain/entities").ResolvedLocation;
  assertLocationUsable(id: string, operation: LocationOperation): void;
  listStockableLocations(warehouseId?: string): readonly import("./domain/entities").ResolvedLocation[];
  /** Exact-location counting never expands descendants of a stockable parent. */
  countLocationIds(id: string): readonly string[];
}

/** Trusted Inventory integration. Actor IDs come from the invoking host/session. */
export interface InventoryWarehouseGateway extends WarehouseLocationPolicy {
  createBranch(actor: string, name: string): string;
  createWarehouse(actor: string, branchId: string, name: string): string;
  createLocation(actor: string, warehouseId: string, name: string): string;
  directory(): Record<string,string>[];
  places(): Record<string,string>[];
}
