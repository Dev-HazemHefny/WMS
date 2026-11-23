import type { z } from "zod";
import type * as S from "./schemas";

export type DefinitionStatus = "active" | "inactive";
export type LocationType = "zone" | "shelf" | "bin" | "other";
interface DefinitionDto {
  id: string; code: string; name: string; status: DefinitionStatus;
  createdAt: string; updatedAt: string; version: number;
}
export interface BranchDto extends DefinitionDto {
  description: string | null; address: string | null; phone: string | null; contactName: string | null;
}
export interface WarehouseDto extends DefinitionDto { branchId: string; description: string | null; address: string | null }
export interface StorageLocationDto extends DefinitionDto {
  warehouseId: string; parentId: string | null; locationType: LocationType; isStockable: boolean; isDefault: boolean;
}
export interface LocationPathDto { id: string; code: string; name: string }
export interface ResolvedLocationDto {
  location: StorageLocationDto; warehouse: WarehouseDto; branch: BranchDto;
  path: readonly LocationPathDto[]; effectiveActive: boolean;
}
export interface DefinitionPageDto<T> { items: readonly T[]; total: number; page: number; pageSize: number }
export interface BranchDetailsDto { branch: BranchDto; warehouses: readonly WarehouseDto[] }
export interface WarehouseDetailsDto { warehouse: WarehouseDto; branch: BranchDto; defaultLocation: StorageLocationDto }

export interface WarehouseManagementApi {
  branches: {
    create(input: z.input<typeof S.branchCreate>): Promise<BranchDto>;
    update(input: z.input<typeof S.branchUpdate>): Promise<BranchDto>;
    list(input: z.input<typeof S.branchList>): Promise<DefinitionPageDto<BranchDto>>;
    get(input: z.input<typeof S.idRequest>): Promise<BranchDetailsDto>;
    listWarehouses(input: z.input<typeof S.idRequest>): Promise<readonly WarehouseDto[]>;
    setStatus(input: z.input<typeof S.setStatus>): Promise<BranchDto>;
  };
  warehouses: {
    create(input: z.input<typeof S.warehouseCreate>): Promise<WarehouseDto>;
    update(input: z.input<typeof S.warehouseUpdate>): Promise<WarehouseDto>;
    list(input: z.input<typeof S.warehouseList>): Promise<DefinitionPageDto<WarehouseDto>>;
    get(input: z.input<typeof S.idRequest>): Promise<WarehouseDetailsDto>;
    reassign(input: z.input<typeof S.warehouseReassign>): Promise<WarehouseDto>;
    setStatus(input: z.input<typeof S.setStatus>): Promise<WarehouseDto>;
  };
  locations: {
    create(input: z.input<typeof S.locationCreate>): Promise<StorageLocationDto>;
    update(input: z.input<typeof S.locationUpdate>): Promise<StorageLocationDto>;
    list(input: z.input<typeof S.locationList>): Promise<DefinitionPageDto<StorageLocationDto>>;
    get(input: z.input<typeof S.idRequest>): Promise<ResolvedLocationDto>;
    tree(input: z.input<typeof S.locationTree>): Promise<readonly StorageLocationDto[]>;
    path(input: z.input<typeof S.idRequest>): Promise<readonly LocationPathDto[]>;
    stockable(input?: z.input<typeof S.stockableList>): Promise<readonly ResolvedLocationDto[]>;
    reparent(input: z.input<typeof S.locationReparent>): Promise<StorageLocationDto>;
    setStatus(input: z.input<typeof S.setStatus>): Promise<StorageLocationDto>;
  };
}
