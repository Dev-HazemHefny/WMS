export const architectureV2 = `
CREATE TABLE stock_items (
 id TEXT PRIMARY KEY NOT NULL,
 product_id TEXT UNIQUE REFERENCES products(id) ON DELETE CASCADE,
 variant_id TEXT UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
 CHECK ((product_id IS NULL) <> (variant_id IS NULL))
);
INSERT INTO stock_items SELECT 'p:' || id,id,NULL FROM products WHERE product_type='simple';
INSERT INTO stock_items SELECT 'v:' || id,NULL,id FROM product_variants;
CREATE TRIGGER item_product AFTER INSERT ON products WHEN NEW.product_type='simple' BEGIN
 INSERT INTO stock_items VALUES ('p:' || NEW.id,NEW.id,NULL);
END;
CREATE TRIGGER item_variant AFTER INSERT ON product_variants BEGIN
 SELECT CASE WHEN (SELECT product_type FROM products WHERE id=NEW.product_id)<>'with_variants' THEN RAISE(ABORT,'invalid variant owner') END;
 INSERT INTO stock_items VALUES ('v:' || NEW.id,NULL,NEW.id);
END;
CREATE TRIGGER item_type AFTER UPDATE OF product_type ON products WHEN OLD.product_type<>NEW.product_type BEGIN
 DELETE FROM stock_items WHERE product_id=NEW.id;
 INSERT INTO stock_items SELECT 'p:' || NEW.id,NEW.id,NULL WHERE NEW.product_type='simple';
END;
CREATE TABLE operators(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, digest TEXT NOT NULL);
CREATE TABLE roles(id TEXT PRIMARY KEY);
CREATE TABLE operator_roles(operator TEXT REFERENCES operators, role TEXT REFERENCES roles, PRIMARY KEY(operator,role));
CREATE TABLE permissions(role TEXT REFERENCES roles, action TEXT NOT NULL, PRIMARY KEY(role,action));
INSERT INTO roles VALUES ('admin');
INSERT INTO permissions VALUES ('admin','catalog'),('admin','warehouse'),('admin','draft'),('admin','post'),('admin','reverse'),('admin','count'),('admin','read'),('admin','backup'),('admin','restore');
INSERT INTO roles VALUES ('clerk'),('supervisor');
INSERT INTO permissions VALUES ('admin','manage-users'),('clerk','read'),('clerk','draft'),('supervisor','read'),('supervisor','post'),('supervisor','reverse'),('supervisor','count');
CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE warehouses(id TEXT PRIMARY KEY,branch TEXT NOT NULL REFERENCES branches,name TEXT NOT NULL,UNIQUE(branch,name));
CREATE TABLE locations(id TEXT PRIMARY KEY,warehouse TEXT NOT NULL REFERENCES warehouses,name TEXT NOT NULL,UNIQUE(warehouse,name),UNIQUE(warehouse,id));
CREATE TABLE documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('receipt','issue','transfer','count','reversal')), state TEXT NOT NULL CHECK(state IN ('draft','review','posted','cancelled')), version INTEGER NOT NULL DEFAULT 1, lines TEXT NOT NULL, original TEXT UNIQUE REFERENCES documents);
CREATE TABLE document_items(document TEXT NOT NULL REFERENCES documents,item TEXT NOT NULL REFERENCES stock_items ON DELETE RESTRICT,PRIMARY KEY(document,item));
CREATE TRIGGER draft_items AFTER INSERT ON documents BEGIN
 INSERT INTO document_items SELECT DISTINCT NEW.id,json_extract(value,'$.item') FROM json_each(NEW.lines);
END;
CREATE TRIGGER edited_items AFTER UPDATE OF lines ON documents BEGIN
 DELETE FROM document_items WHERE document=NEW.id;
 INSERT INTO document_items SELECT DISTINCT NEW.id,json_extract(value,'$.item') FROM json_each(NEW.lines);
END;
CREATE TRIGGER stock_identity BEFORE UPDATE ON stock_items BEGIN SELECT RAISE(ABORT,'immutable stock identity'); END;
CREATE TABLE count_locks(location TEXT PRIMARY KEY REFERENCES locations, document TEXT NOT NULL REFERENCES documents);
CREATE TABLE count_expected(document TEXT NOT NULL REFERENCES documents,item TEXT NOT NULL REFERENCES stock_items,expected INTEGER NOT NULL CHECK(expected>0),PRIMARY KEY(document,item));
CREATE TABLE reviewed_counts(document TEXT NOT NULL REFERENCES documents,item TEXT NOT NULL REFERENCES stock_items,base INTEGER NOT NULL CHECK(typeof(base)='integer' AND base>=0),snapshot TEXT NOT NULL,PRIMARY KEY(document,item));
CREATE TABLE movements(id INTEGER PRIMARY KEY, document TEXT NOT NULL REFERENCES documents, line INTEGER NOT NULL, item TEXT NOT NULL REFERENCES stock_items ON DELETE RESTRICT, location TEXT NOT NULL REFERENCES locations, delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0), snapshot TEXT NOT NULL, UNIQUE(document,line,location));
CREATE INDEX movements_history ON movements(item,location,id);
CREATE TABLE balances(item TEXT NOT NULL REFERENCES stock_items, location TEXT NOT NULL REFERENCES locations, qty INTEGER NOT NULL CHECK(typeof(qty)='integer' AND qty>=0), PRIMARY KEY(item,location));
CREATE TABLE receipts(command TEXT PRIMARY KEY, document TEXT NOT NULL UNIQUE REFERENCES documents, fingerprint TEXT NOT NULL);
CREATE TABLE audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL REFERENCES operators, action TEXT NOT NULL,target TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER add_movement BEFORE INSERT ON movements WHEN (SELECT state FROM documents WHERE id=NEW.document) NOT IN ('draft','review') BEGIN SELECT RAISE(ABORT,'closed document'); END;
CREATE TRIGGER retain_document BEFORE DELETE ON documents WHEN OLD.state='posted' BEGIN SELECT RAISE(ABORT,'posted document'); END;
CREATE TRIGGER immutable_movement BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'posted movement'); END;
CREATE TRIGGER retain_movement BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'posted movement'); END;
CREATE TRIGGER immutable_document BEFORE UPDATE ON documents WHEN OLD.state='posted' BEGIN SELECT RAISE(ABORT,'posted document'); END;
UPDATE app_metadata SET value='6' WHERE key='schema_version';
CREATE TRIGGER lock_products_base BEFORE UPDATE OF base_unit_id ON products WHEN NEW.base_unit_id<>OLD.base_unit_id AND EXISTS(SELECT 1 FROM document_items JOIN stock_items ON stock_items.id=document_items.item WHERE stock_items.product_id=OLD.id) BEGIN SELECT RAISE(ABORT,'base unit has stock history'); END;
CREATE TRIGGER lock_product_variants_base BEFORE UPDATE OF base_unit_id ON product_variants WHEN NEW.base_unit_id<>OLD.base_unit_id AND EXISTS(SELECT 1 FROM document_items JOIN stock_items ON stock_items.id=document_items.item WHERE stock_items.variant_id=OLD.id) BEGIN SELECT RAISE(ABORT,'base unit has stock history'); END;
CREATE TRIGGER barcode_owner_INSERT BEFORE INSERT ON barcodes WHEN (NEW.product_packaging_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_packaging_units WHERE id=NEW.product_packaging_unit_id AND product_id=NEW.product_id)) OR (NEW.variant_packaging_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_variant_packaging_units WHERE id=NEW.variant_packaging_unit_id AND variant_id=NEW.variant_id)) BEGIN SELECT RAISE(ABORT,'barcode package owner mismatch'); END;
CREATE TRIGGER barcode_owner_UPDATE BEFORE UPDATE ON barcodes WHEN (NEW.product_packaging_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_packaging_units WHERE id=NEW.product_packaging_unit_id AND product_id=NEW.product_id)) OR (NEW.variant_packaging_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_variant_packaging_units WHERE id=NEW.variant_packaging_unit_id AND variant_id=NEW.variant_id)) BEGIN SELECT RAISE(ABORT,'barcode package owner mismatch'); END;
`;
