import { lstatSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { closeDatabase, initializeDatabase } from "../../electron/main/database";
import { CURRENT_SCHEMA_VERSION, verifyDatabase } from "../../electron/main/database/migrations";
import { createSqliteCatalog } from "../../src/core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "../../src/core/catalog/infrastructure/file-image-storage";
import { createStockCatalog } from "../../src/core/catalog/infrastructure/stock-catalog";
import { createSqliteIdentity } from "../../src/core/identity/infrastructure/create-sqlite-identity";
import { createSqliteLocationUsage } from "../../src/core/inventory/infrastructure/sqlite-location-usage";
import { createInventory } from "../../src/core/inventory/infrastructure/sqlite-inventory";
import { createInventoryWarehouseGateway } from "../../src/core/warehouses/infrastructure/create-inventory-gateway";
import { createSqliteWarehouses } from "../../src/core/warehouses/infrastructure/create-sqlite-warehouses";
import type { StockLine } from "../../src/shared/ipc/stock";
import { groups, makeVariants, units } from "./catalog";

export const seedAccounts = {
  admin: { name: "demo-admin", password: "demo-admin-local-2026" },
  clerk: { name: "demo-clerk", password: "demo-clerk-local-2026" },
  supervisor: { name: "demo-supervisor", password: "demo-supervisor-local-2026" },
};
const demo = "Pre-Phase 5 development sample";
const windowId = 1;

function barcodeGenerator() {
  let sequence = 0;
  return () => {
    // EAN-13 with the in-store prefix and a valid check digit.
    const digits = "290" + String(++sequence).padStart(9, "0");
    const sum = Array.from(digits, (digit, index) => Number(digit) * (index % 2 ? 3 : 1))
      .reduce((total, digit) => total + digit, 0);
    return digits + ((10 - (sum % 10)) % 10);
  };
}

function seedDefinitions(db: Database.Database, directory: string, identity: ReturnType<typeof createSqliteIdentity>) {
  const catalog = createSqliteCatalog(db, new FileImageStorage(join(directory, "media")));
  const usage = createSqliteLocationUsage(db);
  const actor = identity.actor(windowId);
  const warehouses = createSqliteWarehouses(db, {
    usage,
    access: { currentActor: () => actor, authorize: identity.authorize },
  });
  const inventory = createInventory(db, identity.authorize, createStockCatalog(db),
    createInventoryWarehouseGateway(db, identity.authorize, usage),
    () => { throw new Error("The seed does not perform stock repairs"); },
  );
  const nextBarcode = barcodeGenerator();

  return catalog.runMutation(() => {
    const unitIds = Object.fromEntries(Object.entries(units).map(([key, unit]) =>
      [key, catalog.createUnit({ ...unit, description: demo }).id],
    ));
    const retiredUnit = catalog.createUnit({ name: "Legacy crate", symbol: "crate", dimension: "count", description: demo });
    catalog.deactivateUnit(retiredUnit.id);
    const retiredBrand = catalog.createBrand({ code: "DEMO-RETIRED", name: "Old Canal Trading", description: demo });
    catalog.deactivateBrand(retiredBrand.id);
    const retiredCategory = catalog.createCategory({ code: "DEMO-RETIRED", name: "Discontinued Supplies", description: demo });
    catalog.deactivateCategory(retiredCategory.id);

    const main = warehouses.createBranch({ code: "DEMO-CAI", name: "Main Branch", address: "Nasr City, Cairo", description: demo });
    const alex = warehouses.createBranch({ code: "DEMO-ALX", name: "Alexandria Branch", address: "Borg El Arab, Alexandria", description: demo });
    const former = warehouses.createBranch({ code: "DEMO-OLD", name: "Former Giza Branch", address: "Giza", description: demo });
    const central = warehouses.createWarehouse({ code: "DEMO-CENTRAL", name: "Central Warehouse", branchId: main.id, description: demo });
    const retail = warehouses.createWarehouse({ code: "DEMO-RETAIL", name: "Retail Warehouse", branchId: main.id, description: demo });
    const coastal = warehouses.createWarehouse({ code: "DEMO-COAST", name: "Alexandria Distribution Warehouse", branchId: alex.id, description: demo });
    const closed = warehouses.createWarehouse({ code: "DEMO-CLOSED", name: "Former Giza Warehouse", branchId: former.id, description: demo });
    warehouses.setWarehouseStatus(closed.id, "inactive", closed.version);
    warehouses.setBranchStatus(former.id, "inactive", former.version);

    function location(
      warehouseId: string, code: string, name: string, locationType: "zone" | "shelf" | "bin",
      isStockable: boolean, parentId?: string,
    ) {
      return warehouses.createLocation({ warehouseId, code, name, locationType, isStockable, parentId });
    }
    const [centralBins, retailBins, coastalBins] = [central, retail, coastal].map(warehouse => {
      const receiving = location(warehouse.id, "DEMO-REC", "Receiving Zone", "zone", false);
      location(warehouse.id, "DEMO-DOCK", "Receiving Dock 01", "bin", true, receiving.id);
      const zone = location(warehouse.id, "DEMO-A", "Storage Zone A", "zone", false);
      const shelf = location(warehouse.id, "DEMO-A01", "Shelf A-01", "shelf", false, zone.id);
      const bins = ["01", "02", "03", "04"].map(number =>
        location(warehouse.id, `DEMO-A010${number}`, `Bin A-01-${number}`, "bin", true, shelf.id).id,
      );
      const reserve = location(warehouse.id, "DEMO-B", "Bulk Storage Zone B", "zone", false);
      location(warehouse.id, "DEMO-B01", "Bulk Bay B-01", "bin", true, reserve.id);
      const retired = location(warehouse.id, "DEMO-OLD", "Retired Overflow Bin", "bin", true, reserve.id);
      warehouses.setLocationStatus(retired.id, "inactive", retired.version);
      return bins;
    });

    const centralLines: StockLine[] = [];
    const retailLines: StockLine[] = [];
    const coastalLines: StockLine[] = [];
    let zeroLine: StockLine | undefined;
    groups.forEach((group, groupIndex) => {
      const root = catalog.createCategory({ code: `DEMO-${group.code}`, name: group.name, description: demo });
      const section = catalog.createCategory({ code: `DEMO-${group.code}-STOCK`, name: group.aisle, parentId: root.id, description: demo });
      const reserve = catalog.createCategory({ code: `DEMO-${group.code}-RESERVE`, name: `${group.name} Reserve`, parentId: section.id, description: demo });
      const brand = catalog.createBrand({ code: `DEMO-${group.code}`, name: group.brand, description: demo });

      group.products.forEach(([code, name, unit = "piece", attribute, options], index) => {
        const sku = `DEMO-${code}`;
        const decimal = unit !== "piece";
        const packaging = unit === "piece" ? [
          { unitId: unitIds.pack, conversionFactor: "6" },
          { unitId: unitIds.carton, conversionFactor: "24" },
        ] : [{
          unitId: unitIds[{ kilogram: "gram", liter: "milliliter", meter: "roll" }[unit]],
          conversionFactor: unit === "meter" ? "25" : "0.001",
        }];
        const details = catalog.createProduct({
          name, sku, description: demo,
          categoryId: index < 7 ? section.id : reserve.id,
          brandId: index % 3 === 2 ? null : brand.id,
          baseUnitId: unitIds[unit],
          allowDecimalQuantity: decimal,
          ...(attribute && options ? {
            productType: "with_variants",
            variants: makeVariants(sku, attribute, options, packaging, nextBarcode),
          } : {
            productType: "simple",
            packaging,
            barcodes: [{ code: nextBarcode() }, { code: nextBarcode(), packagingUnitId: packaging[0].unitId }],
          }),
        });
        if (index === group.products.length - 1) catalog.deactivateProduct(details.product.id);
        if (index >= 8) return; // Leave unstocked products for the missing-balance view.
        const items = details.variants.length
          ? details.variants.map(variant => ({ id: `v:${variant.id}`, packaging: variant.packaging[0].id }))
          : [{ id: `p:${details.product.id}`, packaging: details.packaging[0].id }];
        items.forEach(({ id, packaging: pack }, variantIndex) => {
          const location = centralBins[groupIndex];
          if (code === "PAPER") {
            zeroLine = { item: id, location, quantity: "6" };
            centralLines.push(zeroLine);
          } else if (code === "RICE") {
            centralLines.push({ item: id, location, quantity: "125375", packaging: pack });
          } else {
            const quantity = decimal ? `${22 + index}.125` : String(index === 1 ? 2 : 240 + variantIndex * 24);
            centralLines.push({ item: id, location, quantity });
          }
          if (index % 2 === 0) retailLines.push({ item: id, location: retailBins[groupIndex], quantity: decimal ? "2.375" : String(12 + variantIndex) });
          if (index % 3 === 0) coastalLines.push({ item: id, location: coastalBins[groupIndex], quantity: decimal ? "48.250" : "5" });
        });
      });
    });
    function post(kind: "receipt" | "issue", lines: StockLine[], reference: string) {
      const { id } = inventory(actor, { op: "draft", kind, lines });
      if (!id) throw new Error("Missing seed stock document ID");
      inventory(actor, { op: "post", document: id, version: 1, command: `demo-opening-${reference}` });
    }
    post("receipt", centralLines, "central");
    post("receipt", retailLines, "retail");
    post("receipt", coastalLines, "alexandria");
    if (!zeroLine) throw new Error("Missing seed zero-balance example");
    post("issue", [zeroLine], "zero-balance");
    if (inventory(actor, { op: "reconcile" }).rows?.length !== 0) throw new Error("Seed stock failed ledger reconciliation");

    // Store dataset provenance in existing application metadata.
    db.prepare("INSERT INTO app_metadata(key,value) VALUES ('development_seed',?)").run(demo);
  });
}

export async function seedProfile(directory: string) {
  if (lstatSync(join(directory, "warehouse.sqlite"), { throwIfNoEntry: false })) {
    throw new Error("The seed requires a fresh database");
  }
  const db = initializeDatabase(directory);
  try {
    const identity = createSqliteIdentity(db);
    const { admin, clerk, supervisor } = seedAccounts;
    await identity.login(windowId, admin.name, admin.password, true);
    await identity.addOperator(windowId, clerk.name, clerk.password, ["clerk"]);
    await identity.addOperator(windowId, supervisor.name, supervisor.password, ["supervisor"]);
    seedDefinitions(db, directory, identity);
    if (db.pragma("foreign_keys", { simple: true }) !== 1 || verifyDatabase(db) !== CURRENT_SCHEMA_VERSION) {
      throw new Error("Seed database failed integrity validation");
    }
    const tables = [
      "categories", "brands", "units", "products", "product_variants", "product_packaging_units",
      "product_variant_packaging_units", "barcodes", "branches", "warehouses", "locations",
      "operators", "balances", "documents", "movements",
    ];
    return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()]));
  } finally {
    closeDatabase();
  }
}
