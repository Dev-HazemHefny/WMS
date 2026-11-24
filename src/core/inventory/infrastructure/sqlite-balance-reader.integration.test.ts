import Database from "better-sqlite3";
import { runMigrations } from "../../../../electron/main/database/migrations";
import { createSqliteCatalog } from "../../catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "../../catalog/infrastructure/stock-catalog";
import { createSqliteIdentity } from "../../identity/infrastructure/create-sqlite-identity";
import { AppError } from "../../shared/errors/app-error";
import { createInventoryWarehouseGateway } from "../../warehouses/infrastructure/create-inventory-gateway";
import { createWarehouseDirectory } from "../../warehouses/infrastructure/sqlite-directory";
import { Quantity, StockBalance, StockIdentity } from "../domain";
import type { InventoryBalanceReader } from "../domain/repositories";
import { createSqliteInventoryQueries } from "./create-sqlite-inventory-queries";
import { createSqliteBalanceReader } from "./sqlite-balance-reader";
import { createInventory } from "./sqlite-inventory";
import { createSqliteLocationUsage } from "./sqlite-location-usage";

const warehouseA = "warehouse-a";
const warehouseB = "warehouse-b";
const max = 2n ** 63n - 1n;
const large = 9007199254740993n;
let db: Database.Database;
let reader: InventoryBalanceReader;
let item: string;
let variant: string;
let emptyItem: string;
let execute: ReturnType<typeof createInventory>;
let queries: ReturnType<typeof createSqliteInventoryQueries>;
let connectQueries: (access: Parameters<typeof createSqliteInventoryQueries>[1]) => typeof queries;

function identity(itemId = item, locationId = "bin-a", warehouseId = warehouseA) {
  return StockIdentity.create(itemId, { id: locationId, warehouseId }, { id: warehouseId });
}

function insertBalance(itemId: string, locationId: string, quantity: bigint | number) {
  db.prepare("INSERT INTO balances (item, location, qty) VALUES (?, ?, ?)").run(itemId, locationId, quantity);
}

function draft(kind: "receipt" | "issue", quantity: string, location = "bin-a") {
  return execute("actor", { op: "draft", kind, lines: [{ item, location, quantity }] }).id!;
}

function post(document: string) {
  return execute("actor", { op: "post", document, version: 1, command: `post-${document}` });
}

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  const catalog = createSqliteCatalog(db, { save: () => "", read: () => null, remove: () => {} });
  const categoryId = catalog.createCategory({ name: "Inventory", code: "INV" }).id;
  const baseUnitId = catalog.createUnit({ name: "Piece", symbol: "pc", dimension: "count" }).id;
  const shared = { categoryId, baseUnitId, allowDecimalQuantity: true };
  const simple = catalog.createProduct({ ...shared, name: "Simple", sku: "SIMPLE", productType: "simple" });
  const empty = catalog.createProduct({ ...shared, name: "Empty", sku: "EMPTY", productType: "simple" });
  const family = catalog.createProduct({
    ...shared, name: "Family", sku: "FAMILY", productType: "with_variants",
    variants: [{ name: "Blue", sku: "BLUE", attributes: [{ name: "Color", value: "Blue" }] }],
  });
  item = `p:${simple.product.id}`;
  emptyItem = `p:${empty.product.id}`;
  variant = `v:${family.variants[0].id}`;

  const directory = createWarehouseDirectory(db);
  directory.branch("branch", "Branch");
  directory.warehouse(warehouseA, "branch", "Warehouse A");
  directory.warehouse(warehouseB, "branch", "Warehouse B");
  directory.location("bin-a", warehouseA, "Bin A");
  directory.location("bin-b", warehouseA, "Bin B");
  directory.location("bin-c", warehouseB, "Bin C");
  directory.location("empty", warehouseA, "Empty");
  db.exec("UPDATE locations SET parent_id = 'bin-a' WHERE id = 'bin-b'");
  db.exec("INSERT INTO operators VALUES ('actor','Test','unused-test-digest'); INSERT INTO operator_roles VALUES ('actor','admin');");

  const { authorize } = createSqliteIdentity(db);
  const warehouses = createInventoryWarehouseGateway(db, authorize, createSqliteLocationUsage(db));
  reader = createSqliteBalanceReader(db, warehouses);
  const stockCatalog = createStockCatalog(db);
  execute = createInventory(db, authorize, stockCatalog, warehouses, jest.fn());
  connectQueries = access => createSqliteInventoryQueries(db, access, stockCatalog, warehouses);
  queries = connectQueries({ currentActor: () => "actor", authorize });
});

