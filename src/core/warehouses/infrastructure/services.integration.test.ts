import Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION, runMigrations, verifyDatabase } from "../../../../electron/main/database/migrations";
import { createSqliteIdentity } from "../../identity/infrastructure/create-sqlite-identity";
import { createSqliteLocationUsage } from "../../inventory/infrastructure/sqlite-location-usage";
import { createInventory } from "../../inventory/infrastructure/sqlite-inventory";
import { createStockCatalog } from "../../catalog/infrastructure/stock-catalog";
import { createSqliteCatalog } from "../../catalog/infrastructure/create-sqlite-catalog";
import { createSqliteWarehouses } from "./create-sqlite-warehouses";
import { createWarehouseDirectory } from "./sqlite-directory";
import { createInventoryWarehouseGateway } from "./create-inventory-gateway";
import { SqliteBranchRepository, SqliteLocationRepository, SqliteWarehouseRepository } from "./sqlite-repositories";
import type { StorageLocation } from "../domain/entities";

let db: Database.Database;
let identity: ReturnType<typeof createSqliteIdentity>;
let services: ReturnType<typeof createSqliteWarehouses>;
let usage: ReturnType<typeof createSqliteLocationUsage>;
let inventory: ReturnType<typeof createInventory>;
let branchId: string, warehouseId: string, item: string;
const allTables = ["branches","warehouses","locations","documents","document_items","movements","balances","count_locks","count_expected","reviewed_counts","receipts","audit"];
const stockTables = ["documents","document_items","movements","balances","count_locks","count_expected","reviewed_counts","receipts"];
function state(tables = allTables) {
  return Object.fromEntries(tables.map(table => [table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()]));
}
function rejected(work: () => unknown, code: string) {
  const before = state();
  expect(work).toThrow(expect.objectContaining({code}));
  expect(state()).toEqual(before);
}
function location(code: string, parentId: string | null = null, isStockable = true, wh = warehouseId) {
  return services.createLocation({warehouseId:wh,parentId,code,name:code,locationType:"bin",isStockable});
}
function receive(target: string, quantity = "10") {
  const document = inventory(identity.actor(1),{op:"draft",kind:"receipt",lines:[{item,location:target,quantity}]}).id!;
  inventory(identity.actor(1),{op:"post",document,version:1,command:"post/"+document});
  return document;
}
function setStatus(target: StorageLocation, status: "active" | "inactive") {
  return services.setLocationStatus(target.id,status,target.version);
}
beforeEach(async () => {
  db = new Database(":memory:");
  runMigrations(db);
  identity = createSqliteIdentity(db);
  await identity.login(1,"admin","test-password-123",true);
  usage = createSqliteLocationUsage(db);
  services = createSqliteWarehouses(db,{
    access:{currentActor:()=>identity.actor(1),authorize:identity.authorize},usage,
  });
  const catalog = createSqliteCatalog(db,{save:()=>"",read:()=>null,remove:()=>{}});
  const category = catalog.createCategory({name:"Category",code:"CAT"});
  const unit = catalog.createUnit({name:"Piece",symbol:"pc",dimension:"count"});
  const product = catalog.createProduct({name:"Product",sku:"PRODUCT",categoryId:category.id,baseUnitId:unit.id,productType:"simple",allowDecimalQuantity:true});
  item = "p:"+product.product.id;
  inventory = createInventory(db,identity.authorize,createStockCatalog(db),createInventoryWarehouseGateway(db,identity.authorize,usage),()=>{throw Error("unexpected repair")});
  branchId = services.createBranch({code:"BR",name:"Branch"}).id;
  warehouseId = services.createWarehouse({code:"WH",name:"Warehouse",branchId}).id;
});
afterEach(() => {
  try {
    expect(verifyDatabase(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
  } finally { db.close(); }
});

describe("branch and warehouse services", () => {
  it("normalizes and persists branch metadata with conditional edits and actor audit", () => {
    const branch = services.createBranch({code:" north ",name:" فرع الشمال ",phone:" 0123 ",description:"  "});
    expect(branch).toMatchObject({code:"NORTH",name:"فرع الشمال",phone:"0123",description:null,status:"active",version:1});
    const updated = services.updateBranch(branch.id,{code:"NORTH-2",name:"North two",address:" Address "},branch.version);
    expect(updated).toMatchObject({id:branch.id,version:2,address:"Address"});
    expect(services.getBranchDetails(branch.id).branch).toEqual(updated);
    expect(db.prepare("SELECT actor,action,target FROM audit WHERE target=? ORDER BY id").all(branch.id)).toEqual([
      {actor:identity.actor(1),action:"warehouse.branch.create",target:branch.id},
      {actor:identity.actor(1),action:"warehouse.branch.update",target:branch.id},
    ]);
    rejected(()=>services.updateBranch(branch.id,{code:"X",name:"Other"},1),"VERSION_CONFLICT");
  });
  it("rejects duplicate codes and names, including inactive definitions", () => {
    rejected(()=>services.createBranch({code:"br",name:"Other"}),"DUPLICATE_CODE");
    rejected(()=>services.createBranch({code:"OTHER",name:"Branch"}),"DUPLICATE_NAME");
    const unused = services.createBranch({code:"UNUSED",name:"Unused"});
    services.setBranchStatus(unused.id,"inactive",unused.version);
    rejected(()=>services.createBranch({code:"unused",name:"Another"}),"DUPLICATE_CODE");
    rejected(()=>services.createWarehouse({code:"wh",name:"Other",branchId}),"DUPLICATE_CODE");
    rejected(()=>services.createWarehouse({code:"OTHER",name:"Warehouse",branchId}),"DUPLICATE_NAME");
  });
  it("deactivates and reactivates branch/warehouse/default without cascading branch activation", () => {
    rejected(()=>services.setBranchStatus(branchId,"inactive",1),"ACTIVE_CHILDREN");
    services.setWarehouseStatus(warehouseId,"inactive",1);
    services.setBranchStatus(branchId,"inactive",1);
    rejected(()=>services.setWarehouseStatus(warehouseId,"active",2),"BRANCH_INACTIVE");
    services.setBranchStatus(branchId,"active",2);
    expect(services.getWarehouseDetails(warehouseId).warehouse.status).toBe("inactive");
    const active = services.setWarehouseStatus(warehouseId,"active",2);
    expect(active.version).toBe(3);
    expect(services.getWarehouseDetails(warehouseId).defaultLocation.status).toBe("active");
    expect(services.listBranchWarehouses(branchId).map(w=>w.id)).toEqual([warehouseId]);
  });
  it("creates a warehouse and one default atomically and rejects missing/inactive branches", () => {
    const details = services.getWarehouseDetails(warehouseId);
    expect(details.defaultLocation).toMatchObject({warehouseId,parentId:null,isDefault:true,isStockable:true,status:"active"});
    rejected(()=>services.createWarehouse({code:"MISSING",name:"Missing",branchId:"missing"}),"BRANCH_NOT_FOUND");
    const inactive = services.createBranch({code:"INACTIVE",name:"Inactive"});
    services.setBranchStatus(inactive.id,"inactive",1);
    rejected(()=>services.createWarehouse({code:"INACTIVE",name:"Inactive",branchId:inactive.id}),"BRANCH_INACTIVE");
    const before = state();
    db.exec("CREATE TEMP TRIGGER reject_default BEFORE INSERT ON locations WHEN NEW.is_default=1 BEGIN SELECT RAISE(ABORT,'default failed'); END;");
    expect(()=>services.createWarehouse({code:"FAIL",name:"Fail",branchId})).toThrow("default failed");
    expect(state()).toEqual(before);
  });
  it("updates warehouse metadata without changing branch identity and checks versions", () => {
    const updated = services.updateWarehouse(warehouseId,{code:"WH-2",name:"Warehouse two",description:" Description "},1);
    expect(updated).toMatchObject({branchId,description:"Description",version:2});
    rejected(()=>services.updateWarehouse(warehouseId,{code:"STALE",name:"Stale"},1),"VERSION_CONFLICT");
  });
  it("rejects stock, pending transfer destinations and empty count locks on warehouse deactivation", () => {
    const defaultId = services.getWarehouseDetails(warehouseId).defaultLocation.id;
    const sourceWarehouse = services.createWarehouse({code:"SOURCE",name:"Source",branchId});
    const source = services.getWarehouseDetails(sourceWarehouse.id).defaultLocation.id;
    const document = inventory(identity.actor(1),{op:"draft",kind:"transfer",lines:[{item,location:source,destination:defaultId,quantity:"1"}]}).id!;
    rejected(()=>services.setWarehouseStatus(warehouseId,"inactive",1),"PENDING_DOCUMENTS");
    inventory(identity.actor(1),{op:"cancel",document,version:1});
    const count = inventory(identity.actor(1),{op:"count",location:defaultId}).id!;
    expect(db.prepare("SELECT lines FROM documents WHERE id=?").pluck().get(count)).toBe("[]");
    rejected(()=>services.setWarehouseStatus(warehouseId,"inactive",1),"COUNT_ACTIVE");
    inventory(identity.actor(1),{op:"cancel",document:count,version:1});
    receive(defaultId);
    rejected(()=>services.setWarehouseStatus(warehouseId,"inactive",1),"STOCK_EXISTS");
  });
  it("permits only unused inactive warehouse reassignment and rejects permanent movement history", () => {
    const next = services.createBranch({code:"NEXT",name:"Next"});
    rejected(()=>services.reassignWarehouse(warehouseId,next.id,1),"WAREHOUSE_ACTIVE");
    services.setWarehouseStatus(warehouseId,"inactive",1);
    const reassigned = services.reassignWarehouse(warehouseId,next.id,2);
    expect(reassigned).toMatchObject({id:warehouseId,branchId:next.id,version:3});
    services.setWarehouseStatus(warehouseId,"active",3);
    const defaultId = services.getWarehouseDetails(warehouseId).defaultLocation.id;
    const receipt = receive(defaultId);
    inventory(identity.actor(1),{op:"reverse",document:receipt,command:"reverse"});
    services.setWarehouseStatus(warehouseId,"inactive",4);
    rejected(()=>services.reassignWarehouse(warehouseId,branchId,5),"HISTORY_EXISTS");
  });
  it("uses literal paginated search and status/branch filters", () => {
    services.createBranch({code:"SECOND",name:"100% branch"});
    services.createBranch({code:"THIRD",name:"Third"});
    expect(services.listBranches({page:1,pageSize:1}).total).toBe(3);
    expect(services.listBranches({page:2,pageSize:1}).items).toHaveLength(1);
    expect(services.listBranches({page:1,pageSize:25,search:"%"}).items.map(b=>b.code)).toEqual(["SECOND"]);
    expect(services.listWarehouses({page:1,pageSize:10,branchId}).items.map(w=>w.id)).toEqual([warehouseId]);
    rejected(()=>services.listBranches({page:0,pageSize:10}),"INVALID_PAGE");
  });
});

describe("location services and usage policies", () => {
  it("creates organizational roots and stockable descendants with typed paths, tree levels and filters", () => {
    const root = location("ZONE",null,false);
    const bin = location("BIN",root.id);
    expect(services.getLocationDetails(bin.id)).toMatchObject({effectiveActive:true,location:{isStockable:true,isDefault:false}});
    expect(services.getLocationPath(bin.id).map(l=>l.id)).toEqual([root.id,bin.id]);
    expect(services.getLocationTree(warehouseId,root.id).map(l=>l.id)).toEqual([bin.id]);
    expect(services.listLocations(warehouseId,{page:1,pageSize:10,search:"BIN"}).items).toEqual([bin]);
    expect(services.listStockableLocations(warehouseId).map(l=>l.location.id)).toContain(bin.id);
    expect(services.listStockableLocations(warehouseId).map(l=>l.location.id)).not.toContain(root.id);
    expect(services.listStockableLocations().map(l=>l.location.id)).toContain(bin.id);
    const updated=services.updateLocation(bin.id,{code:"BIN-2",name:"Changed",locationType:"other"},1);
    expect(updated).toMatchObject({id:bin.id,parentId:root.id,warehouseId,version:2});
    rejected(()=>services.createLocation({warehouseId,code:"bin-2",name:"Unique",locationType:"bin"}),"DUPLICATE_CODE");
    rejected(()=>services.createLocation({warehouseId,code:"UNIQUE",name:"Changed",locationType:"bin"}),"DUPLICATE_NAME");
  });
  it("traverses a hierarchy deeper than the former category limit without recursion", () => {
    let parent: string|null=null;
    for(let i=0;i<125;i++) parent=location("DEEP-"+i,parent,false).id;
    expect(services.getLocationPath(parent!)).toHaveLength(125);
  });
  it("rejects missing, foreign, cyclic and inactive parents before writes", () => {
    const root=location("ROOT");
    const child=location("CHILD",root.id);
    rejected(()=>services.reparentLocation(root.id,child.id,1),"LOCATION_CYCLE");
    rejected(()=>location("MISSING","missing"),"LOCATION_NOT_FOUND");
    const otherWarehouse=services.createWarehouse({code:"OTHER",name:"Other",branchId});
    const foreign=location("FOREIGN",null,true,otherWarehouse.id);
    rejected(()=>location("INVALID",foreign.id),"PARENT_WAREHOUSE_MISMATCH");
    rejected(()=>services.reparentLocation(root.id,foreign.id,1),"PARENT_WAREHOUSE_MISMATCH");
    setStatus(child,"inactive");setStatus(root,"inactive");
    rejected(()=>location("INACTIVE",root.id),"LOCATION_INACTIVE");
    rejected(()=>services.setLocationStatus(child.id,"active",2),"LOCATION_INACTIVE");
  });
  it("reparents a stocked location preserving its IDs and every stock/history row", () => {
    const source=location("SOURCE"),parent=location("PARENT",null,false);
    receive(source.id,"9007199254740.993");
    const before=state(stockTables);
    const moved=services.reparentLocation(source.id,parent.id,1);
    expect(moved).toMatchObject({id:source.id,warehouseId,parentId:parent.id,version:2});
    expect(state(stockTables)).toEqual(before);
    expect(inventory(identity.actor(1),{op:"reconcile"}).rows).toEqual([]);
    rejected(()=>services.reparentLocation(source.id,null,1),"VERSION_CONFLICT");
  });
  it("blocks hierarchy and descriptive changes for moved descendants and old/new ancestor count locks", () => {
    const root=location("ROOT"),source=location("SOURCE",root.id),child=location("CHILD",source.id),parent=location("PARENT");
    for(const target of [root,source,child,parent]){
      const count=inventory(identity.actor(1),{op:"count",location:target.id}).id!;
      rejected(()=>services.reparentLocation(source.id,parent.id,1),"COUNT_ACTIVE");
      inventory(identity.actor(1),{op:"cancel",document:count,version:1});
    }
    const count=inventory(identity.actor(1),{op:"count",location:child.id}).id!;
    rejected(()=>services.updateLocation(source.id,{code:"SOURCE",name:"New",locationType:"bin"},1),"COUNT_ACTIVE");
    rejected(()=>services.updateWarehouse(warehouseId,{code:"WH",name:"New"},1),"COUNT_ACTIVE");
    rejected(()=>services.updateBranch(branchId,{code:"BR",name:"New"},1),"COUNT_ACTIVE");
    inventory(identity.actor(1),{op:"cancel",document:count,version:1});
  });
  it("enforces subtree lifecycle blockers and protects default/status/stockability", () => {
    const root=location("ROOT",null,false),child=location("CHILD",root.id);
    rejected(()=>setStatus(root,"inactive"),"ACTIVE_CHILDREN");
    receive(child.id);
    rejected(()=>setStatus(root,"inactive"),"STOCK_EXISTS");
    rejected(()=>setStatus(child,"inactive"),"STOCK_EXISTS");
    rejected(()=>services.updateLocation(child.id,{code:child.code,name:child.name,locationType:"zone",isStockable:false},1),"STOCK_EXISTS");
    const defaultLocation=services.getWarehouseDetails(warehouseId).defaultLocation;
    rejected(()=>setStatus(defaultLocation,"inactive"),"DEFAULT_LOCATION_PROTECTED");
    rejected(()=>services.reparentLocation(defaultLocation.id,root.id,1),"DEFAULT_LOCATION_PROTECTED");
    rejected(()=>services.updateLocation(defaultLocation.id,{code:defaultLocation.code,name:defaultLocation.name,locationType:"zone",isStockable:false},1),"DEFAULT_LOCATION_PROTECTED");
  });
  it("prevents removing stockability after movement history even at zero balance", () => {
    const bin=location("BIN");
    const receipt=receive(bin.id);
    inventory(identity.actor(1),{op:"reverse",document:receipt,command:"reverse"});
    rejected(()=>services.updateLocation(bin.id,{code:"BIN",name:"BIN",locationType:"zone",isStockable:false},1),"HISTORY_EXISTS");
    expect(setStatus(bin,"inactive").status).toBe("inactive");
  });
  it("deactivates and reactivates empty locations and rejects warehouse deactivation with active children", () => {
    const bin=location("BIN");
    rejected(()=>services.setWarehouseStatus(warehouseId,"inactive",1),"ACTIVE_CHILDREN");
    const inactive=setStatus(bin,"inactive");
    expect(services.listLocations(warehouseId,{page:1,pageSize:10,status:"inactive"}).items).toEqual([inactive]);
    expect(services.listStockableLocations().map(l=>l.location.id)).not.toContain(bin.id);
    services.setWarehouseStatus(warehouseId,"inactive",1);
    rejected(()=>services.setLocationStatus(bin.id,"active",inactive.version),"WAREHOUSE_INACTIVE");
    services.setWarehouseStatus(warehouseId,"active",2);
    expect(services.setLocationStatus(bin.id,"active",inactive.version).version).toBe(3);
  });
  it("detects transfer destinations and count locks with empty lines using read-only queries", () => {
    const source=location("SOURCE"),destination=location("DESTINATION");
    const transfer=inventory(identity.actor(1),{op:"draft",kind:"transfer",lines:[{item,location:source.id,destination:destination.id,quantity:"1"}]}).id!;
    const before=state();
    const changes=db.prepare("SELECT total_changes()").pluck().get();
    expect(usage.inspect([destination.id])).toMatchObject({hasPendingDocuments:true,hasPositiveStock:false,hasMovements:false,hasCountLocks:false});
    expect(usage.inspect(["absent"])).toEqual({hasPendingDocuments:false,hasPositiveStock:false,hasMovements:false,hasCountLocks:false});
    expect(usage.lockedLocationIds([])).toEqual(new Set());
    expect(db.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
    expect(state()).toEqual(before);
    rejected(()=>setStatus(destination,"inactive"),"PENDING_DOCUMENTS");
    inventory(identity.actor(1),{op:"cancel",document:transfer,version:1});
    inventory(identity.actor(1),{op:"count",location:destination.id});
    expect(usage.inspect([destination.id])).toMatchObject({hasPendingDocuments:false,hasCountLocks:true});
    expect(usage.lockedLocationIds([source.id,destination.id])).toEqual(new Set([destination.id]));
    const count=db.prepare("SELECT document FROM count_locks WHERE location=?").pluck().get(destination.id) as string;
    inventory(identity.actor(1),{op:"edit",document:count,version:1,lines:[{item,location:destination.id,quantity:"0"}]});
    inventory(identity.actor(1),{op:"review",document:count,version:2});
    expect(usage.inspect([destination.id])).toMatchObject({hasPendingDocuments:true,hasCountLocks:true});
  });
  it("aggregates descendant usage without expanding an exact-location query", () => {
    const root=location("ROOT",null,false),child=location("CHILD",root.id);
    receive(child.id);
    expect(usage.inspect([root.id]).hasPositiveStock).toBe(false);
    expect(usage.inspect([root.id,child.id])).toMatchObject({hasPositiveStock:true,hasMovements:true});
  });
});

describe("transaction, concurrency, authorization and compatibility", () => {
  it("rolls back entity writes and default updates if audit persistence fails", () => {
    db.exec("CREATE TEMP TRIGGER reject_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
    const before=state();
    expect(()=>services.createBranch({code:"FAIL",name:"Fail"})).toThrow("audit failed");
    expect(state()).toEqual(before);
    expect(()=>services.setWarehouseStatus(warehouseId,"inactive",1)).toThrow("audit failed");
    expect(state()).toEqual(before);
  });
  it("translates conditional update failures to VERSION_CONFLICT and rolls back prior writes", () => {
    db.exec("CREATE TEMP TRIGGER reject_update BEFORE UPDATE ON warehouses BEGIN SELECT RAISE(IGNORE); END;");
    rejected(()=>services.setWarehouseStatus(warehouseId,"inactive",1),"VERSION_CONFLICT");
  });
  it("repositories condition updates on versions and never expose delete operations", () => {
    const branchRepo=new SqliteBranchRepository(db),warehouseRepo=new SqliteWarehouseRepository(db),locationRepo=new SqliteLocationRepository(db);
    const branch=branchRepo.findById(branchId)!;
    expect(branchRepo.update({...branch,name:"Stale",version:10},10)).toBe(false);
    expect(warehouseRepo.update({...warehouseRepo.findById(warehouseId)!,version:10},10)).toBe(false);
    const bin=locationRepo.findDefault(warehouseId)!;
    expect(locationRepo.update({...bin,version:10},10)).toBe(false);
    expect(branchRepo.findById(branchId)).toEqual(branch);
    expect(locationRepo.findById(bin.id)?.isStockable).toBe(true);
    expect("delete" in branchRepo || "delete" in warehouseRepo || "delete" in locationRepo).toBe(false);
  });
  it("resolves current sessions inside the service boundary and rejects denied permissions without effects", async () => {
    const bin=location("BIN");
    await identity.addOperator(1,"clerk","clerk-password-123",["clerk"]);
    await identity.login(1,"clerk","clerk-password-123",false);
    expect(services.getWarehouseDetails(warehouseId).warehouse.id).toBe(warehouseId);
    rejected(()=>services.createBranch({code:"DENIED",name:"Denied"}),"FORBIDDEN");
    rejected(()=>services.setLocationStatus(bin.id,"inactive",1),"FORBIDDEN");
    rejected(()=>services.reparentLocation(bin.id,null,1),"FORBIDDEN");
    rejected(()=>services.reassignWarehouse(warehouseId,branchId,1),"FORBIDDEN");
    identity.end(1);
    rejected(()=>services.getBranchDetails(branchId),"AUTH_REQUIRED");
    rejected(()=>services.updateBranch(branchId,{code:"BR",name:"Other"},1),"AUTH_REQUIRED");
  });
  it("retains the authenticated legacy directory path and its single audit event", () => {
    const before=db.prepare("SELECT count(*) FROM audit").pluck().get() as number;
    const id=inventory(identity.actor(1),{op:"warehouse",branch:branchId,name:"Legacy"}).id!;
    expect(createWarehouseDirectory(db).places().some(row=>row.warehouse_id===id)).toBe(true);
    expect(services.getWarehouseDetails(id).defaultLocation.isDefault).toBe(true);
    expect(db.prepare("SELECT count(*) FROM audit").pluck().get()).toBe(before+1);
  });
  it("separates definition management permissions from status, reparent and reassignment", async () => {
    await identity.addOperator(1,"manager","manager-password-123",["clerk"]);
    db.prepare("INSERT INTO permissions VALUES('clerk','warehouse')").run();
    await identity.login(1,"manager","manager-password-123",false);
    const branch=services.createBranch({code:"MANAGED",name:"Managed"});
    expect(db.prepare("SELECT actor FROM audit WHERE target=?").pluck().get(branch.id)).toBe(identity.actor(1));
    rejected(()=>services.setBranchStatus(branch.id,"inactive",1),"FORBIDDEN");
    const bin=location("BIN");
    rejected(()=>services.reparentLocation(bin.id,null,1),"FORBIDDEN");
    rejected(()=>services.reassignWarehouse(warehouseId,branch.id,1),"FORBIDDEN");
  });
});
