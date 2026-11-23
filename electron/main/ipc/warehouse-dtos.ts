import type { Branch, Warehouse, StorageLocation, ResolvedLocation, LocationPathEntry } from "@core/warehouses/public";
import type { BranchDto, WarehouseDto, StorageLocationDto, ResolvedLocationDto, DefinitionPageDto } from "@shared/warehouses/types";

function definition(value: Branch | Warehouse | StorageLocation) {
  return { id:value.id,code:value.code,name:value.name,status:value.status,createdAt:value.createdAt,updatedAt:value.updatedAt,version:value.version };
}
export function branchDto(value: Branch): BranchDto {
  return { ...definition(value),description:value.description,address:value.address,phone:value.phone,contactName:value.contactName };
}
export function warehouseDto(value: Warehouse): WarehouseDto {
  return { ...definition(value),branchId:value.branchId,description:value.description,address:value.address };
}
export function locationDto(value: StorageLocation): StorageLocationDto {
  return { ...definition(value),warehouseId:value.warehouseId,parentId:value.parentId,locationType:value.locationType,isStockable:value.isStockable,isDefault:value.isDefault };
}
export function pathDto(path: readonly LocationPathEntry[]) { return path.map(value => ({id:value.id,code:value.code,name:value.name})); }
export function resolvedDto(value: ResolvedLocation): ResolvedLocationDto {
  return { location:locationDto(value.location),warehouse:warehouseDto(value.warehouse),branch:branchDto(value.branch),path:pathDto(value.path),effectiveActive:value.effectiveActive };
}
export function pageDto<T,R>(page: DefinitionPageDto<T>, map: (value:T)=>R): DefinitionPageDto<R> {
  return {items:page.items.map(map),total:page.total,page:page.page,pageSize:page.pageSize};
}