afterEach(() => db.close());

it("reports exact stock by item and warehouse and retains inactive location and item balances", () => {
  insertBalance(item, "bin-c", large);
  insertBalance(item, "bin-b", 2n);
  insertBalance(variant, "bin-a", 3n);
  insertBalance(item, "bin-a", 1n);
  db.prepare("UPDATE products SET status='inactive' WHERE id=?").run(item.slice(2));
  db.exec("UPDATE locations SET status='inactive' WHERE id='bin-a'");

  const itemStock = queries.getStockItemStock({ itemId: item });
  expect(itemStock.onHand).toBe("9007199254740.996");
  expect(itemStock.balances.map(({ itemId, locationId, warehouseId }) => [itemId, locationId, warehouseId])).toEqual([
    [item, "bin-a", warehouseA], [item, "bin-b", warehouseA], [item, "bin-c", warehouseB],
  ]);
  const stock = queries.getWarehouseStock({ warehouseId: warehouseA });
  expect(stock.items.map(({ itemId, onHand, balances }) => [itemId, onHand, balances.map(row => row.locationId)]))
    .toEqual([[item, "0.003", ["bin-a", "bin-b"]], [variant, "0.003", ["bin-a"]]]);
  expect(queries.getWarehouseStock({ warehouseId: warehouseA })).toEqual(stock);
  expect(queries.getWarehouseStock({ warehouseId: warehouseB }).items.map(row => row.itemId)).toEqual([item]);
  expect(() => queries.getWarehouseStock({ warehouseId: "unknown" }))
    .toThrow(expect.objectContaining({ code: "WAREHOUSE_NOT_FOUND" }));
  expect(() => draft("receipt", "1", "bin-b")).toThrow(expect.objectContaining({ code: "LOCATION_INACTIVE" }));
});

it("validates exact balance references, distinguishes zero and missing, and leaves records untouched", () => {
  insertBalance(item, "bin-a", 0n);
  const before = db.prepare("SELECT * FROM balances").safeIntegers().all();
  const known = { itemId: item, locationId: "bin-a" };
  expect(queries.getStockBalance(known)).toEqual({
    ...known, warehouseId: warehouseA, onHand: "0.000", baseUnitId: expect.any(String),
  });
  expect(queries.getAvailableQuantity(known)).toMatchObject({ onHand: "0.000", available: "0.000" });
  expect(queries.getAvailableQuantity({ ...known, locationId: "empty" })).toMatchObject({ onHand: null, available: null });
  expect(() => queries.getStockBalance({ ...known, locationId: "unknown" }))
    .toThrow(expect.objectContaining({ code: "LOCATION_NOT_FOUND" }));
  expect(() => queries.getStockBalance({ ...known, itemId: "p:unknown" }))
    .toThrow(expect.objectContaining({ code: "STOCK_ITEM_NOT_FOUND" }));
  expect(db.prepare("SELECT * FROM balances").safeIntegers().all()).toEqual(before);
  expect(db.prepare("SELECT * FROM movements").all()).toEqual([]);
});

it("pages movements by exact descending IDs, location and stock item while preserving signed deltas", () => {
  const receipt = draft("receipt", "9007199254740.993");
  post(receipt);
  // Seed a legitimate SQLite row ID beyond Number's exact integer range.
  const other = draft("receipt", "1", "bin-b");
  db.prepare("INSERT INTO movements(id,document,line,item,location,delta,snapshot) VALUES(?,?,0,?,'bin-b',1000,'{}')")
    .run(large, other, item);
  const issue = draft("issue", "0.005");
  post(issue);
  const unrelated = execute("actor", { op: "draft", kind: "receipt", lines: [
    { item: variant, location: "bin-a", quantity: "1" },
  ] }).id!;
  post(unrelated);
  const request = { itemId: item, limit: 1 };
  const first = queries.getInventoryHistory(request);
  expect(first).toEqual({
    movements: [{ movementId: (large + 1n).toString(), documentId: issue, itemId: item, locationId: "bin-a", delta: "-0.005" }],
    nextBeforeMovementId: (large + 1n).toString(),
  });
  const second = queries.getInventoryHistory({ ...request, beforeMovementId: first.nextBeforeMovementId! });
  expect(second.movements).toEqual([
    { movementId: large.toString(), documentId: other, itemId: item, locationId: "bin-b", delta: "1.000" },
  ]);
  const third = queries.getInventoryHistory({ ...request, beforeMovementId: second.nextBeforeMovementId! });
  expect(third.movements).toEqual([
    { movementId: "1", documentId: receipt, itemId: item, locationId: "bin-a", delta: "9007199254740.993" },
  ]);
  expect(third.nextBeforeMovementId).toBeNull();
  expect(queries.getInventoryHistory({ ...request, beforeMovementId: "1" })).toEqual({ movements: [], nextBeforeMovementId: null });
  expect(queries.getInventoryHistory({ itemId: item, locationId: "bin-a" }).movements.map(row => row.documentId))
    .toEqual([issue, receipt]);
});

