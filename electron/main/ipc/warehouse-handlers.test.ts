import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { registerIpcHandlers } from "./index";
import { trustWindow, forgetWindow } from "./dispatch";
import { CURRENT_SCHEMA_VERSION, runMigrations, verifyDatabase } from "../database/migrations";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import * as factory from "@core/warehouses/infrastructure/create-sqlite-warehouses";
import { createSqliteLocationUsage } from "@core/inventory/infrastructure/sqlite-location-usage";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { SESSION_PERMISSIONS, type SessionCapabilities } from "@shared/identity/types";
import type { IpcResult } from "@shared/ipc/result";
import type { BranchDto, BranchDetailsDto, WarehouseDto, StorageLocationDto, ResolvedLocationDto, WarehouseDetailsDto, DefinitionPageDto } from "@shared/warehouses/types";

jest.mock("electron",()=>({ipcMain:{handle:jest.fn()},app:{getPath:jest.fn()},dialog:{showOpenDialog:jest.fn()}}));
const C=IPC_CHANNELS.warehouses;
const channels=Object.values(C).flatMap(group=>Object.values(group));
const mutations=channels.filter(channel=>/:(create|update|setStatus|reparent|reassign)$/.test(channel));
const reads=channels.filter(channel=>!mutations.includes(channel));
let db:Database.Database,identity:ReturnType<typeof createSqliteIdentity>,catalog:ReturnType<typeof createSqliteCatalog>;
let branch:BranchDto,warehouse:WarehouseDto,location:StorageLocationDto,item:string;
let handlers:Map<string,(event:IpcMainInvokeEvent,input:unknown)=>unknown>;
const frame={url:"file:///qa/index.html"};
const trustedEvent={sender:{id:71,mainFrame:frame},senderFrame:frame};
const tables=["branches","warehouses","locations","documents","document_items","movements","balances","count_locks","receipts","audit"];
const state=()=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()]));
async function invoke<T=unknown>(channel:string,input?:unknown,event:unknown=trustedEvent):Promise<IpcResult<T>> {
  const handler=handlers.get(channel);
  if(!handler)throw Error("Unregistered channel: "+channel);
  return await handler(event as IpcMainInvokeEvent,input) as IpcResult<T>;
}
async function ok<T>(channel:string,input?:unknown):Promise<T> {
  const result=await invoke<T>(channel,input);
  if(!result.ok)throw Error(result.error.code+": "+result.error.message);
  return result.data;
}
async function denied(channel:string,input:unknown,code:string){
  const before=state();expect(await invoke(channel,input)).toMatchObject({ok:false,error:{code}});expect(state()).toEqual(before);
}
function sample(channel:string):unknown {
  const common={id:location.id,expectedVersion:location.version};
  const cases:Record<string,unknown>={
    [C.branches.create]:{code:"NEW",name:"New"},
    [C.branches.update]:{id:branch.id,expectedVersion:1,code:"BR",name:"Changed"},
    [C.branches.list]:{},[C.branches.get]:{id:branch.id},[C.branches.listWarehouses]:{id:branch.id},
    [C.branches.setStatus]:{id:branch.id,status:"inactive",expectedVersion:1},
    [C.warehouses.create]:{branchId:branch.id,code:"NEW",name:"New"},
    [C.warehouses.update]:{id:warehouse.id,expectedVersion:1,code:"WH",name:"Changed"},
    [C.warehouses.list]:{},[C.warehouses.get]:{id:warehouse.id},
    [C.warehouses.reassign]:{id:warehouse.id,branchId:branch.id,expectedVersion:1},
    [C.warehouses.setStatus]:{id:warehouse.id,status:"inactive",expectedVersion:1},
    [C.locations.create]:{warehouseId:warehouse.id,code:"NEW",name:"New",locationType:"bin"},
    [C.locations.update]:{...common,code:"BIN",name:"Changed",locationType:"bin"},
    [C.locations.list]:{warehouseId:warehouse.id},[C.locations.get]:{id:location.id},
    [C.locations.tree]:{warehouseId:warehouse.id},[C.locations.path]:{id:location.id},[C.locations.stockable]:{},
    [C.locations.reparent]:{...common,parentId:null},[C.locations.setStatus]:{...common,status:"inactive"},
  };
  return cases[channel];
}
beforeEach(async()=>{
  jest.mocked(ipcMain.handle).mockClear();
  jest.spyOn(console,"info").mockImplementation(()=>{});
  db=new Database(":memory:");runMigrations(db);
  identity=createSqliteIdentity(db);await identity.login(71,"admin","test-password-123",true);
  const services=factory.createSqliteWarehouses(db,{usage:createSqliteLocationUsage(db),access:{currentActor:()=>identity.actor(71),authorize:identity.authorize}});
  branch=services.createBranch({code:"BR",name:"Branch"});
  warehouse=services.createWarehouse({branchId:branch.id,code:"WH",name:"Warehouse"});
  location=services.createLocation({warehouseId:warehouse.id,code:"BIN",name:"Bin",locationType:"bin"});
  catalog=createSqliteCatalog(db,{save:()=>"",read:()=>null,remove:()=>{}});
  const category=catalog.createCategory({code:"CAT",name:"Category"}),unit=catalog.createUnit({name:"Piece",symbol:"pc",dimension:"count"});
  item="p:"+catalog.createProduct({name:"Product",sku:"SKU",productType:"simple",categoryId:category.id,baseUnitId:unit.id,allowDecimalQuantity:false}).product.id;
  registerIpcHandlers(db,catalog,identity);
  handlers=new Map(jest.mocked(ipcMain.handle).mock.calls.map(([channel,handler])=>[channel,handler]));
  trustWindow(71,url=>url===frame.url);
});
afterEach(()=>{
  forgetWindow(71);forgetWindow(72);jest.restoreAllMocks();
  try{expect(verifyDatabase(db)).toBe(CURRENT_SCHEMA_VERSION);expect(db.pragma("foreign_key_check")).toEqual([]);expect(db.pragma("integrity_check",{simple:true})).toBe("ok");}finally{db.close();}
});

