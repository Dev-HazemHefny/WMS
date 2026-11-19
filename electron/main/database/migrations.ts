import type Database from "better-sqlite3";

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
    );`
  },
  {
    version: 2,
    name: "initial_application_metadata",
    up: `CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('schema_version', '2');`
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
    `
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
    `
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
    `
  }
];

export function runMigrations(db: Database.Database): void {
  db.exec(migrations[0].up);

  const getApplied = db.prepare("SELECT version FROM schema_migrations WHERE version = ?");
  const insertApplied = db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");

  for (const migration of migrations) {
    const alreadyApplied = getApplied.get(migration.version);
    if (alreadyApplied) continue;

    const apply = db.transaction(() => {
      db.exec(migration.up);
      insertApplied.run(migration.version, migration.name);
    });
    apply();
  }
}