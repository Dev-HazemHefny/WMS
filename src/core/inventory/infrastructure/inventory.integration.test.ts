import {createInventoryWarehouseGateway} from "@core/warehouses/infrastructure/create-inventory-gateway";
import {createSqliteLocationUsage} from "./sqlite-location-usage";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../electron/main/database/migrations";
import { createSqliteCatalog } from "../../catalog/infrastructure/create-sqlite-catalog";
import { createInventory } from "./sqlite-inventory";
import { createSqliteIdentity } from "../../identity/infrastructure/create-sqlite-identity";
import { Quantity } from "../../../shared/catalog/quantity";
import { ConversionFactor } from "../../../shared/catalog/conversion";
import { assertValidParent } from "../../catalog/domain/category-rules";
import { createVerifiedSnapshot } from "../../../../electron/main/recovery";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("inventory acceptance", () => {
  it("preserves precision, bounds and deep category ancestry", () => {
    expect(Quantity.parse("1.125", true).minor).toBe(1125n);
    expect(() => Quantity.parse("1.0001", true)).toThrow();
    expect(() =>
      Quantity.parse("0.001", true).toBase(ConversionFactor.of(1, 2), true),
    ).toThrow();
    expect(() => Quantity.parse("9223372036854775.808", true)).toThrow();
    const chain = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      parentId: i ? String(i - 1) : null,
    }));
    expect(() => assertValidParent(null, "99", chain)).not.toThrow();
    expect(() => assertValidParent("0", "99", chain)).toThrow();
  });
  it("posts once, rolls back a failed transfer, enforces frozen counts and reconciles", async () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db, 5);

      const catalog = createSqliteCatalog(db, {
        save: () => "",
        read: () => null,
        remove: () => {},
      });
      const category = catalog.createCategory({ name: "Test", code: "CAT" }),
        unit = catalog.createUnit({
          name: "Each",
          symbol: "ea",
          dimension: "count",
        });
      const product = catalog.createProduct({
        name: "Test",
        sku: "TEST",
        categoryId: category.id,
        baseUnitId: unit.id,
        productType: "simple",
        allowDecimalQuantity: false,
      });
      const upgradeRoot=mkdtempSync(join(tmpdir(),"wms-inventory-upgrade-"));
      try {
        runMigrations(db, undefined, {beforeUpgrade:()=>{createVerifiedSnapshot(db,upgradeRoot,join(upgradeRoot,"backups"));}});
      } finally { rmSync(upgradeRoot,{recursive:true,force:true}); }
      runMigrations(db);
      const identity = createSqliteIdentity(db);
      await identity.login(1, "user", "a long password", true);
      const user = identity.actor(1),
        inventory = createInventory(
          db,
          identity.authorize,
          createStockCatalog(db),createInventoryWarehouseGateway(db,identity.authorize,createSqliteLocationUsage(db)),jest.fn());
      await identity.addOperator(1, "second", "another long password", [
        "clerk",
        "supervisor",
      ]);
      await identity.login(2, "second", "another long password", false);
      identity.authorize(identity.actor(2), "draft");
      identity.authorize(identity.actor(2), "post");
      expect(() => identity.authorize(identity.actor(2), "restore")).toThrow();
      identity.end(2);
      expect(() => identity.actor(2)).toThrow();
      const item = "p:" + product.product.id;
      const branch = inventory(user, { op: "branch", name: "branch" }).id!;
      const warehouse = inventory(user, {
        op: "warehouse",
        name: "warehouse",
        branch,
      }).id!;
      const location = String(inventory(user, { op: "places" }).rows![0].id);
      const destination = inventory(user, {
        op: "location",
        name: "other",
        warehouse,
      }).id!;
      const doc = (
        kind: "receipt" | "transfer" | "issue",
        quantity: string,
        loc = location,
      ) =>
        inventory(user, {
          op: "draft",
          kind,
          lines: [
            {
              quantity,
              item,
              location: loc,
              ...(kind === "transfer" ? { destination } : {}),
            },
          ],
        }).id!;
      const post = (document: string, command = document, version = 1) =>
        inventory(user, { op: "post", version, document, command });
      const receipt = doc("receipt", "10");
      post(receipt);
      expect(post(receipt).id).toBe(receipt);
      expect(() => post(receipt, "different")).toThrow();
      const transfer = doc("transfer", "4");
      db.exec(
        "CREATE TRIGGER interrupt BEFORE INSERT ON movements WHEN NEW.delta>0 BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect(() => post(transfer)).toThrow();
      expect(inventory(user, { op: "balances" }).rows![0].thousandths).toBe(
        "10000",
      );
      db.exec("DROP TRIGGER interrupt");
      post(transfer);
      post(doc("issue", "1", destination));
      expect(() =>
        inventory(user, { op: "reverse", document: transfer, command: "r" }),
      ).toThrow("INSUFFICIENT_STOCK");
      const count = inventory(user, { op: "count", location }).id!;
      expect(() => post(doc("issue", "1"))).toThrow("LOCATION_LOCKED");
      expect(() =>
        inventory(user, { op: "review", document: count, version: 1 }),
      ).toThrow("INCOMPLETE_COUNT");
      inventory(user, {
        op: "edit",
        document: count,
        version: 1,
        lines: [{ item, location, quantity: "0" }],
      });
      inventory(user, { op: "review", document: count, version: 2 });
      post(count, "count-post", 3);
      expect(inventory(user, { op: "reconcile" }).rows).toEqual([]);
      db.prepare("UPDATE balances SET qty=100 WHERE location=?").run(location);
      expect(inventory(user,{op:"reconcile"}).rows).toHaveLength(1);
      inventory(user,{op:"rebuild"});
      expect(inventory(user,{op:"reconcile"}).rows).toEqual([]);
      expect(() => inventory("unauthorized", { op: "balances" })).toThrow();
    } finally {
      db.close();
    }
  });
});