it("registers every dedicated channel exactly once",()=>{
  expect(channels).toHaveLength(21);
  for(const channel of [...channels,IPC_CHANNELS.identity.capabilities]){
    expect(jest.mocked(ipcMain.handle).mock.calls.filter(([name])=>name===channel)).toHaveLength(1);
  }
});
it.each(channels)("rejects signed-out calls to %s without effects",async channel=>{
  identity.end(71);await denied(channel,sample(channel),"AUTH_REQUIRED");
});
it.each(mutations)("denies every clerk mutation without effects: %s",async channel=>{
  await identity.addOperator(71,"clerk","test-password-456",["clerk"]);
  await identity.login(71,"clerk","test-password-456",false);
  await denied(channel,sample(channel),"FORBIDDEN");
});
it.each(channels)("rejects unknown fields on %s before constructing application services",async channel=>{
  const spy=jest.spyOn(factory,"createSqliteWarehouses");
  await denied(channel,{...sample(channel) as object,actor:"fake-admin"},"VALIDATION_ERROR");
  expect(spy).not.toHaveBeenCalled();
});
it.each([
  [C.branches.create,{code:"A B",name:"Name"}],
  [C.branches.create,{code:"CODE",name:" "}],
  [C.branches.create,{code:"CODE",name:"Name",description:"x".repeat(2001)}],
  [C.branches.create,{code:"CODE",name:"Name",address:"x".repeat(501)}],
  [C.branches.create,{code:"CODE",name:"Name",phone:"x".repeat(41)}],
  [C.branches.create,{code:"CODE",name:"Name",contactName:"x".repeat(121)}],
  [C.branches.list,{page:0}], [C.branches.list,{page:"1"}], [C.branches.list,{pageSize:101}],
  [C.branches.list,{status:"deleted"}], [C.branches.get,{id:" "}],
  [C.locations.create,{warehouseId:"id",code:"BIN",name:"Bin",locationType:"rack"}],
  [C.locations.create,{warehouseId:"id",code:"BIN",name:"Bin",locationType:"bin",isStockable:1}],
  [C.locations.reparent,{id:"id",parentId:""}], [C.locations.reparent,{id:"id",parentId:null,expectedVersion:1.5}],
  [C.locations.reparent,{id:"id",parentId:null,expectedVersion:Number.MAX_SAFE_INTEGER+1}],
] satisfies Array<[string,unknown]>)("bounds and enums protect %s",async(channel,input)=>{
  const spy=jest.spyOn(factory,"createSqliteWarehouses");await denied(channel,input,"VALIDATION_ERROR");expect(spy).not.toHaveBeenCalled();
});
it.each([C.branches.update,C.branches.setStatus,C.warehouses.update,C.warehouses.setStatus,C.warehouses.reassign,C.locations.update,C.locations.setStatus,C.locations.reparent])("requires expectedVersion on %s",async channel=>{
  const input={...sample(channel) as {expectedVersion?:number}};delete input.expectedVersion;
  await denied(channel,input,"VALIDATION_ERROR");
});

