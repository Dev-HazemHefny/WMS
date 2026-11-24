import { cpus, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../electron/main/database/migrations";
import { createSqliteCatalog } from "../../catalog/infrastructure/create-sqlite-catalog";
import { createStockCatalog } from "../../catalog/infrastructure/stock-catalog";
import { createSqliteIdentity } from "../../identity/infrastructure/create-sqlite-identity";
import { createInventoryWarehouseGateway } from "../../warehouses/infrastructure/create-inventory-gateway";
import { createWarehouseDirectory } from "../../warehouses/infrastructure/sqlite-directory";
import { SqliteLocationRepository } from "../../warehouses/infrastructure/sqlite-repositories";
import { createSqliteBalanceReader } from "./sqlite-balance-reader";
import { createSqliteInventoryQueries } from "./create-sqlite-inventory-queries";
import { createSqliteInventoryLedger } from "./sqlite-inventory-ledger";
import { createSqliteLocationUsage } from "./sqlite-location-usage";
import { createInventory } from "./sqlite-inventory";

const benchmark = process.env.WMS_INVENTORY_BENCHMARK === "1" ? it : it.skip;
const policyRuns = 101;
const postRuns = 31;

benchmark("measures inventory reports against a bounded synthetic schema-v8 database", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db);
    const catalog = createSqliteCatalog(db, { save: () => "", read: () => null, remove: () => {} });
    const category = catalog.createCategory({ name: "Benchmark", code: "BENCH" }).id;
    const unit = catalog.createUnit({ name: "Piece", symbol: "pc", dimension: "count" }).id;
    const directory = createWarehouseDirectory(db);
    const items = 3000;
    const locations = 2400;
    const warehouses = 6;
    const balancesPerItem = 10;
    const regularMovements = 5;
    const hotMovements = 25000;
    const hotItem = "p:product-0";
    const hotLocation = "location-0";
    const hotWarehouse = "warehouse-0";

    // Bulk-load constrained synthetic rows to keep setup time separate from read timings.
    db.transaction(() => {
      directory.branch("branch", "Benchmark branch");
      for (let site = 0; site < warehouses; site++) {
        directory.warehouse(`warehouse-${site}`, "branch", `Warehouse ${site}`);
      }
      for (let location = 0; location < locations; location++) {
        directory.location(`location-${location}`, `warehouse-${location % warehouses}`, `Location ${location}`);
      }
      const insertProduct = db.prepare(`
        INSERT INTO products(id,name,sku,category_id,base_unit_id,product_type,allow_decimal_quantity,status,created_at,updated_at)
        VALUES (?,?,?,?,?,'simple',1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
      const insertBalance = db.prepare("INSERT INTO balances(item,location,qty) VALUES (?,?,?)");
      const insertMovement = db.prepare(`
        INSERT INTO movements(document,line,item,location,delta,snapshot) VALUES ('fixture',?,?,?,1,'{}')`);
      db.exec(`
        INSERT INTO documents(id,kind,state,lines) VALUES ('fixture','receipt','draft','[]');
        INSERT INTO operators VALUES ('actor','Benchmark','synthetic');
        INSERT INTO operator_roles VALUES ('actor','admin');`);
      let line = 0;
      for (let index = 0; index < items; index++) {
        const product = `product-${index}`;
        insertProduct.run(product, product, `BENCH-${index}`, category, unit);
        for (let offset = 0; offset < balancesPerItem; offset++) {
          const item = `p:${product}`;
          const location = `location-${(index * 7 + offset) % locations}`;
          const count = item === hotItem && location === hotLocation ? hotMovements : regularMovements;
          insertBalance.run(item, location, count);
          for (let entry = 0; entry < count; entry++) insertMovement.run(++line, item, location);
        }
      }
      db.exec("UPDATE documents SET state='posted' WHERE id='fixture'");
    })();
    db.exec("ANALYZE");
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);

    const { authorize } = createSqliteIdentity(db);
    const scope = createInventoryWarehouseGateway(db, authorize, createSqliteLocationUsage(db));
    const stockCatalog = createStockCatalog(db);
    const queries = createSqliteInventoryQueries(db, { authorize, currentActor: () => "actor" }, stockCatalog, scope);
    const reader = createSqliteBalanceReader(db, scope);
    const ledger = createSqliteInventoryLedger(db);
    const identity = { itemId: hotItem, locationId: hotLocation };
    const timings: Record<string, { median: number; max: number }> = {};
    function measure<T>(label: string, read: () => T, runs = 15): T {
      const result = read();
      const samples = Array.from({ length: runs }, () => {
        const start = performance.now();
        read();
        return performance.now() - start;
      }).sort((a, b) => a - b);
      timings[label] = { median: Number(samples[Math.floor(runs / 2)].toFixed(2)), max: Number(samples[runs - 1].toFixed(2)) };
      return result;
    }

    const before = process.memoryUsage();
    expect(measure("exact balance", () => queries.getStockBalance(identity)).onHand).toBe("25.000");
    expect(measure("item balances", () => queries.getStockItemStock({ itemId: hotItem })).balances).toHaveLength(balancesPerItem);
    expect(measure("location balances", () => reader.findByLocation(hotLocation)).length).toBeGreaterThan(0);
    expect(measure("warehouse report", () => queries.getWarehouseStock({ warehouseId: hotWarehouse })).items
      .flatMap(item => item.balances)).toHaveLength(5000);
    expect(measure("item history (50)", () => queries.getInventoryHistory({ itemId: hotItem, limit: 50 })).movements).toHaveLength(50);
    expect(measure("location history (50)", () => queries.getInventoryHistory({ ...identity, limit: 50 })).movements).toHaveLength(50);
    expect(measure("exact reconciliation", () => queries.verifyBalanceConsistency(identity)).discrepancies).toEqual([]);
    expect(measure("legacy full reconciliation", () => ledger.findDiscrepancies(), 5)).toEqual([]);
    const after = process.memoryUsage();

    const checkEligibility = () => scope.assertLocationUsable(hotLocation, "receipt");
    const checkCount = () => scope.countLocationIds(hotLocation);
    measure("location eligibility", checkEligibility, policyRuns);
    expect(measure("location count eligibility", checkCount, policyRuns)).toEqual([hotLocation]);

    const execute = createInventory(db, authorize, stockCatalog, scope, () => { throw Error("unexpected repair"); });
    // Prepare a fresh draft for every warm-up, timed sample and query-count check.
    const drafts = Array.from({ length: postRuns + 2 }, () => execute("actor", {
      op: "draft", kind: "receipt", lines: [{ item: hotItem, location: hotLocation, quantity: "1" }],
    }).id!);
    const postReceipt = () => {
      const document = drafts.pop()!;
      return execute("actor", { op: "post", document, version: 1, command: "post/" + document });
    };
    measure("one-line receipt post", postReceipt, postRuns);

    // Each adapter call executes one definitions SELECT. Count separately from latency samples.
    const listByWarehouse = jest.spyOn(SqliteLocationRepository.prototype, "listByWarehouse");
    let definitionReads: Record<string, number>;
    try {
      definitionReads = Object.fromEntries(Object.entries({
        eligibility: checkEligibility, countEligibility: checkCount, receiptPost: postReceipt,
      }).map(([name, run]) => {
        listByWarehouse.mockClear();
        run();
        return [name, listByWarehouse.mock.calls.length];
      }));
    } finally {
      listByWarehouse.mockRestore();
    }
    expect(definitionReads).toEqual({ eligibility: 1, countEligibility: 1, receiptPost: 1 });
    expect(drafts).toHaveLength(0);
    expect(queries.getStockBalance(identity).onHand).toBe((25 + postRuns + 2).toFixed(3));

    const details = (statement: string, ...params: string[]) =>
      db.prepare<string[], { detail: string }>(`EXPLAIN QUERY PLAN ${statement}`).all(...params).map(row => row.detail);

    console.log(JSON.stringify({
      host: { platform: process.platform, release: release(), arch: process.arch, electron: process.versions.electron,
        node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramBytes: totalmem() },
      fixture: { items, locations: locations + warehouses, warehouses, balances: items * balancesPerItem,
        movements: (items * balancesPerItem - 1) * regularMovements + hotMovements, hotMovements },
      timingsMs: timings,
      locationPolicy: { iterations: { eligibility: policyRuns, countEligibility: policyRuns, receiptPost: postRuns }, definitionReads },
      memoryBytes: { rssBefore: before.rss, rssAfter: after.rss, heapBefore: before.heapUsed, heapAfter: after.heapUsed },
      plans: {
        item: details("SELECT item,location,qty FROM balances WHERE item=? ORDER BY item,location", hotItem),
        location: details("SELECT item,location,qty FROM balances WHERE location=? ORDER BY item,location", hotLocation),
        warehouse: details("SELECT item,location,qty FROM balances WHERE location IN (SELECT value FROM json_each(?)) ORDER BY item,location",
          JSON.stringify(scope.listInventoryLocationIds(hotWarehouse))),
        itemHistory: details("SELECT id,document,delta FROM movements WHERE item=? ORDER BY id DESC LIMIT 51", hotItem),
        locationHistory: details("SELECT id,document,delta FROM movements WHERE item=? AND location=? ORDER BY id DESC LIMIT 51", hotItem, hotLocation),
        reconciliation: details("SELECT item,location,delta FROM movements WHERE item=? AND location=?", hotItem, hotLocation),
      },
    }));
  } finally {
    db.close();
  }
}, 60000);
