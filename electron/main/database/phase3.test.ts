import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CURRENT_SCHEMA_VERSION, runMigrations, verifyDatabase, verifySchema } from "./migrations";
import { initializeDatabase, closeDatabase } from "./index";
import { createVerifiedSnapshot, snapshot, stageRestore, verifyRestorableSnapshot } from "../recovery";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import { createInventory } from "@core/inventory/infrastructure/sqlite-inventory";
import { createIdentity } from "@core/identity/application/identity";
import { createWarehouseDirectory } from "@core/warehouses/infrastructure/sqlite-directory";
import { createInventoryWarehouseGateway } from "@core/warehouses/infrastructure/create-inventory-gateway";
import { createSqliteLocationUsage } from "@core/inventory/infrastructure/sqlite-location-usage";

let root: string;
let db: Database.Database;
let item: string;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XkAAAAASUVORK5CYII=", "base64");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function inventory() {
  const authorize=createIdentity(db).authorize;
  return createInventory(db, authorize, createStockCatalog(db), createInventoryWarehouseGateway(db,authorize,createSqliteLocationUsage(db)), () => { throw Error("unexpected repair"); });
}
function state(tables: readonly string[]) {
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()]));
}
const inventoryTables = ["stock_items", "documents", "document_items", "movements", "balances", "count_locks", "count_expected", "reviewed_counts", "receipts", "audit"];
function upgrade() {
  runMigrations(db, CURRENT_SCHEMA_VERSION, {
    beforeUpgrade: () => { createVerifiedSnapshot(db, root, join(root, "backups")); },
  });
}
function backupDirectories() {
  return readdirSync(join(root, "backups")).filter(name => name.startsWith("wms-")).map(name => join(root, "backups", name));
}
function insertLocation(id: string, warehouse = "w-a", parent: string | null = null, isStockable = 1) {
  db.prepare(`INSERT INTO locations(id,warehouse,name,code,parent_id,is_stockable,created_at,updated_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(id, warehouse, id, id.toUpperCase(), parent, isStockable);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wms-v7-"));
  db = new Database(join(root, "warehouse.sqlite"));
  db.pragma("foreign_keys=ON");
  db.pragma("journal_mode=WAL");
  runMigrations(db, 6);
  const catalog = createSqliteCatalog(db, { save: () => "", read: () => null, remove: () => {} });
  const category = catalog.createCategory({ name: "Test", code: "TEST" });
  const unit = catalog.createUnit({ name: "Piece", symbol: "pc", dimension: "count" });
  const product = catalog.createProduct({ name: "Product", sku: "PRODUCT", categoryId: category.id, baseUnitId: unit.id, productType: "simple", allowDecimalQuantity: true });
  item = "p:" + product.product.id;
  for (const folder of ["products", "brands"]) {
    mkdirSync(join(root, "media", folder), { recursive: true });
    writeFileSync(join(root, "media", folder, "test.png"), png);
  }
  db.prepare("UPDATE products SET image_path='products/test.png' WHERE id=?").run(product.product.id);
  db.prepare("INSERT INTO brands(id,code,name,image_path,status,created_at,updated_at) VALUES('brand','BRAND','Brand','brands/test.png','active','old','old')").run();
  db.prepare("INSERT INTO operators VALUES('actor','Test','unused-test-digest')").run();
  db.prepare("INSERT INTO operator_roles VALUES('actor','admin')").run();
  const directory = createWarehouseDirectory(db);
  directory.branch("branch-b", "Branch B");
  directory.branch("branch-a", "Branch A");
  directory.warehouse("w-a", "branch-a", "Warehouse A");
  directory.warehouse("w-b", "branch-b", "Warehouse B");
  // Exercise a real historical warehouse with no default and a referenced custom location.
  db.prepare("DELETE FROM locations WHERE warehouse='w-b'").run();
  directory.location("loc-a", "w-a", "Custom A");
  directory.location("loc-b", "w-b", "Custom B");
  // Historical v6 fixture data predates mandatory v7 Warehouse validation.
  // Seed that representation directly; current application services require v7.
  const lines=JSON.stringify([{item,location:"loc-a",quantity:"9007199254740.993"}]);
  db.prepare("INSERT INTO documents(id,kind,state,lines) VALUES('receipt','receipt','draft',?)").run(lines);
  const movement=JSON.stringify({item,location:"loc-a",quantity:"9007199254740.993",enteredUnit:unit.id,baseUnit:unit.id,numerator:1,denominator:1,base:"9007199254740993"});
  db.prepare("INSERT INTO movements(document,line,item,location,delta,snapshot) VALUES('receipt',0,?,'loc-a',?,?)").run(item,9007199254740993n,movement);
  db.prepare("INSERT INTO balances VALUES(?,'loc-a',?)").run(item,9007199254740993n);
  db.exec("UPDATE documents SET state='posted',version=2 WHERE id='receipt'");
  db.prepare("INSERT INTO receipts VALUES('receipt','receipt',?)").run(JSON.stringify({op:"post",document:"receipt",version:1,command:"receipt"}));
  db.exec("INSERT INTO documents(id,kind,state,lines) VALUES('count','count','draft','[]'); INSERT INTO count_locks VALUES('loc-a','count');");
  db.prepare("INSERT INTO count_expected VALUES('count',?,?)").run(item,9007199254740993n);
  db.prepare("INSERT INTO documents(id,kind,state,lines) VALUES('transfer','transfer','draft',?)").run(JSON.stringify([{item,location:"loc-a",destination:"loc-b",quantity:"1"}]));
});
afterEach(() => {
  closeDatabase();
  if (db?.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

it("upgrades populated WAL data without changing IDs, stock, history, counts or media references", () => {
  const inventoryBefore = state(inventoryTables);
  const ids = state(["branches", "warehouses", "locations"]);
  const defaultId = db.prepare("SELECT id FROM locations WHERE warehouse='w-a' AND name='افتراضي'").pluck().get();
  const locationsBefore = db.prepare("SELECT id,warehouse FROM locations ORDER BY warehouse,id").all() as {id:string;warehouse:string}[];
  upgrade();
  expect(verifyDatabase(db)).toBe(7);
  expect(state(inventoryTables)).toEqual(inventoryBefore);
  expect(db.prepare("SELECT id FROM locations WHERE warehouse='w-a' AND is_default=1").pluck().get()).toBe(defaultId);
  expect(db.prepare("SELECT warehouse FROM locations WHERE id='loc-b'").pluck().get()).toBe("w-b");
  expect(db.prepare("SELECT id,name FROM branches ORDER BY rowid").safeIntegers().all()).toEqual(ids.branches);
  expect(db.prepare("SELECT id,branch,name FROM warehouses ORDER BY rowid").safeIntegers().all()).toEqual(ids.warehouses);
  expect(db.prepare("SELECT id,code FROM branches ORDER BY id").all()).toEqual([{id:"branch-a",code:"BR-000001"},{id:"branch-b",code:"BR-000002"}]);
  for (const warehouse of ["w-a", "w-b"]) {
    const oldLocations = locationsBefore.filter(location => location.warehouse === warehouse);
    oldLocations.forEach((location, index) => {
      const row = db.prepare("SELECT code,parent_id,is_stockable,status,version,created_at FROM locations WHERE id=?").get(location.id) as Record<string,unknown>;
      expect(row).toMatchObject({code:"LOC-"+String(index+1).padStart(6,"0"),parent_id:null,is_stockable:1,status:"active",version:1});
      expect(row.created_at).toBeTruthy();
    });
  }
  expect(db.prepare("SELECT warehouse,count(*) n FROM locations WHERE is_default=1 GROUP BY warehouse ORDER BY warehouse").all()).toEqual([{warehouse:"w-a",n:1},{warehouse:"w-b",n:1}]);
  const paths = backupDirectories();
  expect(paths).toHaveLength(1);
  const manifest = JSON.parse(readFileSync(join(paths[0],"manifest.json"),"utf8"));
  expect(manifest.schema).toBe(6);
  expect(manifest.files).toEqual({"products/test.png":digest(join(root,"media/products/test.png")),"brands/test.png":digest(join(root,"media/brands/test.png"))});
  verifyRestorableSnapshot(paths[0], join(root,"verify-again"));
  const beforeReopen = state(["branches","warehouses","locations",...inventoryTables]);
  db.close();
  db = initializeDatabase(root);
  expect(state(["branches","warehouses","locations",...inventoryTables])).toEqual(beforeReopen);
  expect(backupDirectories()).toEqual(paths);
});

it("requires backup verification even when the runner is called directly", () => {
  const before = state(["schema_migrations",...inventoryTables]);
  expect(() => runMigrations(db)).toThrow("Verified upgrade backup required");
  expect(state(["schema_migrations",...inventoryTables])).toEqual(before);
  expect(verifySchema(db)).toBe(6);
});

it("aborts startup when referenced media cannot be backed up and preserves the old schema", () => {
  const before = state(["schema_migrations",...inventoryTables]);
  rmSync(join(root,"media/products/test.png"));
  db.close();
  expect(() => initializeDatabase(root)).toThrow();
  db = new Database(join(root,"warehouse.sqlite"));
  expect(verifySchema(db)).toBe(6);
  expect(state(["schema_migrations",...inventoryTables])).toEqual(before);
  expect((db.pragma("table_info(branches)") as {name:string}[]).some(column => column.name === "code")).toBe(false);
});

it("rejects a damaged backup before the first v7 change", () => {
  const saved = snapshot(db,root,join(root,"backups"));
  writeFileSync(join(saved,"media/brands/test.png"),"corrupted");
  expect(() => runMigrations(db,7,{beforeUpgrade:()=>verifyRestorableSnapshot(saved,join(root,"verify"))})).toThrow("checksum");
  expect(verifySchema(db)).toBe(6);
  expect((db.pragma("table_info(locations)") as {name:string}[]).some(column => column.name === "parent_id")).toBe(false);
});

it("rolls back a late migration failure and restores the verified pre-upgrade dataset", () => {
  const before = state(["branches","warehouses","locations",...inventoryTables]);
  db.exec("CREATE TEMP TRIGGER fail_v7 BEFORE INSERT ON schema_migrations WHEN NEW.version=7 BEGIN SELECT RAISE(ABORT,'injected v7 failure'); END;");
  expect(upgrade).toThrow("injected v7 failure");
  expect(verifySchema(db)).toBe(6);
  expect(state(["branches","warehouses","locations",...inventoryTables])).toEqual(before);
  db.exec("DROP TRIGGER fail_v7");
  const saved = backupDirectories()[0];
  const backupHash = digest(join(saved,"warehouse.sqlite"));
  const restoredId = stageRestore(saved,root);
  const restored = new Database(join(root,restoredId,"warehouse.sqlite"));
  try {
    expect(verifyDatabase(restored)).toBe(7);
    for (const table of inventoryTables) expect(restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all()).toEqual(before[table]);
    expect(readFileSync(join(root,restoredId,"media/products/test.png"))).toEqual(png);
  } finally { restored.close(); }
  expect(digest(join(saved,"warehouse.sqlite"))).toBe(backupHash);
  expect(verifySchema(db)).toBe(6);
});

it("rejects incompatible v6 before mutation", () => {
  db.exec("DROP TRIGGER immutable_movement");
  const before = state(["schema_migrations",...inventoryTables]);
  const beforeUpgrade = jest.fn();
  expect(() => runMigrations(db,7,{beforeUpgrade})).toThrow(/Incompatible schema v6/);
  expect(beforeUpgrade).not.toHaveBeenCalled();
  expect(state(["schema_migrations",...inventoryTables])).toEqual(before);
});

it("aborts safely when backup creation fails and leaves any prior backup unchanged", () => {
  const first = createVerifiedSnapshot(db,root,join(root,"saved-backups"));
  const previousHash = digest(join(first,"warehouse.sqlite"));
  const before = state(["schema_migrations","locations",...inventoryTables]);
  writeFileSync(join(root,"backups"),"blocked destination");
  db.close();
  expect(()=>initializeDatabase(root)).toThrow();
  db = new Database(join(root,"warehouse.sqlite"));
  expect(verifyDatabase(db)).toBe(6);
  expect(state(["schema_migrations","locations",...inventoryTables])).toEqual(before);
  expect(digest(join(first,"warehouse.sqlite"))).toBe(previousHash);
});

it("enforces hierarchy, code scopes, default structure and immutable ownership", () => {
  upgrade();
  insertLocation("zone", "w-a", null, 0);
  insertLocation("shelf", "w-a", "zone", 0);
  insertLocation("bin", "w-a", "shelf");
  const rejects = [
    "UPDATE locations SET parent_id='bin' WHERE id='bin'",
    "UPDATE locations SET parent_id='bin' WHERE id='zone'",
    "UPDATE locations SET parent_id='loc-b' WHERE id='bin'",
    "UPDATE locations SET parent_id='absent' WHERE id='bin'",
    "UPDATE locations SET warehouse='w-b' WHERE id='bin'",
    "UPDATE locations SET id='new-id' WHERE id='bin'",
    "UPDATE locations SET code='lowercase' WHERE id='bin'",
    "UPDATE locations SET code=NULL WHERE id='bin'",
    "UPDATE locations SET code='ZONE' WHERE id='bin'",
    "UPDATE locations SET status='deleted' WHERE id='bin'",
    "UPDATE locations SET is_stockable=2 WHERE id='bin'",
    "UPDATE locations SET is_default=2 WHERE id='bin'",
    "UPDATE locations SET location_type='fixed-level' WHERE id='bin'",
    "UPDATE locations SET version=0 WHERE id='bin'",
    "UPDATE locations SET version=1.5 WHERE id='bin'",
    "UPDATE locations SET parent_id='zone' WHERE warehouse='w-a' AND is_default=1",
    "UPDATE locations SET is_stockable=0 WHERE warehouse='w-a' AND is_default=1",
    "UPDATE locations SET is_default=0 WHERE warehouse='w-a' AND is_default=1",
    "DELETE FROM locations WHERE warehouse='w-a' AND is_default=1",
    "UPDATE locations SET is_default=1 WHERE id='loc-a'",
    "UPDATE branches SET code=(SELECT code FROM branches WHERE id='branch-a') WHERE id='branch-b'",
    "UPDATE warehouses SET branch=NULL WHERE id='w-a'",
  ];
  for (const sql of rejects) expect(() => db.exec(sql)).toThrow();
  insertLocation("zone-other", "w-b");
  db.prepare("UPDATE locations SET code='ZONE' WHERE id='zone-other'").run();
  expect(verifyDatabase(db)).toBe(7);
  db.exec("DROP TRIGGER phase3_location_owner");
  db.close();
  expect(() => initializeDatabase(root)).toThrow(/Incompatible schema v7/);
});

it("keeps stock and history unchanged when reparenting and counts exactly one location", () => {
  upgrade();
  const execute = inventory();
  const oldCount = db.prepare("SELECT document FROM count_locks WHERE location='loc-a'").pluck().get() as string;
  execute("actor",{op:"cancel",document:oldCount,version:1});
  insertLocation("new-parent");
  insertLocation("child", "w-a", "loc-a");
  const before = state(inventoryTables);
  db.prepare("UPDATE locations SET parent_id='new-parent',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id='loc-a'").run();
  expect(state(inventoryTables)).toEqual(before);
  expect(db.prepare("SELECT id,warehouse FROM locations WHERE id='loc-a'").get()).toEqual({id:"loc-a",warehouse:"w-a"});
  const receipt = execute("actor",{op:"draft",kind:"receipt",lines:[{item,location:"child",quantity:"3"}]}).id!;
  execute("actor",{op:"post",document:receipt,version:1,command:"child-receipt"});
  const count = execute("actor",{op:"count",location:"loc-a"}).id!;
  expect(db.prepare("SELECT item,CAST(expected AS TEXT) expected FROM count_expected WHERE document=?").all(count)).toEqual([{item,expected:"9007199254740993"}]);
  const extra = execute("actor",{op:"draft",kind:"receipt",lines:[{item,location:"child",quantity:"1"}]}).id!;
  execute("actor",{op:"post",document:extra,version:1,command:"child-extra"});
  expect(db.prepare("SELECT location FROM count_locks").all()).toEqual([{location:"loc-a"}]);
  expect(execute("actor",{op:"reconcile"}).rows).toEqual([]);
  expect(verifyDatabase(db)).toBe(7);
});

it("rejects invalid historical relationships before requesting a backup or altering tables", () => {
  db.pragma("foreign_keys=OFF");
  db.prepare("UPDATE locations SET warehouse='missing' WHERE id='loc-b'").run();
  const before=state(["schema_migrations","branches","warehouses","locations",...inventoryTables]);
  const beforeUpgrade=jest.fn();
  expect(()=>runMigrations(db,7,{beforeUpgrade})).toThrow(/foreign keys/);
  expect(beforeUpgrade).not.toHaveBeenCalled();
  expect(state(["schema_migrations","branches","warehouses","locations",...inventoryTables])).toEqual(before);
});

it("creates new v7 warehouses with one default atomically while retaining legacy calls", () => {
  upgrade();
  const directory = createWarehouseDirectory(db);
  directory.branch("new-branch","New branch");
  directory.warehouse("new-warehouse","new-branch","New warehouse");
  expect(db.prepare("SELECT count(*) FROM locations WHERE warehouse='new-warehouse' AND is_default=1 AND is_stockable=1 AND parent_id IS NULL").pluck().get()).toBe(1);
  db.exec("CREATE TEMP TRIGGER no_location BEFORE INSERT ON locations WHEN NEW.warehouse='failed' BEGIN SELECT RAISE(ABORT,'injected default failure'); END;");
  expect(() => directory.warehouse("failed","new-branch","Failed warehouse")).toThrow("injected default failure");
  expect(db.prepare("SELECT 1 FROM warehouses WHERE id='failed'").get()).toBeUndefined();
  directory.location("new-location","new-warehouse","New location");
  expect(verifyDatabase(db)).toBe(7);
});

it("bootstraps a new empty file directly to v7 without a historical backup", () => {
  const freshRoot = join(root,"fresh");
  mkdirSync(freshRoot);
  const fresh = initializeDatabase(freshRoot);
  expect(verifyDatabase(fresh)).toBe(7);
  expect(readdirSync(freshRoot)).not.toContain("backups");
  const directory = createWarehouseDirectory(fresh);
  directory.branch("first","First");
  directory.warehouse("first-wh","first","First warehouse");
  expect(verifyDatabase(fresh)).toBe(7);
});