it("checks sender, origin and main frame before payload validation and revokes windows",async()=>{
  const spy=jest.spyOn(factory,"createSqliteWarehouses"),input=sample(C.branches.create);
  const other={url:"https://untrusted.test/"};
  for(const event of [
    {sender:{id:72,mainFrame:frame},senderFrame:frame},
    {sender:{id:71,mainFrame:other},senderFrame:other},
    {...trustedEvent,senderFrame:{...frame}},
    {...trustedEvent,senderFrame:null},
  ])expect(await invoke(C.branches.create,input,event)).toMatchObject({ok:false,error:{code:"UNTRUSTED_SENDER"}});
  forgetWindow(71);
  expect(await invoke(C.branches.create,{invalid:true})).toMatchObject({ok:false,error:{code:"UNTRUSTED_SENDER"}});
  expect(await invoke(IPC_CHANNELS.identity.capabilities)).toMatchObject({ok:false,error:{code:"UNTRUSTED_SENDER"}});
  expect(spy).not.toHaveBeenCalled();
});
it("isolates capabilities by session and immediately drops admin authority on switching/logout",async()=>{
  const admin=await ok<SessionCapabilities>(IPC_CHANNELS.identity.capabilities);
  expect(admin.authenticated).toBe(true);expect([...admin.permissions].sort()).toEqual([...SESSION_PERMISSIONS].sort());
  expect(Object.keys(admin).sort()).toEqual(["authenticated","permissions"]);
  await identity.addOperator(71,"clerk","test-password-456",["clerk"]);
  const switching=identity.login(71,"clerk","test-password-456",false);
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:false,permissions:[]});
  await denied(C.branches.create,sample(C.branches.create),"AUTH_REQUIRED");await switching;
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read"]});
  expect((await ok<BranchDetailsDto>(C.branches.get,{id:branch.id})).branch.id).toBe(branch.id);
  await denied(C.branches.create,sample(C.branches.create),"FORBIDDEN");
  await ok("identity:logout");
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:false,permissions:[]});
  await denied(C.locations.get,{id:location.id},"AUTH_REQUIRED");
  const anotherFrame={url:frame.url};trustWindow(72,url=>url===frame.url);
  expect(await invoke(C.branches.get,{id:branch.id},{sender:{id:72,mainFrame:anotherFrame},senderFrame:anotherFrame})).toMatchObject({ok:false,error:{code:"AUTH_REQUIRED"}});
});
it.each([{roles:["clerk"]},{roles:["supervisor"]},{roles:["clerk","supervisor"]}])("keeps lower-role Warehouse grants scoped to their actual union: $roles",async({roles})=>{
  await identity.addOperator(71,"operator","test-password-456",roles);
  await identity.login(71,"operator","test-password-456",false);
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read"]});
  await ok(C.locations.list,{warehouseId:warehouse.id});
  for(const channel of [C.branches.create,C.branches.setStatus,C.locations.reparent,C.warehouses.reassign])await denied(channel,sample(channel),"FORBIDDEN");
  const user=identity.actor(71);
  if(roles.includes("clerk"))expect(()=>identity.authorize(user,"draft")).not.toThrow();
  if(roles.includes("supervisor"))expect(()=>identity.authorize(user,"post")).not.toThrow();
});
it("distinguishes warehouse editing from status/reparent/reassignment without new role grants",async()=>{
  db.prepare("INSERT INTO roles VALUES('editor')").run();
  db.prepare("INSERT INTO permissions VALUES('editor','read'),('editor','warehouse')").run();
  await identity.addOperator(71,"editor","test-password-456",["editor"]);
  await identity.login(71,"editor","test-password-456",false);
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read","warehouse"]});
  await ok(C.branches.create,{code:"EDITOR",name:"Editor branch"});
  for(const channel of [C.branches.setStatus,C.warehouses.setStatus,C.locations.setStatus,C.locations.reparent,C.warehouses.reassign])await denied(channel,sample(channel),"FORBIDDEN");
});
it("requires read permission for every query and rejects claims on the capabilities endpoint",async()=>{
  db.prepare("INSERT INTO roles VALUES('blind')").run();
  db.prepare("INSERT INTO permissions VALUES('blind','warehouse')").run();
  await identity.addOperator(71,"blind","test-password-456",["blind"]);
  await identity.login(71,"blind","test-password-456",false);
  for(const channel of reads)await denied(channel,sample(channel),"FORBIDDEN");
  await denied(IPC_CHANNELS.identity.capabilities,{roles:["admin"]},"VALIDATION_ERROR");
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["warehouse"]});
});
it.each(["warehouse.status","warehouse.reparent","warehouse.reassign"])("honors only the fine-grained grant %s and refreshes permissions in the same session",async permission=>{
  const destination=await ok<BranchDto>(C.branches.create,{code:"DEST",name:"Destination"});
  if(permission==="warehouse.reassign"){
    await ok(C.locations.setStatus,{id:location.id,status:"inactive",expectedVersion:1});
    await ok(C.warehouses.setStatus,{id:warehouse.id,status:"inactive",expectedVersion:1});
  }
  db.prepare("INSERT INTO roles VALUES('specialist')").run();
  db.prepare("INSERT INTO permissions VALUES('specialist','read'),('specialist',?)").run(permission);
  await identity.addOperator(71,"specialist","test-password-456",["specialist"]);
  await identity.login(71,"specialist","test-password-456",false);
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read",permission]});
  await denied(C.branches.create,sample(C.branches.create),"FORBIDDEN");
  const requests=[
    {permission:"warehouse.status",channel:C.branches.setStatus,input:{id:destination.id,status:"inactive",expectedVersion:1}},
    {permission:"warehouse.reparent",channel:C.locations.reparent,input:{id:location.id,parentId:null,expectedVersion:1}},
    {permission:"warehouse.reassign",channel:C.warehouses.reassign,input:{id:warehouse.id,branchId:destination.id,expectedVersion:2}},
  ];
  for(const request of requests){
    if(request.permission===permission)await ok(request.channel,request.input);
    else await denied(request.channel,request.input,"FORBIDDEN");
  }
  db.prepare("DELETE FROM permissions WHERE role='specialist' AND action=?").run(permission);
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read"]});
  await denied(C.branches.create,sample(C.branches.create),"FORBIDDEN");
});

