import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import type Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initializeDatabase, closeDatabase } from "../database";
import { CURRENT_SCHEMA_VERSION, verifyDatabase } from "../database/migrations";
import { activeDirectory, activate, confirmStartup, createVerifiedSnapshot, stageRestore } from "../recovery";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { IpcResult } from "@shared/ipc/result";
import type { StockCommand, StockResult } from "@shared/ipc/stock";
import type { Category, ProductDetails, Unit } from "@shared/catalog/types";
import type { BranchDto, ResolvedLocationDto, StorageLocationDto, WarehouseDto, WarehouseDetailsDto } from "@shared/warehouses/types";
import { registerIpcHandlers } from "./index";
import { forgetWindow, trustWindow } from "./dispatch";

jest.mock("electron",()=>({ipcMain:{handle:jest.fn()},app:{getPath:jest.fn()},dialog:{showOpenDialog:jest.fn()}}));
const C=IPC_CHANNELS.warehouses;
const frame={url:"file:///phase3-acceptance/index.html"};
const event={sender:{id:84,mainFrame:frame},senderFrame:frame} as unknown as IpcMainInvokeEvent;
const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XkAAAAASUVORK5CYII=";
const inventoryTables=["stock_items","documents","document_items","movements","balances","count_locks","count_expected","reviewed_counts","receipts"];
const businessTables=["branches","warehouses","locations",...inventoryTables,"audit"];
let root:string,db:Database.Database,identity:ReturnType<typeof createSqliteIdentity>;
let handlers:Map<string,(event:IpcMainInvokeEvent,input:unknown)=>unknown>;
let branch:BranchDto,warehouse:WarehouseDto,zone:StorageLocationDto,shelf:StorageLocationDto,bin:StorageLocationDto,cross:StorageLocationDto,product:ProductDetails,item:string;

function open(){
  db=initializeDatabase(activeDirectory(root));identity=createSqliteIdentity(db);
  jest.mocked(ipcMain.handle).mockClear();
  registerIpcHandlers(db,createSqliteCatalog(db,new FileImageStorage(join(activeDirectory(root),"media"))),identity);
  handlers=new Map(jest.mocked(ipcMain.handle).mock.calls.map(([channel,handler])=>[channel,handler]));
  trustWindow(84,url=>url===frame.url);
}
async function invoke<T>(channel:string,input?:unknown):Promise<IpcResult<T>>{return await handlers.get(channel)!(event,input) as IpcResult<T>;}
async function ok<T>(channel:string,input?:unknown):Promise<T>{const result=await invoke<T>(channel,input);if(!result.ok)throw Error(result.error.code+": "+result.error.message);return result.data;}
const stock=(command:StockCommand)=>ok<StockResult>("inventory:execute",command);
const state=(tables=businessTables)=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()]));
async function rejected(channel:string,input:unknown,code:string){const before=state();expect(await invoke(channel,input)).toMatchObject({ok:false,error:{code}});expect(state()).toEqual(before);}
async function draft(kind:"receipt"|"issue"|"transfer",location:string,quantity:string,destination?:string){return (await stock({op:"draft",kind,lines:[{item,location,quantity,...(destination?{destination}:{})}]})).id!;}
const post=(document:string,version=1)=>stock({op:"post",document,version,command:"acceptance/"+document});
async function receive(location:string,quantity:string){const id=await draft("receipt",location,quantity);await post(id);return id;}
const balance=(location:string)=>db.prepare("SELECT CAST(qty AS TEXT) FROM balances WHERE item=? AND location=?").pluck().get(item,location)??"0";
async function restart(){forgetWindow(84);identity.end(84);closeDatabase();open();await ok("identity:login",{name:"admin",password:"test-password-123",setup:false});}