it("reconciles one identity with exact deltas and reports discrepancies without repairing", () => {
  post(draft("receipt", "9007199254740.993"));
  post(draft("issue", "0.001"));
  const request = { itemId: item, locationId: "bin-a" };
  expect(queries.verifyBalanceConsistency(request).discrepancies).toEqual([]);
  db.prepare("UPDATE balances SET qty=? WHERE item=? AND location=?").run(large, item, request.locationId);
  insertBalance(item, "bin-b", 0n);
  const difference = [{ onHand: "9007199254740.993", ledger: "9007199254740.992" }];
  expect(queries.verifyBalanceConsistency(request).discrepancies).toEqual(difference);
  expect(queries.verifyBalanceConsistency(request).discrepancies).toEqual(difference);
  expect(queries.verifyBalanceConsistency({ ...request, locationId: "bin-b" }).discrepancies)
    .toEqual([{ onHand: "0.000", ledger: null }]);
  expect(reader.findByIdentity(identity())?.quantity.minor).toBe(large);
  expect(db.prepare("SELECT action FROM audit WHERE action='rebuild'").all()).toEqual([]);
  db.prepare("DELETE FROM balances WHERE item=? AND location=?").run(item, request.locationId);
  expect(queries.verifyBalanceConsistency(request).discrepancies).toEqual([{ onHand: null, ledger: "9007199254740.992" }]);
  expect(reader.findByIdentity(identity())).toBeNull();
});

it("requires a trusted session with read permission and checks access before validation", async () => {
  db.exec("DELETE FROM operator_roles; DELETE FROM operators;");
  const identity = createSqliteIdentity(db);
  const scoped = connectQueries({ currentActor: () => identity.actor(1), authorize: identity.authorize });
  const request = { itemId: item, locationId: "bin-a" };
  expect(() => scoped.getStockBalance(request)).toThrow(expect.objectContaining({ code: "AUTH_REQUIRED" }));
  await identity.login(1, "Admin", "test password", true);
  expect(scoped.getStockBalance(request).onHand).toBeNull();
  await identity.addOperator(1, "Restricted", "test password", []);
  await identity.login(1, "Restricted", "test password", false);
  for (const call of [
    () => scoped.getStockBalance({ ...request, locationId: "" }),
    () => scoped.getAvailableQuantity(request),
    () => scoped.getStockItemStock({ itemId: item }),
    () => scoped.getWarehouseStock({ warehouseId: warehouseA }),
    () => scoped.getInventoryHistory({ itemId: item }),
    () => scoped.verifyBalanceConsistency(request),
  ]) {
    expect(call).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  }
});

it("fails safely when a reference or ledger query encounters a database error", () => {
  db.exec("ALTER TABLE stock_items RENAME TO test_stock_items");
  let failure: unknown;
  try {
    queries.getStockBalance({ itemId: item, locationId: "bin-a" });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AppError);
  expect(failure).toMatchObject({
    code: "INVENTORY_READ_FAILED",
    message: "تعذّرت قراءة بيانات المخزون",
    cause: { code: "SQLITE_ERROR" },
  });
  db.exec("ALTER TABLE test_stock_items RENAME TO stock_items; ALTER TABLE movements RENAME TO test_movements");
  expect(() => queries.getInventoryHistory({ itemId: item })).toThrow(expect.objectContaining({ code: "INVENTORY_READ_FAILED" }));
});

