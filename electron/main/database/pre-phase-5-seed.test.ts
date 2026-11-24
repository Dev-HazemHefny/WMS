import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedAccounts, seedProfile } from "../../../scripts/pre-phase-5/seed";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import { CURRENT_SCHEMA_VERSION, verifyDatabase } from "./migrations";

describe("Pre-Phase 5 development fixture", () => {
  let directory: string;
  let db: Database.Database;
  let counts: Awaited<ReturnType<typeof seedProfile>>;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "wms-seed-test-"));
    counts = await seedProfile(directory);
    db = new Database(join(directory, "warehouse.sqlite"), { fileMustExist: true });
    db.pragma("foreign_keys = ON");
  });

  afterAll(() => {
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("has the expected catalog, hierarchy and account coverage", async () => {
    expect(counts).toEqual({
      categories: 13, brands: 5, units: 10, products: 44, product_variants: 12,
      product_packaging_units: 71, product_variant_packaging_units: 24, barcodes: 104,
      branches: 3, warehouses: 4, locations: 37, operators: 3, balances: 76, documents: 4, movements: 77,
    });
    expect(verifyDatabase(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.prepare(`SELECT root.code FROM categories leaf JOIN categories parent ON parent.id=leaf.parent_id
      JOIN categories root ON root.id=parent.parent_id WHERE leaf.code='DEMO-FOOD-RESERVE'`).pluck().get()).toBe("DEMO-FOOD");
    expect(db.prepare(`SELECT b.code branch, w.code warehouse, z.code zone, s.code shelf
      FROM locations l JOIN locations s ON s.id=l.parent_id JOIN locations z ON z.id=s.parent_id
      JOIN warehouses w ON w.id=l.warehouse JOIN branches b ON b.id=w.branch
      WHERE l.name='Bin A-01-02' ORDER BY w.code`).all()).toEqual([
      { branch: "DEMO-CAI", warehouse: "DEMO-CENTRAL", zone: "DEMO-A", shelf: "DEMO-A01" },
      { branch: "DEMO-ALX", warehouse: "DEMO-COAST", zone: "DEMO-A", shelf: "DEMO-A01" },
      { branch: "DEMO-CAI", warehouse: "DEMO-RETAIL", zone: "DEMO-A", shelf: "DEMO-A01" },
    ]);
    expect(db.prepare("SELECT count(*) FROM sku_registry").pluck().get()).toBe(56);
    expect(db.prepare("SELECT count(DISTINCT code) FROM barcodes").pluck().get()).toBe(104);
    expect(db.prepare("SELECT count(*) FROM products WHERE status='inactive'").pluck().get()).toBe(4);
    expect(db.prepare("SELECT count(*) FROM products WHERE brand_id IS NULL").pluck().get()).toBeGreaterThan(0);
    expect(db.prepare(`SELECT n.symbol base, u.symbol entered, k.conversion_numerator numerator, k.conversion_denominator denominator
      FROM products p JOIN units n ON n.id=p.base_unit_id JOIN product_packaging_units k ON p.id=k.product_id
      JOIN units u ON u.id=k.unit_id WHERE p.sku='DEMO-RICE'`).get())
      .toEqual({ base: "kg", entered: "g", numerator: 1, denominator: 1000 });

    const identity = createSqliteIdentity(db);
    await identity.login(1, seedAccounts.clerk.name, seedAccounts.clerk.password, false);
    expect(identity.capabilities(1)).toEqual({ authenticated: true, permissions: ["read"] });
    expect(() => identity.authorize(identity.actor(1), "post")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    await identity.login(1, seedAccounts.supervisor.name, seedAccounts.supervisor.password, false);
    expect(() => identity.authorize(identity.actor(1), "post")).not.toThrow();
  });

  it("has exact, nonnegative and independently reconciled base quantities", () => {
    const central = db.prepare(`SELECT CAST(b.qty AS TEXT) qty FROM balances b JOIN stock_items i ON i.id=b.item
      LEFT JOIN products p ON p.id=i.product_id LEFT JOIN product_variants v ON v.id=i.variant_id
      JOIN locations l ON l.id=b.location JOIN warehouses w ON w.id=l.warehouse
      WHERE w.code='DEMO-CENTRAL' AND coalesce(p.sku,v.sku)=?`).pluck();
    expect(central.get("DEMO-RICE")).toBe("125375");
    expect(central.get("DEMO-PAPER")).toBe("0");
    expect(central.get("DEMO-ENVELOPE")).toBeUndefined();
    expect(["1", "2", "3"].map(suffix => central.get(`DEMO-USB-C-${suffix}`))).toEqual(["240000", "264000", "288000"]);
    expect(db.prepare(`SELECT b.item, b.location FROM balances b JOIN locations l ON l.id=b.location
      JOIN warehouses w ON w.id=l.warehouse JOIN branches br ON br.id=w.branch
      WHERE b.qty < 0 OR typeof(b.qty) <> 'integer' OR l.is_stockable <> 1 OR l.status <> 'active'
      OR w.status <> 'active' OR br.status <> 'active'`).all()).toEqual([]);
    expect(db.prepare(`WITH ledger AS (SELECT item, location, sum(delta) qty FROM movements GROUP BY item, location)
      SELECT * FROM ledger FULL OUTER JOIN balances b USING(item, location) WHERE ledger.qty IS NOT b.qty`).all()).toEqual([]);
  });

  it("rejects an existing database before opening or changing it", async () => {
    const path = join(directory, "warehouse.sqlite");
    const before = readFileSync(path);
    await expect(seedProfile(directory)).rejects.toThrow("The seed requires a fresh database");
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("rejects a duplicate barcode on a new product and rolls back its SKU and packaging", () => {
    const catalog = createSqliteCatalog(db, new FileImageStorage(join(directory, "media")));
    const rice = catalog.getProduct(catalog.listProducts({ page: 1, pageSize: 20, search: "DEMO-RICE" }).items[0].id);
    expect(() => catalog.createProduct({
      sku: "QA-DUPLICATE-BARCODE", name: "Duplicate barcode example", productType: "simple",
      categoryId: rice.product.categoryId, baseUnitId: rice.product.baseUnitId, allowDecimalQuantity: true,
      packaging: [{ unitId: rice.packaging[0].unitId, conversionFactor: "0.001" }],
      barcodes: [{ code: rice.barcodes[0].code }],
    })).toThrow(expect.objectContaining({ code: "DUPLICATE_BARCODE" }));
    expect(db.prepare("SELECT 1 FROM sku_registry WHERE sku='QA-DUPLICATE-BARCODE'").get()).toBeUndefined();
    expect(db.prepare("SELECT count(*) FROM products").pluck().get()).toBe(44);
    expect(db.prepare("SELECT count(*) FROM product_packaging_units").pluck().get()).toBe(71);
    expect(db.prepare("SELECT count(*) FROM barcodes").pluck().get()).toBe(104);
  });
});
