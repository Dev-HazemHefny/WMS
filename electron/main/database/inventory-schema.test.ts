import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { createInventory } from "@core/inventory/infrastructure/sqlite-inventory";
import { createSqliteLocationUsage } from "@core/inventory/infrastructure/sqlite-location-usage";
import { createInventoryWarehouseGateway } from "@core/warehouses/infrastructure/create-inventory-gateway";
import { createWarehouseDirectory } from "@core/warehouses/infrastructure/sqlite-directory";
import { Quantity } from "@shared/catalog/quantity";
import { runMigrations, verifyDatabase, verifySchema } from "./migrations";

let db: Database.Database;
const max = 2n ** 63n - 1n;
const index = "balances_location";

beforeEach(() => {
  db = new Database(":memory:");
});

afterEach(() => {
  db.close();
});

function fixture(version = 8) {
  runMigrations(db, version);
  const catalog = createSqliteCatalog(db, {
    save: () => "",
    read: () => null,
    remove: () => {},
  });
  const categoryId = catalog.createCategory({ name: "Inventory", code: "INV" }).id;
  const baseUnitId = catalog.createUnit({ name: "Piece", symbol: "pc", dimension: "count" }).id;
  const shared = { categoryId, baseUnitId, allowDecimalQuantity: true };
  const simple = catalog.createProduct({
    ...shared, name: "Simple", sku: "SIMPLE", productType: "simple",
  }).product.id;
  const family = catalog.createProduct({
    ...shared, name: "Family", sku: "FAMILY", productType: "with_variants",
    variants: [{ name: "Blue", sku: "BLUE", attributes: [{ name: "Color", value: "Blue" }] }],
  });
  const variant = family.variants[0].id;
  const directory = createWarehouseDirectory(db);
  directory.branch("branch", "Branch");
  directory.warehouse("warehouse-a", "branch", "Warehouse A");
  directory.warehouse("warehouse-b", "branch", "Warehouse B");
  directory.location("bin-a", "warehouse-a", "Bin A");
  directory.location("bin-b", "warehouse-b", "Bin B");
  return { simple, family: family.product.id, variant, item: `p:${simple}`, variantItem: `v:${variant}` };
}

function checkIntegrity(version: number) {
  expect(verifyDatabase(db)).toBe(version);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
}

function rows(table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).safeIntegers().all();
}

function locationPlan() {
  return db.prepare(
    "EXPLAIN QUERY PLAN SELECT item,CAST(qty AS TEXT) FROM balances WHERE location=? AND qty>0",
  ).all("bin-a") as { detail: string }[];
}

function insertBalance(item: string, location: string, quantity: unknown) {
  db.prepare("INSERT INTO balances (item,location,qty) VALUES (?,?,?)").run(item, location, quantity);
}

it("creates the inventory schema, keys and non-cascading foreign keys on a fresh database", () => {
  runMigrations(db);
  expect(db.pragma("table_info(balances)")).toMatchObject([
    { name: "item", type: "TEXT", notnull: 1, pk: 1 },
    { name: "location", type: "TEXT", notnull: 1, pk: 2 },
    { name: "qty", type: "INTEGER", notnull: 1, pk: 0 },
  ]);
  expect(db.pragma("foreign_key_list(balances)")).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: "item", table: "stock_items", on_delete: "NO ACTION" }),
    expect.objectContaining({ from: "location", table: "locations", on_delete: "NO ACTION" }),
  ]));
  expect(db.pragma("index_list(balances)")).toEqual(expect.arrayContaining([
    expect.objectContaining({ unique: 1, origin: "pk" }),
    expect.objectContaining({ name: index, unique: 0 }),
  ]));
  expect(db.pragma("index_info(balances_location)")).toMatchObject([{ name: "location" }]);
  expect(rows("schema_migrations")).toContainEqual(expect.objectContaining({
    version: 8n, name: "inventory_balance_location_index",
  }));
  checkIntegrity(8);
});

