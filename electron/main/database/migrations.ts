import { architectureV2 } from "./architecture-v2";
import Database from "better-sqlite3";
import { phase3 } from "./phase3";

export const CURRENT_SCHEMA_VERSION = 7;

interface Migration {
  version: number;
  name: string;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "create_schema_migrations",
    up: `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
  {
    version: 2,
    name: "initial_application_metadata",
    up: `CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('schema_version', '2');`,
  },
  {
    version: 3,
    name: "catalog_products",
    up: `
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT,
      parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_categories_parent ON categories(parent_id);
    CREATE INDEX idx_categories_status ON categories(status);

    CREATE TABLE units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      symbol TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT,
      image_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      base_unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      description TEXT,
      image_path TEXT,
      brand_id TEXT REFERENCES brands(id) ON DELETE RESTRICT,
      product_type TEXT NOT NULL CHECK (product_type IN ('simple', 'with_variants')),
      allow_decimal_quantity INTEGER NOT NULL CHECK (allow_decimal_quantity IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_products_category ON products(category_id);
    CREATE INDEX idx_products_brand ON products(brand_id);
    CREATE INDEX idx_products_unit ON products(base_unit_id);
    CREATE INDEX idx_products_status ON products(status);

    CREATE TABLE product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      sku TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      base_unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      attributes_signature TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (product_id, attributes_signature)
    );
    CREATE INDEX idx_variants_product ON product_variants(product_id);

    CREATE TABLE product_variant_attributes (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX idx_variant_attributes_variant ON product_variant_attributes(variant_id);

    CREATE TABLE sku_registry (
      sku TEXT PRIMARY KEY COLLATE NOCASE,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('product', 'variant')),
      owner_id TEXT NOT NULL UNIQUE
    );

    CREATE TRIGGER sku_registry_product_insert AFTER INSERT ON products
    BEGIN
      INSERT INTO sku_registry (sku, owner_type, owner_id) VALUES (NEW.sku, 'product', NEW.id);
    END;
    CREATE TRIGGER sku_registry_product_update AFTER UPDATE OF sku ON products
    BEGIN
      UPDATE sku_registry SET sku = NEW.sku WHERE owner_id = NEW.id;
    END;
    CREATE TRIGGER sku_registry_product_delete AFTER DELETE ON products
    BEGIN
      DELETE FROM sku_registry WHERE owner_id = OLD.id;
    END;
    CREATE TRIGGER sku_registry_variant_insert AFTER INSERT ON product_variants
    BEGIN
      INSERT INTO sku_registry (sku, owner_type, owner_id) VALUES (NEW.sku, 'variant', NEW.id);
    END;
    CREATE TRIGGER sku_registry_variant_update AFTER UPDATE OF sku ON product_variants
    BEGIN
      UPDATE sku_registry SET sku = NEW.sku WHERE owner_id = NEW.id;
    END;
    CREATE TRIGGER sku_registry_variant_delete AFTER DELETE ON product_variants
    BEGIN
      DELETE FROM sku_registry WHERE owner_id = OLD.id;
    END;