beforeEach(async()=>{
  jest.spyOn(console,"info").mockImplementation(()=>{});
  root=mkdtempSync(join(tmpdir(),"wms-stage8-"));jest.mocked(app.getPath).mockReturnValue(root);open();
  await ok("identity:login",{name:"admin",password:"test-password-123",setup:true});
  branch=await ok(C.branches.create,{code:"BR",name:"فرع القبول"});
  warehouse=await ok(C.warehouses.create,{branchId:branch.id,code:"WH",name:"مخزن القبول"});
  zone=await ok(C.locations.create,{warehouseId:warehouse.id,code:"ZONE",name:"منطقة قابلة للتخزين",locationType:"zone",isStockable:true});
  shelf=await ok(C.locations.create,{warehouseId:warehouse.id,parentId:zone.id,code:"SHELF",name:"رف تنظيمي",locationType:"shelf"});
  bin=await ok(C.locations.create,{warehouseId:warehouse.id,parentId:shelf.id,code:"BIN",name:"خانة الاستلام",locationType:"bin"});
  const other=await ok<WarehouseDto>(C.warehouses.create,{branchId:branch.id,code:"CROSS",name:"المخزن الآخر"});
  cross=(await ok<WarehouseDetailsDto>(C.warehouses.get,{id:other.id})).defaultLocation;
  const category=await ok<Category>(IPC_CHANNELS.catalog.categories.create,{code:"CAT",name:"تصنيف القبول"});
  const unit=await ok<Unit>(IPC_CHANNELS.catalog.units.create,{name:"كجم",symbol:"kg",dimension:"mass"});
  product=await ok(IPC_CHANNELS.catalog.products.create,{name:"منتج دقيق",sku:"ACCEPTANCE",productType:"simple",categoryId:category.id,baseUnitId:unit.id,allowDecimalQuantity:true,imageDataUrl:png});
  item=(await stock({op:"items"})).rows!.find(row=>row.sku==="ACCEPTANCE")!.id as string;
});
afterEach(async()=>{
  try{
    expect(verifyDatabase(db)).toBe(CURRENT_SCHEMA_VERSION);expect(db.pragma("foreign_keys",{simple:true})).toBe(1);expect(db.pragma("journal_mode",{simple:true})).toBe("wal");
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");expect(db.pragma("foreign_key_check")).toEqual([]);
    await ok("identity:login",{name:"admin",password:"test-password-123",setup:false});expect((await stock({op:"reconcile"})).rows).toEqual([]);
  }finally{
    forgetWindow(84);closeDatabase();jest.restoreAllMocks();
    if(dirname(resolve(root))!==resolve(tmpdir())||!/^wms-stage8-/.test(root.split(/[\\/]/).pop()!))throw Error("Unsafe fixture cleanup");
    rmSync(root,{recursive:true,force:true});
  }
});

it("A: persists organization IDs, default, hierarchy, stockability and status across a reopen",async()=>{
  const details=await ok<WarehouseDetailsDto>(C.warehouses.get,{id:warehouse.id});
  expect(details.defaultLocation).toMatchObject({warehouseId:warehouse.id,parentId:null,isDefault:true,isStockable:true});
  expect(await ok(C.locations.path,{id:bin.id})).toEqual([zone,shelf,bin].map(({id,code,name})=>({id,code,name})));
  expect((await ok<ResolvedLocationDto>(C.locations.get,{id:shelf.id})).location.isStockable).toBe(false);
  await ok(C.locations.setStatus,{id:bin.id,status:"inactive",expectedVersion:1});
  const before=state();await restart();expect(state()).toEqual(before);
  expect(await ok(C.locations.get,{id:bin.id})).toMatchObject({location:{id:bin.id,parentId:shelf.id,status:"inactive"},warehouse:{id:warehouse.id,branchId:branch.id},effectiveActive:false});
  expect(await ok(C.locations.tree,{warehouseId:warehouse.id,parentId:shelf.id})).toMatchObject([{id:bin.id}]);
});

