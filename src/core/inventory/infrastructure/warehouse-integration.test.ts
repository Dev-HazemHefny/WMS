import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase, closeDatabase } from "../../../../electron/main/database";
import { CURRENT_SCHEMA_VERSION, verifyDatabase } from "../../../../electron/main/database/migrations";
import { createSqliteIdentity } from "../../identity/infrastructure/create-sqlite-identity";
import { createSqliteWarehouses } from "../../warehouses/infrastructure/create-sqlite-warehouses";
import { createInventoryWarehouseGateway } from "../../warehouses/infrastructure/create-inventory-gateway";
import { createSqliteCatalog } from "../../catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "../../catalog/infrastructure/stock-catalog";
import { createSqliteLocationUsage } from "./sqlite-location-usage";
import { createInventory } from "./sqlite-inventory";
import type { StockCommand } from "../../../shared/ipc/stock";

let root:string, db:Database.Database, item:string, branchId:string, warehouseId:string, source:string, destination:string, cross:string;
let identity:ReturnType<typeof createSqliteIdentity>;
let services:ReturnType<typeof createSqliteWarehouses>;
let gateway:ReturnType<typeof createInventoryWarehouseGateway>;
let execute:ReturnType<typeof createInventory>;
const tables=["branches","warehouses","locations","documents","document_items","movements","balances","count_locks","count_expected","reviewed_counts","receipts","audit"];
function open() {
  db=initializeDatabase(root);
  identity=createSqliteIdentity(db);
  const usage=createSqliteLocationUsage(db);
  services=createSqliteWarehouses(db,{usage,access:{currentActor:()=>identity.actor(1),authorize:identity.authorize}});
  gateway=createInventoryWarehouseGateway(db,identity.authorize,usage);
  execute=createInventory(db,identity.authorize,createStockCatalog(db),gateway,()=>{throw Error("unexpected repair")});
}
function state(selected=tables) {return Object.fromEntries(selected.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()]));}
const cmd=(command:StockCommand)=>execute(identity.actor(1),command);
function rejected(work:()=>unknown,code:string){const before=state();expect(work).toThrow(expect.objectContaining({code}));expect(state()).toEqual(before);}
function draft(kind:"receipt"|"issue"|"transfer",location=source,quantity="10",target?:string){
  return cmd({op:"draft",kind,lines:[{item,location,quantity,...(target?{destination:target}:{})}]}).id!;
}
const post=(document:string,version=1)=>cmd({op:"post",document,version,command:"post/"+document});
function receive(location=source,quantity="10"){const id=draft("receipt",location,quantity);post(id);return id;}
beforeEach(async()=>{
  root=mkdtempSync(join(tmpdir(),"wms-stage5-"));open();
  await identity.login(1,"admin","test-password-123",true);
  const catalog=createSqliteCatalog(db,{save:()=>"",read:()=>null,remove:()=>{}});
  const category=catalog.createCategory({code:"CAT",name:"Category"});
  const unit=catalog.createUnit({name:"Piece",symbol:"pc",dimension:"count"});
  item="p:"+catalog.createProduct({name:"Product",sku:"SKU",productType:"simple",categoryId:category.id,baseUnitId:unit.id,allowDecimalQuantity:true}).product.id;
  branchId=services.createBranch({code:"BR",name:"Branch"}).id;
  warehouseId=services.createWarehouse({code:"WH",name:"Warehouse",branchId}).id;
  source=services.createLocation({code:"SOURCE",name:"Source",locationType:"bin",warehouseId}).id;
  destination=services.createLocation({code:"DEST",name:"Destination",locationType:"bin",warehouseId}).id;
  const other=services.createWarehouse({code:"CROSS",name:"Cross warehouse",branchId}).id;
  cross=services.getWarehouseDetails(other).defaultLocation.id;
});
afterEach(()=>{
  try{
    expect(verifyDatabase(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    expect(db.pragma("journal_mode",{simple:true})).toBe("wal");
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(cmd({op:"reconcile"}).rows).toEqual([]);
  }finally{closeDatabase();rmSync(root,{recursive:true,force:true})}
});

it.each([
  ["location", "LOCATION_INACTIVE"],
  ["stockable", "LOCATION_NOT_STOCKABLE"],
  ["warehouse", "WAREHOUSE_INACTIVE"],
  ["branch", "BRANCH_INACTIVE"],
] as const)("rejects receipt, issue and count starts for invalid %s eligibility without writes",(scenario,error)=>{
  // Fixture-only SQL simulates stale/imported data which application lifecycle guards prevent.
  if(scenario==="location")db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  if(scenario==="stockable")db.prepare("UPDATE locations SET is_stockable=0 WHERE id=?").run(source);
  if(scenario==="warehouse")db.prepare("UPDATE warehouses SET status='inactive' WHERE id=?").run(warehouseId);
  if(scenario==="branch")db.prepare("UPDATE branches SET status='inactive' WHERE id=?").run(branchId);
  rejected(()=>draft("receipt"),error);
  rejected(()=>draft("issue"),error);
  rejected(()=>cmd({op:"count",location:source}),error);
});

it("blocks inactive ancestors and prepares eligible typed paths while retaining historical resolution",()=>{
  const parent=services.createLocation({code:"ZONE",name:"Zone",locationType:"zone",warehouseId}).id;
  services.reparentLocation(source,parent,1);
  expect(gateway.listStockableLocations().find(row=>row.location.id===source)).toMatchObject({effectiveActive:true,warehouse:{id:warehouseId},branch:{id:branchId},path:[{id:parent,name:"Zone"},{id:source,name:"Source"}]});
  expect(cmd({op:"places"}).rows?.find(row=>row.id===source)).toMatchObject({warehouse_id:warehouseId,branch_id:branchId,path:"Zone / Source"});
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(parent);
  rejected(()=>draft("receipt"),"LOCATION_INACTIVE");
  expect(gateway.resolveLocation(source).effectiveActive).toBe(false);
  expect(cmd({op:"places"}).rows?.some(row=>row.id===source)).toBe(false);
});

it("supports internal and cross-warehouse transfers, atomic eligibility rejection and negative-stock prevention",()=>{
  receive();
  const internal=draft("transfer",source,"4",destination);post(internal);
  const external=draft("transfer",destination,"3",cross);post(external);
  const issue=draft("issue",cross,"1");post(issue);
  expect(cmd({op:"balances"}).rows).toEqual(expect.arrayContaining([
    {item,location:source,thousandths:"6000"},{item,location:destination,thousandths:"1000"},{item,location:cross,thousandths:"2000"},
  ]));
  const excess=draft("issue",source,"7");rejected(()=>post(excess),"INSUFFICIENT_STOCK");
  rejected(()=>draft("transfer",source,"1",source),"INVALID_DESTINATION");
  rejected(()=>draft("transfer","missing","1",destination),"LOCATION_NOT_FOUND");
  rejected(()=>draft("transfer",source,"1","missing"),"LOCATION_NOT_FOUND");
});

it.each(["source","destination","organizational"] as const)("revalidates a transfer's %s before creating either movement",scenario=>{
  receive();
  const document=draft("transfer",source,"1",destination);
  if(scenario==="source")db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  else if(scenario==="destination")db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(destination);
  else db.prepare("UPDATE locations SET is_stockable=0 WHERE id=?").run(destination);
  rejected(()=>post(document),scenario==="organizational"?"LOCATION_NOT_STOCKABLE":"LOCATION_INACTIVE");
  expect(db.prepare("SELECT state FROM documents WHERE id=?").pluck().get(document)).toBe("draft");
});

it("revalidates changed draft lines and rejects posting a previously valid inactive receipt or issue",()=>{
  const receipt=draft("receipt");
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  rejected(()=>post(receipt),"LOCATION_INACTIVE");
  rejected(()=>cmd({op:"edit",document:receipt,version:1,lines:[{item,location:source,quantity:"2"}]}),"LOCATION_INACTIVE");
  cmd({op:"edit",document:receipt,version:1,lines:[{item,location:destination,quantity:"2"}]});
  rejected(()=>post(receipt),"VERSION_CONFLICT");post(receipt,2);
  const issue=draft("issue",destination,"1");
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(destination);
  rejected(()=>post(issue),"LOCATION_INACTIVE");
});

it("returns committed results after reparenting, metadata changes, deactivation and restart",async()=>{
  const receipt=receive();
  post(draft("issue",source,"10"));
  services.reparentLocation(source,destination,1);
  services.updateWarehouse(warehouseId,{code:"WH",name:"Changed name"},1);
  services.setLocationStatus(source,"inactive",2);
  const before=state();
  expect(post(receipt)).toEqual({id:receipt});expect(state()).toEqual(before);
  rejected(()=>cmd({op:"post",document:receipt,version:2,command:"post/"+receipt}),"COMMAND_CONFLICT");
  closeDatabase();open();await identity.login(1,"admin","test-password-123",false);
  expect(post(receipt)).toEqual({id:receipt});expect(state()).toEqual(before);
  expect(cmd({op:"history",item}).rows?.some(row=>row.document===receipt)).toBe(true);
  expect(cmd({op:"details",document:receipt}).rows?.[0].location).toBe(source);
  expect(gateway.resolveLocation(source)).toMatchObject({effectiveActive:false,location:{id:source,warehouseId}});
});

it("counts exactly a stockable parent's balance and permits independent child movements",()=>{
  const child=services.createLocation({code:"CHILD",name:"Child",locationType:"bin",warehouseId,parentId:source}).id;
  receive(source,"10");receive(child,"5");
  const count=cmd({op:"count",location:source}).id!;
  expect(db.prepare("SELECT location FROM count_locks").all()).toEqual([{location:source}]);
  expect(db.prepare("SELECT item,CAST(expected AS TEXT) expected FROM count_expected WHERE document=?").all(count)).toEqual([{item,expected:"10000"}]);
  receive(child,"3");
  const blocked=draft("issue",source,"1");rejected(()=>post(blocked),"LOCATION_LOCKED");
  const blockedDestination=draft("transfer",child,"1",source);
  rejected(()=>post(blockedDestination),"LOCATION_LOCKED");
  rejected(()=>cmd({op:"edit",document:count,version:1,lines:[{item,location:child,quantity:"9"}]}),"INVALID_COUNT_LINE");
  cmd({op:"edit",document:count,version:1,lines:[{item,location:source,quantity:"9"}]});
  cmd({op:"review",document:count,version:2});post(count,3);
  expect(cmd({op:"balances"}).rows).toEqual(expect.arrayContaining([{item,location:source,thousandths:"9000"},{item,location:child,thousandths:"8000"}]));
  expect(db.prepare("SELECT location,delta FROM movements WHERE document=?").all(count)).toEqual([{location:source,delta:-1000}]);
  expect(db.prepare("SELECT 1 FROM count_locks").get()).toBeUndefined();
});

it("validates an empty count on review and posting, preserving state and lock on failure",()=>{
  const count=cmd({op:"count",location:source}).id!;
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  rejected(()=>cmd({op:"review",document:count,version:1}),"LOCATION_INACTIVE");
  db.prepare("UPDATE locations SET status='active' WHERE id=?").run(source);
  cmd({op:"review",document:count,version:1});
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  rejected(()=>post(count,2),"LOCATION_INACTIVE");
  expect(db.prepare("SELECT state,version FROM documents WHERE id=?").get(count)).toEqual({state:"review",version:2});
  expect(db.prepare("SELECT location FROM count_locks WHERE document=?").pluck().get(count)).toBe(source);
  cmd({op:"cancel",document:count,version:2});
  expect(db.prepare("SELECT 1 FROM count_locks").get()).toBeUndefined();
});

it("retains reviewed quantities and the lock across failed count posting until reactivation",()=>{
  receive();
  const count=cmd({op:"count",location:source}).id!;
  cmd({op:"edit",document:count,version:1,lines:[{item,location:source,quantity:"9"}]});
  cmd({op:"review",document:count,version:2});
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  rejected(()=>post(count,3),"LOCATION_INACTIVE");
  expect(db.prepare("SELECT CAST(base AS TEXT) base FROM reviewed_counts WHERE document=?").pluck().get(count)).toBe("9000");
  db.prepare("UPDATE locations SET status='active' WHERE id=?").run(source);
  post(count,3);
  expect(cmd({op:"balances"}).rows).toEqual([{item,location:source,thousandths:"9000"}]);
});

it("validates zero-variance reversal references even when the count produced no movements",()=>{
  const count=cmd({op:"count",location:source}).id!;
  cmd({op:"edit",document:count,version:1,lines:[{item,location:source,quantity:"0"}]});
  cmd({op:"review",document:count,version:2});post(count,3);
  expect(db.prepare("SELECT 1 FROM movements WHERE document=?").get(count)).toBeUndefined();
  services.setLocationStatus(source,"inactive",1);
  rejected(()=>cmd({op:"reverse",document:count,command:"zero-count-reversal"}),"LOCATION_INACTIVE");
});

it("runs Warehouse validation inside the existing Inventory write transaction",()=>{
  const validate=jest.fn((id:string,op:Parameters<typeof gateway.assertLocationUsable>[1])=>{
    expect(db.inTransaction).toBe(true);gateway.assertLocationUsable(id,op);
  });
  execute=createInventory(db,identity.authorize,createStockCatalog(db),{...gateway,assertLocationUsable:validate},()=>{throw Error("unexpected repair")});
  receive();
  expect(validate).toHaveBeenCalledWith(source,"receipt");
  expect(validate).toHaveBeenCalledTimes(2);
});

it("requires reactivation for reversal, retains original movements, and retries an inactive reversal safely",()=>{
  const original=receive();
  const movements=db.prepare("SELECT * FROM movements WHERE document=?").safeIntegers().all(original);
  db.prepare("UPDATE locations SET status='inactive' WHERE id=?").run(source);
  const reverse=()=>cmd({op:"reverse",document:original,command:"reverse/"+original});
  rejected(reverse,"LOCATION_INACTIVE");
  services.setLocationStatus(source,"active",1);
  const reversal=reverse();
  expect(db.prepare("SELECT original FROM documents WHERE id=?").pluck().get(reversal.id)).toBe(original);
  expect(db.prepare("SELECT * FROM movements WHERE document=?").safeIntegers().all(original)).toEqual(movements);
  services.setLocationStatus(source,"inactive",2);
  const before=state();expect(reverse()).toEqual(reversal);expect(state()).toEqual(before);
  rejected(()=>draft("receipt"),"LOCATION_INACTIVE");
});

it("keeps legacy management authorized, lifecycle-validated and audited exactly once",async()=>{
  const auditBefore=db.prepare("SELECT count(*) FROM audit").pluck().get() as number;
  const legacy=cmd({op:"warehouse",branch:branchId,name:"Legacy warehouse"}).id!;
  expect(db.prepare("SELECT count(*) FROM audit").pluck().get()).toBe(auditBefore+1);
  expect(services.getWarehouseDetails(legacy).defaultLocation).toMatchObject({isDefault:true,isStockable:true,parentId:null});
  services.setWarehouseStatus(legacy,"inactive",1);
  rejected(()=>cmd({op:"location",warehouse:legacy,name:"Forbidden child"}),"WAREHOUSE_INACTIVE");
  const inactiveBranch=services.createBranch({code:"INACTIVE",name:"Inactive"});
  services.setBranchStatus(inactiveBranch.id,"inactive",1);
  rejected(()=>cmd({op:"warehouse",branch:inactiveBranch.id,name:"Forbidden warehouse"}),"BRANCH_INACTIVE");
  rejected(()=>cmd({op:"branch",name:"Branch"}),"DUPLICATE_NAME");
  await identity.addOperator(1,"clerk","test-password-456",["clerk"]);
  await identity.login(1,"clerk","test-password-456",false);
  rejected(()=>cmd({op:"branch",name:"Denied"}),"FORBIDDEN");
});
