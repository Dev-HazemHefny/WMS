import type Database from "better-sqlite3";
import type { Branch, StorageLocation, Warehouse } from "../domain/entities";
import type { BranchRepository, DefinitionPage, DefinitionQuery, LocationRepository, WarehouseRepository } from "../domain/repositories";

const base = "id,code,name,status,created_at AS createdAt,updated_at AS updatedAt,version";
const branchColumns = base + ",description,address,phone,contact_name AS contactName";
const warehouseColumns = base + ",branch AS branchId,description,address";
const locationColumns = base + ",warehouse AS warehouseId,parent_id AS parentId,location_type AS locationType,is_stockable AS isStockable,is_default AS isDefault";
type LocationRow = Omit<StorageLocation, "isStockable" | "isDefault"> & { isStockable: number; isDefault: number };
function location(row: LocationRow): StorageLocation { return { ...row, isStockable: Boolean(row.isStockable), isDefault: Boolean(row.isDefault) }; }

function list<T>(db: Database.Database, table: "branches" | "warehouses", columns: string, query: DefinitionQuery, branchId?: string): DefinitionPage<T> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.status) { conditions.push("status=?"); values.push(query.status); }
  if (query.search) {
    conditions.push("(code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')");
    const search = "%" + query.search.replace(/[\\%_]/g, "\\$&") + "%";
    values.push(search, search);
  }
  if (branchId !== undefined) { conditions.push("branch=?"); values.push(branchId); }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const total = db.prepare(`SELECT count(*) FROM ${table}${where}`).pluck().get(...values) as number;
  const items = db.prepare(`SELECT ${columns} FROM ${table}${where} ORDER BY code COLLATE NOCASE,id LIMIT ? OFFSET ?`).all(...values, query.pageSize, (query.page - 1) * query.pageSize) as T[];
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export class SqliteBranchRepository implements BranchRepository {
  constructor(private readonly db: Database.Database) {}
  private find(where: string, value: string): Branch | null {
    return this.db.prepare(`SELECT ${branchColumns} FROM branches WHERE ${where}`).get(value) as Branch | undefined ?? null;
  }
  findById(id: string) { return this.find("id=?", id); }
  findByCode(code: string) { return this.find("code=? COLLATE NOCASE", code); }
  findByName(name: string) { return this.find("name=?", name); }
  list(query: DefinitionQuery) { return list<Branch>(this.db, "branches", branchColumns, query); }
  insert(value: Branch) {
    this.db.prepare("INSERT INTO branches(id,code,name,status,created_at,updated_at,version,description,address,phone,contact_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.id,value.code,value.name,value.status,value.createdAt,value.updatedAt,value.version,value.description,value.address,value.phone,value.contactName);
  }
  update(value: Branch, expectedVersion: number) {
    return this.db.prepare("UPDATE branches SET code=?,name=?,status=?,updated_at=?,version=?,description=?,address=?,phone=?,contact_name=? WHERE id=? AND version=?")
      .run(value.code,value.name,value.status,value.updatedAt,value.version,value.description,value.address,value.phone,value.contactName,value.id,expectedVersion).changes === 1;
  }
}

export class SqliteWarehouseRepository implements WarehouseRepository {
  constructor(private readonly db: Database.Database) {}
  private find(where: string, ...values: string[]): Warehouse | null {
    return this.db.prepare(`SELECT ${warehouseColumns} FROM warehouses WHERE ${where}`).get(...values) as Warehouse | undefined ?? null;
  }
  findById(id: string) { return this.find("id=?", id); }
  findByCode(code: string) { return this.find("code=? COLLATE NOCASE", code); }
  findByName(branchId: string, name: string) { return this.find("branch=? AND name=?", branchId, name); }
  list(query: DefinitionQuery & { branchId?: string }) { return list<Warehouse>(this.db, "warehouses", warehouseColumns, query, query.branchId); }
  listByBranch(branchId: string) {
    return this.db.prepare(`SELECT ${warehouseColumns} FROM warehouses WHERE branch=? ORDER BY code COLLATE NOCASE,id`).all(branchId) as Warehouse[];
  }
  insert(value: Warehouse) {
    this.db.prepare("INSERT INTO warehouses(id,code,name,branch,status,created_at,updated_at,version,description,address) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(value.id,value.code,value.name,value.branchId,value.status,value.createdAt,value.updatedAt,value.version,value.description,value.address);
  }
  update(value: Warehouse, expectedVersion: number) {
    return this.db.prepare("UPDATE warehouses SET code=?,name=?,branch=?,status=?,updated_at=?,version=?,description=?,address=? WHERE id=? AND version=?")
      .run(value.code,value.name,value.branchId,value.status,value.updatedAt,value.version,value.description,value.address,value.id,expectedVersion).changes === 1;
  }
}

export class SqliteLocationRepository implements LocationRepository {
  constructor(private readonly db: Database.Database) {}
  private find(where: string, ...values: string[]): StorageLocation | null {
    const row = this.db.prepare(`SELECT ${locationColumns} FROM locations WHERE ${where}`).get(...values) as LocationRow | undefined;
    return row ? location(row) : null;
  }
  findById(id: string) { return this.find("id=?", id); }
  findByCode(warehouseId: string, code: string) { return this.find("warehouse=? AND code=? COLLATE NOCASE", warehouseId,code); }
  findByName(warehouseId: string, name: string) { return this.find("warehouse=? AND name=?", warehouseId,name); }
  findDefault(warehouseId: string) { return this.find("warehouse=? AND is_default=1", warehouseId); }
  listByWarehouse(warehouseId: string) {
    return (this.db.prepare(`SELECT ${locationColumns} FROM locations WHERE warehouse=? ORDER BY code COLLATE NOCASE,id`).all(warehouseId) as LocationRow[]).map(location);
  }
  listChildren(warehouseId: string, parentId: string | null) {
    return (this.db.prepare(`SELECT ${locationColumns} FROM locations WHERE warehouse=? AND parent_id IS ? ORDER BY code COLLATE NOCASE,id`).all(warehouseId,parentId) as LocationRow[]).map(location);
  }
  insert(value: StorageLocation) {
    this.db.prepare("INSERT INTO locations(id,code,name,warehouse,parent_id,status,created_at,updated_at,version,location_type,is_stockable,is_default) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(value.id,value.code,value.name,value.warehouseId,value.parentId,value.status,value.createdAt,value.updatedAt,value.version,value.locationType,Number(value.isStockable),Number(value.isDefault));
  }
  update(value: StorageLocation, expectedVersion: number) {
    return this.db.prepare("UPDATE locations SET code=?,name=?,parent_id=?,status=?,updated_at=?,version=?,location_type=?,is_stockable=? WHERE id=? AND version=?")
      .run(value.code,value.name,value.parentId,value.status,value.updatedAt,value.version,value.locationType,Number(value.isStockable),value.id,expectedVersion).changes === 1;
  }
}
