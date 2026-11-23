import { z } from "zod";
import type { WarehouseServices } from "@core/warehouses/public";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { WarehouseManagementApi } from "@shared/warehouses/types";
import type { SessionCapabilities } from "@shared/identity/types";
import * as S from "@shared/warehouses/schemas";
import { branchDto, warehouseDto, locationDto, resolvedDto, pathDto, pageDto } from "./warehouse-dtos";
import { bind } from "./dispatch";

type Channel = { [G in keyof typeof IPC_CHANNELS.warehouses]: typeof IPC_CHANNELS.warehouses[G][keyof typeof IPC_CHANNELS.warehouses[G]] }[keyof typeof IPC_CHANNELS.warehouses];
type Method<C extends Channel> = C extends `warehouses:${infer G extends keyof WarehouseManagementApi}:${infer M}`
  ? M extends keyof WarehouseManagementApi[G] ? WarehouseManagementApi[G][M] : never : never;
type Response<C extends Channel> = Method<C> extends (...args:never[])=>Promise<infer R> ? R : never;

export function registerWarehouseHandlers(servicesForWindow: (windowId:number)=>WarehouseServices, capabilities: (windowId:number)=>SessionCapabilities): void {
  function register<C extends Channel,S extends z.ZodTypeAny>(channel:C,schema:S,execute:(services:WarehouseServices,input:z.output<S>)=>Response<NoInfer<C>>) {
    bind(channel,schema,(input,windowId)=>execute(servicesForWindow(windowId),input));
  }
  const channels=IPC_CHANNELS.warehouses;
  register(channels.branches.create,S.branchCreate,(service,input)=>branchDto(service.createBranch(input)));
  register(channels.branches.update,S.branchUpdate,(service,{id,expectedVersion,...input})=>branchDto(service.updateBranch(id,input,expectedVersion)));
  register(channels.branches.list,S.branchList,(service,input)=>pageDto(service.listBranches(input),branchDto));
  register(channels.branches.get,S.idRequest,(service,{id})=>{
    const result=service.getBranchDetails(id);return {branch:branchDto(result.branch),warehouses:result.warehouses.map(warehouseDto)};
  });
  register(channels.branches.listWarehouses,S.idRequest,(service,{id})=>service.listBranchWarehouses(id).map(warehouseDto));
  register(channels.branches.setStatus,S.setStatus,(service,{id,status,expectedVersion})=>branchDto(service.setBranchStatus(id,status,expectedVersion)));

  register(channels.warehouses.create,S.warehouseCreate,(service,input)=>warehouseDto(service.createWarehouse(input)));
  register(channels.warehouses.update,S.warehouseUpdate,(service,{id,expectedVersion,...input})=>warehouseDto(service.updateWarehouse(id,input,expectedVersion)));
  register(channels.warehouses.list,S.warehouseList,(service,input)=>pageDto(service.listWarehouses(input),warehouseDto));
  register(channels.warehouses.get,S.idRequest,(service,{id})=>{
    const result=service.getWarehouseDetails(id);return {warehouse:warehouseDto(result.warehouse),branch:branchDto(result.branch),defaultLocation:locationDto(result.defaultLocation)};
  });
  register(channels.warehouses.reassign,S.warehouseReassign,(service,{id,branchId,expectedVersion})=>warehouseDto(service.reassignWarehouse(id,branchId,expectedVersion)));
  register(channels.warehouses.setStatus,S.setStatus,(service,{id,status,expectedVersion})=>warehouseDto(service.setWarehouseStatus(id,status,expectedVersion)));

  register(channels.locations.create,S.locationCreate,(service,input)=>locationDto(service.createLocation(input)));
  register(channels.locations.update,S.locationUpdate,(service,{id,expectedVersion,...input})=>locationDto(service.updateLocation(id,input,expectedVersion)));
  register(channels.locations.list,S.locationList,(service,{warehouseId,...input})=>pageDto(service.listLocations(warehouseId,input),locationDto));
  register(channels.locations.get,S.idRequest,(service,{id})=>resolvedDto(service.getLocationDetails(id)));
  register(channels.locations.tree,S.locationTree,(service,{warehouseId,parentId})=>service.getLocationTree(warehouseId,parentId).map(locationDto));
  register(channels.locations.path,S.idRequest,(service,{id})=>pathDto(service.getLocationPath(id)));
  register(channels.locations.stockable,S.stockableList,(service,{warehouseId})=>service.listStockableLocations(warehouseId).map(resolvedDto));
  register(channels.locations.reparent,S.locationReparent,(service,{id,parentId,expectedVersion})=>locationDto(service.reparentLocation(id,parentId,expectedVersion)));
  register(channels.locations.setStatus,S.setStatus,(service,{id,status,expectedVersion})=>locationDto(service.setLocationStatus(id,status,expectedVersion)));
  bind(IPC_CHANNELS.identity.capabilities,z.undefined(),(_,windowId)=>capabilities(windowId));
}
