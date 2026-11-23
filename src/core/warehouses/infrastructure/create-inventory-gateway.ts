import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { InventoryWarehouseGateway, LocationUsagePolicy } from "../public";
import { createWarehouseLocationPolicy } from "../application/location-policy";
import { createSqliteWarehouses } from "./create-sqlite-warehouses";
import { SqliteBranchRepository, SqliteLocationRepository, SqliteWarehouseRepository } from "./sqlite-repositories";

/** Composition must inject usage from Inventory on the same SQLite connection. */
export function createInventoryWarehouseGateway(db: Database.Database, authorize: (actor:string,permission:string)=>void, usage: LocationUsagePolicy): InventoryWarehouseGateway {
  const policy = createWarehouseLocationPolicy({
    branches:new SqliteBranchRepository(db),warehouses:new SqliteWarehouseRepository(db),locations:new SqliteLocationRepository(db),
  });
  function services(actor: string) {
    return createSqliteWarehouses(db,{usage,access:{currentActor:()=>actor,authorize}});
  }
  const code = (prefix:string) => prefix+"-"+randomUUID().replace(/-/g,"").slice(0,24).toUpperCase();
  return {
    ...policy,
    createBranch(actor,name) { return services(actor).createBranch({code:code("BR"),name}).id; },
    createWarehouse(actor,branchId,name) { return services(actor).createWarehouse({code:code("WH"),name,branchId}).id; },
    createLocation(actor,warehouseId,name) { return services(actor).createLocation({code:code("LOC"),name,warehouseId,locationType:"other",isStockable:true}).id; },
    directory() {
      return db.prepare("SELECT id,name,'branch' kind FROM branches UNION ALL SELECT id,name,'warehouse' kind FROM warehouses ORDER BY kind,name").all() as {id:string;name:string;kind:string}[];
    },
    places() {
      return policy.listStockableLocations().map(({location,warehouse,branch,path}) => ({
        id:location.id,name:location.name,warehouse:warehouse.name,branch:branch.name,
        warehouse_id:warehouse.id,branch_id:branch.id,path:path.map(node=>node.name).join(" / "),
      }));
    },
  };
}