it("B/C: posts exact decimal receipts/issues and both transfer legs, rejects overdraw and rolls back a late cross-warehouse failure",async()=>{
  expect(item).toBe("p:"+product.product.id);
  await receive(bin.id,"10.125");await post(await draft("issue",bin.id,"1.125"));expect(balance(bin.id)).toBe("9000");
  const internal=await draft("transfer",bin.id,"2.500",zone.id);await post(internal);
  const external=await draft("transfer",zone.id,"1.125",cross.id);await post(external);
  expect([balance(bin.id),balance(zone.id),balance(cross.id)]).toEqual(["6500","1375","1125"]);
  expect(db.prepare("SELECT location,CAST(delta AS TEXT) delta FROM movements WHERE document=? ORDER BY delta").all(external)).toEqual([{location:zone.id,delta:"-1125"},{location:cross.id,delta:"1125"}]);
  const excess=await draft("issue",bin.id,"6.501");await rejected("inventory:execute",{op:"post",document:excess,version:1,command:"overdraw"},"INSUFFICIENT_STOCK");
  await rejected("inventory:execute",{op:"draft",kind:"transfer",lines:[{item,location:bin.id,destination:bin.id,quantity:"1"}]},"INVALID_DESTINATION");
  const failing=await draft("transfer",bin.id,"0.001",cross.id);
  db.exec(`CREATE TEMP TRIGGER acceptance_late_failure BEFORE INSERT ON movements WHEN NEW.location='${cross.id}' BEGIN SELECT RAISE(ABORT,'injected second-leg failure'); END`);
  jest.spyOn(console,"error").mockImplementation(()=>{});
  await rejected("inventory:execute",{op:"post",document:failing,version:1,command:"late-failure"},"INTERNAL_ERROR");
  db.exec("DROP TRIGGER acceptance_late_failure");
  await post(failing);expect(balance(cross.id)).toBe("1126");
});

it("D: counts only the exact stockable parent's snapshot while child stock remains independent",async()=>{
  await receive(zone.id,"2.125");await receive(bin.id,"5.500");
  const count=(await stock({op:"count",location:zone.id})).id!;
  expect(db.prepare("SELECT CAST(expected AS TEXT) expected FROM count_expected WHERE document=?").all(count)).toEqual([{expected:"2125"}]);
  expect(db.prepare("SELECT location FROM count_locks").all()).toEqual([{location:zone.id}]);
  await receive(bin.id,"0.500");
  await rejected(C.locations.reparent,{id:bin.id,parentId:null,expectedVersion:1},"COUNT_ACTIVE");
  const blocked=await draft("issue",zone.id,"0.001");await rejected("inventory:execute",{op:"post",document:blocked,version:1,command:"locked-parent"},"LOCATION_LOCKED");
  await stock({op:"edit",document:count,version:1,lines:[{item,location:zone.id,quantity:"1.125"}]});
  await stock({op:"review",document:count,version:2});await post(count,3);
  expect([balance(zone.id),balance(bin.id)]).toEqual(["1125","6000"]);
  expect(db.prepare("SELECT location,CAST(delta AS TEXT) delta FROM movements WHERE document=?").all(count)).toEqual([{location:zone.id,delta:"-1000"}]);
  expect(db.prepare("SELECT 1 FROM count_locks").get()).toBeUndefined();
});

it("E: preserves stock/history on a stocked reparent and returns identical committed retries after deactivation/restart",async()=>{
  const receipt=await receive(bin.id,"2.500");
  const before=state(inventoryTables);
  await ok(C.locations.reparent,{id:bin.id,parentId:zone.id,expectedVersion:1});expect(state(inventoryTables)).toEqual(before);
  await rejected(C.locations.reparent,{id:bin.id,parentId:cross.id,expectedVersion:2},"PARENT_WAREHOUSE_MISMATCH");
  await rejected(C.locations.reparent,{id:zone.id,parentId:bin.id,expectedVersion:1},"LOCATION_CYCLE");
  await rejected(C.locations.setStatus,{id:bin.id,status:"inactive",expectedVersion:2},"STOCK_EXISTS");
  await rejected(C.locations.reparent,{id:cross.id,parentId:null,expectedVersion:1},"DEFAULT_LOCATION_PROTECTED");
  await post(await draft("issue",bin.id,"2.500"));
  const pending=await draft("receipt",bin.id,"1");await rejected(C.locations.setStatus,{id:bin.id,status:"inactive",expectedVersion:2},"PENDING_DOCUMENTS");
  await stock({op:"cancel",document:pending,version:1});await ok(C.locations.setStatus,{id:bin.id,status:"inactive",expectedVersion:2});
  await rejected("inventory:execute",{op:"draft",kind:"receipt",lines:[{item,location:bin.id,quantity:"1"}]},"LOCATION_INACTIVE");
  const committed=state();await restart();expect(await post(receipt)).toEqual({id:receipt});expect(state()).toEqual(committed);
});

