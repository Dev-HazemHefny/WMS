import type { Brand, Page, PageQuery, Unit } from "../../../shared/catalog/types";
import type { UnitDimension } from "../../../shared/catalog/types";
import type { BrandRepository, UnitRepository } from "../domain/repositories";
import { likeTerm, pageClause, readCount, rethrowDb, type SqlDatabase } from "./sql";

interface UnitRow {
  id: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  description: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

interface BrandRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  image_path: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

function mapUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    dimension: row.dimension,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    imagePath: row.image_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteUnitRepository implements UnitRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(unit: Unit): void {
    try {
      this.db.prepare(`INSERT INTO units (id, name, symbol, dimension, description, status, created_at, updated_at)
        VALUES (@id, @name, @symbol, @dimension, @description, @status, @createdAt, @updatedAt)`).run(unit);
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(unit: Unit): void {
    try {
      this.db.prepare(`UPDATE units SET name=@name, symbol=@symbol, dimension=@dimension, description=@description, status=@status, updated_at=@updatedAt WHERE id=@id`).run(unit);
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM units WHERE id = ?").run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): Unit | null {
    const row = this.db.prepare("SELECT * FROM units WHERE id = ?").get(id) as UnitRow | undefined;
    return row ? mapUnit(row) : null;
  }

  findByName(name: string): Unit | null {
    const row = this.db.prepare("SELECT * FROM units WHERE name = ?").get(name) as UnitRow | undefined;
    return row ? mapUnit(row) : null;
  }

  findBySymbol(symbol: string): Unit | null {
    const row = this.db.prepare("SELECT * FROM units WHERE symbol = ?").get(symbol) as UnitRow | undefined;
    return row ? mapUnit(row) : null;
  }

  list(query: PageQuery): Page<Unit> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR name LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\') AND (? IS NULL OR status = ?)`;
    const params = [term, term, term, query.status ?? null, query.status ?? null];
    const total = readCount(this.db, `SELECT COUNT(*) AS total FROM units ${filters}`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`SELECT * FROM units ${filters} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as UnitRow[];
    return { items: rows.map(mapUnit), total, page: query.page, pageSize: query.pageSize };
  }

  listAll(): Unit[] {
    return (this.db.prepare("SELECT * FROM units ORDER BY name COLLATE NOCASE").all() as UnitRow[]).map(mapUnit);
  }

  countUsage(id: string): number {
    return readCount(this.db, `SELECT
      (SELECT COUNT(*) FROM products WHERE base_unit_id = ?) +
      (SELECT COUNT(*) FROM product_variants WHERE base_unit_id = ?) +
      (SELECT COUNT(*) FROM product_packaging_units WHERE unit_id = ?) +
      (SELECT COUNT(*) FROM product_variant_packaging_units WHERE unit_id = ?) AS total`, [id, id, id, id]);
  }
}

export class SqliteBrandRepository implements BrandRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(brand: Brand): void {
    try {
      this.db.prepare(`INSERT INTO brands (id, name, code, description, image_path, status, created_at, updated_at)
        VALUES (@id, @name, @code, @description, @imagePath, @status, @createdAt, @updatedAt)`).run(brand);
    } catch (error) {
      rethrowDb(error);
    }
  }

  update(brand: Brand): void {
    try {
      this.db.prepare(`UPDATE brands
        SET name=@name, code=@code, description=@description, image_path=@imagePath, status=@status, updated_at=@updatedAt
        WHERE id=@id`).run(brand);
    } catch (error) {
      rethrowDb(error);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM brands WHERE id = ?").run(id);
    } catch (error) {
      rethrowDb(error);
    }
  }

  findById(id: string): Brand | null {
    const row = this.db.prepare("SELECT * FROM brands WHERE id = ?").get(id) as BrandRow | undefined;
    return row ? mapBrand(row) : null;
  }

  findByCode(code: string): Brand | null {
    const row = this.db.prepare("SELECT * FROM brands WHERE code = ?").get(code) as BrandRow | undefined;
    return row ? mapBrand(row) : null;
  }

  list(query: PageQuery): Page<Brand> {
    const term = likeTerm(query.search);
    const filters = `WHERE (? IS NULL OR name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') AND (? IS NULL OR status = ?)`;
    const params = [term, term, term, query.status ?? null, query.status ?? null];
    const total = readCount(this.db, `SELECT COUNT(*) AS total FROM brands ${filters}`, params);
    const { limit, offset } = pageClause(query.page, query.pageSize);
    const rows = this.db.prepare(`SELECT * FROM brands ${filters} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset) as BrandRow[];
    return { items: rows.map(mapBrand), total, page: query.page, pageSize: query.pageSize };
  }

  listAll(): Brand[] {
    return (this.db.prepare("SELECT * FROM brands ORDER BY name COLLATE NOCASE").all() as BrandRow[]).map(mapBrand);
  }

  countProducts(id: string): number {
    return readCount(this.db, "SELECT COUNT(*) AS total FROM products WHERE brand_id = ?", [id]);
  }
}