it("creates, edits, queries and changes status/ownership through the dedicated endpoints",async()=>{
  const created=await ok<BranchDto>(C.branches.create,{code:" north ",name:" فرع الشمال ",contactName:" Manager "});
  expect(created).toMatchObject({code:"NORTH",name:"فرع الشمال",contactName:"Manager",version:1});
  const updated=await ok<BranchDto>(C.branches.update,{id:created.id,expectedVersion:1,code:"NORTH",name:"Updated"});
  expect(updated.version).toBe(2);
  expect(await ok(C.branches.list,{search:"Updated",pageSize:1})).toMatchObject({items:[updated],total:1,page:1,pageSize:1});
  const newWarehouse=await ok<WarehouseDto>(C.warehouses.create,{branchId:created.id,code:"NORTH_WH",name:"North warehouse"});
  expect(await ok(C.branches.listWarehouses,{id:created.id})).toEqual([newWarehouse]);
  const edited=await ok<WarehouseDto>(C.warehouses.update,{id:newWarehouse.id,expectedVersion:1,code:newWarehouse.code,name:"Renamed",address:"العنوان"});
  expect(await ok(C.warehouses.list,{branchId:created.id,search:"Renamed"})).toMatchObject({items:[edited],total:1});
  await denied(C.branches.setStatus,{id:created.id,status:"inactive",expectedVersion:2},"ACTIVE_CHILDREN");
  const inactive=await ok<WarehouseDto>(C.warehouses.setStatus,{id:edited.id,status:"inactive",expectedVersion:2});
  expect(inactive.status).toBe("inactive");
  const reassigned=await ok<WarehouseDto>(C.warehouses.reassign,{id:edited.id,branchId:branch.id,expectedVersion:3});
  expect(reassigned).toMatchObject({id:edited.id,branchId:branch.id,version:4});
  const activated=await ok<WarehouseDto>(C.warehouses.setStatus,{id:edited.id,status:"active",expectedVersion:4});
  expect(activated.status).toBe("active");
  expect((await ok<WarehouseDetailsDto>(C.warehouses.get,{id:edited.id})).defaultLocation.status).toBe("active");
  expect(await ok(C.branches.setStatus,{id:created.id,status:"inactive",expectedVersion:2})).toMatchObject({status:"inactive",version:3});
  expect(await ok(C.branches.setStatus,{id:created.id,status:"active",expectedVersion:3})).toMatchObject({status:"active",version:4});
});
it("preserves hierarchy integrity and returns only approved typed DTOs",async()=>{
  const created=await ok<WarehouseDto>(C.warehouses.create,{branchId:branch.id,code:"NEW",name:"New warehouse"});
  const details=await ok<WarehouseDetailsDto>(C.warehouses.get,{id:created.id});
  expect(details.defaultLocation).toMatchObject({isDefault:true,isStockable:true,parentId:null});
  const parent=await ok<StorageLocationDto>(C.locations.create,{warehouseId:created.id,code:"ZONE",name:"Zone",locationType:"zone"});
  const child=await ok<StorageLocationDto>(C.locations.create,{warehouseId:created.id,parentId:parent.id,code:"BIN",name:"Bin",locationType:"bin"});
  expect(await ok(C.locations.path,{id:child.id})).toEqual([{id:parent.id,code:"ZONE",name:"Zone"},{id:child.id,code:"BIN",name:"Bin"}]);
  expect(await ok(C.locations.tree,{warehouseId:created.id,parentId:parent.id})).toEqual([child]);
  await denied(C.locations.reparent,{id:parent.id,parentId:child.id,expectedVersion:1},"LOCATION_CYCLE");
  await denied(C.locations.reparent,{id:child.id,parentId:location.id,expectedVersion:1},"PARENT_WAREHOUSE_MISMATCH");
  const moved=await ok<StorageLocationDto>(C.locations.reparent,{id:child.id,parentId:null,expectedVersion:1});
  expect(moved).toMatchObject({id:child.id,warehouseId:created.id,parentId:null,version:2});
  const organizational=await ok<StorageLocationDto>(C.locations.update,{id:child.id,expectedVersion:2,code:"BIN",name:"Bin",locationType:"other",isStockable:false});
  expect(organizational.isStockable).toBe(false);
  expect(await ok(C.locations.get,{id:child.id})).toMatchObject({location:organizational,warehouse:created,effectiveActive:true});
  expect(await ok(C.locations.list,{warehouseId:created.id,search:"Bin"})).toMatchObject({items:[organizational],total:1});
  expect(await ok(C.locations.setStatus,{id:child.id,status:"inactive",expectedVersion:3})).toMatchObject({status:"inactive",version:4});
  expect(await ok(C.locations.setStatus,{id:child.id,status:"active",expectedVersion:4})).toMatchObject({status:"active",version:5});
  expect((await ok<readonly ResolvedLocationDto[]>(C.locations.stockable,{warehouseId:created.id})).some(row=>row.location.id===child.id)).toBe(false);
  await denied(C.locations.setStatus,{id:details.defaultLocation.id,status:"inactive",expectedVersion:1},"DEFAULT_LOCATION_PROTECTED");
});
it("preserves not-found, duplicate and optimistic-concurrency error codes without effects",async()=>{
  for(const [channel,code] of [[C.branches.get,"BRANCH_NOT_FOUND"],[C.warehouses.get,"WAREHOUSE_NOT_FOUND"],[C.locations.get,"LOCATION_NOT_FOUND"]])await denied(channel,{id:"missing"},code);
  await denied(C.branches.create,{code:branch.code,name:"Duplicate code"},"DUPLICATE_CODE");
  await denied(C.locations.update,{id:location.id,expectedVersion:2,code:location.code,name:"Stale",locationType:"bin"},"VERSION_CONFLICT");
});
it("keeps Inventory history intact during IPC reparenting and returns domain errors safely",async()=>{
  const parent=await ok<StorageLocationDto>(C.locations.create,{warehouseId:warehouse.id,code:"PARENT",name:"Parent",locationType:"zone"});
  const draft=await ok<{id:string}>("inventory:execute",{op:"draft",kind:"receipt",lines:[{item,location:location.id,quantity:"10"}]});
  await ok("inventory:execute",{op:"post",document:draft.id,version:1,command:"receipt"});
  const before=db.prepare("SELECT document,item,location,CAST(delta AS TEXT) delta,snapshot FROM movements").all();
  const balances=db.prepare("SELECT * FROM balances").safeIntegers().all();
  await ok(C.locations.reparent,{id:location.id,parentId:parent.id,expectedVersion:1});
  expect(db.prepare("SELECT document,item,location,CAST(delta AS TEXT) delta,snapshot FROM movements").all()).toEqual(before);
  expect(db.prepare("SELECT * FROM balances").safeIntegers().all()).toEqual(balances);
  await denied(C.locations.setStatus,{id:location.id,status:"inactive",expectedVersion:2},"STOCK_EXISTS");
  expect(await ok("inventory:execute",{op:"reconcile"})).toEqual({rows:[]});
});
it("reuses canonical Warehouse services for legacy calls and emits one audit event",async()=>{
  const before=db.prepare("SELECT count(*) FROM audit").pluck().get() as number;
  const result=await ok<{id:string}>("inventory:execute",{op:"warehouse",branch:branch.id,name:"Legacy"});
  expect(db.prepare("SELECT count(*) FROM audit").pluck().get()).toBe(before+1);
  const details=await ok<WarehouseDetailsDto>(C.warehouses.get,{id:result.id});expect(details.defaultLocation.isDefault).toBe(true);
  await ok(C.warehouses.setStatus,{id:result.id,status:"inactive",expectedVersion:1});
  await denied("inventory:execute",{op:"location",warehouse:result.id,name:"Denied"},"WAREHOUSE_INACTIVE");
});
it("hides unexpected failures and strips fields outside the response DTO",async()=>{
  jest.spyOn(console,"error").mockImplementation(()=>{});
  const spy=jest.spyOn(factory,"createSqliteWarehouses");
  spy.mockImplementationOnce(()=>{throw Error("SELECT digest FROM operators; C:/private/warehouse.sqlite stack");});
  const result=await invoke(C.branches.list,{});
  expect(result).toEqual({ok:false,error:{code:"INTERNAL_ERROR",message:"حدث خطأ غير متوقع"}});
  const real=factory.createSqliteWarehouses(db,{usage:createSqliteLocationUsage(db),access:{currentActor:()=>identity.actor(71),authorize:identity.authorize}});
  spy.mockReturnValueOnce({...real,createBranch:input=>({...real.createBranch(input),privateSql:"secret"})});
  const branch=await ok<BranchDto>(C.branches.create,{code:"SAFE",name:"Safe"});
  expect(branch).not.toHaveProperty("privateSql");
  expect((await ok<DefinitionPageDto<BranchDto>>(C.branches.list,{})).total).toBe(2);
});
