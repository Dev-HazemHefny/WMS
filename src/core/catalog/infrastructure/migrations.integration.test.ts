import Database from "better-sqlite3";
import { runMigrations } from "../../../../electron/main/database/migrations";
import { createSqliteCatalog } from "./create-sqlite-catalog";

describe("catalog database migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it("adds a constrained unit dimension while preserving the legacy default", () => {
    const columns = db.pragma("table_info(units)") as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "dimension")).toBe(true);

    db.prepare(`INSERT INTO units
      (id, name, symbol, description, status, created_at, updated_at)
      VALUES ('unit-1', 'قطعة', 'ق', NULL, 'active', '2026-01-01', '2026-01-01')`).run();

    expect(db.prepare("SELECT dimension FROM units WHERE id = 'unit-1'").get()).toEqual({ dimension: "other" });
    expect(() => db.prepare(`INSERT INTO units
      (id, name, symbol, dimension, status, created_at, updated_at)
      VALUES ('unit-2', 'وزن', 'و', 'weight', 'active', '2026-01-01', '2026-01-01')`).run()).toThrow();
  });

  it("enforces compatible packaging units and persists barcode links", () => {
    let nextId = 0;
    const catalog = createSqliteCatalog(
      db,
      { save: () => "image", read: () => null, remove: () => undefined },
      { nowIso: () => "2026-01-01T00:00:00.000Z" },
      { next: () => `id-${++nextId}` }
    );
    const category = catalog.createCategory({ name: "عام", code: "GENERAL" });
    const piece = catalog.createUnit({ name: "قطعة", symbol: "ق", dimension: "count" });
    const pack = catalog.createUnit({ name: "عبوة", symbol: "ع", dimension: "count" });
    const kilogram = catalog.createUnit({ name: "كيلوجرام", symbol: "كجم", dimension: "mass" });
    const created = catalog.createProduct({
      name: "منتج تجريبي",
      sku: "ITEM-1",
      categoryId: category.id,
      baseUnitId: piece.id,
      productType: "simple",
      allowDecimalQuantity: false
    });

    expect(() => catalog.updateUnit(piece.id, {
      name: piece.name,
      symbol: piece.symbol,
      dimension: "mass"
    })).toThrow("لا يمكن تغيير نوع وحدة مرتبطة بأصناف أو وحدات تعبئة");
    expect(() => catalog.createProduct({
      name: "صنف بمتغيرات",
      sku: "ITEM-V",
      categoryId: category.id,
      baseUnitId: piece.id,
      productType: "with_variants",
      allowDecimalQuantity: false
    })).toThrow("يجب إضافة متغير واحد على الأقل لهذا النوع من الأصناف");

    expect(() => catalog.addPackaging({
      ownerType: "product",
      ownerId: created.product.id,
      unitId: kilogram.id,
      conversionFactor: "1"
    })).toThrow("يجب أن تكون وحدة التعبئة من نفس نوع وحدة القياس الأساسية");

    const packaging = catalog.addPackaging({
      ownerType: "product",
      ownerId: created.product.id,
      unitId: pack.id,
      conversionFactor: "6"
    });
    catalog.addBarcode({
      code: "123456789",
      productId: created.product.id,
      packagingUnitId: packaging.id
    });
    const match = catalog.findProductByBarcode("123456789");

    expect(match.product.product.id).toBe(created.product.id);
    expect(match.barcode.packagingLabel).toContain("عبوة");
  });

  it("rejects legacy units defaulted to 'other' from packaging conversions (H-01)", () => {
    let nextId = 0;
    const catalog = createSqliteCatalog(
      db,
      { save: () => "image", read: () => null, remove: () => undefined },
      { nowIso: () => "2026-01-01T00:00:00.000Z" },
      { next: () => `id-${++nextId}` }
    );
    const category = catalog.createCategory({ name: "عام", code: "GENERAL" });

    // Simulate a unit that predated migration 5: inserted without a dimension,
    // so the column default assigns it 'other' (an unverifiable dimension).
    db.prepare(`INSERT INTO units
      (id, name, symbol, description, status, created_at, updated_at)
      VALUES ('legacy-base', 'وحدة قديمة', 'قديم', NULL, 'active', '2026-01-01', '2026-01-01')`).run();
    // A second legacy unit, also defaulted to 'other'.
    db.prepare(`INSERT INTO units
      (id, name, symbol, description, status, created_at, updated_at)
      VALUES ('legacy-pack', 'تعبئة قديمة', 'تعب', NULL, 'active', '2026-01-01', '2026-01-01')`).run();

    expect(db.prepare("SELECT dimension FROM units WHERE id = 'legacy-base'").get()).toEqual({ dimension: "other" });

    const created = catalog.createProduct({
      name: "صنف قديم",
      sku: "ITEM-LEGACY",
      categoryId: category.id,
      baseUnitId: "legacy-base",
      productType: "simple",
      allowDecimalQuantity: false
    });

    // H-01: two units that are both 'other' must NOT be treated as compatible.
    expect(() => catalog.addPackaging({
      ownerType: "product",
      ownerId: created.product.id,
      unitId: "legacy-pack",
      conversionFactor: "1"
    })).toThrow("لا يمكن إنشاء تحويل مع وحدة قياس من نوع «أخرى»");

    // A legacy 'other' base unit must also be rejected against a real dimension.
    const countUnit = catalog.createUnit({ name: "قطعة", symbol: "ق", dimension: "count" });
    expect(() => catalog.addPackaging({
      ownerType: "product",
      ownerId: created.product.id,
      unitId: countUnit.id,
      conversionFactor: "1"
    })).toThrow("لا يمكن إنشاء تحويل مع وحدة قياس من نوع «أخرى»");

    // The legacy unit's id and the product relationship are untouched.
    const baseRow = db.prepare("SELECT id, dimension FROM units WHERE id = 'legacy-base'").get();
    expect(baseRow).toEqual({ id: "legacy-base", dimension: "other" });
    expect(db.prepare("SELECT base_unit_id FROM products WHERE id = ?").get(created.product.id)).toEqual({ base_unit_id: "legacy-base" });
  });
});