it("F: switches roles and invalidates sessions at the real IPC composition boundary with zero unauthorized effects",async()=>{
  await ok("identity:add",{name:"restricted",password:"test-password-456",roles:["clerk","supervisor"]});
  await ok("identity:login",{name:"restricted",password:"test-password-456",setup:false});
  expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:true,permissions:["read"]});
  await rejected(C.branches.create,{code:"DENIED",name:"مرفوض"},"FORBIDDEN");
  await rejected(C.locations.reparent,{id:bin.id,parentId:null,expectedVersion:1},"FORBIDDEN");
  await rejected(C.locations.create,{warehouseId:warehouse.id,code:"CLAIM",name:"مرفوض",locationType:"bin",actor:"admin"},"VALIDATION_ERROR");
  await rejected(IPC_CHANNELS.catalog.categories.create,{code:"DENIED",name:"مرفوض"},"FORBIDDEN");
  expect(db.prepare("SELECT 1 FROM categories WHERE code='DENIED'").get()).toBeUndefined();
  await rejected("inventory:execute",{op:"rebuild"},"FORBIDDEN");
  const balanceRequest={itemId:item,locationId:bin.id};
  await ok(IPC_CHANNELS.inventory.getStockBalance,balanceRequest);
  await ok("identity:logout");expect(await ok(IPC_CHANNELS.identity.capabilities)).toEqual({authenticated:false,permissions:[]});
  await rejected(C.warehouses.get,{id:warehouse.id},"AUTH_REQUIRED");
  await rejected(IPC_CHANNELS.catalog.categories.lookup,undefined,"AUTH_REQUIRED");
  await rejected(IPC_CHANNELS.inventory.getStockBalance,balanceRequest,"AUTH_REQUIRED");
});

it("restores a media-complete organization/stock snapshot, preserves identities/receipts and rejects corrupted media without activation",async()=>{
  const receipt=await receive(bin.id,"12.345"),before=state();
  const image=product.product.imagePath!;expect(image).toBeTruthy();
  const saved=createVerifiedSnapshot(db,activeDirectory(root),join(root,"qa-backups"));
  const originalMedia=readFileSync(join(saved,"media",image));
  await post(await draft("issue",bin.id,"1.000"));
  writeFileSync(join(saved,"media",image),"corrupt");const live=state(),current=activeDirectory(root);
  expect(()=>stageRestore(saved,root)).toThrow(/media checksum/i);expect(activeDirectory(root)).toBe(current);expect(state()).toEqual(live);
  writeFileSync(join(saved,"media",image),originalMedia);
  const staged=stageRestore(saved,root);forgetWindow(84);closeDatabase();activate(root,staged);open();
  await ok("identity:login",{name:"admin",password:"test-password-123",setup:false});
  expect(state()).toEqual(before);expect(balance(bin.id)).toBe("12345");expect(await post(receipt)).toEqual({id:receipt});
  expect(readFileSync(join(activeDirectory(root),"media",image))).toEqual(originalMedia);
  expect((await ok<ResolvedLocationDto>(C.locations.get,{id:bin.id})).path.map(node=>node.id)).toEqual([zone.id,shelf.id,bin.id]);confirmStartup(root);
});