it("returns an immutable domain balance for the exact identity and leaves a missing balance absent", () => {
  insertBalance(item, "bin-a", 1250n);
  const balance = reader.findByIdentity(identity())!;
  expect(balance).toBeInstanceOf(StockBalance);
  expect(balance.identity).toBeInstanceOf(StockIdentity);
  expect(balance.identity).toEqual(identity());
  expect(balance.quantity).toBeInstanceOf(Quantity);
  expect(balance.quantity.toDecimalString()).toBe("1.250");
  expect(Object.isFrozen(balance)).toBe(true);
  expect(Reflect.set(balance.identity, "locationId", "bin-b")).toBe(false);
  expect(Reflect.set(balance.quantity, "minor", 0n)).toBe(false);

  expect(reader.findByIdentity(identity(item, "bin-b"))).toBeNull();
  expect(reader.findByIdentity(identity(variant))).toBeNull();
  expect(db.prepare("SELECT COUNT(*) AS total FROM balances").get()).toEqual({ total: 1 });
});

it("returns one stock item's balances across locations and warehouses in location order", () => {
  insertBalance(item, "bin-c", 3n);
  insertBalance(item, "bin-b", 2n);
  insertBalance(variant, "bin-a", 4n);
  insertBalance(item, "bin-a", 1n);

  expect(reader.findByStockItem(item).map(({ identity, quantity }) => [identity, quantity.minor])).toEqual([
    [identity(item, "bin-a"), 1n], [identity(item, "bin-b"), 2n], [identity(item, "bin-c", warehouseB), 3n],
  ]);
  expect(reader.findByStockItem(emptyItem)).toEqual([]);
});

it("returns every item at an exact location, including zero, and excludes descendants", () => {
  insertBalance(variant, "bin-a", 0n);
  insertBalance(item, "bin-b", 2n);
  insertBalance(item, "bin-a", 1n);

  expect(reader.findByLocation("bin-a")).toEqual([
    StockBalance.create(identity(), Quantity.fromScaled(1n)),
    StockBalance.create(identity(variant), Quantity.fromScaled(0n)),
  ]);
  expect(reader.findByLocation("empty")).toEqual([]);
});

it("lists balances by item and location within each warehouse, including inactive stockable locations", () => {
  insertBalance(item, "bin-c", 3n);
  expect(reader.findByWarehouse(warehouseA)).toEqual([]);
  insertBalance(variant, "bin-a", 4n);
  insertBalance(item, "bin-b", 2n);
  insertBalance(item, "bin-a", 1n);
  insertBalance(item, "empty", 0n);
  db.exec("UPDATE locations SET is_stockable = 0 WHERE id = 'empty'");

  const scope = (warehouseId: string) => reader.findByWarehouse(warehouseId).map(balance => balance.identity);
  expect(scope(warehouseA)).toEqual([identity(), identity(item, "bin-b"), identity(variant)]);
  expect(scope(warehouseB)).toEqual([identity(item, "bin-c", warehouseB)]);

  db.exec("UPDATE locations SET status = 'inactive' WHERE id = 'bin-a'");
  expect(scope(warehouseA)).toEqual([identity(), identity(item, "bin-b"), identity(variant)]);
  expect(reader.findByLocation("bin-b")).toHaveLength(1);
  expect(scope(warehouseB)).toEqual([identity(item, "bin-c", warehouseB)]);
  expect(() => reader.findByWarehouse("unknown")).toThrow(expect.objectContaining({ code: "WAREHOUSE_NOT_FOUND" }));
});

it("reads exact SQLite integers written by posting, including zero and the upper signed 64-bit limit", () => {
  post(draft("receipt", "1.250"));
  post(draft("receipt", Quantity.fromScaled(large).toDecimalString(), "bin-b"));
  post(draft("receipt", Quantity.fromScaled(max).toDecimalString(), "bin-c"));
  expect(reader.findByStockItem(item).map(balance => balance.quantity.minor)).toEqual([1250n, large, max]);

  const overflow = draft("receipt", "0.001", "bin-c");
  expect(() => post(overflow)).toThrow("QUANTITY_OVERFLOW");
  expect(reader.findByIdentity(identity(item, "bin-c", warehouseB))?.quantity.minor).toBe(max);

  post(draft("issue", "1.250"));
  expect(reader.findByIdentity(identity())?.quantity.minor).toBe(0n);
  const overdraft = draft("issue", "0.001");
  expect(() => post(overdraft)).toThrow("INSUFFICIENT_STOCK");
  expect(reader.findByIdentity(identity())?.quantity.minor).toBe(0n);
  expect(db.prepare("SELECT DISTINCT typeof(qty) AS storage FROM balances").all()).toEqual([{ storage: "integer" }]);
});

