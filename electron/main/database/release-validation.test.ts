import { afterEach, beforeEach, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { initializeDatabase, closeDatabase } from "./index";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrations";
import { activate, activeDirectory, confirmStartup, snapshot, stageRestore } from "../recovery";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { createInventory } from "@core/inventory/infrastructure/sqlite-inventory";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import { createInventoryWarehouseGateway } from "@core/warehouses/infrastructure/create-inventory-gateway";
import { createSqliteLocationUsage } from "@core/inventory/infrastructure/sqlite-location-usage";
import type { StockCommand } from "@shared/ipc/stock";

let root:string, db:Database.Database, item:string, a:string, b:string;
let identity:ReturnType<typeof createSqliteIdentity>, execute:ReturnType<typeof createInventory>;
function open(){
  db=initializeDatabase(root);
  identity=createSqliteIdentity(db);
  execute=createInventory(db,identity.authorize,createStockCatalog(db),createInventoryWarehouseGateway(db,identity.authorize,createSqliteLocationUsage(db)),()=>{throw Error("backup unavailable")});
}
const cmd=(input:StockCommand)=>execute(identity.actor(1),input);
function draft(kind:"receipt"|"issue"|"transfer",quantity:string){
  return cmd({op:"draft",kind,lines:[{item,quantity,location:a,...(kind==="transfer"?{destination:b}:{})}]}).id!;
}
const post=(document:string,version=1)=>cmd({op:"post",document,version,command:"post/"+document});
function businessState(){
  return Object.fromEntries(["documents","document_items","movements","balances","audit","receipts","count_locks","reviewed_counts"].map(table=>[table,db.prepare("SELECT * FROM "+table+" ORDER BY rowid").safeIntegers().all()]));
}
beforeEach(async()=>{
  root=mkdtempSync(join(tmpdir(),"wms-p0-"));
  const old=new Database(join(root,"warehouse.sqlite"));
  try{
    runMigrations(old,5);
    const catalog=createSqliteCatalog(old,{save:()=>"",read:()=>null,remove:()=>{}});
    const unit=catalog.createUnit({dimension:"count",name:"Piece",symbol:"pc"});
    const category=catalog.createCategory({name:"General",code:"GEN"});
    const product=catalog.createProduct({name:"Item",sku:"PARENT",productType:"with_variants",baseUnitId:unit.id,categoryId:category.id,allowDecimalQuantity:true,
      variants:[{sku:"RED",name:"Red",attributes:[{name:"Color",value:"Red"}],barcodes:[{code:"00123"}]},{sku:"BLUE",name:"Blue",attributes:[{name:"Color",value:"Blue"}]}]});
    item="v:"+product.variants.find(v=>v.sku==="RED")!.id;
  }finally{old.close()}
  open();
  expect(db.prepare("SELECT count(*) FROM stock_items").pluck().get()).toBe(2);
  expect(createStockCatalog(db).resolveBarcode("00123").item).toBe(item);
  await identity.login(1,"admin","test-password-123",true);
  const branch=cmd({op:"branch",name:"HQ"}).id!;
  const first=cmd({op:"warehouse",name:"A",branch}).id!;
  cmd({op:"warehouse",name:"B",branch});
  const places=cmd({op:"places"}).rows!;
  a=String(places.find(p=>p.warehouse_id===first)!.id);
  b=String(places.find(p=>p.warehouse_id!==first)!.id);
});
afterEach(()=>{
  try{
    if (!db.open) return;
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    expect(db.pragma("journal_mode",{simple:true})).toBe("wal");
    expect(db.pragma("integrity_check")).toEqual([{integrity_check:"ok"}]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  }finally{closeDatabase();rmSync(root,{recursive:true,force:true})}
});
it("replays a committed receipt after reopening without duplicating any business effect",async()=>{
  const id=draft("receipt","9007199254740.993");post(id);
  const saved=businessState();
  closeDatabase();open();expect(()=>identity.actor(1)).toThrow();
  await identity.login(1,"admin","test-password-123",false);
  expect(post(id)).toEqual({id});expect(businessState()).toEqual(saved);
  expect(cmd({op:"balances"}).rows![0].thousandths).toBe("9007199254740993");
  expect(()=>post(id,2)).toThrow("COMMAND_CONFLICT");
  expect(cmd({op:"reconcile"}).rows).toEqual([]);
});
it("preserves the whole transaction on a late failure and reverses a cross-warehouse transfer once",()=>{
  post(draft("receipt","10"));
  const transfer=draft("transfer","4");
  cmd({op:"edit",document:transfer,version:1,lines:[{item,location:a,destination:b,quantity:"3"}]});
  const before=businessState();
  expect(()=>post(transfer)).toThrow("VERSION_CONFLICT");
  db.exec("CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;");
  expect(()=>post(transfer,2)).toThrow("injected receipt failure");
  expect(businessState()).toEqual(before);
  db.exec("DROP TRIGGER fail_receipt");post(transfer,2);
  expect(cmd({op:"balances"}).rows).toEqual(expect.arrayContaining([{item,location:a,thousandths:"7000"},{item,location:b,thousandths:"3000"}]));
  const original=db.prepare("SELECT * FROM movements WHERE document=? ORDER BY id").all(transfer);
  const reverse=()=>cmd({op:"reverse",document:transfer,command:"undo"});
  const reversal=reverse();const saved=businessState();expect(reverse()).toEqual(reversal);
  expect(()=>cmd({op:"reverse",document:transfer,command:"undo-again"})).toThrow("INVALID_REVERSAL");
  expect(()=>db.prepare("UPDATE movements SET delta=1 WHERE document=?").run(transfer)).toThrow();
  expect(()=>db.prepare("DELETE FROM movements WHERE document=?").run(transfer)).toThrow();
  expect(()=>db.prepare("UPDATE documents SET state='draft' WHERE id=?").run(transfer)).toThrow();
  expect(db.prepare("SELECT * FROM movements WHERE document=? ORDER BY id").all(transfer)).toEqual(original);
  expect(businessState()).toEqual(saved);
  expect(cmd({op:"balances"}).rows).toEqual(expect.arrayContaining([{item,location:a,thousandths:"10000"},{item,location:b,thousandths:"0"}]));
  const issue=draft("issue","10.001");const prior=businessState();
  expect(()=>post(issue)).toThrow("INSUFFICIENT_STOCK");expect(businessState()).toEqual(prior);
  expect(cmd({op:"reconcile"}).rows).toEqual([]);
});
it("retains count locks across restart and enforces switched operator permissions",async()=>{
  post(draft("receipt","1"));
  const count=cmd({op:"count",location:a}).id!;
  closeDatabase();open();await identity.login(1,"admin","test-password-123",false);
  const transfer=draft("transfer","1");expect(()=>post(transfer)).toThrow("LOCATION_LOCKED");
  cmd({op:"cancel",document:count,version:1});
  await identity.addOperator(1,"clerk","test-password-456",["clerk"]);
  await identity.login(1,"clerk","test-password-456",false);
  const previous=businessState();
  expect(()=>post(transfer)).toThrow(expect.objectContaining({code:"FORBIDDEN"}));
  expect(()=>cmd({op:"rebuild"})).toThrow(expect.objectContaining({code:"FORBIDDEN"}));
  expect(businessState()).toEqual(previous);
  await identity.login(1,"admin","test-password-123",false);post(transfer);
  const posted=businessState();
  expect(()=>cmd({op:"rebuild"})).toThrow("backup unavailable");
  expect(businessState()).toEqual(posted);
});
it("rejects an incompatible current database before accepting writes",()=>{
  db.exec("DROP TRIGGER immutable_movement");
  closeDatabase();
  expect(()=>initializeDatabase(root)).toThrow(`Incompatible schema v${CURRENT_SCHEMA_VERSION}: immutable_movement`);
});
it("rejects future schemas without altering their migration records",()=>{
  db.prepare("INSERT INTO schema_migrations(version,name) VALUES(99,'future')").run();
  const before=db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  expect(()=>runMigrations(db)).toThrow("Unsupported newer database");
  expect(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(before);
});
it("rejects noninteger balances and preserves foreign-key and document references",()=>{
  const document=draft("receipt","1.125");
  expect(()=>db.prepare("DELETE FROM stock_items WHERE id=?").run(item)).toThrow();
  expect(()=>db.prepare("INSERT INTO balances VALUES(?,?,?)").run(item,a,1.25)).toThrow();
  expect(()=>db.prepare("INSERT INTO balances VALUES(?,?,?)").run("missing",a,1)).toThrow();
  post(document);
  expect(db.prepare("SELECT typeof(qty) FROM balances").pluck().get()).toBe("integer");
  expect(()=>db.prepare("DELETE FROM documents WHERE id=?").run(document)).toThrow();
});
it("reopens the restored dataset with its original stock, receipt, barcode and operator",async()=>{
  const receipt=draft("receipt","12.345");
  post(receipt);
  const saved=snapshot(db,root,join(root,"qa-backups"));
  const baseline=businessState();
  post(draft("issue","1"));
  const staged=stageRestore(saved,root);
  closeDatabase();
  activate(root,staged);
  db=initializeDatabase(activeDirectory(root));
  const restoredIdentity=createSqliteIdentity(db);
  await restoredIdentity.login(1,"admin","test-password-123",false);
  const stockCatalog=createStockCatalog(db);
  const stock=createInventory(db,restoredIdentity.authorize,stockCatalog,createInventoryWarehouseGateway(db,restoredIdentity.authorize,createSqliteLocationUsage(db)),()=>{throw Error("unexpected repair")});
  const actor=restoredIdentity.actor(1);
  expect(stockCatalog.resolveBarcode("00123").item).toBe(item);
  expect(stock(actor,{op:"post",document:receipt,version:1,command:"post/"+receipt})).toEqual({id:receipt});
  expect(businessState()).toEqual(baseline);
  expect(stock(actor,{op:"balances"}).rows).toEqual([{item,location:a,thousandths:"12345"}]);
  expect(stock(actor,{op:"reconcile"}).rows).toEqual([]);
  confirmStartup(root);
});
