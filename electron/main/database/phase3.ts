// Additive definition-table migration. Inventory tables and migration 6 stay intact.
function definitionColumns(table: string): string {
  return `
    ALTER TABLE ${table} ADD COLUMN code TEXT;
    ALTER TABLE ${table} ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active','inactive'));
    ALTER TABLE ${table} ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1
      CHECK(typeof(version)='integer' AND version > 0);
  `;
}

function definitionGuards(table: string): string {
  return ["INSERT", "UPDATE"].map(operation => `
    CREATE TRIGGER phase3_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
    WHEN NEW.code IS NULL OR typeof(NEW.code)<>'text'
      OR length(NEW.code) NOT BETWEEN 1 AND 32
      OR NEW.code GLOB '*[^A-Z0-9_-]*'
      OR length(trim(NEW.created_at))=0 OR length(trim(NEW.updated_at))=0
    BEGIN SELECT RAISE(ABORT,'invalid definition metadata'); END;
  `).join("\n");
}

function backfill(table: string, prefix: string, partition = ""): string {
  return `
    WITH numbered AS (
      SELECT id, '${prefix}-' || printf('%06d',row_number() OVER (${partition} ORDER BY id)) code
      FROM ${table}
    )
    UPDATE ${table} SET code=(SELECT code FROM numbered WHERE numbered.id=${table}.id),
      created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
  `;
}

export const phase3 = `
  ${definitionColumns("branches")}
  ALTER TABLE branches ADD COLUMN description TEXT CHECK(description IS NULL OR length(description)<=2000);
  ALTER TABLE branches ADD COLUMN address TEXT CHECK(address IS NULL OR length(address)<=500);
  ALTER TABLE branches ADD COLUMN phone TEXT CHECK(phone IS NULL OR length(phone)<=40);
  ALTER TABLE branches ADD COLUMN contact_name TEXT CHECK(contact_name IS NULL OR length(contact_name)<=120);
  ${definitionColumns("warehouses")}
  ALTER TABLE warehouses ADD COLUMN description TEXT CHECK(description IS NULL OR length(description)<=2000);
  ALTER TABLE warehouses ADD COLUMN address TEXT CHECK(address IS NULL OR length(address)<=500);
  ${definitionColumns("locations")}
  ALTER TABLE locations ADD COLUMN parent_id TEXT REFERENCES locations(id) ON DELETE RESTRICT;
  ALTER TABLE locations ADD COLUMN location_type TEXT NOT NULL DEFAULT 'other'
    CHECK(location_type IN ('zone','shelf','bin','other'));
  ALTER TABLE locations ADD COLUMN is_stockable INTEGER NOT NULL DEFAULT 1
    CHECK(typeof(is_stockable)='integer' AND is_stockable IN (0,1));
  ALTER TABLE locations ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(is_default)='integer' AND is_default IN (0,1));

  ${backfill("branches", "BR")}
  ${backfill("warehouses", "WH")}
  ${backfill("locations", "LOC", "PARTITION BY warehouse")}
  UPDATE locations SET is_default=1 WHERE name='افتراضي';
  INSERT INTO locations(id,warehouse,name,code,is_default,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),w.id,'افتراضي','LOC-DEFAULT',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
    FROM warehouses w WHERE NOT EXISTS(SELECT 1 FROM locations l WHERE l.warehouse=w.id AND l.is_default=1);

  CREATE UNIQUE INDEX phase3_branch_code ON branches(code COLLATE NOCASE);
  CREATE UNIQUE INDEX phase3_warehouse_code ON warehouses(code COLLATE NOCASE);
  CREATE UNIQUE INDEX phase3_location_code ON locations(warehouse,code COLLATE NOCASE);
  CREATE UNIQUE INDEX phase3_one_default ON locations(warehouse) WHERE is_default=1;
  CREATE INDEX phase3_branch_status ON branches(status);
  CREATE INDEX phase3_warehouse_branch_status ON warehouses(branch,status);
  CREATE INDEX phase3_location_warehouse_status ON locations(warehouse,status);
  CREATE INDEX phase3_location_parent ON locations(parent_id);
  ${definitionGuards("branches")}
  ${definitionGuards("warehouses")}
  ${definitionGuards("locations")}

  CREATE TRIGGER phase3_location_owner BEFORE UPDATE OF id,warehouse ON locations
    WHEN NEW.id IS NOT OLD.id OR NEW.warehouse IS NOT OLD.warehouse
    BEGIN SELECT RAISE(ABORT,'immutable location ownership'); END;
  CREATE TRIGGER phase3_default_identity BEFORE UPDATE OF is_default ON locations
    WHEN OLD.is_default=1 AND NEW.is_default<>1
    BEGIN SELECT RAISE(ABORT,'protected default location'); END;
  CREATE TRIGGER phase3_default_delete BEFORE DELETE ON locations WHEN OLD.is_default=1
    BEGIN SELECT RAISE(ABORT,'protected default location'); END;
  ${["INSERT", "UPDATE"].map(operation => `
    CREATE TRIGGER phase3_location_structure_${operation.toLowerCase()} BEFORE ${operation} ON locations BEGIN
      SELECT CASE WHEN NEW.is_default=1 AND (NEW.parent_id IS NOT NULL OR NEW.is_stockable<>1)
        THEN RAISE(ABORT,'protected default structure') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse)
        THEN RAISE(ABORT,'warehouse not found') END;
      SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM locations WHERE id=NEW.parent_id AND warehouse=NEW.warehouse)
        THEN RAISE(ABORT,'parent must belong to the same warehouse') END;
      SELECT CASE WHEN NEW.parent_id=NEW.id OR EXISTS(
        WITH RECURSIVE ancestors(id) AS (
          SELECT NEW.parent_id WHERE NEW.parent_id IS NOT NULL
          UNION SELECT l.parent_id FROM locations l JOIN ancestors a ON l.id=a.id WHERE l.parent_id IS NOT NULL
        ) SELECT 1 FROM ancestors WHERE id=NEW.id)
        THEN RAISE(ABORT,'location hierarchy cycle') END;
    END;
  `).join("\n")}
  INSERT OR IGNORE INTO permissions(role,action) VALUES
    ('admin','warehouse.status'),('admin','warehouse.reparent'),('admin','warehouse.reassign');
  UPDATE app_metadata SET value='7',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
`;