it.each([-1n, -(2n ** 63n), 1.25])("rejects a corrupt stored quantity of %p", quantity => {
  db.pragma("ignore_check_constraints = ON");
  insertBalance(item, "bin-a", quantity);
  db.pragma("ignore_check_constraints = OFF");

  const invalid = expect.objectContaining({ code: "INVALID_BALANCE_RECORD", cause: expect.any(Error) });
  expect(() => reader.findByIdentity(identity())).toThrow(invalid);
  expect(() => reader.findByWarehouse(warehouseA)).toThrow(invalid);
});

it("rejects malformed identities and orphan records when reading stored balances", () => {
  const invalid = expect.objectContaining({ code: "INVALID_BALANCE_RECORD" });
  db.pragma("foreign_keys = OFF");
  insertBalance("p:orphan", "bin-a", 1n);
  insertBalance(item, "orphan-location", 2n);
  db.pragma("foreign_keys = ON");
  expect(() => reader.findByIdentity(identity("p:orphan"))).toThrow(invalid);
  expect(() => reader.findByStockItem(item)).toThrow(invalid);

  const directory = createWarehouseDirectory(db);
  directory.location(" whitespace", warehouseB, "Corrupt location ID");
  insertBalance(item, " whitespace", 3n);
  expect(() => reader.findByWarehouse(warehouseB)).toThrow(invalid);
});

it("preserves the SQLite failure as the cause of a typed balance read error", () => {
  expect(reader.findByLocation("empty")).toEqual([]);
  db.exec("DROP TABLE balances");
  expect.assertions(3);
  try {
    reader.findByLocation("empty");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BALANCE_READ_FAILED",
      message: "تعذّرت قراءة أرصدة المخزون",
      cause: { code: "SQLITE_ERROR", message: expect.stringContaining("no such table: balances") },
    });
  }
});

it("reads posted changes inside the caller transaction and observes the rollback outside it", () => {
  const document = draft("receipt", "1.250");
  const rollback = new Error("roll back caller transaction");
  expect(() => db.transaction(() => {
    post(document);
    expect(reader.findByIdentity(identity())?.quantity.minor).toBe(1250n);
    expect(reader.findByWarehouse(warehouseA)).toHaveLength(1);
    expect(db.prepare("SELECT document FROM movements").all()).toEqual([{ document }]);
    throw rollback;
  }).immediate()).toThrow(rollback);

  expect(reader.findByIdentity(identity())).toBeNull();
  expect(db.prepare("SELECT document FROM movements").all()).toEqual([]);
  expect(post(document).id).toBe(document);
});

it("rolls back balances, movements and posting metadata after a late stock posting failure", () => {
  post(draft("receipt", "8"));
  const document = draft("issue", "2");
  const movementRows = () => db.prepare("SELECT document, delta FROM movements ORDER BY id").safeIntegers().all();
  const before = movementRows();
  db.exec(`CREATE TEMP TRIGGER interrupt_post BEFORE INSERT ON audit WHEN NEW.action = 'post'
    BEGIN SELECT RAISE(ABORT, 'injected late posting failure'); END;`);

  expect(() => post(document)).toThrow("injected late posting failure");
  expect(reader.findByIdentity(identity())?.quantity.minor).toBe(8000n);
  expect(movementRows()).toEqual(before);
  expect(db.prepare("SELECT state, version FROM documents WHERE id = ?").get(document)).toEqual({ state: "draft", version: 1 });
  expect(db.prepare("SELECT document FROM receipts WHERE document = ?").get(document)).toBeUndefined();

  db.exec("DROP TRIGGER interrupt_post");
  expect(post(document).id).toBe(document);
  expect(post(document).id).toBe(document);
  expect(reader.findByIdentity(identity())?.quantity.minor).toBe(6000n);
  expect(movementRows()).toEqual([...before, { document, delta: -2000n }]);
});

it("leaves foreign key, nonnegative quantity and composite identity enforcement in place", () => {
  insertBalance(item, "bin-a", 1n);
  expect(reader.findByLocation("bin-a")).toHaveLength(1);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(() => insertBalance("p:missing", "bin-a", 1n)).toThrow(/FOREIGN KEY/);
  expect(() => insertBalance(item, "bin-b", -1n)).toThrow(/CHECK/);
  expect(() => insertBalance(item, "bin-a", 2n)).toThrow(/UNIQUE/);
  expect(reader.findByLocation("bin-a")[0].quantity.minor).toBe(1n);
  expect(reader.findByLocation("bin-b")).toEqual([]);
});