it.each([0n, 1n, 1000n, 1250n, 10500n, 9007199254740991n, 9007199254740993n, max])(
  "round-trips %s thousandths as an exact SQLite INTEGER",
  (value) => {
    const { item } = fixture();
    insertBalance(item, "bin-a", Quantity.fromScaled(value).minor);
    const read = db.prepare("SELECT qty, typeof(qty) AS storage FROM balances").safeIntegers();
    expect(read.get()).toEqual({ qty: value, storage: "integer" });
  },
);

it.each([-1n, 1.25, "1.25", "text", Buffer.from("1"), null])(
  "rejects invalid balance quantity %p on insert and update",
  (value) => {
    const { item } = fixture();
    expect(() => insertBalance(item, "bin-a", value)).toThrow(/constraint failed/i);
    insertBalance(item, "bin-a", 1n);
    expect(() => db.prepare("UPDATE balances SET qty=?").run(value)).toThrow(/constraint failed/i);
    expect(rows("balances")).toEqual([{ item, location: "bin-a", qty: 1n }]);
  },
);

it("rejects quantities beyond the signed 64-bit limit", () => {
  const { item } = fixture();
  expect(() => insertBalance(item, "bin-a", max + 1n)).toThrow(/bigint is too big/);
  expect(() => insertBalance(item, "bin-a", "9223372036854775808")).toThrow(/CHECK constraint failed/);
  expect(rows("balances")).toEqual([]);
});

it("permits independent simple and variant balances at exact locations across warehouses", () => {
  const { item, variantItem, family } = fixture();
  insertBalance(item, "bin-a", 1000n);
  insertBalance(variantItem, "bin-a", 1250n);
  insertBalance(item, "bin-b", 10500n);
  expect(() => insertBalance(item, "bin-a", 0n)).toThrow(/UNIQUE constraint failed/);
  expect(() => insertBalance(`p:${family}`, "bin-a", 1n)).toThrow(/FOREIGN KEY constraint failed/);
  expect(db.prepare(`SELECT b.item, l.warehouse, b.qty FROM balances b
    JOIN locations l ON l.id=b.location WHERE l.warehouse=? ORDER BY b.item`).safeIntegers().all("warehouse-a"))
    .toEqual([
      { item, warehouse: "warehouse-a", qty: 1000n },
      { item: variantItem, warehouse: "warehouse-a", qty: 1250n },
    ]);
});

it("rejects orphan keys and blocks deleting Catalog and Warehouse definitions in use", () => {
  const { item, simple, variant, variantItem } = fixture();
  expect(() => insertBalance("p:missing", "bin-a", 1n)).toThrow(/FOREIGN KEY constraint failed/);
  expect(() => insertBalance(item, "missing", 1n)).toThrow(/FOREIGN KEY constraint failed/);
  insertBalance(item, "bin-a", 0n);
  insertBalance(variantItem, "bin-b", 1n);
  expect(() => db.prepare("UPDATE balances SET location='missing' WHERE item=?").run(item))
    .toThrow(/FOREIGN KEY constraint failed/);
  expect(() => db.prepare("DELETE FROM products WHERE id=?").run(simple)).toThrow(/FOREIGN KEY constraint failed/);
  expect(() => db.prepare("DELETE FROM product_variants WHERE id=?").run(variant)).toThrow(/FOREIGN KEY constraint failed/);
  expect(() => db.prepare("DELETE FROM locations WHERE id='bin-a'").run()).toThrow(/FOREIGN KEY constraint failed/);
  checkIntegrity(8);
});