    CREATE TABLE product_packaging_units (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      conversion_numerator INTEGER NOT NULL CHECK (conversion_numerator > 0),
      conversion_denominator INTEGER NOT NULL CHECK (conversion_denominator > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (product_id, unit_id)
    );

    CREATE TABLE product_variant_packaging_units (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
      conversion_numerator INTEGER NOT NULL CHECK (conversion_numerator > 0),
      conversion_denominator INTEGER NOT NULL CHECK (conversion_denominator > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (variant_id, unit_id)
    );

    CREATE TABLE barcodes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
      product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,
      variant_id TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
      product_packaging_unit_id TEXT REFERENCES product_packaging_units(id) ON DELETE RESTRICT,
      variant_packaging_unit_id TEXT REFERENCES product_variant_packaging_units(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      CHECK ((product_id IS NOT NULL AND variant_id IS NULL) OR (product_id IS NULL AND variant_id IS NOT NULL)),
      CHECK (product_packaging_unit_id IS NULL OR variant_id IS NULL),
      CHECK (variant_packaging_unit_id IS NULL OR product_id IS NULL)
    );
    CREATE INDEX idx_barcodes_product ON barcodes(product_id);
    CREATE INDEX idx_barcodes_variant ON barcodes(variant_id);
    `,
  },
  {
    version: 4,
    name: "catalog_indexes_and_constraints",
    up: `
    CREATE UNIQUE INDEX IF NOT EXISTS ux_variant_attributes_name
      ON product_variant_attributes(variant_id, name COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_barcodes_product_packaging_unit
      ON barcodes(product_packaging_unit_id);
    CREATE INDEX IF NOT EXISTS idx_barcodes_variant_packaging_unit
      ON barcodes(variant_packaging_unit_id);

    CREATE INDEX IF NOT EXISTS idx_products_product_type
      ON products(product_type);

    UPDATE app_metadata
      SET value = '4', updated_at = datetime('now')
      WHERE key = 'schema_version';
    `,
  },
  {
    version: 5,
    name: "unit_dimensions",
    up: `
    ALTER TABLE units
      ADD COLUMN dimension TEXT NOT NULL DEFAULT 'other'
      CHECK (dimension IN ('count', 'mass', 'volume', 'length', 'area', 'other'));

    UPDATE app_metadata
      SET value = '5', updated_at = datetime('now')
      WHERE key = 'schema_version';
    `,
  },
  { version: 6, name: "architecture_v2", up: architectureV2 },
  { version: 7, name: "warehouse_definitions", up: phase3 },
];

// Compare against the applied version, so ALTER TABLE in v7 does not invalidate
// legitimate v7 databases on the next startup. Applied migration SQL is unchanged.
const definitions = new Map<number, { name: string; sql: string }[]>();
export function verifySchema(db: Database.Database): number {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get()) {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get()) {
      throw new Error("Unversioned nonempty database");
    }
    return 0;
  }
  const history = db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all() as {version:number;name:string}[];
  const version = history.at(-1)?.version ?? 0;
  if (version > CURRENT_SCHEMA_VERSION) throw new Error("Unsupported newer database");
  if (!version || history.length !== version || history.some((row,index) => row.version !== index+1 || row.name !== migrations[index]?.name)) {
    throw new Error("Incompatible migration history");
  }
  if (!definitions.has(version)) {
    const reference = new Database(":memory:");
    try {
      reference.pragma("foreign_keys=ON");
      for (const migration of migrations.filter(m => m.version <= version)) reference.exec(migration.up);
      definitions.set(version, reference.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
      ).all() as { name: string; sql: string }[]);
    } finally { reference.close(); }
  }
  const definition = db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").pluck();
  for (const expected of definitions.get(version)!) {
    if (definition.get(expected.name) !== expected.sql)
      throw new Error(`Incompatible schema v${version}: ${expected.name}`);
  }
  if (version >= 4 && db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").pluck().get() !== String(version)) {
    throw new Error("Incompatible schema metadata");
  }
  return version;
}

export function verifyDatabase(db: Database.Database): number {
  const version = verifySchema(db);
  if (!version || db.pragma("integrity_check",{simple:true}) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) {
    throw new Error("Invalid database integrity or foreign keys");
  }
  if (version >= 7 && db.prepare(`SELECT w.id FROM warehouses w LEFT JOIN locations l ON l.warehouse=w.id AND l.is_default=1
      GROUP BY w.id HAVING count(l.id)<>1 OR min(l.is_stockable)<>1 OR count(l.parent_id)<>0`).get()) {
    throw new Error("Warehouse must have one stockable default root");
  }
  return version;
}

export interface UpgradeOptions {
  /** Must create and verify a restorable, media-complete snapshot before returning. */
  beforeUpgrade: () => void;
}

export function runMigrations(
  db: Database.Database,
  targetVersion = CURRENT_SCHEMA_VERSION,
  options?: UpgradeOptions,
): void {
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > CURRENT_SCHEMA_VERSION) throw new Error("Unsupported migration target");
  const initialVersion = verifySchema(db);
  if (initialVersion) verifyDatabase(db);
  if (initialVersion && initialVersion < 7 && targetVersion >= 7) {
    if (!options) throw new Error("Verified upgrade backup required");
    options.beforeUpgrade();
  }
  db.pragma("foreign_keys=ON");
  db.exec(migrations[0].up);

  const getApplied = db.prepare(
    "SELECT version FROM schema_migrations WHERE version = ?",
  );
  const insertApplied = db.prepare(
    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (migration.version > targetVersion) break;
    const alreadyApplied = getApplied.get(migration.version);
    if (alreadyApplied) continue;

    const apply = db.transaction(() => {
      if (migration.version === 6) {
        const invalid = db
          .prepare(
            "SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.product_type<>'with_variants' UNION ALL SELECT b.id FROM barcodes b JOIN product_packaging_units u ON u.id=b.product_packaging_unit_id WHERE u.product_id IS NOT b.product_id UNION ALL SELECT b.id FROM barcodes b JOIN product_variant_packaging_units u ON u.id=b.variant_packaging_unit_id WHERE u.variant_id IS NOT b.variant_id LIMIT 1",
          )
          .get() as { id: string } | undefined;
        if (invalid) throw new Error("Invalid catalog owner: " + invalid.id);
      }
      if (migration.version === 7) {
        for (const table of ["branches", "warehouses", "locations"]) {
          if (db.prepare(`SELECT 1 FROM ${table} WHERE id IS NULL OR length(trim(id))=0`).get()) {
            throw new Error("Invalid historical identity: " + table);
          }
        }
      }
      db.exec(migration.up);
      insertApplied.run(migration.version, migration.name);
      if (migration.version === 7) verifyDatabase(db);
    });
    apply();
  }
}