it("upgrades posted v7 history without rewriting rows and uses the location index for counts", () => {
  const { item } = fixture(7);
  db.exec("INSERT INTO operators VALUES('actor','Test','unused-test-digest'); INSERT INTO operator_roles VALUES('actor','admin');");
  const { authorize } = createSqliteIdentity(db);
  const execute = createInventory(db, authorize, createStockCatalog(db),
    createInventoryWarehouseGateway(db, authorize, createSqliteLocationUsage(db)), jest.fn());
  const postReceipt = (location: string, quantity: string) => {
    const { id } = execute("actor", { op: "draft", kind: "receipt", lines: [{ item, location, quantity }] });
    execute("actor", { op: "post", document: id!, version: 1, command: `post-${id}` });
  };
  postReceipt("bin-a", Quantity.fromScaled(max).toDecimalString());
  const tables = ["products", "stock_items", "warehouses", "locations", "balances", "movements", "documents", "receipts", "audit"];
  const before = tables.map(rows);
  expect(locationPlan()[0].detail).toMatch(/SCAN balances/);

  runMigrations(db);
  checkIntegrity(8);
  expect(tables.map(rows)).toEqual(before);
  expect(locationPlan()[0].detail).toMatch(/SEARCH balances USING INDEX balances_location/);
  const migrationHistory = rows("schema_migrations");
  const metadata = rows("app_metadata");
  runMigrations(db);
  expect(rows("schema_migrations")).toEqual(migrationHistory);
  expect(rows("app_metadata")).toEqual(metadata);
  expect(tables.map(rows)).toEqual(before);
  expect(execute("actor", { op: "history", item }).rows).toEqual([
    expect.objectContaining({ location: "bin-a", thousandths: max.toString() }),
  ]);
  postReceipt("bin-b", "1.250");
  expect(execute("actor", { op: "balances" }).rows).toEqual([
    { item, location: "bin-a", thousandths: max.toString() },
    { item, location: "bin-b", thousandths: "1250" },
  ]);
  expect(db.prepare("SELECT delta, typeof(delta) AS storage FROM movements WHERE location='bin-b'")
    .safeIntegers().get()).toEqual({ delta: 1250n, storage: "integer" });
  expect(execute("actor", { op: "reconcile" }).rows).toEqual([]);
  checkIntegrity(8);
});

it("rolls back the index, schema metadata and version after a late migration failure", () => {
  const { item } = fixture(7);
  insertBalance(item, "bin-a", max);
  const before = rows("balances");
  const metadata = rows("app_metadata");
  const history = rows("schema_migrations");
  db.exec(`CREATE TEMP TRIGGER fail_v8 BEFORE INSERT ON schema_migrations
    WHEN NEW.version=8 BEGIN SELECT RAISE(ABORT,'injected migration failure'); END;`);
  expect(() => runMigrations(db)).toThrow("injected migration failure");
  expect(db.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(index)).toBeUndefined();
  expect(rows("schema_migrations")).toEqual(history);
  expect(rows("app_metadata")).toEqual(metadata);
  expect(rows("balances")).toEqual(before);
  checkIntegrity(7);
  db.exec("DROP TRIGGER fail_v8");
  runMigrations(db);
  expect(rows("balances")).toEqual(before);
  checkIntegrity(8);
});

it.each([-1n, 1.25])("rejects invalid legacy quantity %p before applying v8", (value) => {
  const { item } = fixture(7);
  db.pragma("ignore_check_constraints=ON");
  insertBalance(item, "bin-a", value);
  db.pragma("ignore_check_constraints=OFF");
  const before = rows("balances");
  expect(() => runMigrations(db)).toThrow(/CHECK constraint failed in balances/);
  expect(verifySchema(db)).toBe(7);
  expect(rows("balances")).toEqual(before);
});

it("rejects legacy orphan balances without deleting them", () => {
  const { item } = fixture(7);
  db.pragma("foreign_keys=OFF");
  insertBalance(item, "missing", 1n);
  const before = rows("balances");
  expect(() => runMigrations(db)).toThrow("Invalid database foreign keys: balances references locations");
  expect(verifySchema(db)).toBe(7);
  expect(rows("balances")).toEqual(before);
});

it("rejects a v8 database missing the required balance index", () => {
  runMigrations(db);
  db.exec("DROP INDEX balances_location");
  expect(() => runMigrations(db)).toThrow("Incompatible schema v8: balances_location");
});
